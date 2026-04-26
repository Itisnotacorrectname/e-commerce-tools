#!/usr/bin/env node
/**
 * step2_worker.js — Isolated Playwright scraper for diagnose.js
 * Usage: node step2_worker.js <ASIN> [cc]
 *
 * 爬取产品页数据（title, bullets, price, rating, BSR, category）
 * 使用 lib/amazon_scraper.js 的通用逻辑（ZIP+reload geo bypass）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { scrapeProductPage } = require(path.join(__dirname, 'lib', 'amazon_scraper.js'));

const asin = String(process.argv[2] || '').trim();
const cc = (process.argv[3] || 'US').toUpperCase();

if (!asin || asin.length < 5) {
  console.error('Usage: node step2_worker.js <ASIN> [cc]');
  process.exit(1);
}

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
const cpDir = path.join(CHECKPOINT_DIR, asin);
if (!fs.existsSync(cpDir)) fs.mkdirSync(cpDir, { recursive: true });

console.error('step2_worker: asin=' + asin + ' cc=' + cc);

scrapeProductPage(asin, cc).then(function(result) {
  const cpPath = path.join(cpDir, 'step2.json');
  fs.writeFileSync(cpPath, JSON.stringify(result), 'utf8');
  console.error('step2_worker: checkpoint written, title length=' + result.title.length);
  console.log('__STEP2_OUTPUT__' + JSON.stringify(result) + '__STEP2_OUTPUT__');
}).catch(function(e) {
  console.error('Fatal:', e.message);
  process.exit(1);
});