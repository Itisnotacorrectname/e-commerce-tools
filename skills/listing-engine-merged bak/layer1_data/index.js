/**
 * layer1_data/index.js — Data Ingestion Layer
 *
 * 职责：抓取产品数据、清洗数据、导入评论。
 * 基于源A的结构，保持完整性。
 */

'use strict';

const normalizer = require('../core/normalizer.js');

// ── 1a. 抓取目标产品 ─────────────────────────────────────────
async function scrapeProduct(ctx) {
  var asin = ctx.input.asin;
  var url  = ctx.input.url;

  console.error('[layer1_data] Scraping product...');

  // 优先使用缓存的 checkpoint
  var checkpointDir = getCheckpointDir();
  var step2Path = asin ? checkpointDir + '\\' + asin + '\\step2.json' : null;

  if (step2Path && require('fs').existsSync(step2Path)) {
    try {
      var step2Data = JSON.parse(require('fs').readFileSync(step2Path, 'utf8'));
      ctx.raw.product = step2Data;
      console.error('[layer1_data] Loaded from checkpoint: ' + step2Path);
      return ctx;
    } catch(e) {
      console.error('[layer1_data] checkpoint load failed: ' + e.message);
    }
  }

  // 模拟抓取（生产环境替换为真实爬虫）
  var mockData = getMockData(asin || 'B0TEST12345');
  ctx.raw.product = mockData;

  return ctx;
}

function getCheckpointDir() {
  var workspace = process.env.OPENCLAW_WORKSPACE || 'C:\\Users\\csbd\\.openclaw\\workspace';
  return workspace + '\\amazon-listing-doctor\\checkpoints';
}

// ── 1b. 清洗数据 ─────────────────────────────────────────────
async function clean(ctx) {
  var raw = ctx.raw.product;
  if (!raw) return ctx;

  // 基本清洗
  if (raw.title) {
    raw.title = raw.title.replace(/\s{2,}/g, ' ').trim();
  }
  if (raw.bullets) {
    raw.bullets = raw.bullets.map(function(b) {
      return b ? b.replace(/\s{2,}/g, ' ').trim() : '';
    }).filter(Boolean);
  }

  return ctx;
}

// ── 1c. 导入评论 ─────────────────────────────────────────────
async function importReviews(ctx, reviewsPath) {
  if (!reviewsPath) return ctx;

  try {
    var data = JSON.parse(require('fs').readFileSync(reviewsPath, 'utf8'));
    ctx.raw.reviews = Array.isArray(data) ? data : (data.reviews || []);
    console.error('[layer1_data] Imported ' + ctx.raw.reviews.length + ' reviews');
  } catch(e) {
    console.error('[layer1_data] Failed to import reviews: ' + e.message);
  }

  return ctx;
}

// ── Mock 数据（开发/测试用）────────────────────────────────
function getMockData(asin) {
  return {
    asin: asin,
    title: 'DUMOS L Shaped Desk 47 Inch Computer Desk, L-Shaped Corner Gaming Table w/ Reversible Storage Shelves, for Home Office Writing Study (Black)',
    brand: 'DUMOS',
    bullets: [
      'Reversible & Space-Saving Design - This corner desk features reversible 2-tier shelves',
      'Large Workspace - 47" x 47" surface fits multiple monitors. Open leg design for comfortable seating',
      'Robust Stability with X-Brace Support - Reinforced steel frame, wobble-free',
      'Adjustable Feet - stays stable on uneven surfaces',
      'Easy Assembly - under 30 minutes, all tools included'
    ],
    price: 41.98,
    rating: 4.6,
    reviewCount: 110,
    category: 'Home & Kitchen > Furniture > Home Office Furniture > Desks',
    images: [],
    marketplace: 'US'
  };
}

module.exports = { scrapeProduct, clean, importReviews };