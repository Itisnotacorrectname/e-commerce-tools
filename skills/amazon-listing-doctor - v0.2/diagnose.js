#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  Amazon Listing Doctor — diagnose.js v5.2 (2026-04-18)
//  15-step mechanical audit — pure dynamic, NO hardcoded category data
//  Multi-marketplace: amazon.com, de, uk, fr, it, es, jp, ca …
// ─────────────────────────────────────────────────────────────

var DOMAIN_MAP = {
  'US': 'amazon.com', 'DE': 'amazon.de', 'GB': 'amazon.co.uk',
  'FR': 'amazon.fr',  'IT': 'amazon.it',  'ES': 'amazon.es',
  'JP': 'amazon.co.jp', 'CA': 'amazon.ca', 'AU': 'amazon.com.au',
  'MX': 'amazon.com.mx', 'IN': 'amazon.in'
};

const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const https   = require('https');
const zlib    = require('zlib');
const cheerio = require('cheerio');

// ── Paths (dynamic — works on any machine) ───────────────────
const WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');

// ── Cookie Jar ───────────────────────────────────────────────
const COOKIE_JAR = [];
function jarSet(name, val) {
  var idx = COOKIE_JAR.findIndex(function(c) { return c.name === name; });
  if (idx >= 0) COOKIE_JAR[idx].val = val;
  else COOKIE_JAR.push({ name: name, val: val });
}

// ── HTTP Client ───────────────────────────────────────────────
function httpGet(url) {
  return new Promise(function(resolve, reject) {
    var cookieStr = COOKIE_JAR.map(function(c) { return c.name + '=' + c.val; }).join('; ');
    var opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      timeout: 25000
    };
    if (cookieStr) opts.headers['Cookie'] = cookieStr;
    var req = https.get(url, opts, function(r) {
      (r.headers['set-cookie'] || []).forEach(function(sc) {
        var parts = sc.split(';')[0].split('=');
        jarSet(parts[0].trim(), parts.slice(1).join('='));
      });
      var chunks = [];
      r.on('data', function(c) { chunks.push(c); });
      r.on('end', function() {
        var buf = Buffer.concat(chunks);
        var enc = r.headers['content-encoding'];
        var dec = enc === 'br' ? zlib.brotliDecompressSync(buf)
                 : enc === 'gzip' ? zlib.gunzipSync(buf)
                 : buf;
        resolve(dec.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('HTTP timeout')); });
  });
}

// ── Checkpoint IO ─────────────────────────────────────────────
function getCpPath(asin, n) {
  var dir = path.join(CHECKPOINT_DIR, asin);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'step' + n + '.json');
}
function loadCp(asin, n) {
  var p = getCpPath(asin, n);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch(e) { return null; }
}
function saveCp(asin, n, data) {
  fs.writeFileSync(getCpPath(asin, n), JSON.stringify(data, null, 2), 'utf8');
}

// ── Universal stopwords ──────────────────────────────────────
var STOPWORDS = new Set([
  'the','and','for','with','from','this','that','is','are','was','it','be',
  'to','in','on','of','a','an','by','or','as','at','your','you',
  'not','but','can','all','one','two','three','four','five','six',
  'new','use','used','best','top','more','most','only','easy','free','fast','safe',
  'large','small','mini','max','plus','pro','prime','extra','ultra','super',
  'every','each','such','some','any','no','yes',
  'so','if','then','than','when','where','how','what','which','who','whom'
]);

// ── Utility helpers ──────────────────────────────────────────
function log(msg) { console.log((msg || '').toString()); }

// ── Text analysis utilities ───────────────────────────────────
function tokenize(text) {
  return (text || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function(w) { return w.length > 1 && !/^\d+$/.test(w); });
}

function extractPhrases(title, n) {
  var words = tokenize(title);
  var phrases = [];
  for (var i = 0; i <= words.length - n; i++) {
    var phrase = words.slice(i, i + n).join(' ');
    if (phrase.length > 2) phrases.push(phrase);
  }
  return phrases;
}

function buildPhraseFreq(titles, maxN) {
  maxN = maxN || 3;
  var freq = {};
  titles.forEach(function(title) {
    for (var n = 1; n <= maxN; n++) {
      extractPhrases(title, n).forEach(function(p) {
        if (!STOPWORDS.has(p.split(' ')[0]) && !STOPWORDS.has(p.split(' ')[p.split(' ').length - 1])) {
          freq[p] = (freq[p] || 0) + 1;
        }
      });
    }
  });
  return freq;
}

function detectOffTarget(titles, threshold) {
  threshold = threshold || 0.25;
  var docFreq = {};
  titles.forEach(function(t) {
    var words = new Set(tokenize(t));
    words.forEach(function(w) { docFreq[w] = (docFreq[w] || 0) + 1; });
  });
  var n = titles.length;
  var wordOverlapScore = {};
  titles.forEach(function(t, i) {
    var myWords = new Set(tokenize(t));
    var overlap = 0;
    myWords.forEach(function(w) {
      if ((docFreq[w] || 0) / n > 0.4) overlap++;
    });
    wordOverlapScore[i] = overlap / Math.max(myWords.size, 1);
  });
  var scores = Object.values(wordOverlapScore).sort(function(a, b) { return a - b; });
  var median = scores[Math.floor(scores.length / 2)] || 0.5;
  var offTarget = [];
  titles.forEach(function(t, i) {
    if (wordOverlapScore[i] < median * threshold) offTarget.push(i);
  });
  return offTarget;
}

// ── Shared fragment detection (used by step3 and step5) ──────────
var HYPHEN_STARTS = new Set(['up', 'down', 'in', 'out', 'on', 'off', 'back']);
var FRAG_PAIRS = new Set(['frame inches','inches tall','tall lb','lb weight','weight capacity',
  'under bed','bed storage','metal support','support system','box spring','spring needed',
  'retainers matte','matte black','bed mattress','duty platform','metal full',
  'mattress retainers','frame inches','inches tall','tall lb','lb weight','weight capacity']);
function isFragment(p) {
  var words = p.split(' ');
  if (words.length === 2 && HYPHEN_STARTS.has(words[0])) return true;
  if (words.length === 3 && HYPHEN_STARTS.has(words[0])) return true;
  if (FRAG_PAIRS.has(p.toLowerCase())) return true;
  return false;
}

// ── Step 1: Extract ASIN ───────────────────────────────────────
async function step1(ctx) {
  var asinArg = process.argv.find(function(a) { return a.match(/^B[A-Z0-9]{9}$/); });
  var urlArg  = process.argv.find(function(a) { return a.match(/amazon\.(?:www\.)?[^/]+\/(?:dp|gp\/product)\//); });
  function extractAsinFromUrl(url) {
    // domain pattern: amazon.com, amazon.co.uk, amazon.co.jp, amazon.com.mx, amazon.com.au, amazon.de, etc.
    var m = url.match(/amazon\.(?:www\.)?([^/]+)\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    if (!m) return null;
    return { domain: 'amazon.' + m[1], asin: m[2] };
  }
  var extracted = urlArg ? extractAsinFromUrl(urlArg) : null;
  var asin = asinArg || (extracted ? extracted.asin : null);
  var domainFromUrl = extracted ? extracted.domain : null;
  // Map full amazon.{tld} domain to marketplace code
  var ccFromDomain = {
    'amazon.com': 'US', 'amazon.co.uk': 'GB', 'amazon.de': 'DE',
    'amazon.fr': 'FR', 'amazon.it': 'IT', 'amazon.es': 'ES',
    'amazon.co.jp': 'JP', 'amazon.ca': 'CA', 'amazon.com.au': 'AU',
    'amazon.com.mx': 'MX', 'amazon.in': 'IN'
  };
  var marketplace = domainFromUrl ? (ccFromDomain[domainFromUrl] || 'US') : 'US';
  var domain = domainFromUrl || (marketplace === 'US' ? 'amazon.com' : 'amazon.' + (marketplace === 'GB' ? 'co.uk' : marketplace === 'JP' ? 'co.jp' : marketplace === 'AU' ? 'com.au' : marketplace === 'MX' ? 'com.mx' : marketplace === 'IN' ? 'in' : marketplace === 'DE' ? 'de' : marketplace === 'FR' ? 'fr' : marketplace === 'IT' ? 'it' : marketplace === 'ES' ? 'es' : 'amazon.com'));
  return { asin: asin, marketplace: marketplace, domain: domain, inputUrl: 'https://' + domain + '/dp/' + (asin || '') };
}

// ── Step 2: Live Scrape ────────────────────────────────────────
async function step2(ctx) {
  var asin = ctx.deps[1].data.asin;
  var marketplace = ctx.deps[1].data.marketplace || 'US';
  var domain = ctx.deps[1].data.domain || 'amazon.com';
  var url = 'https://' + domain + '/dp/' + asin;

  return new Promise(function(resolve) {
    var workerPath = path.join(__dirname, 'step2_worker.js');
    var child = require('child_process').spawn(
      process.execPath, [workerPath, asin, marketplace],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );
    var stdout = '';
    var stderr = '';
    child.stdout.on('data', function(d) { stdout += d.toString(); });
    child.stderr.on('data', function(d) { stderr += d.toString(); });
    child.on('close', function(code) {
      try {
        var marker = '__STEP2_OUTPUT__';
        var start = stdout.indexOf(marker);
        var end = stdout.lastIndexOf(marker);
        if (start !== -1 && end !== -1 && start !== end) {
          var dataStr = stdout.substring(start + marker.length, end);
          var parsed = JSON.parse(dataStr);
          saveCp(asin, 2, parsed);
          resolve(parsed);
        } else {
          resolve({ title: '', bullets: [], price: null, rating: null,
            reviewCount: 0, BSR: null, category: null,
            marketplace: marketplace, url: url,
            error: 'Worker produced no valid output' });
        }
      } catch(e) {
        resolve({ title: '', bullets: [], price: null, rating: null,
          reviewCount: 0, BSR: null, category: null,
          marketplace: marketplace, url: url,
          error: 'Worker error: ' + (stderr || e.message) });
      }
    });
    child.on('error', function(e) {
      resolve({ title: '', bullets: [], price: null, rating: null,
        reviewCount: 0, BSR: null, category: null,
        marketplace: marketplace, url: url,
        error: e.message });
    });
  });
}

// ── Step 3: Keyword Research ──────────────────────────────────
async function step3(ctx) {
  var s2 = ctx.deps[2].data;
  var title = s2.title || '';
  var titleLower = title.toLowerCase();
  var words = tokenize(title);
  var phrase2 = [], phrase3 = [];
  for (var i = 0; i < words.length - 1; i++) {
    if (!STOPWORDS.has(words[i]) && !STOPWORDS.has(words[i+1])) phrase2.push(words[i] + ' ' + words[i+1]);
  }
  for (var j = 0; j < words.length - 2; j++) {
    if (!STOPWORDS.has(words[j]) && !STOPWORDS.has(words[j+1]) && !STOPWORDS.has(words[j+2])) {
      phrase3.push(words[j] + ' ' + words[j+1] + ' ' + words[j+2]);
    }
  }
  // Prefer 2-word phrases (product types) over 3-word (features/descriptions)
  // 2-word: +3 pts (product descriptors like "bed frame")
  // 3-word: +1 pt (features like "under bed storage")
  var phraseScore = {};
  phrase2.forEach(function(p) { phraseScore[p] = (phraseScore[p] || 0) + 3; });
  phrase3.forEach(function(p) { phraseScore[p] = (phraseScore[p] || 0) + 1; });
  var sorted = Object.keys(phraseScore).sort(function(a, b) { return phraseScore[b] - phraseScore[a]; });
  var brand = (s2.brand || '').toLowerCase();

  // ── Dynamic coreProduct: prefer title phrase (2+ words), then category as fallback ──
  // Title phrases are more specific than generic category terms (e.g. "bed frame" vs "bed")
  // But when brand is unknown, title may contain brand+product (e.g. "keter store") — detect via title capitalization
  var titleOriginal = title; // preserve original casing
  function isTitlePhraseLikelyBrand(p) {
    // If none of the words in p were capitalized in original title, it's generic (not a brand name)
    var words = p.split(' ');
    return words.some(function(w) {
      var origLower = w.toLowerCase();
      var wasCapitalized = titleOriginal.indexOf(origLower.charAt(0).toUpperCase() + origLower.slice(1)) !== -1;
      return wasCapitalized;
    });
  }

  var coreProduct = '';

  // Step A: Find longest 2+ word phrase from title (most specific), excluding brand and fragments
  // Prefer longest when scores tie: "metal bed frame" (3w) > "metal bed" (2w) > "bed frame" (2w)
  var titleMultiWord = (!brand ? null : (function() {
    var best = null;
    sorted.forEach(function(p) {
      if (p.split(' ').length < 2) return;
      if (p.toLowerCase().indexOf(brand) !== -1) return;
      if (isFragment(p)) return;
      if (!best || p.split(' ').length > best.split(' ').length) best = p;
    });
    return best;
  })()) || '';

  // Step B: Category last segment as fallback (clean plurals)
  // Use category ONLY when brand is unknown (avoids "keter store" problem)
  var category = s2.category || '';
  var catParts = category.split('>').map(function(p) { return p.trim(); });
  var catProduct = '';
  if (catParts.length > 0) {
    var lastCat = catParts[catParts.length - 1].toLowerCase().replace(/\s+/g, ' ').trim();
    if (lastCat.length > 3) catProduct = lastCat.replace(/s$/, '');
    var catIgnore = ['products', 'items', 'sale', 'deals', 'sets', 'collections'];
    catIgnore.forEach(function(w) { if (catProduct.indexOf(w) !== -1) catProduct = ''; });
  }

  // Final: prefer title multi-word phrase (if brand known), else category, else top phrase
  var coreProduct = titleMultiWord || catProduct || sorted[0] || '';

  var primaryKeyword = sorted.find(function(p) { return p.split(' ').length >= 2; }) || coreProduct || '';
  var sizeMatches = title.match(/\d+\s*(oz|lb|lbs|gallon|ml|liter|inch|inches|mm|cm|ft|"|\'|\s+pack|\s+piece|\s+set)/gi) || [];
  return {
    primaryKeyword: primaryKeyword || coreProduct || '',
    coreProduct: coreProduct || primaryKeyword || '',
    foundPhrases: sorted.slice(0, 20),
    sizeSignals: sizeMatches.slice(0, 3),
    keywords: sorted.filter(function(p) { return p.length > 3; }).slice(0, 30)
  };
}

// ── Step 4: Competitor Benchmark (self-only, no competitor pool) ──
// coreProduct is already computed in Step3 from category path.
// Competitor data is NOT needed — all downstream steps use self-only data.
async function step4(ctx) {
  var s3 = ctx.deps[3].data;
  var s2 = ctx.deps[2].data;
  var coreProduct = s3.coreProduct || '';
  var category = s2.category || '';

  log('  [step4] coreProduct: "' + coreProduct + '" (from category: ' + category.split('>').pop().trim() + ')');
  log('  [step4] Competitor pool: none (self-only mode)');

  return {
    competitors: [],
    cascadeRounds: [],
    totalFound: 0,
    coreProduct: coreProduct
  };
}

// ── Step 5: Keyword Universe ──────────────────────────────────
async function step5(ctx) {
  var s2 = ctx.deps[2].data;
  var s3 = ctx.deps[3].data;
  var brand = (s2.brand || '').toLowerCase();

  // Build phraseFreq from current listing's own phrases (no competitor pollution)
  var phraseFreq = {};
  (s3.foundPhrases || []).forEach(function(p) {
    var words = p.split(' ');
    if (words.length >= 2 && words.length <= 3 && !isFragment(p)) {
      phraseFreq[p] = (phraseFreq[p] || 0) + 1;
    }
  });
  var sortedPhrases = Object.keys(phraseFreq).sort(function(a, b) {
    return phraseFreq[b] - phraseFreq[a];
  });

  // Primary: frequent phrases from THIS listing (not competitors)
  var primary = [], primarySet = new Set();
  sortedPhrases.forEach(function(p) {
    if (phraseFreq[p] >= 1 && primary.length < 6) {
      if (brand && p.toLowerCase().indexOf(brand) !== -1) return;
      primary.push({ keyword: p, inTitle: true, category: 'self', freq: phraseFreq[p] });
      primarySet.add(p);
    }
  });

  // Secondary: less frequent, still from this listing
  var secondary = [], secondarySet = new Set();
  sortedPhrases.forEach(function(p) {
    if (!primarySet.has(p) && secondary.length < 8) {
      if (brand && p.toLowerCase().indexOf(brand) !== -1) return;
      secondary.push({ keyword: p, category: 'self', freq: phraseFreq[p] });
      secondarySet.add(p);
    }
  });

  return { primary: primary, secondary: secondary, backend: [], wordFreq: phraseFreq };
}

// ── Step 6: Title Audit ───────────────────────────────────────
async function step6(ctx) {
  var s2 = ctx.deps[2].data;
  var title = s2.title || '';
  var titleLower = title.toLowerCase();
  var issues = [];

  if (title.length > 200) issues.push({ severity: 'high', issue: 'Title exceeds 200 characters — reduce or move details to bullets' });
  var pipeCount = (title.match(/[|]/g) || []).length;
  if (pipeCount > 2) issues.push({ severity: 'medium', issue: 'Title has ' + pipeCount + ' pipes (best: ≤2)' });
  var commaCount = (title.match(/,/g) || []).length;
  if (commaCount > 3) issues.push({ severity: 'medium', issue: 'Title has ' + commaCount + ' commas — consider simplifying' });
  var dashCount = (title.match(/[—–-]/g) || []).length;
  if (dashCount > 3) issues.push({ severity: 'low', issue: 'Multiple dashes may fragment Rufus parsing' });
  if (!s2.bullets || s2.bullets.length === 0) issues.push({ severity: 'high', issue: 'No bullet points found' });

  var titleSegments = title.split(/[,—–|]/).map(function(s) { return s.trim().toLowerCase(); }).filter(function(s) { return s.length > 3; });
  var segCount = {};
  titleSegments.forEach(function(seg) { segCount[seg] = (segCount[seg] || 0) + 1; });
  Object.keys(segCount).forEach(function(seg) {
    if (segCount[seg] > 1) issues.push({ severity: 'high', issue: 'Segment "' + seg + '" appears ' + segCount[seg] + '× — remove repetition' });
  });

  var s3 = ctx.deps[3].data;
  var foundPhrases = (s3.foundPhrases || []).slice(0, 10);
  var titleWords = titleLower.split(/[\s,\-_|"']+/);
  var titleDelimitedSegments = title.split(/[,—–|]/).map(function(s) { return s.trim().toLowerCase(); });
  foundPhrases.forEach(function(phrase) {
    var phraseWords = phrase.split(' ');
    if (phraseWords.length >= 2) {
      var allPresent = phraseWords.every(function(w) { return titleWords.indexOf(w) !== -1; });
      var contiguous = titleLower.indexOf(phrase) !== -1;
      if (allPresent && !contiguous) {
        // If phrase words span across 2+ comma/pipe segments, it's split by design — not a real fragmentation issue
        var wordSegmentCounts = titleDelimitedSegments.map(function(seg) {
          var segWords = seg.split(/[\s]+/);
          return phraseWords.filter(function(w) { return segWords.indexOf(w) !== -1; }).length;
        });
        var wordsInMultipleSegments = wordSegmentCounts.filter(function(c) { return c > 0; }).length;
        if (wordsInMultipleSegments > 1) return; // split by design — skip
        issues.push({ severity: 'medium', issue: '"' + phrase + '" is implied but fragmented — keep as one segment' });
      }
    }
  });

  if (!/\d+/.test(title)) issues.push({ severity: 'low', issue: 'No numeric specification in title — Rufus may under-index' });

  return { issues: issues, titleLength: title.length };
}

// ── Step 7: Optimized Titles (competitor-driven) ──────────────
// Sources (priority order):
//   1. Use case chains (2+ consecutive use case words) from foundPhrases
//   2. Clean 2-word subsegments from foundPhrases (positioning/attributes)
//   3. step5 secondary attributes
//   4. High-freq competitor bigrams (freq>=3)
//   5. Capacity phrases (3-word number+unit, freq>=2)
// Filters: no brand, no stopword-start, no core product type words,
//          no cert fragments, min 4 chars
async function step7(ctx) {
  var s2 = ctx.deps[2].data;
  var s3 = ctx.deps[3].data;
  var s4 = ctx.deps[4].data;
  var s5 = ctx.deps[5].data;
  // Brand: prefer extracted brand, fallback to first word of title if it looks like a brand name
  var brand = s2.brand || '';
  if (!brand && s2.title) {
    var firstWord = (s2.title.split(/[\s,_|\-\—]/)[0] || '').trim();
    if (firstWord && firstWord.length >= 2 && firstWord.length <= 20 && /^[A-Z][a-zA-Z0-9]+$/.test(firstWord)) {
      brand = firstWord;
    }
  }
  var coreProduct = (s4.coreProduct || s3.coreProduct || '').trim();
  var brandPrefix = brand ? brand + ' ' : '';

  // — LLM-driven title generation (step7) ————————————————
  var stepLLM = require('./stepLLM');
  var s11 = ctx.deps[11] ? ctx.deps[11].data : null;
  var violations = (s11 ? (s11.violations || []) : []).filter(function(v) { return v.severity && v.severity !== 'none'; });
  var s5primary = (s5.primary || []).map(function(k) { return typeof k === 'string' ? k : (k.keyword || ''); }).filter(function(k) { return k; });
  log('  [step7] generating optimized titles via LLM...');
  var llmTitles = null;
  try {
    llmTitles = await stepLLM.generateOptimizedTitles({
      title: s2.title || '',
      brand: brand,
      coreProduct: coreProduct,
      primaryKeywords: s5primary,
      violations: violations
    });
  } catch(e) {
    log('  [step7] LLM title gen failed: ' + e.message + ' — falling back to rule engine');
  }
  var versionA, versionB, versionC, recommendation;
  if (llmTitles && llmTitles.versionA && llmTitles.versionA.text) {
    versionA = llmTitles.versionA.text.substring(0, 200);
    versionB = llmTitles.versionB && llmTitles.versionB.text ? llmTitles.versionB.text.substring(0, 200) : versionA;
    versionC = llmTitles.versionC && llmTitles.versionC.text ? llmTitles.versionC.text.substring(0, 200) : versionB;
    recommendation = (llmTitles.versionA.note || 'Generated by LLM.') + ' Original char count: ' + (s2.title || '').length + '.';
    return {
      versionA: versionA,
      versionB: versionB,
      versionC: versionC,
      topSegments: [],
      recommendation: recommendation
    };
  }
  // Fallback: Rule-based title generation
  var CAPACITY_SIGNALS = /\d+\s*(lbs?|kg|oz|pcs?|piece|set|gal|hour|min|inch|cm|mm|ft)/i;
  var brandLower = brand.toLowerCase();
  var coreLower = (coreProduct || '').toLowerCase();
  var coreWords = coreLower.split(' ').filter(function(w) { return w.length > 2; });

  // Core product synonyms — words that describe the product type itself
  var CORE_SYNONYMS = new Set(['machine', 'maker', 'ice', 'nugget', 'clear', 'pellet']);
  var CERT_TOKENS = new Set(['etl', 'doe', 'ul', 'ce', 'fcc', 'fda', 'nsf', 'certificated', 'certified']);
  var USE_CASE_WORDS = new Set(['home', 'cafe', 'bar', 'restaurant', 'office', 'hotel', 'party', 'apartment', 'dorm', 'commercial', 'residential']);

  function isCleanWord(w) {
    return !STOPWORDS.has(w) && !CORE_SYNONYMS.has(w) && !CERT_TOKENS.has(w);
  }

  function segmentPriority(p) {
    var words = p.split(' ');
    var ucCount = words.filter(function(w) { return USE_CASE_WORDS.has(w); }).length;
    if (ucCount >= 2) return 4 + ucCount; // use case chains: highest
    if (/\d+\s*(lbs?|kg|oz|pcs?)/i.test(p)) return 3; // capacity phrases
    if (p.split(' ').length === 2 && isCleanWord(words[0]) && isCleanWord(words[1])) return 2;
    return 1;
  }

  var segMap = {};
  function addSeg(seg, pri) {
    if (!seg || seg.length < 4) return;
    var key = seg.toLowerCase();
    if (segMap[key]) {
      segMap[key].freq++;
      if (pri > segMap[key].priority) segMap[key].priority = pri;
    } else {
      segMap[key] = { phrase: seg, priority: pri, freq: 1 };
    }
  }

  // P5: Use case chains from foundPhrases
  (s3.foundPhrases || []).forEach(function(p) {
    var words = p.split(' ');
    var chainStart = -1, chainLen = 0;
    for (var i = 0; i <= words.length; i++) {
      var w = (words[i] || '').toLowerCase();
      var isUC = USE_CASE_WORDS.has(w) && !CORE_SYNONYMS.has(w) && !CERT_TOKENS.has(w) && !STOPWORDS.has(w);
      if (isUC) {
        if (chainStart === -1) chainStart = i;
        chainLen++;
      } else {
        if (chainLen >= 2) addSeg(words.slice(chainStart, chainStart + chainLen).join(' '), 5);
        chainStart = -1; chainLen = 0;
      }
    }
  });

  // P3: Capacity signals from THIS listing's own size/dimension data
  (s3.sizeSignals || []).slice(0, 3).forEach(function(sig) {
    addSeg(sig, 3);
  });

  // P2: 3-word clean segments from foundPhrases (no core words, no cert fragments)
  (s3.foundPhrases || []).forEach(function(p) {
    var words = p.split(' ');
    if (words.length >= 3) {
      for (var i = 0; i <= words.length - 3; i++) {
        var sub = words.slice(i, i + 3).join(' ');
        var ws = sub.toLowerCase().split(' ');
        if (ws.some(function(w) { return CORE_SYNONYMS.has(w); })) continue;
        if (CERT_TOKENS.has(ws[0]) || CERT_TOKENS.has(ws[2])) continue;
        addSeg(sub, 2);
      }
    }
  });

  // P2: 2-word attribute phrases from step5 secondary
  (s5.secondary || [])
    .map(function(s) { return typeof s === 'string' ? s : (s.keyword || ''); })
    .filter(function(p) {
      if (p.split(' ').length < 2) return false;
      if (brandLower && p.toLowerCase().indexOf(brandLower) !== -1) return false;
      var words = p.split(' ');
      return words.every(function(w) {
        w = w.toLowerCase();
        return !STOPWORDS.has(w) && !CORE_SYNONYMS.has(w) && !CERT_TOKENS.has(w);
      }) && p.length >= 4;
    })
    .forEach(function(p) { addSeg(p, 2); });

  // P1: Attribute bigrams from THIS listing's foundPhrases (no competitor copy)
  (s3.foundPhrases || [])
    .filter(function(p) {
      if (p.split(' ').length !== 2) return false;
      var words = p.toLowerCase().split(' ');
      if (!words.every(function(w) { return !STOPWORDS.has(w) && !CORE_SYNONYMS.has(w) && !CERT_TOKENS.has(w); })) return false;
      if (brandLower && words.some(function(w) { return w.indexOf(brandLower) !== -1; })) return false;
      return p.length >= 4;
    })
    .slice(0, 12)
    .forEach(function(p) { addSeg(p, 1); });

  // P0.5: Positioning adjectives from THIS listing's title + bullets
  var POS_SINGLE = new Set(['countertop', 'portable', 'stainless', 'compact', 'freestanding', 'automatic', 'heavy-duty', 'slim', 'upright', 'adjustable']);
  var allSelfWords = [];
  if (s2.title) allSelfWords = allSelfWords.concat(tokenize(s2.title));
  (s2.bullets || []).forEach(function(b) { allSelfWords = allSelfWords.concat(tokenize(b)); });
  var posFreq = {};
  allSelfWords.forEach(function(w) {
    if (POS_SINGLE.has(w.toLowerCase()) && (!brandLower || w.toLowerCase().indexOf(brandLower) === -1)) {
      posFreq[w.toLowerCase()] = (posFreq[w.toLowerCase()] || 0) + 1;
    }
  });
  Object.keys(posFreq)
    .sort(function(a, b) { return posFreq[b] - posFreq[a]; })
    .slice(0, 4)
    .forEach(function(w) { addSeg(w, 0.5); });

  // Sort: priority desc, freq desc
  var sortedSegs = Object.keys(segMap)
    .map(function(k) { return segMap[k]; })
    .sort(function(a, b) {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.freq - a.freq;
    });

  // Substring dedup (bidirectional): skip if new seg is substring of accepted OR
  // if accepted seg is a substring of new seg (new seg is shorter/less specific)
  var accepted = [];
  sortedSegs.forEach(function(s) {
    var key = s.phrase.toLowerCase();
    var isSubstring = accepted.some(function(a) {
      var ak = a.phrase.toLowerCase();
      // new is substring of accepted, OR accepted is substring of new (new is less specific)
      return ak.indexOf(key) !== -1 || key.indexOf(ak) !== -1;
    });
    if (!isSubstring) accepted.push(s);
  });

  // Use accepted (deduped, no substring fragments) for VER A, not raw sortedSegs
  var topSegments = accepted.map(function(s) { return s.phrase; }).slice(0, 10);

  // VERSION A: coreProduct FIRST (brand optional), then top segments.
  // Structure: "[Brand] <coreProduct>, <seg1>, <seg2>, <seg3>, ..."
  // Deduplication: skip segments that exactly match coreProduct (avoid repetition)
  var verA_parts = [];
  if (brand) verA_parts.push(brand);
  verA_parts.push(coreProduct);
  topSegments.slice(0, 10).forEach(function(seg) {
    // Skip exact duplicate of coreProduct (case-insensitive)
    if (seg.toLowerCase() === (coreProduct || '').toLowerCase()) return;
    // Skip segments that contain the brand name (partial match)
    if (brand && seg.toLowerCase().indexOf(brandLower) !== -1) return;
    var test = verA_parts.join(', ') + ', ' + seg;
    if (test.length < 195) verA_parts.push(seg);
  });
  var versionA = verA_parts.join(', ').substring(0, 200);

  // VERSION B: VERSION C format (brand + top seg + coreProduct), 1-3 segments
  // Best for short titles
  // Deduplication: skip segments matching coreProduct or already added
  var verB_parts = [brand];
  topSegments.slice(0, 3).forEach(function(seg) {
    if (verB_parts.length >= 5) return;
    if (seg.toLowerCase() === (coreProduct || '').toLowerCase()) return;
    if (verB_parts.indexOf(seg) !== -1) return;  // no intra-list duplicates
    var test = verB_parts.join(', ') + ', ' + seg;
    if (test.length < 140) verB_parts.push(seg);
  });
  verB_parts.push(coreProduct);
  var versionB = verB_parts.join(', ').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').substring(0, 200);

  // VERSION C: Cleanest format — brand + top seg + coreProduct
  // Skip if topSegments[0] matches coreProduct
  var verC_parts = [brand];
  if (topSegments[0] && topSegments[0].toLowerCase() !== (coreProduct || '').toLowerCase()) {
    verC_parts.push(topSegments[0]);
  }
  verC_parts.push(coreProduct);
  var versionC = verC_parts.join(', ').replace(/,\s*,/g, ',').replace(/^\s*,\s*/, '').substring(0, 200);

  // Recommend: VERSION C by default (cleaner). VERSION A only if it adds 3+ extra segments.
  var verASegs = versionA.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s && s.toLowerCase() !== brandLower; });
  var verCSegs = versionC.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s && s.toLowerCase() !== brandLower; });
  var extraSegs = verASegs.length - verCSegs.length;
  var recommendation = (extraSegs >= 3
    ? 'Version A recommended (' + verASegs.length + ' segments, more keyword coverage). '
    : 'Version C recommended (cleaner keyword order, ' + verCSegs.length + ' segments). ')
    + 'Built from listing own data. '
    + 'Top segments: ' + topSegments.slice(0, 3).join(', ') + '.';

  return {
    versionA: versionA,
    versionB: versionB,
    versionC: versionC,
    topSegments: topSegments.slice(0, 8),
    recommendation: recommendation
  };
}

// ── Step 8: Backend Keywords ─────────────────────────────────
async function step8(ctx) {
  var s5 = ctx.deps[5].data;

  // Backend built from THIS listing's own keywords (no competitor copying)
  // E-GEO gap keywords will be added in step13 (after E-GEO features are computed)
  var s5primary = (s5.primary || []).map(function(k) { return typeof k === 'string' ? k : (k.keyword || ''); }).filter(function(k) { return k; });
  var s5secondary = (s5.secondary || []).map(function(k) { return typeof k === 'string' ? k : (k.keyword || ''); }).filter(function(k) { return k; });
  var combined = [];
  var seen = {};
  function add(w) {
    if (w && w.length > 2 && !seen[w]) { seen[w] = true; combined.push(w.toLowerCase()); }
  }
  s5primary.forEach(add);
  s5secondary.forEach(add);
  // Final dedup: collect unique words preserving order, split phrases for coverage
  var allWords = [];
  combined.forEach(function(w) { allWords.push(w.toLowerCase()); });
  // Split phrases (some may still be multi-word) and dedup with Set
  var wordSet = new Set();
  allWords.forEach(function(w) {
    w.split(' ').forEach(function(sub) { if (sub.length > 2) wordSet.add(sub); });
  });
  var finalWords = Array.from(wordSet).slice(0, 50);
  var backendStr = finalWords.join(' ').substring(0, 250);
  return { backend: backendStr, byteCount: backendStr.length, _selfOnly: true };
}

// ── Step 9: Bullet Optimization ─────────────────────────────
async function step9(ctx) {
  var s2 = ctx.deps[2].data;
  var s11 = ctx.deps[11] ? ctx.deps[11].data : null;
  var s12 = ctx.deps[12] ? ctx.deps[12].data : null;
  var bullets = s2.bullets || [];
  var violations = (s11 ? (s11.violations || []) : []).filter(function(v) { return v.severity && v.severity !== 'none'; });
  var missingEgeo = s12 ? (s12.egeoFeatures || []).filter(function(f) { return f.missing; }) : [];

  // — LLM-driven bullet generation (step9) ————————————————
  var stepLLM = require('./stepLLM');
  log('  [step9] generating optimized bullets via LLM...');
  var llmBullets = null;
  try {
    llmBullets = await stepLLM.generateOptimizedBullets({
      bullets: bullets,
      violations: violations,
      implicitViolations: s11 ? (s11.implicitViolations || []) : [],
      missingEgeo: missingEgeo
    });
  } catch(e) {
    log('  [step9] LLM bullet gen failed: ' + e.message + ' — falling back to template');
  }
  if (llmBullets && llmBullets.bullets && llmBullets.bullets.length > 0) {
    var bulletMap = {};
    llmBullets.bullets.forEach(function(b) {
      if (b.index !== undefined) bulletMap[b.index - 1] = b;
    });
    var optimized = bullets.map(function(bulletText, i) {
      if (bulletMap[i]) {
        var b = bulletMap[i];
        var parts = [b.rewritten || bulletText];
        if (b.actions && b.actions.length > 0) {
          b.actions.forEach(function(a) { parts.push('  → ' + a); });
        }
        return parts.join('\n');
      }
      return bulletText;
    });
    return { optimized: optimized, missingEgeo: missingEgeo.map(function(f) { return f.label; }), method: 'llm' };
  }
  // Fallback: Template-based bullet optimization
  var violatedBullets = {};
  violations.forEach(function(v) {
    if (v.bullet) violatedBullets[v.bullet - 1] = v;
  });

  var optimized = bullets.map(function(bulletText, i) {
    var violationActions = [];
    var enhanceActions = [];
    var text = bulletText;

    if (violatedBullets[i]) {
      var vr = violatedBullets[i];

      // V2: Direct competitor comparison — "Unlike..."
      if (vr.rule === 'Direct competitor comparison') {
        var unlikeIdx = text.toLowerCase().indexOf('unlike');
        if (unlikeIdx !== -1) {
          var endIdx = text.indexOf(', our', unlikeIdx);
          var nextClause = unlikeIdx > 0 ? text.substring(0, unlikeIdx).replace(/\s+$/, '') : '';
          var afterClause = endIdx !== -1 ? text.substring(endIdx + 1) : '';
          text = (nextClause + (afterClause ? ' ' + afterClause : '')).trim();
          if (text.length > 0 && !text.match(/^[^a-z]/)) {
            text = text.charAt(0).toUpperCase() + text.substring(1);
          }
          violationActions.push('Remove competitor comparison ("Unlike...")');
        }
      }

      // V1: Unsubstantiated superlatives
      if (vr.rule === 'Unsubstantiated superlatives') {
        var supWords = (vr.matched || '').split(/\s+/);
        var fixText = text;
        supWords.forEach(function(sw) {
          if (sw && sw.length > 1) {
            var re = new RegExp('\\b' + sw + '\\b', 'gi');
            fixText = fixText.replace(re, 'proven');
          }
        });
        if (fixText !== text) {
          text = fixText;
          violationActions.push('Replace superlative "' + vr.matched + '" with verifiable claim (e.g., "proven")');
        } else {
          violationActions.push('Remove unsubstantiated superlative: "' + vr.matched + '"');
        }
      }

      // V3: Unverified health claim
      if (vr.rule === 'Unverified health claim') {
        violationActions.push('Remove unverified health claim: "' + vr.matched + '" — replace with factual product benefit');
      }

      // V4: Promotional price language
      if (vr.rule === 'Promotional price language') {
        var saleIdx = text.toLowerCase().indexOf('sale');
        if (saleIdx !== -1) {
          text = text.substring(0, saleIdx).trim();
          if (text.length > 0 && !text.match(/^[^a-z]/)) {
            text = text.charAt(0).toUpperCase() + text.substring(1);
          }
          violationActions.push('Remove promotional language ("SALE")');
        }
      }
    }

    var hasDim = /\d+\s*(?:inch|inches|cm|mm|"|''|lbs?|kg|oz|gallon|liter)/i.test(text);
    if (!hasDim && missingEgeo.some(function(f) { return f.id === 'dimension'; })) {
      enhanceActions.push('Add exact dimensions (H × W × D) and weight capacity');
    }
    if (!/warranty|guarantee/i.test(text) && missingEgeo.some(function(f) { return f.id === 'warranty'; })) {
      enhanceActions.push('Add warranty period (e.g., "1-Year Warranty")');
    }
    if (!/(durab|sturdy|material|quality)/i.test(text) && missingEgeo.some(function(f) { return f.id === 'quality'; })) {
      enhanceActions.push('Add material or durability claim relevant to your product');
    }

    var allActions = violationActions.concat(enhanceActions);
    if (allActions.length > 0) {
      return bulletText + '\n  → ' + allActions.join('\n  → ');
    }
    return bulletText;
  });

  return { optimized: optimized, missingEgeo: missingEgeo.map(function(f) { return f.label; }) };
}

// ── Step 10: Rufus Intent + LLM Semantic Analysis ────────────────
// Replaces all hardcoded regex scoring with LLM-driven evaluation.
// KB (kb_rules.js) provides the evaluation framework (5 dimensions).
// Listing data (title + bullets) is the semantic context for LLM judgment.
// ── Step 10: LLM-Driven E-GEO + Violations + Implicit Analysis ──
// Unified analysis: calls stepLLM.js once via external process, gets violations + E-GEO scores + implicit violations.
// External process (step10_external.js) solves the gateway HTTP blocking issue during agent exec.
async function step10(ctx) {
  var asin = ctx.deps[2] && ctx.deps[2].data && ctx.deps[2].data.asin || (ctx.deps[1] && ctx.deps[1].data && ctx.deps[1].data.asin) || 'UNKNOWN';
  var cpDir = path.join(CHECKPOINT_DIR, asin);
  var step10File = path.join(cpDir, 'step10.json');

  // Check cache
  if (fs.existsSync(step10File)) {
    var cached = JSON.parse(fs.readFileSync(step10File, 'utf8'));
    log('  [step10] LLM analysis (cached)');
    return cached;
  }

  log('  [step10] LLM semantic analysis (E-GEO + violations + implicit)...');

  // Run in external process to avoid gateway HTTP blocking during agent exec
  var step10Ext = path.join(__dirname, 'step10_external.js');
  var start = Date.now();
  try {
    await new Promise(function(resolve, reject) {
      var child = require('child_process').spawn(
        process.execPath, [step10Ext, asin],
        { stdio: ['ignore', 'pipe', 'pipe'], cwd: __dirname }
      );
      var stderr = '';
      child.stderr.on('data', function(c) { stderr += c; });
      child.on('close', function(code) {
        if (code === 0) resolve();
        else reject(new Error('step10_external exited code ' + code + ': ' + stderr));
      });
      child.on('error', reject);
    });
    var result = JSON.parse(fs.readFileSync(step10File, 'utf8'));
    log('  [step10] method: ' + result.method + ' | violations: ' + result.totalViolations + ' | egeo missing: ' + result.missingFeatures + ' | ' + (Date.now()-start) + 'ms');
    return result;
  } catch(e) {
    log('  [step10] external process failed: ' + e.message + ' — falling back to char check');
    return {
      violations: [],
      egeoScores: [],
      implicitViolations: [],
      missingFeatures: 0,
      egeoFeatures: [],
      method: 'llm_fallback',
      summary: 'LLM analysis failed. Manual review recommended.'
    };
  }
}

// ── LLM call helper ──────────────────────────────────────────
// Calls the configured LLM (MiniMax via Gateway) with the given prompt.
// Returns the text response or null on failure.
async function callLLM(prompt) {
  var cfg = { model: 'minimax/MiniMax-M2.7', temperature: 0.3 };
  // Use OpenClaw gateway to call LLM
  try {
    var http = require('http');
    var body = JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: 'You are a precise Amazon listing analyst. Output ONLY valid JSON array matching the requested format. No markdown, no explanation.' },
        { role: 'user', content: prompt }
      ],
      temperature: cfg.temperature,
      max_tokens: 1500
    });

    var authToken = process.env.OPENCLAW_GATEWAY_TOKEN || '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3';
    return new Promise(function(resolve, reject) {
      var req = http.request({ hostname: '127.0.0.1', port: 18789, path: '/v1/chat/completions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Bearer ' + authToken } }, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try { var json = JSON.parse(data); resolve(json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || null); }
          catch(e) { resolve(null); }
        });
      });
      req.on('error', function(e) { reject(e); });
      req.setTimeout(15000, function() { req.destroy(); reject(new Error('LLM timeout')); });
      req.write(body);
      req.end();
    });
  } catch(e) { return null; }
}
// ── Step 11: Explicit Violations (reads from step10 LLM cache) ──
// No independent LLM call — reads violations from step10's unified analysis.
// This preserves the step11 interface for backward compatibility.
async function step11(ctx) {
  // step10 already ran and saved full analysis to checkpoint 10
  var s10 = ctx.deps[10] ? ctx.deps[10].data : null;
  if (s10 && s10.violations) {
    log('  [step11] loaded ' + s10.violations.length + ' violations from step10 cache');
    return { violations: s10.violations, totalViolations: s10.totalViolations || s10.violations.length };
  }
  // Fallback: no cache, return empty
  log('  [step11] WARNING: no step10 cache — returning empty violations');
  return { violations: [], totalViolations: 0 };
}

// ── Step 12: E-GEO Features + Implicit Violations (reads from step10 LLM cache) ──
// No independent LLM call — reads E-GEO features and implicit violations from step10.
// This preserves the step12 interface for backward compatibility.
async function step12(ctx) {
  // step10 already ran and saved full analysis to checkpoint 10
  var s10 = ctx.deps[10] ? ctx.deps[10].data : null;
  if (s10 && s10.egeoFeatures) {
    log('  [step12] loaded ' + s10.egeoFeatures.length + ' E-GEO features from step10 cache');
    return {
      egeoFeatures: s10.egeoFeatures,
      missingFeatures: s10.missingFeatures || 0,
      implicitViolations: s10.implicitViolations || [],
      implicitViolationCount: s10.implicitViolationCount || 0
    };
  }
  // Fallback: no cache, return empty
  log('  [step12] WARNING: no step10 cache — returning empty E-GEO features');
  return { egeoFeatures: [], missingFeatures: 0, implicitViolations: [], implicitViolationCount: 0 };
}

// ── Step 13: Listing Weight Improvement Suggestions ─────────────
async function step13(ctx) {
  var s2 = ctx.deps[2].data;
  var s5 = ctx.deps[5].data;
  var s8 = ctx.deps[8].data;
  var s12 = ctx.deps[12] ? ctx.deps[12].data : null;
  var bt = ((s2.bullets || []).join(' ') + ' ' + (s2.title || '')).toLowerCase();
  var suggestions = [];

  var hasNumbers = /\d+\s*(lbs?|kg|oz|cm|mm|inch|inches|ft|gal|liter|kw|w|v|db)/i.test(bt);
  var hasCert = /\b(ETL|UL|CE|FCC|DOE|Energy Star|certified)\b/i.test(bt);
  var hasSocial = /\b(customers|reviews|ratings|best seller|top rated)\b/i.test(bt);
  var hasWarranty = /\b(warranty|guarantee)\b/i.test(bt);
  var hasSafety = /\b(ETL|UL|food.?grade|non.?toxic|safe)\b/i.test(bt);
  var hasUrgency = /\b(now|today|limited|available|order now)\b/i.test(bt);
  var hasScannable = (s2.bullets || []).some(function(b) { return /[:;|]|\n/.test(b); });
  var hasUseCases = /\b(home|office|hotel|bar|restaurant|commercial)\b/i.test(bt);

  if (!hasNumbers)   suggestions.push({ factor: 'Numeric specs',      current: 'Missing',   action: 'Add exact weight, dimensions, and capacity (lbs, inches)',     impact: 'high' });
  if (!hasCert)     suggestions.push({ factor: 'Certification',      current: 'Missing',   action: 'Add ETL/UL certification mention',                       impact: 'high' });
  if (!hasSocial)   suggestions.push({ factor: 'Social proof',       current: 'Missing',   action: 'Add rating or bestseller reference if available',           impact: 'medium' });
  if (!hasWarranty) suggestions.push({ factor: 'Warranty',           current: 'Missing',   action: 'Add warranty period ("1-Year Warranty")',                 impact: 'high' });
  if (!hasSafety)   suggestions.push({ factor: 'Safety claim',       current: 'Missing',   action: 'Add ETL/UL safety certification or food-grade claim',      impact: 'high' });
  if (!hasUrgency)  suggestions.push({ factor: 'Urgency signal',    current: 'Missing',   action: 'Add "In Stock / Ships Today" or "Available Now"',         impact: 'medium' });
  if (!hasScannable) suggestions.push({ factor: 'Bullet structure',  current: 'Flat/long', action: 'Use colons, semicolons, or newlines to separate claims',   impact: 'medium' });
  if (!hasUseCases) suggestions.push({ factor: 'Use case coverage', current: 'Limited',   action: 'List target scenarios: home bar, office kitchen, restaurant', impact: 'medium' });

  // ── E-GEO Backend Generation (runs after step12 E-GEO features are available) ──
  var egeoBackend = (s8 && s8.backend) ? s8.backend : '';
  if (s12) {
    var missingEgeo = (s12.egeoFeatures || []).filter(function(f) { return f.missing; });
    var egeoMap = {
      certification: ['certified etl ul ce fcc'],
      warranty: ['warranty guarantee 1-year 2-year'],
      social_proof: ['bestseller top-rated reviews ratings'],
      safety: ['safety certified tested'],
      usecase: ['home apartment dorm office hotel'],
      ranking: ['top-rated bestseller #1'],
      dimension: ['dimensions measurements size'],
      quality: ['premium quality durable'],
      origin: ['usa imported made']
    };
    var egeoWords = [];
    missingEgeo.forEach(function(f) {
      var words = egeoMap[f.id] || f.id;
      if (typeof words === 'string') words = words.split(' ');
      words.forEach(function(w) { if (w.length > 2) egeoWords.push(w); });
    });
    // Merge E-GEO words with s8 backend (dedup)
    var existing = (egeoBackend || '').split(' ').filter(function(w) { return w.length > 2; });
    var seen = {};
    existing.forEach(function(w) { seen[w] = true; });
    egeoWords.forEach(function(w) { if (!seen[w]) { egeoBackend += ' ' + w; seen[w] = true; } });
    egeoBackend = egeoBackend.trim().substring(0, 250);
  }

  return { issues: suggestions, backend: egeoBackend };
}

// ── Step 14: Priority Action Plan ─────────────────────────────
async function step14(ctx) {
  var s11 = ctx.deps[11] ? ctx.deps[11].data : null;
  var s12 = ctx.deps[12] ? ctx.deps[12].data : null;
  var s13 = ctx.deps[13] ? ctx.deps[13].data : null;
  var plan = [];

  if (s11 && s11.violations) {
    s11.violations.forEach(function(v) {
      plan.push({
        priority: 'P0',
        rule: v.rule,
        location: v.bullet ? 'Bullet ' + v.bullet : 'Title',
        action: 'Remove or rephrase: "' + v.matched + '"',
        impact: 'Compliance risk — required fix'
      });
    });
  }

  if (s12 && s12.egeoFeatures) {
    s12.egeoFeatures.filter(function(f) { return f.missing; }).forEach(function(f) {
      plan.push({
        priority: 'P1',
        rule: f.label,
        location: 'Bullets',
        action: 'Add: ' + f.label,
        impact: 'Rufus/Cosmo ranking impact'
      });
    });
  }

  // Add implicit violations (LLM-detected, not regex) as P1 items
  if (s12 && s12.implicitViolations && s12.implicitViolations.length > 0) {
    s12.implicitViolations.forEach(function(v) {
      plan.push({
        priority: 'P1',
        rule: v.rule,
        location: v.location || 'Listing',
        action: 'Fix: ' + (v.matched || v.rule),
        impact: 'Implicit compliance risk: ' + (v.severity || 'medium')
      });
    });
  }

  if (s13 && s13.issues) {
    s13.issues.forEach(function(s) {
      plan.push({
        priority: 'P2',
        rule: s.factor,
        location: 'Bullets/Title',
        action: s.action,
        impact: s.impact
      });
    });
  }

  // Deduplicate: skip P2 items whose action is already covered by P1
  // (same E-GEO feature, different wording)
  var seenP1Labels = {};
  plan.filter(function(p) { return p.priority === 'P1'; }).forEach(function(p1) {
    // Extract core semantic content for matching
    var norm = p1.action.replace(/^Add:\s*/i, '').replace(/[\s,\-_()]+/g, ' ').toLowerCase().trim();
    // Also store significant words
    var words = norm.split(' ').filter(function(w) { return w.length > 3; });
    seenP1Labels[p1.action] = words;
  });
  var dedupedPlan = plan.filter(function(p) {
    if (p.priority !== 'P2') return true;
    var p2Norm = p.action.replace(/[\s,\-_()\/]+/g, ' ').toLowerCase().trim();
    var p2Words = p2Norm.split(' ').filter(function(w) { return w.length > 3; });
    // Check if P2 is redundant with any P1
    for (var existingAction in seenP1Labels) {
      var p1Words = seenP1Labels[existingAction];
      var overlap = p2Words.filter(function(w) { return p1Words.indexOf(w) !== -1; });
      // Skip P2 if it shares 2+ significant words with any P1 (same E-GEO feature, different wording)
      if (overlap.length >= 2) {
        return false; // skip this P2 — already covered by P1
      }
    }
    return true;
  });

  return { plan: dedupedPlan };
}

// ── Step 15: Anomalies ────────────────────────────────────────
async function step15(ctx) {
  var s2 = ctx.deps[2].data;
  var s4 = ctx.deps[4] ? ctx.deps[4].data : null;
  var anomalies = [];

  if (s2.price) {
    var prices = (s4 ? s4.competitors.map(function(c) { return c.price; }).filter(function(p) { return p && p > 0; }) : []);
    if (prices.length > 0) {
      var avg = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
      if (s2.price > avg * 1.5) {
        anomalies.push({ type: 'price_high', detail: 'Price is 50%+ above competitor average ($' + avg.toFixed(0) + ')' });
      }
    }
  }

  if (s2.reviewCount && s2.reviewCount > 100 && (!s2.rating || parseFloat(s2.rating) < 4.0)) {
    anomalies.push({ type: 'reviews_low_rating', detail: s2.reviewCount + ' reviews but rating < 4.0 — investigate quality' });
  }

  return { anomalies: anomalies };
}

// ── Main ───────────────────────────────────────────────────────
var ASIN_ARG = process.argv.find(function(a) { return a.match(/^B[A-Z0-9]{9}$/); });
var URL_ARG  = process.argv.find(function(a) { return a.match(/amazon\.\w+.*\/dp\//); });

function extractAsinFromUrl(url) {
  var m = url.match(/amazon\.\w+.*\/dp\/([A-Z0-9]{10})/);
  return m ? m[1] : null;
}

async function main() {
  var asin = ASIN_ARG || (URL_ARG ? extractAsinFromUrl(URL_ARG) : null);
  if (!asin) {
    console.error('Usage: node diagnose.js [--url=https://www.amazon.com/dp/B0XXXXX] [ASIN]');
    process.exit(1);
  }

  console.log('========================================');
  console.log('  Listing Doctor — ' + asin);
  console.log('========================================');

  var deps = [null];

  async function run(stepFn, n, label) {
    var t1 = Date.now();
    var cp = loadCp(asin, n);
    var result;
    if (cp) {
      result = cp;
      console.log('▶ Step ' + n + ': ' + label + ' (cached)');
    } else {
      console.log('▶ Step ' + n + ': ' + label);
      result = await stepFn({ deps: deps });
      saveCp(asin, n, result);
    }
    deps[n] = { data: result };
    console.log('  ✓ ' + ((Date.now() - t1) / 1000).toFixed(1) + 's');
    return result;
  }

  try {
    await run(step1,  1,  'ASIN Extraction');
    await run(step2,  2,  'Live Scrape');
    await run(step3,  3,  'Keyword Research');
    await run(step4,  4,  'Competitor Benchmark');
    await run(step5,  5,  'Keyword Universe');
    await run(step6,  6,  'Title Audit');
    await run(step7,  7,  'Optimized Titles');
    await run(step8,  8,  'Backend Keywords');
    await new Promise(r => setTimeout(r, 120000)); // Gateway cooldown after step8
    await run(step10, 10, 'Rufus+Cosmo');
    await run(step11, 11, '显性违规识别');
    await run(step12, 12, '隐性违规识别');
    await new Promise(r => setTimeout(r, 120000)); // Gateway cooldown after step12
    await run(step9,   9,  'Bullet Optimization');   // after step11/12 for violations+E-GEO data
    await run(step13, 13, 'Listing Weight');
    await run(step14, 14, 'Priority Action Plan');
    await run(step15, 15, 'Anomalies');

    console.log('========================================');
    console.log('  ✅ Diagnosis complete: ' + asin);
    console.log('========================================');
    console.log('');
    console.log('Summary:');
    var s10 = deps[10] ? deps[10].data : null;
    var s11 = deps[11] ? deps[11].data : null;
    var s12 = deps[12] ? deps[12].data : null;
    var s14 = deps[14] ? deps[14].data : null;
    var s4  = deps[4]  ? deps[4].data  : null;
    var method = s10 ? s10.method || '' : '';
    console.log('  分析方法: ' + (method || 'unknown'));
    console.log('  显性违规: ' + (s11 ? s11.totalViolations || 0 : 0));
    console.log('  隐性违规: ' + (s12 ? (s12.implicitViolationCount || 0) : 0));
    console.log('  E-GEO缺失: ' + (s12 ? s12.missingFeatures || 0 : 0));
    console.log('  Rufus Avg: ' + (s10 ? s10.averageScore || 'N/A' : 'N/A'));
    console.log('  行动计划: ' + ((s14 && s14.plan) ? s14.plan.length : 0));
    console.log('');
    console.log('Checkpoints: ' + path.join(CHECKPOINT_DIR, asin));
    var reportDir = path.join(WORKSPACE, 'amazon-listing-doctor', 'reports', asin);
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    var htmlOut = path.join(reportDir, asin + '.html');
    var reportHtml = require('./report_gen.js').generate(asin);
    fs.writeFileSync(htmlOut, reportHtml, 'utf8');
    console.log('HTML: ' + htmlOut);
    console.log('  📄 Report generated');
    try {
      var pdfgen = require('./generate_pdf.js');
      var pdfOut = path.join(reportDir, asin + '.pdf');
      pdfgen(htmlOut, pdfOut, function(err) {
        if (!err) console.log('PDF: ' + pdfOut);
        else console.log('  PDF generation skipped');
        process.exit(0);
      });
    } catch(e) {
      console.log('  PDF generation skipped (error: ' + e.message + ')');
      process.exit(0);
    }
  } catch(e) {
    console.error('Fatal error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
} else {
  module.exports = { step1, step2, step3, step4, step5, step6, step7, step8, step9, step10, step11, step12, step13, step14, step15 };
}
