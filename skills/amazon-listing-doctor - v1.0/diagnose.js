#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  Amazon Listing Doctor — diagnose.js v6.0 (Route B)
//
//  职责：数据层（step1-4），只爬虫，不分析。
//  分析由 Claude Agent 执行（参见 SKILL.md）。
//
//  Usage:
//    node diagnose.js B0GVRS65WW
//    node diagnose.js https://www.amazon.com/dp/B0GVRS65WW
//    node diagnose.js B0GVRS65WW --force   (强制重新抓取，忽略缓存)
// ─────────────────────────────────────────────────────────────

'use strict';

const path    = require('path');
const os      = require('os');
const fs      = require('fs');

// ── Paths ────────────────────────────────────────────────────
const WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
const REPORT_DIR     = path.join(WORKSPACE, 'amazon-listing-doctor', 'reports');
const SKILL_DIR      = __dirname;

// ── Marketplace map ─────────────────────────────────────────
const DOMAIN_TO_CC = {
  'amazon.com':    'US', 'amazon.co.uk': 'GB', 'amazon.de':    'DE',
  'amazon.fr':     'FR', 'amazon.it':    'IT', 'amazon.es':    'ES',
  'amazon.co.jp':  'JP', 'amazon.ca':    'CA', 'amazon.com.au':'AU',
  'amazon.com.mx': 'MX', 'amazon.in':    'IN'
};

// ── Utilities ────────────────────────────────────────────────
function log(msg) { console.log(String(msg || '')); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function cpPath(asin, n) {
  var dir = path.join(CHECKPOINT_DIR, asin);
  ensureDir(dir);
  return path.join(dir, 'step' + n + '.json');
}

function loadCp(asin, n) {
  var p = cpPath(asin, n);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

function saveCp(asin, n, data) {
  fs.writeFileSync(cpPath(asin, n), JSON.stringify(data, null, 2), 'utf8');
}

// ── Step 1: ASIN + Marketplace 解析 ─────────────────────────
async function step1() {
  var arg = process.argv[2] || '';
  var force = process.argv.includes('--force');

  // 直接是 ASIN
  var asinMatch = arg.match(/^(B[A-Z0-9]{9})$/);
  if (asinMatch) {
    return { asin: asinMatch[1], marketplace: 'US', domain: 'amazon.com',
             inputUrl: 'https://amazon.com/dp/' + asinMatch[1], force };
  }

  // 是 URL
  var urlMatch = arg.match(/amazon\.([a-z.]+)\/(?:[^/]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  if (urlMatch) {
    var rawDomain = 'amazon.' + urlMatch[1].replace(/\/$/, '');
    var asin = urlMatch[2].toUpperCase();
    var cc = DOMAIN_TO_CC[rawDomain] || 'US';
    return { asin, marketplace: cc, domain: rawDomain,
             inputUrl: 'https://www.' + rawDomain + '/dp/' + asin, force };
  }

  throw new Error('Invalid input. Usage: node diagnose.js [ASIN|URL] [--force]');
}

// ── Step 2: 产品页爬取（Playwright子进程） ───────────────────
async function step2(s1) {
  return new Promise(function(resolve) {
    var workerPath = path.join(SKILL_DIR, 'step2_worker.js');
    var child = require('child_process').spawn(
      process.execPath, [workerPath, s1.asin, s1.marketplace],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    var stdout = '', stderr = '';
    child.stdout.on('data', function(d) { stdout += d; });
    child.stderr.on('data', function(d) {
      var line = d.toString().trim();
      if (line) log('  [step2] ' + line);
    });
    child.on('close', function(code) {
      // step2_worker 把数据包在 __STEP2_OUTPUT__...__STEP2_OUTPUT__ 之间输出
      var MARKER = '__STEP2_OUTPUT__';
      var start = stdout.indexOf(MARKER);
      var end   = stdout.lastIndexOf(MARKER);
      if (start !== -1 && end !== -1 && start !== end) {
        try {
          var parsed = JSON.parse(stdout.substring(start + MARKER.length, end));
          resolve(parsed);
          return;
        } catch(e) { /* fall through */ }
      }
      // 降级：返回空结构，让后续步骤能继续但知道数据缺失
      log('  [step2] ⚠ Worker failed (exit ' + code + ') — empty product data');
      resolve({
        asin: s1.asin, marketplace: s1.marketplace, domain: s1.domain,
        title: '', bullets: [], price: null, rating: null,
        reviewCount: 0, BSR: null, category: null, brand: null,
        scrapeError: stderr.split('\n')[0] || 'Unknown error'
      });
    });
    child.on('error', function(e) {
      log('  [step2] ⚠ Spawn error: ' + e.message);
      resolve({
        asin: s1.asin, marketplace: s1.marketplace, domain: s1.domain,
        title: '', bullets: [], price: null, rating: null,
        reviewCount: 0, BSR: null, category: null, brand: null,
        scrapeError: e.message
      });
    });
  });
}

// ── Step 3: coreProduct 推断（轻量，无网络请求） ─────────────
// 从 step2 的 title + category 推断核心产品词，作为 step4 竞品搜索词。
// 注意：真正的关键词分析由 Claude 在 SKILL.md 分析层执行。
// 这里只做"搜什么词去找竞品"这一件事。
async function step3(s2) {
  var title    = s2.title || '';
  var category = s2.category || '';
  var brand    = (s2.brand || '').toLowerCase();

  // 从 category 路径的倒数两段组合提取产品类型
  // 策略：最后一段作为核心品类词，倒数第二段提供修饰词
  // 例：...> Patio Furniture Sets > Dining Sets → "patio dining set"
  var catParts = category.split('>').map(function(p) { return p.trim(); });
  var CAT_IGNORE = new Set(['products','items','sale','deals','collections','accessories','supplies','furniture']);
  
  var catLast = (catParts[catParts.length - 1] || '').toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '').trim();
  var catPrev = catParts.length >= 2
    ? (catParts[catParts.length - 2] || '').toLowerCase().replace(/\s+/g, ' ').replace(/s$/, '').trim()
    : '';
  
  // 从倒数第二段提取修饰词（去掉通用词和与最后一段重复的词）
  var lastWords = new Set(catLast.split(' ').filter(function(w) { return w.length > 2; }));
  var prevModifiers = catPrev.split(' ').filter(function(w) {
    return w.length > 2 && !CAT_IGNORE.has(w) && !lastWords.has(w);
  });
  
  // 组合：修饰词 + 核心品类词（限制最多3词）
  var catCombined = prevModifiers.concat([catLast]).join(' ').replace(/\s+/g, ' ').trim();
  if (catCombined.split(' ').length > 3) {
    // 太长了，只取最后一个修饰词 + 核心品类词
    catCombined = (prevModifiers[prevModifiers.length - 1] || '') + ' ' + catLast;
  }

  // 从 title 提取2词短语，排除品牌词和 stopwords
  var STOPWORDS = new Set([
    'the','and','for','with','from','this','that','is','are',
    'to','in','on','of','a','an','by','or','as','at',
    'new','use','best','top','more','most','only','easy','free','fast','safe',
    'large','small','mini','max','plus','pro','prime','extra','ultra','super'
  ]);
  // 品牌词集合（含多词品牌）
  var brandWords = new Set(brand.split(/\s+/).filter(function(w) { return w.length > 1; }));
  var words = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) {
    return w.length > 1 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !brandWords.has(w);
  });
  var bigrams = [];
  for (var i = 0; i < words.length - 1; i++) {
    if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i+1]) &&
        !brandWords.has(words[i]) && !brandWords.has(words[i+1])) {
      bigrams.push(words[i] + ' ' + words[i + 1]);
    }
  }

  // 优先级：category 组合 > 2词短语 > title word
  // category 组合（如 "patio dining set"）比 bigram（如 "dining set"）更精确
  var coreProduct = catCombined || bigrams[0] || words[0] || '';
  
  // 如果组合词太长（>3词），降级用 bigram
  if (coreProduct.split(' ').length > 3) {
    coreProduct = bigrams[0] || catLast || words[0] || '';
  }

  // 提取规格信号（容量、尺寸等）
  var sizeSignals = (title.match(/\d+\s*(oz|qt|quart|gal|gallon|lb|lbs|kg|inch|inches|cm|mm|ft|l|liter|ml|w|v|pack|piece|pcs)/gi) || []).slice(0, 3);

  log('  [step3] coreProduct: "' + coreProduct + '" (from: ' +
      (bigrams[0] ? 'title bigram' : catLast ? 'category' : 'title word') + ')');
  if (sizeSignals.length) log('  [step3] sizeSignals: ' + sizeSignals.join(', '));

  return {
    coreProduct,
    brand: s2.brand || '',
    sizeSignals,
    titleBigrams: bigrams.slice(0, 15)   // 存下来供 Claude 分析参考
  };
}

// ── Step 4: 竞品抓取（Playwright子进程） ────────────────────
async function step4(s1, s2, s3) {
  var coreProduct = s3.coreProduct;
  if (!coreProduct) {
    log('  [step4] ⚠ No coreProduct — skipping competitor search');
    return { competitors: [], cascadeRounds: [], totalFound: 0, coreProduct: '' };
  }

  log('  [step4] Searching competitors for: "' + coreProduct + '" [' + s1.marketplace + ']');

  return new Promise(function(resolve) {
    var workerPath = path.join(SKILL_DIR, 'step4_worker.js');
    var child = require('child_process').spawn(
      process.execPath,
      [workerPath, s1.asin, coreProduct, s1.marketplace, JSON.stringify(s3.titleBigrams || [])],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    var stdout = '', stderr = '';
    child.stdout.on('data', function(d) { stdout += d; });
    child.stderr.on('data', function(d) {
      var line = d.toString().trim();
      if (line) log('  [step4] ' + line);
    });
    child.on('close', function(code) {
      // step4_worker 把结果直接 JSON.stringify 到 stdout
      try {
        var parsed = JSON.parse(stdout.trim());
        if (parsed.ok !== false) {
          // step4_worker 写了 checkpoint，直接读
          var cpFile = path.join(CHECKPOINT_DIR, s1.asin, 'step4.json');
          if (fs.existsSync(cpFile)) {
            var result = JSON.parse(fs.readFileSync(cpFile, 'utf8'));
            log('  [step4] ✓ ' + result.totalFound + ' competitors found');
            resolve(result);
            return;
          }
        }
      } catch(e) { /* fall through */ }

      log('  [step4] ⚠ Worker failed (exit ' + code + ') — empty competitor list');
      resolve({ competitors: [], cascadeRounds: [], totalFound: 0, coreProduct, scrapeError: code });
    });
    child.on('error', function(e) {
      log('  [step4] ⚠ Spawn error: ' + e.message);
      resolve({ competitors: [], cascadeRounds: [], totalFound: 0, coreProduct, scrapeError: e.message });
    });
  });
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  // ── 初始化目录 ────────────────────────────────────────────
  ensureDir(CHECKPOINT_DIR);
  ensureDir(REPORT_DIR);

  console.log('════════════════════════════════════════');
  console.log('  Amazon Listing Doctor — Data Layer');
  console.log('════════════════════════════════════════');

  // ── Step 1 ───────────────────────────────────────────────
  var s1;
  try {
    s1 = await step1();
  } catch(e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }

  var asin  = s1.asin;
  var force = s1.force;
  log('▶ ASIN: ' + asin + ' [' + s1.marketplace + '] ' + (force ? '(--force)' : ''));
  saveCp(asin, 1, s1);

  // 网络步骤（step2/4）每次都重新抓取，除非有缓存且未 --force
  // 计算步骤（step3）每次都重新执行（依赖 step2 结果，很快）
  function shouldSkip(n) {
    if (force) return false;
    var cp = loadCp(asin, n);
    return cp !== null;
  }

  // ── Step 2: 产品页 ───────────────────────────────────────
  var t = Date.now();
  var s2;
  if (shouldSkip(2)) {
    s2 = loadCp(asin, 2);
    log('▶ Step 2: Live Scrape (cached)');
  } else {
    log('▶ Step 2: Live Scrape');
    s2 = await step2(s1);
    saveCp(asin, 2, s2);
  }
  log('  ✓ ' + ((Date.now()-t)/1000).toFixed(1) + 's' +
      (s2.title ? ' | "' + s2.title.substring(0, 60) + (s2.title.length > 60 ? '…' : '') + '"' : ' | ⚠ no title'));
  if (s2.scrapeError) log('  ⚠ Scrape warning: ' + s2.scrapeError);

  // ── Step 3: coreProduct 推断 ─────────────────────────────
  t = Date.now();
  log('▶ Step 3: Core Product Detection');
  var s3 = await step3(s2);
  saveCp(asin, 3, s3);
  log('  ✓ ' + ((Date.now()-t)/1000).toFixed(1) + 's');

  // ── Step 4: 竞品抓取 ─────────────────────────────────────
  t = Date.now();
  var s4;
  if (shouldSkip(4)) {
    s4 = loadCp(asin, 4);
    log('▶ Step 4: Competitor Benchmark (cached — ' + s4.totalFound + ' competitors)');
  } else {
    log('▶ Step 4: Competitor Benchmark');
    s4 = await step4(s1, s2, s3);
    saveCp(asin, 4, s4);
  }
  log('  ✓ ' + ((Date.now()-t)/1000).toFixed(1) + 's | found: ' + s4.totalFound);

  // ── 汇总 data_package.json ───────────────────────────────
  var dataPackage = {
    meta: {
      asin,
      marketplace: s1.marketplace,
      domain: s1.domain,
      url: s1.inputUrl,
      scrapedAt: new Date().toISOString()
    },
    product: {
      title:       s2.title,
      brand:       s2.brand,
      bullets:     s2.bullets,
      price:       s2.price,
      rating:      s2.rating,
      reviewCount: s2.reviewCount,
      BSR:         s2.BSR,
      category:    s2.category,
      scrapeError: s2.scrapeError || null
    },
    keywords: {
      coreProduct:  s3.coreProduct,
      sizeSignals:  s3.sizeSignals,
      titleBigrams: s3.titleBigrams   // 供 Claude 快速参考，不是最终关键词
    },
    competitors: {
      items:         s4.competitors,
      totalFound:    s4.totalFound,
      cascadeRounds: s4.cascadeRounds,
      scrapeError:   s4.scrapeError || null
    }
  };

  var pkgPath = path.join(CHECKPOINT_DIR, asin, 'data_package.json');
  fs.writeFileSync(pkgPath, JSON.stringify(dataPackage, null, 2), 'utf8');

  // ── 完成输出 ──────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  ✅ Data collection complete');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log('产品:    ' + (s2.title || '(no title)').substring(0, 70));
  console.log('价格:    ' + (s2.price ? '$' + s2.price : 'N/A'));
  console.log('评分:    ' + (s2.rating || 'N/A') + ' (' + (s2.reviewCount || 0) + ' reviews)');
  console.log('BSR:     ' + (s2.BSR   || 'N/A'));
  console.log('品类:    ' + (s2.category || 'N/A'));
  console.log('竞品数:  ' + s4.totalFound);
  console.log('');
  console.log('data_package: ' + pkgPath);
  console.log('');
  console.log('→ 下一步：Claude 读取 data_package.json 执行分析（参见 SKILL.md）');
  console.log('→ 生成报告：node report_gen.js ' + asin);
}

if (require.main === module) {
  main().catch(function(e) {
    console.error('Fatal: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  });
} else {
  module.exports = { step1, step2, step3, step4 };
}
