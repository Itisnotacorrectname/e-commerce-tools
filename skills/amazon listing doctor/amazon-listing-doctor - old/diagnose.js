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
  
  // 从倒数第二段提取修饰词
  // 过滤：通用词、与 catLast 重复的词、catLast 各词的词根形式（去复数/词尾变化）
  var lastWords = new Set(catLast.split(' ').filter(function(w) { return w.length > 2; }));
  // 额外：catLast 各词的词根（去掉末尾 e/s/es/ing 变化），防止父级分类词污染
  var lastRoots = new Set();
  lastWords.forEach(function(w) {
    lastRoots.add(w);
    lastRoots.add(w + 's');
    lastRoots.add(w + 'es');
    if (w.endsWith('e')) lastRoots.add(w.slice(0, -1));      // base → bas
    if (w.endsWith('ing')) lastRoots.add(w.slice(0, -3));    // adjust → adjus (rarely needed)
  });
  
  var prevModifiers = catPrev.split(' ').filter(function(w) {
    return w.length > 2 && !CAT_IGNORE.has(w) && !lastRoots.has(w);
  });
  
  // 组合：只取最后一个修饰词 + 核心品类词（最多2词）
  // 如果父级词是通用词（equipment/furniture）或不在 title 里，则只用 catLast
  var GENERIC_PARENTS = new Set(['equipment','furniture','products','items','accessories','supplies']);
  var useParent = prevModifiers.length > 0 && !GENERIC_PARENTS.has(prevModifiers[prevModifiers.length - 1]) &&
    title.toLowerCase().includes(prevModifiers[prevModifiers.length - 1]);
  var catCombined = useParent ? (prevModifiers[prevModifiers.length - 1] + ' ' + catLast) : catLast;

  // 从 title 提取2词短语和3词短语，排除品牌词和 stopwords
  var STOPWORDS = new Set([
    'the','and','for','with','from','this','that','is','are',
    'to','in','on','of','a','an','by','or','as','at',
    'new','use','best','top','more','most','only','easy','free','fast','safe',
    'large','small','mini','max','plus','pro','prime','extra','ultra','super',
    'black','white','grey','gray','brown','beige','pink','blue','green','red'
  ]);
  // 产品类型词：最常见的家具/家居产品后缀
  var PRODUCT_TYPE_WORDS = new Set([
    'bag','tote','box','case','carrier','container','cooler',
    'chair','recliner','sofa','couch','sectional','loveseat','ottoman','bench','stool','seat',
    'table','desk','shelf','cabinet','console','stand','rack',
    'bed','mattress','pillow','cushion','cover','pad',
    'lamp','light','chandelier','sconce',
    'mirror','frame','canvas','poster','art','clock',
    'basket','bin','bucket','jar','pot','vase','planter',
    'bag','backpack','purse','wallet','pouch','tote','clutch','briefcase','laptop'
  ]);
  // 品牌词集合（含多词品牌）
  var brandWords = new Set(brand.split(/\s+/).filter(function(w) { return w.length > 1; }));
  var words = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) {
    return w.length > 1 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !brandWords.has(w);
  });

  // 提取 trigrams（3词产品类型短语）
  var trigrams = [];
  for (var j = 0; j < words.length - 2; j++) {
    var tri = words[j] + ' ' + words[j + 1] + ' ' + words[j + 2];
    var triWords = tri.split(' ');
    if (!brandWords.has(triWords[0]) && !brandWords.has(triWords[1]) && !brandWords.has(triWords[2])) {
      // 必须包含至少一个 product-type 词
      if (PRODUCT_TYPE_WORDS.has(triWords[0]) || PRODUCT_TYPE_WORDS.has(triWords[1]) || PRODUCT_TYPE_WORDS.has(triWords[2])) {
        trigrams.push(tri);
      }
    }
  }

  // 提取 bigrams（2词产品类型短语）
  var bigrams = [];
  // category 叶子词集合：给出现在 category 末段的 bigram 词 +1 加分
  // 例：category 末段 "Dip Stands" → "dip stand" → catLastWords = {dip, stand}
  // 这样 "dip stand" 排先于 "bar stand"（bar 不在 category 末段）
  var catLastWords = new Set(catLast.split(' ').filter(function(w) { return w.length > 1; }));
  for (var i = 0; i < words.length - 1; i++) {
    if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1]) &&
        !brandWords.has(words[i]) && !brandWords.has(words[i + 1])) {
      // 必须包含 product-type 词
      if (PRODUCT_TYPE_WORDS.has(words[i]) || PRODUCT_TYPE_WORDS.has(words[i + 1])) {
        // 评分：两个词都是产品类型 = 2分（最高），1个是 = 1分
        // 额外加分：每个词出现在 category 末段 +1（category 信号优先）
        var score = (PRODUCT_TYPE_WORDS.has(words[i]) ? 1 : 0) + (PRODUCT_TYPE_WORDS.has(words[i + 1]) ? 1 : 0);
        var catBoost = (catLastWords.has(words[i]) ? 1 : 0) + (catLastWords.has(words[i + 1]) ? 1 : 0);
        bigrams.push({ phrase: words[i] + ' ' + words[i + 1], score: score, catBoost: catBoost });
      }
    }
  }

  // 按评分降序，评分相同则按长度（更长的优先）和出现顺序
  // 额外加权：如果 bigram 以 accessory 词结尾（e.g. "sofa cover"），额外 +1
  // 这样 "sectional sofa" (2分) 输给 "sofa cover" (2分+加权) 当 target 是 cover 类时
  var accessoryBoost = new Set(['cover','covers','protector','slipcover','slipcovers','pad','pads','mat','liner','liners','case','cases']);
  // 修复断裂 bigram：如果倒序后总分更高且两词都在 category 末段，flip
  // 例："stand dip" (score=1,catBoost=2) → "dip stand" (倒序后 catBoost不变但顺序正确)
  bigrams.forEach(function(b) {
    var parts = b.phrase.split(/\s+/);
    var reversed = parts[1] + ' ' + parts[0];
    var reversedWords = reversed.split(/\s+/);
    var reversedCatBoost = (catLastWords.has(reversedWords[0]) ? 1 : 0) + (catLastWords.has(reversedWords[1]) ? 1 : 0);
    var originalTotal = b.score + b.catBoost;
    var reversedTotal = b.score + reversedCatBoost;
    var bothWordsInCatLast = catLastWords.has(reversedWords[0]) && catLastWords.has(reversedWords[1]);
    if (reversedTotal > originalTotal && bothWordsInCatLast) {
      b.phrase = reversed;
      b.catBoost = reversedCatBoost;
    }
  });
  bigrams.sort(function(a, b) {
    // 第一排序键：score + catBoost（category 信号加权）
    if ((b.score + b.catBoost) !== (a.score + a.catBoost)) return (b.score + b.catBoost) - (a.score + a.catBoost);
    // 第二排序键：accessoryBoost（配件优先）
    var aBoost = accessoryBoost.has(a.phrase.split(/\s+/)[1]) ? 1 : 0;
    var bBoost = accessoryBoost.has(b.phrase.split(/\s+/)[1]) ? 1 : 0;
    if (bBoost !== aBoost) return bBoost - aBoost;
    // 第三排序键：长度（更长的优先）
    return b.phrase.length - a.phrase.length;
  });
  var bigramList = bigrams.map(function(b) { return b.phrase; });

  // 优先级：按评分排序的2词产品类型短语 > category 组合 > 其他 bigrams
  // 注意：不再直接用 trigrams[0]，因为 trigram 太容易误匹配（如 "inch l shaped" 含 sectional）
  // trigram 仅作参考信息，不作为 coreProduct 的直接来源
  var coreProduct = (bigramList[0] || catCombined || words[0] || '').replace(/\s+/g, ' ').trim();

  // 如果组合词太长（>3词），降级
  if (coreProduct.split(' ').length > 3) {
    coreProduct = trigrams[0] || bigrams[0] || catLast || words[0] || '';
  }

  // ── category 词与 title 交叉验证 ──────────────────────────
  // 触发条件：(1) coreProduct 来自 catCombined (2) bigram 弱但 category 信号强（catBoost≥2 + score≤1）
  // 验证：只保留在 title 中作为独立 token 出现的词（不在长词内部）
  // 例："equipment dip stand" → title 中 "equipment" 只在 "workout Equipment" 里 → 被过滤
  var topBigram = bigrams[0] || null;
  var needsFallback = (catCombined && coreProduct === catCombined) ||
    (topBigram && topBigram.catBoost >= 2 && topBigram.score <= 1);
  if (needsFallback) {
    var titleWords = title.toLowerCase().split(/\s+/);
    var validatedWords = catCombined.split(/\s+/).filter(function(w) {
      return titleWords.indexOf(w) !== -1;
    });
    if (validatedWords.length >= 2) {
      coreProduct = validatedWords.join(' ');
      log('  [step3] category fallback: "' + catCombined + '" → "' + coreProduct + '" (validated)');
    } else if (validatedWords.length === 1) {
      log('  [step3] category fallback: only 1 word matched title, fallback to bigram');
      coreProduct = bigrams[0] || catLast || words[0] || '';
    } else {
      log('  [step3] category fallback: no words matched title, fallback to catLast');
      coreProduct = catLast;
    }
  }

  // 提取规格信号（容量、尺寸等）
  var sizeSignals = (title.match(/\d+\-?\s*(oz|qt|quart|gal|gallon|lb|lbs|kg|inch|inches|cm|mm|ft|l|liter|ml|w|v|pack|piece|pcs)/gi) || []).slice(0, 3);

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

  // ── 竞品质量评估辅助函数 ─────────────────────────────────
  // 用 title bigrams 对竞品标题做重合度评分
  // 返回 0-1 的比例：有多少竞品标题包含至少一个 title bigram
  function assessCompetitorQuality(competitors, titleBigrams) {
    if (!competitors || competitors.length === 0) return 0;
    if (!titleBigrams || titleBigrams.length === 0) return 0.5; // 无法判断，中性
    var relevantBigrams = titleBigrams.slice(0, 5); // 只用前5个最核心的bigram
    var matchCount = competitors.filter(function(c) {
      if (!c.title) return false;
      var t = c.title.toLowerCase();
      return relevantBigrams.some(function(bg) { return t.includes(bg); });
    }).length;
    return matchCount / competitors.length;
  }

  // ── spawn 子进程的通用封装 ────────────────────────────────
  function spawnWorker(asin, searchTerm, marketplace, titleBigrams) {
    return new Promise(function(resolve) {
      var workerPath = path.join(SKILL_DIR, 'step4_worker.js');
      var child = require('child_process').spawn(
        process.execPath,
        [workerPath, asin, searchTerm, marketplace, JSON.stringify(titleBigrams || []), categoryFallback || ''],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      );
      var stdout = '', stderr = '';
      child.stdout.on('data', function(d) { stdout += d; });
      child.stderr.on('data', function(d) {
        var line = d.toString().trim();
        if (line) log('  [step4] ' + line);
      });
      child.on('close', function() {
        try {
          var parsed = JSON.parse(stdout.trim());
          resolve(parsed.ok !== false ? parsed : null);
        } catch(e) { resolve(null); }
      });
      child.on('error', function() { resolve(null); });
    });
  }

  return new Promise(function(resolve) {
    var workerPath = path.join(SKILL_DIR, 'step4_worker.js');
    var child = require('child_process').spawn(
      process.execPath,
      [workerPath, s1.asin, coreProduct, s1.marketplace, JSON.stringify(s3.titleBigrams || []), s2.category || ''],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    var stdout = '', stderr = '';
    child.stdout.on('data', function(d) { stdout += d; });
    child.stderr.on('data', function(d) {
      var line = d.toString().trim();
      if (line) log('  [step4] ' + line);
    });
    child.on('close', async function(code) {
      try {
        var parsed = JSON.parse(stdout.trim());
        if (parsed.ok !== false) {
          var cpFile = path.join(CHECKPOINT_DIR, s1.asin, 'step4.json');
          if (fs.existsSync(cpFile)) {
            var result = JSON.parse(fs.readFileSync(cpFile, 'utf8'));
            var origCount  = result.originalCompetitorCount || result.competitors.length;
            var filtCount  = result.filteredCompetitorCount || (result.filteredCompetitors || []).length;
            var needsCheck = result.filterApplied && origCount > 0 && filtCount / origCount < 0.3;

            if (needsCheck) {
              // ── Step1: 评估原始竞品质量 ────────────────────────
              var quality = assessCompetitorQuality(result.competitors, s3.titleBigrams || []);
              log('  [step4] ⚠ Filter removed >' +
                  Math.round((1 - filtCount / origCount) * 100) + '% of competitors. ' +
                  'Original quality score: ' + (quality * 100).toFixed(0) + '%');

              if (quality >= 0.4) {
                // ── v1.6.6: 原始竞品质量OK：回退到宽松过滤（基于cascade搜索词）──
                var searchTerms = [];
                if (result.cascadeRounds) {
                  result.cascadeRounds.forEach(function(r) {
                    if (r.keyword) searchTerms.push(r.keyword.toLowerCase());
                  });
                }
                if (result.fallbackTermsUsed) {
                  result.fallbackTermsUsed.forEach(function(t) {
                    if (t && searchTerms.indexOf(t.toLowerCase()) === -1) searchTerms.push(t.toLowerCase());
                  });
                }
                if (searchTerms.length > 0) {
                  var SEARCH_STOPWORDS = new Set(['for','and','the','with','from','this','that','is','are','to','in','on','of','a','an','by']);
                  var searchWords = [];
                  searchTerms.forEach(function(term) {
                    term.split(/\s+/).forEach(function(w) {
                      if (w.length > 2 && !SEARCH_STOPWORDS.has(w)) searchWords.push(w);
                    });
                  });
                  searchWords = searchWords.filter(function(w, i, arr) { return arr.indexOf(w) === i; });
                  var looseFiltered = result.competitors.filter(function(c) {
                    if (!c.title) return false;
                    var t = c.title.toLowerCase();
                    return searchWords.some(function(w) { return t.indexOf(w) !== -1; });
                  });
                  var kept = looseFiltered.length;
                  log('  [step4] Reverting filter with loose mode: kept ' + kept + '/' + result.competitors.length + ' (matched: ' + searchTerms.slice(0, 4).join(', ') + ')');
                  result.filteredCompetitors = looseFiltered;
                  result.filteredCompetitorCount = kept;
                  result.filterApplied = true;
                  result.filterReverted = true;
                  result.filterDecision = 'reverted-loose: ' + kept + ' competitors (quality ' + (quality * 100).toFixed(0) + '%)';
                } else {
                  log('  [step4] Original competitors look relevant — reverting filter');
                  result.filteredCompetitors = result.competitors;
                  result.filteredCompetitorCount = result.competitors.length;
                  result.filterApplied = false;
                  result.filterReverted = true;
                  result.filterDecision = 'reverted: original quality ' + (quality * 100).toFixed(0) + '%';
                }

              } else {
                // ── 原始竞品质量差：搜索词本身是脏的，尝试重搜 ──────
                var fallbackTerm = (s3.titleBigrams || [])[0] || '';
                log('  [step4] Original competitors look irrelevant (quality ' +
                    (quality * 100).toFixed(0) + '%). ' +
                    (fallbackTerm ? 'Retrying with title bigram: "' + fallbackTerm + '"' : 'No fallback term available.'));

                if (fallbackTerm && fallbackTerm !== coreProduct) {
                  // 用 titleBigrams[0] 重新搜一次
                  var retryOk = await spawnWorker(s1.asin, fallbackTerm, s1.marketplace, s3.titleBigrams);
                  if (retryOk) {
                    var cpFile2 = path.join(CHECKPOINT_DIR, s1.asin, 'step4.json');
                    var retryResult = JSON.parse(fs.readFileSync(cpFile2, 'utf8'));
                    var retryCount  = (retryResult.filteredCompetitors || retryResult.competitors || []).length;

                    if (retryCount >= 5) {
                      log('  [step4] ✓ Retry with "' + fallbackTerm + '" found ' + retryCount + ' competitors');
                      retryResult.filterDecision = 'retry: searched "' + fallbackTerm + '", found ' + retryCount;
                      fs.writeFileSync(cpFile2, JSON.stringify(retryResult, null, 2), 'utf8');
                      resolve(retryResult);
                      return;
                    } else {
                      log('  [step4] Retry returned only ' + retryCount + ' competitors — keeping original with flag');
                    }
                  } else {
                    log('  [step4] Retry worker failed — keeping original with flag');
                  }
                }

                // 重搜失败或无 fallback 词：保留原始竞品，但打上 lowQuality 标记
                result.filteredCompetitors    = result.competitors;
                result.filteredCompetitorCount = result.competitors.length;
                result.filterApplied  = false;
                result.filterReverted = true;
                result.competitorQualityLow = true;
                result.filterDecision = 'reverted-low-quality: original score ' + (quality * 100).toFixed(0) + '%, retry failed';
                log('  [step4] ⚠ Keeping original competitors with lowQuality flag (report will note this)');
              }

              fs.writeFileSync(cpFile, JSON.stringify(result, null, 2), 'utf8');
            }

            var finalCount = (result.filteredCompetitors || result.competitors || []).length;
            log('  [step4] ✓ ' + result.totalFound + ' found → ' + finalCount + ' usable' +
                (result.competitorQualityLow ? ' ⚠ low quality' : '') +
                (result.filterDecision ? ' [' + result.filterDecision + ']' : ''));
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
  console.log('  ✅ Phase 1 完成：数据层抓取成功');
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
  console.log('════════════════════════════════════════');
  console.log('  ▶ Phase 2：请 Claude Agent 执行分析');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log('  数据文件已就绪：');
  console.log('    ' + path.join(CHECKPOINT_DIR, asin, 'step2.json'));
  console.log('    ' + path.join(CHECKPOINT_DIR, asin, 'step4.json'));
  console.log('');
  console.log('  Claude Agent 请按 SKILL.md Phase 2 执行分析，');
  console.log('  完成后将分析结果写入：');
  console.log('    ' + path.join(CHECKPOINT_DIR, asin, 'analysis.md'));
  console.log('');
  console.log('  写入完成后执行：');
  console.log('    node ' + path.join(SKILL_DIR, 'md_to_checkpoints.js') + ' ' + asin);
  console.log('');
  console.log('  （或使用 JSON 路线：node inject_analysis.js ' + asin + ' analysis.json）');
  console.log('');

  // ── v2.4: Phase 1 完成后自动执行 Phase 2 ───────────────────────
  var analyzePath = path.join(SKILL_DIR, 'analyze_phase2.js');
  if (fs.existsSync(analyzePath)) {
    console.log('');
    console.log('[diagnose] Phase 1 完成，自动执行 Phase 2...');
    require('child_process').spawn(
      process.execPath, [analyzePath, asin],
      { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true }
    ).on('close', function(code) {
      if (code === 0) {
        console.log('[diagnose] Phase 2 完成 — 报告已生成');
      } else {
        console.error('[diagnose] Phase 2 失败 (code ' + code + ')');
      }
      process.exit(code || 0);
    });
  } else {
    console.error('[diagnose] analyze_phase2.js not found — 跳过 Phase 2');
    console.log('');
    console.log('  手动执行: node analyze_phase2.js ' + asin);
    process.exit(0);
  }
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
