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
const { scrapeCompetitorSearch } = require(path.join(__dirname, 'lib', 'amazon_scraper.js'));

const asin = String(process.argv[2] || '').trim();
const coreProduct = String(process.argv[3] || '').trim();
const marketplace = String(process.argv[4] || 'US').toUpperCase();
let foundPhrases = [];
try { foundPhrases = JSON.parse(process.argv[5] || '[]'); } catch(e) {}

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

// 从 foundPhrases 里提取备选搜索词：
// - 2–3 词短语优先（不要单词，太泛；不要 4 词+，Amazon 匹配差）
// - 去掉和 coreProduct 完全一样的词
// - 最多取 5 个
function extractFallbackTerms(foundPhrases, coreProduct) {
  var core = (coreProduct || '').toLowerCase().trim();
  return (foundPhrases || [])
    .map(function(p) { return String(p).toLowerCase().trim(); })
    .filter(function(p) {
      var wc = p.split(/\s+/).length;
      return wc >= 2 && wc <= 3 && p !== core && p.length > 4;
    })
    .filter(function(p, i, arr) { return arr.indexOf(p) === i; }) // 去重
    .slice(0, 5);
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
  if (allCompetitors.length < 10 && foundPhrases.length > 0) {
    var fallbackTerms = extractFallbackTerms(foundPhrases, coreProduct);
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

  // ── 竞品过滤：移除标题不含核心品类词的无关产品 ──────────────
  var FILTER_STOPWORDS = new Set(['with', 'for', 'and', 'the', 'set', 'new', 'home', 'room']);

  // 过滤词来源：coreProduct + fallbackTerms 里的词，取并集
  var filterSourceWords = [coreProduct].concat(fallbackTermsUsed)
    .join(' ').toLowerCase().split(/\s+/)
    .filter(function(w) { return w.length > 3 && !FILTER_STOPWORDS.has(w); });
  // 去重
  var coreWords = filterSourceWords.filter(function(w, i, arr) { return arr.indexOf(w) === i; });

  var filtered = allCompetitors;
  var filterApplied = false;

  if (coreWords.length > 0) {
    var afterFilter = allCompetitors.filter(function(c) {
      if (!c.title) return false;
      var t = c.title.toLowerCase();
      return coreWords.some(function(w) { return t.includes(w); });
    });

    if (afterFilter.length >= 5) {
      var removed = allCompetitors.length - afterFilter.length;
      if (removed > 0) {
        console.error('Competitor filter: removed ' + removed + ' irrelevant titles, kept ' + afterFilter.length);
        console.error('Filter keywords:', coreWords.join(', '));
      }
      filtered = afterFilter;
      filterApplied = true;
    } else {
      console.error('Competitor filter: would leave only ' + afterFilter.length + ' — skipping (threshold: 5)');
    }
  }

  // ── 写入 checkpoint ───────────────────────────────────────
  var output = Object.assign({}, result, {
    competitors:            allCompetitors,
    cascadeRounds:          allRounds,
    totalFound:             totalFound,
    filteredCompetitors:    filtered,
    filterApplied:          filterApplied,
    filterKeywords:         coreWords,
    originalCompetitorCount: allCompetitors.length,
    filteredCompetitorCount: filtered.length,
    usedFallback:           usedFallback,
    fallbackTermsUsed:      fallbackTermsUsed,
    lowCompetitorWarning:   filtered.length < 5
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
    fallbackTermsUsed: fallbackTermsUsed
  }));
}).catch(function(e) {
  console.error('Fatal:', e.message);
  process.exit(1);
});