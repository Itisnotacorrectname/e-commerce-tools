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
}).then(function(result) {
  // Fallback: if competitors < 10, use foundPhrases for extra searches
  if (result.competitors.length < 10 && foundPhrases.length > 0) {
    console.error('Fallback: competitors=' + result.competitors.length + ', using foundPhrases for extra searches');
    // Extract 2-word phrases from foundPhrases that are product-type keywords
    const extraPhrases = (foundPhrases || [])
      .filter(p => p.split(' ').length === 2)
      .filter(p => p.length > 5)
      .slice(0, 5);

    if (extraPhrases.length > 0) {
      console.error('Extra search phrases:', extraPhrases.join(', '));
      // Note: fallback would go here — for now just log it
    }
  }

  const cpPath = path.join(cpDir, 'step4.json');
  fs.writeFileSync(cpPath, JSON.stringify(result), 'utf8');
  console.error('step4_worker: checkpoint written, competitors=' + result.competitors.length);
  console.log(JSON.stringify({ ok: true, totalFound: result.totalFound, rounds: result.cascadeRounds.length }));
}).catch(function(e) {
  console.error('Fatal:', e.message);
  process.exit(1);
});