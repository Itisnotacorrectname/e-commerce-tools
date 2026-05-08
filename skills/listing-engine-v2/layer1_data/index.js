/**
 * layer1_data/index.js — Listing Engine v2.0
 *
 * 职责：Layer 1 — 数据抓取。
 * 调用外部 scraper 获取原始产品数据。
 *
 * 数据来源优先级：
 *   1. 传入的 step2.json（断点续跑）
 *   2. 调用 universal-scraper 抓取
 *   3. 从 checkpoint 读取
 */

'use strict';

var path   = require('path');
var fs     = require('fs');
var ctxBus = require('../core/context.js');

// ── 尝试从 checkpoint 加载 ───────────────────────────────────
function loadFromCheckpoint(ctx) {
  var asin = ctx.input.asin;
  if (!asin) return null;

  var cpDir = path.join(__dirname, '..', '..', 'amazon-listing-doctor', 'checkpoints', asin);
  var step2  = path.join(cpDir, 'step2.json');

  if (fs.existsSync(step2)) {
    try {
      var data = JSON.parse(fs.readFileSync(step2, 'utf8'));
      console.log('[layer1_data] Loaded from checkpoint: ' + step2);
      return data;
    } catch(e) {
      console.warn('[layer1_data] Failed to parse step2.json: ' + e.message);
    }
  }
  return null;
}

// ── 抓取新产品 ───────────────────────────────────────────────
async function scrape(ctx, input) {
  var asin = input.asin;
  var url  = input.url;

  if (!asin && !url) {
    ctxBus.markMissing(ctx, 'raw.product', 'No asin or url provided');
    return ctx;
  }

  // 优先复用 checkpoint 数据
  var cached = loadFromCheckpoint(ctx);
  if (cached && !input.options.force) {
    ctx.raw.product = cached;
    ctxBus.setConfidence(ctx, 'raw.product', 1.0);
    return ctx;
  }

  // TODO: 调用 universal-scraper
  // 暂时标记为需要人工导入数据
  ctxBus.markMissing(ctx, 'raw.product', 'Scraper not implemented — provide step2.json manually or run via amazon-listing-doctor first');
  ctxBus.flagManualReview(ctx, 'layer1_data: scraping not wired up yet — use amazon-listing-doctor to produce step2.json');

  return ctx;
}

async function run(ctx, input) {
  var t0 = Date.now();

  // 如果已经有 product 数据（外部传入），直接使用
  if (ctx.raw.product) {
    console.log('[layer1_data] product already in context, skipping scrape');
    ctxBus.setConfidence(ctx, 'raw.product', 0.9);
    ctxBus.setCheckpoint(ctx, 'layer1_data');
    return ctx;
  }

  await scrape(ctx, input);

  ctxBus.logExecution(ctx, 'layer1_data', 'layer1_data', ctx.raw.product ? 'success' : 'failed', Date.now() - t0);
  if (ctx.raw.product) ctxBus.setCheckpoint(ctx, 'layer1_data');

  return ctx;
}

module.exports = { run: run, scrape: scrape };