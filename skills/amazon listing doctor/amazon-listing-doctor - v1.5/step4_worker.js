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

scrapeCompetitorSearch(coreProduct, marketplace, {
  maxCompetitors: 60,
  maxPerRound: 30,
  sort: 'review-rank'
}).then(async function(result) {
  // Fallback: if competitors < 5, try extra search phrases from title bigrams
  if (result.competitors.length < 5 && foundPhrases.length > 0) {
    var extraPhrases = (foundPhrases || [])
      .filter(function(p) { return p.split(/\s+/).length >= 2; })
      .filter(function(p) { return p.length > 4; })
      .filter(function(p) { return p.toLowerCase() !== coreProduct.toLowerCase(); })
      .slice(0, 5);

    if (extraPhrases.length > 0) {
      console.error('Fallback: only ' + result.competitors.length + ' competitors — trying extra phrases:', extraPhrases.join(', '));
      var seenAsin = new Set(result.competitors.map(function(c) { return c.asin; }));
      var merged = result.competitors.slice();
      var fallbackFound = 0;

      for (var fi = 0; fi < extraPhrases.length; fi++) {
        try {
          var extra = await scrapeCompetitorSearch(extraPhrases[fi], marketplace, {
            maxCompetitors: 60, maxPerRound: 30, sort: 'review-rank'
          });
          extra.competitors.forEach(function(c) {
            if (!seenAsin.has(c.asin)) {
              seenAsin.add(c.asin);
              merged.push(c);
              fallbackFound++;
            }
          });
          console.error('  Fallback "' + extraPhrases[fi] + '": +' + extra.competitors.length + ' (total merged: ' + merged.length + ')');
          if (merged.length >= 10) break; // stop if we have enough
        } catch(e) {
          console.error('  Fallback "' + extraPhrases[fi] + '" error: ' + e.message.split('\n')[0]);
        }
      }

      if (fallbackFound > 0) {
        console.error('Fallback complete: +' + fallbackFound + ' from extra phrases, total ' + merged.length);
        result.competitors = merged;
        result.totalFound = merged.length;
        result.fallbackPhrases = extraPhrases;
        result.fallbackFound = fallbackFound;
      }
    }
  }

  // ── 竞品过滤：移除标题不含核心品类词的无关产品 ──────────────
  // 例：coreProduct="sectional sofa" → 过滤掉 Ottoman、单人折叠沙发 等
  var FILTER_STOPWORDS = new Set(['with', 'for', 'and', 'the', 'set', 'new', 'home', 'room']);
  var coreWords = coreProduct.toLowerCase().split(/\s+/).filter(function(w) {
    return w.length > 3 && !FILTER_STOPWORDS.has(w);
  });

  var filtered = result.competitors;
  var filterApplied = false;

  if (coreWords.length > 0) {
    var afterFilter = result.competitors.filter(function(c) {
      if (!c.title) return false;
      var t = c.title.toLowerCase();
      return coreWords.some(function(w) { return t.includes(w); });
    });

    // 只在过滤后至少保留5条时应用，防止过度过滤
    if (afterFilter.length >= 5) {
      var removed = result.competitors.length - afterFilter.length;
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

  // 写入 checkpoint：保留原始竞品 + 新增 filteredCompetitors 字段
  var output = Object.assign({}, result, {
    filteredCompetitors: filtered,
    filterApplied: filterApplied,
    filterKeywords: coreWords,
    originalCompetitorCount: result.competitors.length,
    filteredCompetitorCount: filtered.length
  });

  var cpPath = path.join(cpDir, 'step4.json');
  fs.writeFileSync(cpPath, JSON.stringify(output), 'utf8');
  console.error('step4_worker: checkpoint written, total=' + result.competitors.length + ', filtered=' + filtered.length);
  console.log(JSON.stringify({ ok: true, totalFound: result.totalFound, rounds: result.cascadeRounds.length, filtered: filtered.length }));
}).catch(function(e) {
  console.error('Fatal:', e.message);
  process.exit(1);
});