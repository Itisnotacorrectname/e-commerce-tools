/**
 * layer1_data/index.js — Data Layer
 *
 * 职责：数据获取、清洗、导入。
 * 对外暴露 pipeline.js 需要的接口。
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

var WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
var CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');

// ── 工具函数 ──────────────────────────────────────────────────
function loadCheckpoint(asin, step) {
  var p = path.join(CHECKPOINT_DIR, asin, 'step' + step + '.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

// ── scrapeProduct ─────────────────────────────────────────────
// 从 step2.json checkpoint 读取（爬虫由 diagnose.js 的 step2_worker 完成）
// 新架构里爬虫保持不变，这里只是数据接入层
async function scrapeProduct(context) {
  var asin = context.input.asin;
  var url  = context.input.url;

  // 从 URL 提取 ASIN
  if (!asin && url) {
    var m = url.match(/\/dp\/([A-Z0-9]{10})/);
    if (m) asin = m[1];
  }

  if (!asin) throw new Error('ASIN required — provide input.asin or input.url');

  // 尝试从 checkpoint 读取
  var step2 = loadCheckpoint(asin, 2);
  if (!step2) {
    // 如果 checkpoint 不存在，触发 step2_worker
    var workerPath = path.join(
      process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace'),
      'skills', 'amazon-listing-doctor', 'step2_worker.js'
    );

    if (!fs.existsSync(workerPath)) {
      throw new Error('step2.json not found and step2_worker.js not available. Run diagnose.js first.');
    }

    // spawn step2_worker 同步等待
    step2 = await new Promise(function(resolve, reject) {
      var { spawn } = require('child_process');
      var child = spawn(process.execPath, [workerPath, asin], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      var stdout = '';
      child.stdout.on('data', function(d) { stdout += d; });
      child.on('close', function(code) {
        if (code !== 0) { reject(new Error('step2_worker exited ' + code)); return; }
        // 重新读 checkpoint
        var result = loadCheckpoint(asin, 2);
        if (result) resolve(result);
        else reject(new Error('step2_worker ran but checkpoint not found'));
      });
      child.on('error', reject);
    });
  }

  context.input.asin    = asin;
  context.raw.product   = step2;

  // 从 step4 读取竞品（如果存在）
  var step4 = loadCheckpoint(asin, 4);
  if (step4) {
    context.raw.competitors = step4.filteredCompetitors || step4.competitors || [];
    // 把 step4 原始数据也保存一份供 market 层使用
    context._step4 = step4;
  }

  return context;
}

// ── clean ─────────────────────────────────────────────────────
function clean(context) {
  var raw = context.raw.product;
  if (!raw) return context;

  // title 清洗
  if (raw.title) {
    raw.title = raw.title
      .replace(/\s{2,}/g, ' ')           // 多余空格
      .replace(/&amp;/g, '&')            // HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')            // 数字 HTML entities
      .trim();
  }

  // bullets 清洗
  if (Array.isArray(raw.bullets)) {
    raw.bullets = raw.bullets
      .filter(Boolean)
      .map(function(b) {
        return b.replace(/\s{2,}/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .trim();
      })
      .filter(function(b) { return b.length > 5; });
  }

  // price 标准化（确保是数字）
  if (raw.price && typeof raw.price === 'string') {
    raw.price = parseFloat(raw.price.replace(/[^0-9.]/g, '')) || null;
  }

  // rating 标准化
  if (raw.rating && typeof raw.rating === 'string') {
    var ratingMatch = raw.rating.match(/(\d+\.?\d*)/);
    raw.rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
  }

  // reviewCount 标准化
  if (raw.reviewCount && typeof raw.reviewCount === 'string') {
    raw.reviewCount = parseInt(raw.reviewCount.replace(/[^0-9]/g, '')) || 0;
  }

  context.raw.product = raw;
  return context;
}

// ── importReviews ─────────────────────────────────────────────
// 支持：文件路径（JSON/CSV）或直接传入数组
async function importReviews(context, source) {
  if (!source) return context;

  var reviews = [];

  if (typeof source === 'string') {
    // 文件路径
    if (!fs.existsSync(source)) {
      console.error('[layer1] Reviews file not found: ' + source);
      return context;
    }
    var ext  = path.extname(source).toLowerCase();
    var data = fs.readFileSync(source, 'utf8');

    if (ext === '.json') {
      reviews = JSON.parse(data);
    } else if (ext === '.csv') {
      // 简单 CSV 解析：假设格式为 text,rating,date
      var lines = data.split('\n').slice(1);  // 跳过 header
      reviews = lines.filter(Boolean).map(function(line) {
        var parts = line.split(',');
        return { text: parts[0] || '', rating: parseFloat(parts[1]) || 0, date: parts[2] || '' };
      });
    }
  } else if (Array.isArray(source)) {
    reviews = source;
  }

  context.raw.reviews = reviews.filter(function(r) { return r && r.text; });
  console.error('[layer1] Imported ' + context.raw.reviews.length + ' reviews');
  return context;
}

module.exports = { scrapeProduct, clean, importReviews };
