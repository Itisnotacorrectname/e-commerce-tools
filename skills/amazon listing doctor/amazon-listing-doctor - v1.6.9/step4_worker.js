#!/usr/bin/env node
/**
 * step4_worker.js — Isolated Playwright competitor scraper for diagnose.js
 * Usage: node step4_worker.js <ASIN> <coreProduct> [foundPhrasesJson]
 *
 * 爬取竞品搜索结果，使用 lib/amazon_scraper.js 的通用逻辑（ZIP+reload geo bypass）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { scrapeCompetitorSearch, STOPWORDS } = require(path.join(__dirname, 'lib', 'amazon_scraper.js'));

const asin = String(process.argv[2] || '').trim();
const coreProduct = String(process.argv[3] || '').trim();
const marketplace = String(process.argv[4] || 'US').toUpperCase();
let foundPhrases = [];
try { foundPhrases = JSON.parse(process.argv[5] || '[]'); } catch(e) {}
let categoryFallback = process.argv[6] || '';  // category path, e.g. "Office Products > Office Furniture & Lighting > Chairs & Sofas > Drafting Chairs"

if (!asin) {
  console.error('Usage: node step4_worker.js <ASIN> <coreProduct> [foundPhrasesJson]');
  process.exit(1);
}

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
const cpDir = path.join(CHECKPOINT_DIR, asin);
if (!fs.existsSync(cpDir)) fs.mkdirSync(cpDir, { recursive: true });

console.error('step4_worker: asin=' + asin + ' coreProduct="' + coreProduct + '"');

// ── 主搜索 + fallback 搜索流程 ───────────────────────────────
// 策略：
//   1. 先用 coreProduct 搜索
//   2. 若结果 < 10，从 foundPhrases 提取备选词逐个搜索，合并结果（去重）
//   3. 若仍然 < 5，保留现有结果并打 warning 标记

function dedupeByAsin(competitors) {
  var seen = new Set();
  return competitors.filter(function(c) {
    if (!c.asin || seen.has(c.asin)) return false;
    seen.add(c.asin);
    return true;
  });
}

// 从 foundPhrases + coreProduct + categoryFallback 提取备选搜索词
// 优先使用 foundPhrases（已有搜索结果的短语）
// 当 foundPhrases 为空时，从 coreProduct 自身拆解（v1.6.5 修复）
// - 2–3 词短语优先（不要单词，太泛；不要 4 词+，Amazon 匹配差）
// - 去掉和 coreProduct 完全一样的词
// - 最多取 5 个
function extractFallbackTerms(foundPhrases, coreProduct, categoryFallback) {
  var core = (coreProduct || '').toLowerCase().trim();
  var STOPWORDS = new Set(['with', 'for', 'and', 'the', 'set', 'new', 'home', 'room',
    'from', 'this', 'that', 'are', 'was', 'it', 'be', 'to', 'in', 'on', 'of', 'a', 'an']);

  var terms = [];

  // Primary: from foundPhrases (search result derived terms)
  if (foundPhrases && foundPhrases.length > 0) {
    var fromFound = (foundPhrases || [])
      .map(function(p) { return String(p).toLowerCase().trim(); })
      .filter(function(p) {
        var wc = p.split(/\s+/).length;
        return wc >= 2 && wc <= 3 && p !== core && p.length > 4 && !STOPWORDS.has(p);
      })
      .filter(function(p, i, arr) { return arr.indexOf(p) === i; })
      .slice(0, 5);
    terms = terms.concat(fromFound);
  }

  // Secondary: when foundPhrases is empty, extract from coreProduct itself
  if (terms.length === 0 && core) {
    var coreWords = core.split(/\s+/).filter(function(w) { return w.length > 2 && !STOPWORDS.has(w); });
    // Extract 2-word and 3-word phrases from coreProduct
    for (var i = 0; i < coreWords.length - 1; i++) {
      var bi = coreWords[i] + ' ' + coreWords[i + 1];
      if (bi !== core && bi.length > 5) terms.push(bi);
    }
    for (var j = 0; j < coreWords.length - 2; j++) {
      var tri = coreWords[j] + ' ' + coreWords[j + 1] + ' ' + coreWords[j + 2];
      if (tri !== core && tri.length > 7) terms.push(tri);
    }
    terms = terms.filter(function(p, i, arr) { return arr.indexOf(p) === i; }).slice(0, 5);
  }

  // Tertiary: category last part as fallback
  if (categoryFallback && terms.length === 0) {
    var parts = categoryFallback.split('>').map(function(p) { return p.trim(); });
    var catLast = (parts[parts.length - 1] || '').toLowerCase().replace(/s$/, '').trim();
    if (catLast && catLast !== core && catLast.length > 3 && !STOPWORDS.has(catLast)) {
      terms.push(catLast);
    }
  }

  return terms.slice(0, 5);
}

scrapeCompetitorSearch(coreProduct, marketplace, {
  maxCompetitors: 60,
  maxPerRound: 30,
  sort: 'review-rank'
}).then(async function(result) {
  var allCompetitors = result.competitors.slice();
  var allRounds = result.cascadeRounds.slice();
  var totalFound = result.totalFound;
  var usedFallback = false;
  var fallbackTermsUsed = [];

  // ── Fallback：主搜索结果不足时用备选词补充 ────────────────
  // 同时：当 cascade 返回了结果但质量极差时，也强制走 category fallback
  var needsQualityFallback = (allCompetitors.length >= 10) &&
    (allCompetitors.filter(function(c) {
      if (!c.title) return false;
      var t = c.title.toLowerCase();
      // 如果竞品标题不含任何 coreProduct 的核心词，认为是脏数据
      var coreWords = (coreProduct || '').split(/\s+/).filter(function(w) { return w.length > 3; });
      return !coreWords.some(function(w) { return t.includes(w); });
    }).length / allCompetitors.length > 0.6);

  if ((allCompetitors.length < 10 || needsQualityFallback) && (foundPhrases.length > 0 || categoryFallback)) {
    // Extract category-based fallback term first (most reliable: Amazon's own taxonomy)
    var catTerm = '';
    if (categoryFallback) {
      var parts = categoryFallback.split('>').map(function(p) { return p.trim(); });
      // Use the last non-generic category part
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i].toLowerCase();
        if (p.length > 4 && p !== coreProduct && !STOPWORDS.has(p)) {
          catTerm = p;
          break;
        }
      }
    }

    var fallbackTerms = extractFallbackTerms(foundPhrases, coreProduct, categoryFallback);
    // Prepend category term (higher priority than title-derived terms)
    if (catTerm && fallbackTerms.indexOf(catTerm) === -1) {
      fallbackTerms.unshift(catTerm);
    }

    if (needsQualityFallback) {
      console.error('Quality check: ' +
        Math.round((allCompetitors.filter(function(c) {
          if (!c.title) return false;
          var t = c.title.toLowerCase();
          var coreWords = (coreProduct || '').split(/\s+/).filter(function(w) { return w.length > 3; });
          return !coreWords.some(function(w) { return t.includes(w); });
        }).length / allCompetitors.length) * 100) +
        '% competitors missing coreProduct keywords — forcing category fallback');
    }

    console.error('Fallback triggered: main search found ' + allCompetitors.length +
                  ' competitors. Trying ' + fallbackTerms.length + ' fallback terms: ' +
                  fallbackTerms.join(', '));

    for (var i = 0; i < fallbackTerms.length; i++) {
      var term = fallbackTerms[i];
      // 已经有足够竞品就停止
      if (allCompetitors.length >= 20) break;

      console.error('  Fallback round ' + (i + 1) + ': searching "' + term + '"');
      try {
        var fbResult = await scrapeCompetitorSearch(term, marketplace, {
          maxCompetitors: 30,
          maxPerRound: 30,
          sort: 'review-rank'
        });

        if (fbResult.competitors && fbResult.competitors.length > 0) {
          var before = allCompetitors.length;
          allCompetitors = dedupeByAsin(allCompetitors.concat(fbResult.competitors));
          var added = allCompetitors.length - before;
          totalFound += fbResult.totalFound;
          allRounds = allRounds.concat(fbResult.cascadeRounds.map(function(r) {
            return Object.assign({}, r, { fallbackTerm: term });
          }));
          fallbackTermsUsed.push(term);
          usedFallback = true;
          console.error('  "' + term + '": added ' + added + ' new competitors (total now: ' + allCompetitors.length + ')');
        } else {
          console.error('  "' + term + '": 0 results');
        }
      } catch(e) {
        console.error('  "' + term + '" search error: ' + e.message);
      }
    }

    if (allCompetitors.length < 5) {
      console.error('⚠ Warning: only ' + allCompetitors.length + ' competitors found after all fallbacks');
    } else {
      console.error('Fallback complete: ' + allCompetitors.length + ' total competitors');
    }
  }

  // ── v1.6.3: Product-type phrase extraction + filter ──────────────────
  // Extract 2-word and 3-word product-type phrases from target title
  // Use these as filter criteria instead of single words
  var PRODUCT_STOPWORDS = new Set(['with', 'for', 'and', 'the', 'set', 'new', 'home', 'room',
    'from', 'this', 'that', 'are', 'was', 'it', 'be', 'to', 'in', 'on', 'of', 'a', 'an',
    'by', 'or', 'as', 'at', 'your', 'you', 'not', 'but', 'can', 'all', 'one', 'two',
    'three', 'four', 'five', 'six', 'use', 'used', 'best', 'top', 'more', 'most',
    'only', 'easy', 'free', 'fast', 'safe', 'large', 'small', 'mini', 'max', 'plus',
    'pro', 'prime', 'extra', 'ultra', 'super', 'black', 'white', 'grey', 'gray']);

  // Extract all meaningful n-grams (2-word and 3-word) from title
  function extractProductPhrases(title) {
    var words = title.toLowerCase()
      .replace(/[\-\/]/g, ' ')
      .split(/\s+/)
      .filter(function(w) { return w.length > 2 && !PRODUCT_STOPWORDS.has(w) && !/^[0-9"']/.test(w); });

    var phrases = [];
    // 2-word phrases
    for (var i = 0; i < words.length - 1; i++) {
      phrases.push(words[i] + ' ' + words[i + 1]);
    }
    // 3-word phrases
    for (var j = 0; j < words.length - 2; j++) {
      phrases.push(words[j] + ' ' + words[j + 1] + ' ' + words[j + 2]);
    }
    return phrases;
  }

  // Score a competitor title: how many product phrases match?
  function countPhraseMatches(compTitle, phrases) {
    if (!compTitle) return 0;
    var t = compTitle.toLowerCase();
    var count = 0;
    phrases.forEach(function(p) {
      if (t.indexOf(p) !== -1) count++;
    });
    return count;
  }

  // Extract product-type phrases from target title (from step2 checkpoint)
  var targetTitle = ''; // will be loaded from step2
  try {
    var step2Path = path.join(CHECKPOINT_DIR, asin, 'step2.json');
    if (fs.existsSync(step2Path)) {
      var step2 = JSON.parse(fs.readFileSync(step2Path, 'utf8'));
      targetTitle = step2.title || '';
    }
  } catch(e) {}

  var productPhrases = targetTitle ? extractProductPhrases(targetTitle) : [];

  // Also add coreProduct bigrams from cascade terms as fallback phrases
  var cascadePhrases = (coreProduct || '').split(/\s+/).filter(function(w) { return w.length > 3; });
  if (cascadePhrases.length >= 2) {
    cascadePhrases.forEach(function(w, i) {
      if (i < cascadePhrases.length - 1) {
        productPhrases.push(cascadePhrases[i] + ' ' + cascadePhrases[i + 1]);
      }
    });
  }

  // Deduplicate
  productPhrases = productPhrases.filter(function(p, i, arr) { return arr.indexOf(p) === i; });

  // v1.6.5: Add phrases from successful fallback search terms
  // If competitors were found via fallback, extract phrases from those search terms
  if (usedFallback && fallbackTermsUsed.length > 0) {
    var SEARCH_STOPWORDS = new Set(['for', 'and', 'the', 'with', 'of', 'to', 'in', 'on', 'a', 'an']);
    fallbackTermsUsed.forEach(function(term) {
      var words = term.toLowerCase().replace(/[-/]/g, ' ').split(/s+/).filter(function(w) {
        return w.length > 2 && !SEARCH_STOPWORDS.has(w) && !/^[0-9"']/.test(w);
      });
      // 2-word phrases from search term
      for (var i = 0; i < words.length - 1; i++) {
        var bi = words[i] + ' ' + words[i + 1];
        if (bi.length > 5) productPhrases.push(bi);
      }
      // 3-word phrases from search term
      for (var j = 0; j < words.length - 2; j++) {
        var tri = words[j] + ' ' + words[j + 1] + ' ' + words[j + 2];
        if (tri.length > 8) productPhrases.push(tri);
      }
      // Also add the full term itself if >= 2 words
      if (words.length >= 2) {
        productPhrases.push(term);
      }
    });
    // Deduplicate again after adding fallback phrases
    productPhrases = productPhrases.filter(function(p, i, arr) { return arr.indexOf(p) === i; });
  }

  var filtered = allCompetitors;
  var filterApplied = false;

  if (productPhrases.length > 0) {
    // Score all competitors by phrase match count
    var scored = allCompetitors.map(function(c) {
      return { comp: c, score: countPhraseMatches(c.title, productPhrases) };
    });
    // Keep competitors with >= 2 three-word phrase matches (strict: must have real product-type overlap)
    var threeWordPhrases = productPhrases.filter(function(p) { return p.split(/\s+/).length >= 3; });
    // Require strong product-type signal: must match at least 2 product-type phrases,
    // OR match a single 3+ word phrase (which is highly specific)
    var afterFilter = scored.filter(function(s) {
      var t = (s.comp.title || '').toLowerCase();
      // Count 3+ word phrases (high specificity)
      var longMatches = threeWordPhrases.filter(function(p) { return t.indexOf(p) !== -1; }).length;
      if (longMatches >= 1) return true;
      // Count 2-word phrases (lower specificity, need >= 2)
      var twoWordPhrases = productPhrases.filter(function(p) { return p.split(/\s+/).length === 2; });
      var shortMatches = twoWordPhrases.filter(function(p) { return t.indexOf(p) !== -1; }).length;
      return shortMatches >= 2;
    }).map(function(s) { return s.comp; });

    if (afterFilter.length >= 5) {
      var removed = allCompetitors.length - afterFilter.length;
      if (removed > 0) {
        console.error('Competitor filter (v1.6.3): removed ' + removed + ' irrelevant titles, kept ' + afterFilter.length);
        console.error('Filter phrases: ' + productPhrases.slice(0, 10).join(', '));
      }
      filtered = afterFilter;
      filterApplied = true;
    } else {
      console.error('Competitor filter: would leave only ' + afterFilter.length + ' — skipping (threshold: 5)');
    }
  }

  // ── v1.6.9: 价格抓取验证 ──────────────────────────────
  var priceFound = allCompetitors.filter(function(c) { return c.price && c.price.trim().length > 0; }).length;
  var priceRate = allCompetitors.length > 0 ? priceFound / allCompetitors.length : 0;
  console.error('Price capture rate: ' + priceFound + '/' + allCompetitors.length + ' = ' + (priceRate * 100).toFixed(0) + '%');
  if (priceRate < 0.3 && allCompetitors.length >= 5) {
    console.error('⚠ Price capture rate < 30% — possible geo-redirect or Amazon anti-bot. Recommend retry with different IP.');
  }

  // ── 写入 checkpoint ───────────────────────────────────────
  var output = Object.assign({}, result, {
    competitors:            allCompetitors,
    cascadeRounds:          allRounds,
    totalFound:             totalFound,
    filteredCompetitors:    filtered,
    filterApplied:          filterApplied,
    filterKeywords:         productPhrases || [],
    originalCompetitorCount: allCompetitors.length,
    filteredCompetitorCount: filtered.length,
    usedFallback:           usedFallback,
    fallbackTermsUsed:      fallbackTermsUsed,
    lowCompetitorWarning:   filtered.length < 5,
    priceCaptureRate:       priceRate,
    priceFound:             priceFound,
    priceTotal:             allCompetitors.length
  });

  var cpPath = path.join(cpDir, 'step4.json');
  fs.writeFileSync(cpPath, JSON.stringify(output), 'utf8');
  console.error('step4_worker: done. total=' + allCompetitors.length +
                ', filtered=' + filtered.length +
                (usedFallback ? ', fallback used: [' + fallbackTermsUsed.join(', ') + ']' : ''));
  console.log(JSON.stringify({
    ok: true,
    totalFound: totalFound,
    rounds: allRounds.length,
    filtered: filtered.length,
    usedFallback: usedFallback,
    fallbackTermsUsed: fallbackTermsUsed,
    priceCaptureRate: priceRate,
    priceFound: priceFound
  }));
}).catch(function(e) {
  console.error('Fatal:', e.message);
  process.exit(1);
});