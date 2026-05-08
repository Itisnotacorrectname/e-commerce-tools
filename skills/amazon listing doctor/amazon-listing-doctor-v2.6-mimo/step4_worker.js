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
var QUIET = false;
function log(msg) { if (!QUIET) console.log(String(msg || '')); }

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
  QUIET = process.argv.includes('--quiet');

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

  throw new Error('Invalid input. Usage: node diagnose.js [ASIN|URL] [--force] [--quiet]');
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
  
  var catLastRaw = (catParts[catParts.length - 1] || '').toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  var catLast = catLastRaw.replace(/es$/, '').replace(/s$/, '').trim();
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
  
  // 组合：用 catLastRaw（未 stem 的原始品类词），不再混入父级
  // 理由：stem 后的词（如 'mattres'）可能变成非法词，导致搜索失败。
  // catLastRaw 是 Amazon 的完整品类名，更适合做搜索词。
  var catCombined = catLastRaw;

  // ── 全路径 category 词集（方案 B）──────────────────────────
  // 从完整 category 路径提取所有有意义的词，用于 bigram/catBoost 匹配
  // 例："Sports & Outdoors > ... > Racks & Cages > Power Cages"
  //   → catAllWords = {sport, outdoor, rack, cage, power, ...}
  var catAllWords = new Set();
  catParts.forEach(function(p) {
    p.toLowerCase().split(/[^a-z]+/).forEach(function(w) {
      if (w.length > 2 && !CAT_IGNORE.has(w)) catAllWords.add(w);
    });
  });
  // 补充去复数形式：rack ← racks, cage ← cages
  catAllWords.forEach(function(w) {
    if (w.endsWith('s')) catAllWords.add(w.replace(/s$/, ''));
    if (w.endsWith('es')) catAllWords.add(w.replace(/es$/, ''));
  });

  // 从 title 提取2词短语和3词短语，排除品牌词和 stopwords
  var STOPWORDS = new Set([
    'the','and','for','with','from','this','that','is','are',
    'to','in','on','of','a','an','by','or','as','at',
    'new','use','best','top','more','most','only','easy','free','fast','safe',
    'large','small','mini','max','plus','pro','prime','extra','ultra','super',
    'black','white','grey','gray','brown','beige','pink','blue','green','red'
  ]);
  // 品牌词集合（含多词品牌）
  var brandWords = new Set(brand.split(/\s+/).filter(function(w) { return w.length > 1; }));
  var words = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(function(w) {
    return w.length > 1 && !/^\d+$/.test(w) && !STOPWORDS.has(w) && !brandWords.has(w);
  });

  // ── trigram 提取：位置优先 ──────────────────────────────────
  // 不做 category 门控（品类路径太窄会误杀正确产品类型）
  // 只取标题前 8 个位置的 trigram，按位置排序即可
  // titleLower 用于后续 contiguity 验证
  var titleLower = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  var trigrams = [];
  for (var j = 0; j < Math.min(words.length - 2, 20); j++) {
    var tri = words[j] + ' ' + words[j + 1] + ' ' + words[j + 2];
    var triWords = tri.split(' ');
    if (!brandWords.has(triWords[0]) && !brandWords.has(triWords[1]) && !brandWords.has(triWords[2])) {
      // Contiguity pre-check: 三词必须在原始标题中连续出现
      // 防止跨间隔重复词产生无效短语（如 "king ... mattress ... king mattress box"）
      if (titleLower.includes(tri)) {
        trigrams.push(tri);
      }
    }
  }
  log('  [step3] trigrams: ' + JSON.stringify(trigrams.slice(0, 10)));

  // catLastWords: category 末段词集，用于 bigram 门控和评分
  var catLastWords = new Set(catLast.split(' ').filter(function(w) { return w.length > 1; }).map(function(w) {
    return w.replace(/es$/, '').replace(/s$/, '');
  }));

  var bigrams = [];
  for (var i = 0; i < words.length - 1; i++) {
    if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i + 1]) &&
        !brandWords.has(words[i]) && !brandWords.has(words[i + 1])) {
      // 门控：有 category 用 catLastWords，无 category 用位置（前 5 个词内）
      var passesGate = catLastWords.size > 0
        ? (catLastWords.has(words[i]) || catLastWords.has(words[i + 1]))
        : (i < 5); // 无 category 时，只取标题前 5 个位置的 bigram
      if (passesGate) {
        // 评分：category 末段词各 +3（category 是最可靠信号）
        var catBoost = (catLastWords.has(words[i]) ? 3 : 0) + (catLastWords.has(words[i + 1]) ? 3 : 0);
        bigrams.push({ phrase: words[i] + ' ' + words[i + 1], catBoost: catBoost });
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
    var originalTotal = b.catBoost;
    var reversedTotal = reversedCatBoost;
    var bothWordsInCatLast = catLastWords.has(reversedWords[0]) && catLastWords.has(reversedWords[1]);
    if (reversedTotal > originalTotal && bothWordsInCatLast) {
      b.phrase = reversed;
      b.catBoost = reversedCatBoost;
    }
  });
  bigrams.sort(function(a, b) {
    // 第一排序键：catBoost（category 信号加权）
    if (b.catBoost !== a.catBoost) return b.catBoost - a.catBoost;
    // 第二排序键：accessoryBoost（配件优先）
    var aBoost = accessoryBoost.has(a.phrase.split(/\s+/)[1]) ? 1 : 0;
    var bBoost = accessoryBoost.has(b.phrase.split(/\s+/)[1]) ? 1 : 0;
    if (bBoost !== aBoost) return bBoost - aBoost;
    // 第三排序键：长度（更长的优先）
    return b.phrase.length - a.phrase.length;
  });
  var bigramList = bigrams.map(function(b) { return b.phrase; });


  // 优先级：3词 trigram > 2词 bigram > category 组合 > 其他
  // 注意：trigram 必须包含至少2个产品类型词才优先使用
  // 排序规则：category 词数量 > 长度升序（避免包含额外词）> productTypeCount 降序
  var coreProduct = '';
  if (trigrams.length > 0) {
    // 为每个 trigram 计算 productTypeCount、category 词数量和位置
    // 检查短语完整性：末尾词是否与下一个词形成常见搭配
    // 如果形成搭配（如 pull→up, tv→stand），说明短语不完整
    var COMMON_CONTINUATIONS = new Set([
      'up','down','in','out','on','off','over','under','with','for','and','or',
      'stand','bar','rack','set','kit','board','room','edge','top','side','mount'
    ]);

    var scoredTrigrams = trigrams.map(function(tri) {
      var triWords = tri.split(' ');
      var firstWordIdx = words.indexOf(triWords[0]);
      if (firstWordIdx === -1) firstWordIdx = words.length;
      // 检查末尾词的下一个词是否在标题中形成搭配
      var lastWordIdx = firstWordIdx + triWords.length - 1;
      var nextWord = (lastWordIdx + 1 < words.length) ? words[lastWordIdx + 1] : '';
      var incomplete = nextWord && COMMON_CONTINUATIONS.has(nextWord) && !STOPWORDS.has(nextWord);
      return { phrase: tri, length: tri.length, position: firstWordIdx, incomplete: incomplete };
    });

    // 排序：位置升序 > 完整性（完整优先）> 长度升序
    scoredTrigrams.sort(function(a, b) {
      if (a.incomplete !== b.incomplete) return a.incomplete ? 1 : -1;  // 完整短语优先
      if (a.position !== b.position) return a.position - b.position;
      if (a.length !== b.length) return a.length - b.length;
      return 0;
    });
    log('  [step3] scoredTrigrams[0]: ' + JSON.stringify(scoredTrigrams[0]));

    // 选择第一个完整短语；如果没有完整短语，退回第一个
    if (scoredTrigrams.length > 0) {
      var best = scoredTrigrams.find(function(t) { return !t.incomplete; }) || scoredTrigrams[0];
      coreProduct = best.phrase;
      log('  [step3] coreProduct from trigram: ' + coreProduct + (best.incomplete ? ' (incomplete fallback)' : ''));
    }
  }
  if (!coreProduct) {
    coreProduct = (bigramList[0] || catCombined || words[0] || '').replace(/\s+/g, ' ').trim();
    log('  [step3] coreProduct from bigram: ' + coreProduct);
  }

  // ── category 约束验证 ──────────────────────────────────
  // 已移除：品类路径太窄会误杀正确产品类型（如 'pull up bar' 不在 'Dip Stands' 路径中）
  // 位置优先的 trigram 排序已足够保证核心产品词的准确性

  // ── 连续性验证 ──────────────────────────────────────────
  // coreProduct 的词必须在原始 title 中连续出现
  // 防止 "sofa couch living" 这种从过滤后词列表错误组合的非连续短语
  // titleLower 已在 trigram 提取前声明
  var cpLower = coreProduct.toLowerCase();
  if (cpLower && !titleLower.includes(cpLower)) {
    // 不连续 → 尝试从 bigramList 找连续的
    var foundValid = false;
    for (var bi = 0; bi < bigramList.length; bi++) {
      if (titleLower.includes(bigramList[bi])) {
        coreProduct = bigramList[bi];
        log('  [step3] contiguity check: "' + cpLower + '" not continuous in title, fallback to "' + coreProduct + '"');
        foundValid = true;
        break;
      }
    }
    if (!foundValid && catCombined && titleLower.includes(catCombined)) {
      coreProduct = catCombined;
      log('  [step3] contiguity check: no valid bigram, fallback to catCombined "' + coreProduct + '"');
    } else if (!foundValid) {
      log('  [step3] contiguity check: "' + cpLower + '" not continuous, keeping as-is (no better option)');
    }
  }

  // 如果组合词太长（>3词），降级
  if (coreProduct.split(' ').length > 3) {
    // 使用排序后的 trigrams（如果有）
    if (scoredTrigrams && scoredTrigrams.length > 0) {
      coreProduct = scoredTrigrams[0].phrase || bigramList[0] || catLast || words[0] || '';
    } else {
      coreProduct = trigrams[0] || bigramList[0] || catLast || words[0] || '';
    }
  }

  // ── category 词与 title 交叉验证 ──────────────────────────
  // 仅当 coreProduct 来自 catCombined 时才触发验证
  // 如果 coreProduct 来自 trigram/bigram（已在 title 中验证过），不覆盖
  // 注意：category 词可能是复数（如 'mattresses'），title 可能是单数（如 'mattress'）
  // 验证时用 stem 归一化（去 es/s）做模糊匹配，避免因单复数差异误判
  var needsFallback = (catCombined && coreProduct === catCombined);
  if (needsFallback) {
    function stemWord(w) { return w.replace(/es$/, '').replace(/s$/, ''); }
    var titleWords = title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 1; });
    var titleStems = new Set(titleWords.map(stemWord));
    var validatedWords = catCombined.split(/\s+/).filter(function(w) {
      return titleStems.has(stemWord(w));
    });
    if (validatedWords.length >= 2) {
      coreProduct = validatedWords.join(' ');
      log('  [step3] category fallback: "' + catCombined + '" → "' + coreProduct + '" (validated)');
    } else if (validatedWords.length === 1) {
      log('  [step3] category fallback: only 1 word matched title, fallback to bigram');
      coreProduct = (bigramList[0] || catLast || words[0] || '');
    } else {
      log('  [step3] category fallback: no words matched title, fallback to catLast');
      coreProduct = catLast;
    }
  }

  // 提取规格信号（容量、尺寸等）
  // 匹配：123-Inch, 123 Inch, 123lb, 123 lb 等格式
  var sizeSignals = (title.match(/[\d]+\-?\s*(oz|qt|quart|gal|gallon|lb|lbs|kg|inch|inches|cm|mm|ft|l|liter|ml|w|v|pack|piece|pcs)/gi) || []).slice(0, 3);

  log('  [step3] coreProduct: "' + coreProduct + '" (from: ' +
      (bigrams[0] ? 'title bigram' : catLast ? 'category' : 'title word') + ')');
  if (sizeSignals.length) log('  [step3] sizeSignals: ' + sizeSignals.join(', '));

  return {
    coreProduct,
    brand: s2.brand || '',
    sizeSignals,
    titleBigrams: bigrams.slice(0, 15).map(function(b) { return b.phrase; })  // 返回字符串数组供 Claude 和 retry 参考
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
                // ── 价格偏离过滤（±30%，宽松方案：totalPrice || price）──────────────
                var TARGET_PRICE_FILTER = 0.30;
                var effectivePriceFilter = function(c) {
                  var tp = (c.totalPrice && !isNaN(parseFloat(c.totalPrice))) ? parseFloat(c.totalPrice) :
                           (c.price     && !isNaN(parseFloat(c.price)))     ? parseFloat(c.price) : null;
                  if (tp === null) return true; // 无法判断则保留
                  var dev = Math.abs(tp - targetPrice) / targetPrice;
                  return dev <= TARGET_PRICE_FILTER;
                };
                var pricePassed = result.competitors.filter(effectivePriceFilter);
                var priceRemoved = result.competitors.length - pricePassed.length;
                if (priceRemoved > 0) {
                  log('  [step4] Price filter: removed ' + priceRemoved + ' competitors (>±' + (TARGET_PRICE_FILTER * 100).toFixed(0) + '% from $' + targetPrice + '), kept ' + pricePassed.length);
                }
                // 用价格过滤后的结果做质量评估
                result.competitors = pricePassed;
                var quality2 = assessCompetitorQuality(result.competitors, s3.titleBigrams || []);
                if (quality2 < 0.4) {
                  log('  [step4] ⚠ After price filter, quality dropped to ' + (quality2 * 100).toFixed(0) + '% — reverting price filter');
                  result.competitors = pricePassed; // keep price-filtered but flag
                  result.priceFilterReverted = true;
                }
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

// ── Step 13: 评论抓取（Playwright子进程） ───────────────────
async function step13(s1, reviewCount) {
  return new Promise(function(resolve) {
    var workerPath = path.join(SKILL_DIR, 'step13_review_worker.js');
    var maxReviews = Math.min(parseInt(reviewCount) || 60, 80);
    var child = require('child_process').spawn(
      process.execPath, [workerPath, s1.asin, s1.marketplace, String(maxReviews)],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    var stdout = '', stderr = '';
    child.stdout.on('data', function(d) { stdout += d; });
    child.stderr.on('data', function(d) {
      var line = d.toString().trim();
      if (line) log('  [step13] ' + line);
    });
    child.on('close', function(code) {
      var MARKER = '__STEP13_OUTPUT__';
      var start = stdout.indexOf(MARKER);
      var end = stdout.lastIndexOf(MARKER);
      if (start !== -1 && end !== -1 && start !== end) {
        try {
          var parsed = JSON.parse(stdout.substring(start + MARKER.length, end));
          resolve(parsed);
          return;
        } catch(e) {}
      }
      log('  [step13] ⚠ Worker failed (exit ' + code + ') — empty review data');
      resolve({ asin: s1.asin, reviews: [], totalExtracted: 0, scrapeError: stderr.split('\n')[0] || 'Unknown error' });
    });
    child.on('error', function(e) {
      log('  [step13] ⚠ Spawn error: ' + e.message);
      resolve({ asin: s1.asin, reviews: [], totalExtracted: 0, scrapeError: e.message });
    });
  });
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  // ── 初始化目录 ────────────────────────────────────────────
  ensureDir(CHECKPOINT_DIR);
  ensureDir(REPORT_DIR);

  if (!QUIET) {
    console.log('════════════════════════════════════════');
    console.log('  Amazon Listing Doctor — Data Layer');
    console.log('════════════════════════════════════════');
  }

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

  // 网络步骤（step2/4/13）每次都重新抓取，不使用缓存
  // 计算步骤（step3）每次都重新执行（依赖 step2 结果，很快）

  // ── Step 2: 产品页 ───────────────────────────────────────
  var t = Date.now();
  var s2;
  log('▶ Step 2: Live Scrape');
  s2 = await step2(s1);
  saveCp(asin, 2, s2);
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
  log('▶ Step 4: Competitor Benchmark');
  s4 = await step4(s1, s2, s3);
  saveCp(asin, 4, s4);
  log('  ✓ ' + ((Date.now()-t)/1000).toFixed(1) + 's | found: ' + s4.totalFound);

  // ── Step 13: 评论抓取 ────────────────────────────────────
  t = Date.now();
  var s13;
  var reviewCount = parseInt(s2.reviewCount || '0');
  if (reviewCount < 10) {
    log('⊘ Step 13: Review Analysis (skipped — only ' + reviewCount + ' reviews)');
    s13 = { asin: asin, reviews: [], totalExtracted: 0, skipped: 'low-review-count' };
    saveCp(asin, 13, s13);
  } else {
    log('▶ Step 13: Review Analysis (' + reviewCount + ' reviews detected, scraping up to 60)');
    s13 = await step13(s1, reviewCount);
    saveCp(asin, 13, s13);
  }
  log('  ✓ ' + ((Date.now()-t)/1000).toFixed(1) + 's | extracted: ' + s13.totalExtracted);

  // ── 数据质量门禁 ────────────────────────────────────────
  // Phase 1 完成后检查数据是否足够，不够就停，不浪费 Phase 2 的时间和 API 费用
  var dataIssues = [];
  if (!s2.title || s2.title.length < 10) dataIssues.push('产品标题缺失或过短');
  if (!s2.bullets || s2.bullets.length === 0) dataIssues.push('五点描述缺失');
  if (s4.totalFound === 0) dataIssues.push('竞品搜索返回 0 条（可能 Amazon 反爬触发）');
  if (s4.totalFound > 0 && s4.totalFound < 5) dataIssues.push('竞品不足 5 条，分析结果可能不可靠');

  if (dataIssues.length > 0) {
    console.log('');
    console.log('════════════════════════════════════════');
    console.log('  ❌ Phase 1 数据不足，无法继续 Phase 2');
    console.log('════════════════════════════════════════');
    console.log('');
    console.log('问题：');
    dataIssues.forEach(function(issue) { console.log('  - ' + issue); });
    console.log('');
    console.log('建议：');
    if (s4.totalFound === 0) {
      console.log('  等待 10-15 分钟后重试（Amazon 反爬冷却）');
      console.log('  或换一个 ASIN 测试');
    } else {
      console.log('  检查 ASIN 是否正确，或手动确认产品页面可访问');
    }
    console.log('');
    console.log('已保存的数据：');
    console.log('  ' + path.join(CHECKPOINT_DIR, asin, 'step1.json'));
    console.log('  ' + path.join(CHECKPOINT_DIR, asin, 'step2.json'));
    console.log('  ' + path.join(CHECKPOINT_DIR, asin, 'step4.json'));
    process.exit(1);
  }

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

  // ── 竞品价格偏差警告 ──────────────────────────────────────
  // 检查竞品价格是否与目标价格大幅偏离（可能抓取了错误竞品或价格不准）
  if (s2.price && s4.competitors && s4.competitors.length > 0) {
    var targetPrice = s2.price;
    var compPrices = s4.competitors
      .filter(function(c) { return c.price && !isNaN(parseFloat(c.price)); })
      .map(function(c) { return parseFloat(c.price); });
    if (compPrices.length > 0) {
      var avgCompPrice = compPrices.reduce(function(a, b) { return a + b; }, 0) / compPrices.length;
      var deviation = Math.abs(avgCompPrice - targetPrice) / targetPrice;
      if (deviation > 0.5) {
        var direction = avgCompPrice > targetPrice ? '高于' : '低于';
        log('  [step4] ⚠ 价格偏差警告: 目标 $' + targetPrice + ', 竞品均价 $' + avgCompPrice.toFixed(2) +
            ' (' + direction + '目标 ' + (deviation * 100).toFixed(0) + '%)，请检查竞品是否正确');
      }
      // 检测低价高运费风险：如果竞品价格低于目标 50%+，可能有高额运费
      var lowPriceComps = compPrices.filter(function(p) { return p < targetPrice * 0.5; });
      if (lowPriceComps.length > 0) {
        log('  [step4] ⚠ 低价竞品检测: ' + lowPriceComps.length + ' 个竞品价格低于目标 50%，注意运费可能较高');
      }
    }
  }

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
  console.log('评论数:  ' + (s13.totalExtracted || 0));
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
  console.log('    ' + path.join(CHECKPOINT_DIR, asin, 'step13.json'));
  console.log('');
  console.log('  Claude Agent 请按 SKILL.md Phase 2 执行分析，');
  console.log('  完成后将分析结果写入：');
  console.log('    ' + path.join(CHECKPOINT_DIR, asin, 'analysis.md'));
  console.log('');
  console.log('  写入完成后执行：');
  console.log('    node ' + path.join(SKILL_DIR, 'md_to_checkpoints.js') + ' ' + asin);
  console.log('');
  console.log('  （或使用 JSON 路线：node inject_analysis.js ' + asin + ' analysis.json）');
}

if (require.main === module) {
  main().catch(function(e) {
    console.error('Fatal: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  });
} else {
  module.exports = { step1, step2, step3, step4, step13 };
}
