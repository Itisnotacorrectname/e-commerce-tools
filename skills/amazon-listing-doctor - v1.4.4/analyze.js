#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  Amazon Listing Doctor — analyze.js v1.4.4
//
//  职责：分析层（step5-14），读取 data_package.json，
//  调用 OpenClaw Gateway LLM，生成结构化分析结果，
//  写入 step5-14.json。
//
//  Usage（独立运行，分析长耗时，建议后台跑）:
//    node analyze.js B0F9FHN4LX
//    node analyze.js B0F9FHN4LX --force  （强制重跑所有step）
//
//  配合 diagnose.js 使用：
//    1. node diagnose.js ASIN --force    （只跑数据层，快速）
//    2. node analyze.js ASIN            （跑分析层，240s/step）
//    3. node report_gen.js ASIN         （生成HTML）
// ══════════════════════════════════════════════════════════════

'use strict';

var path    = require('path');
var os      = require('os');
var fs      = require('fs');
var http     = require('http');

// ── 路径配置 ───────────────────────────────────────────────
var WORKSPACE      = path.join(os.homedir(), '.openclaw', 'workspace', 'amazon-listing-doctor');
var CHECKPOINT_DIR = path.join(WORKSPACE, 'checkpoints');
var SKILL_DIR      = __dirname;

// ── Gateway 配置（与 diagnose.js 一致）──────────────────────
var GATEWAY_HOST  = '127.0.0.1';
var GATEWAY_PORT  = 18789;
var GATEWAY_TOKEN = '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3';
var LLM_MODEL     = 'openclaw/minimax';
var LLM_TIMEOUT   = 240000;   // 240s per step
var LLM_RETRIES   = 2;

// ── 工具函数 ───────────────────────────────────────────────
function cpPath(asin, n) {
  return path.join(CHECKPOINT_DIR, asin, 'step' + n + '.json');
}
function loadCp(asin, n) {
  var p = cpPath(asin, n);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}
function saveCp(asin, n, data) {
  var dir = path.join(CHECKPOINT_DIR, asin);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var p = cpPath(asin, n);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log('  [step' + n + '] ✓ saved (' + fs.statSync(p).size + ' bytes)');
}
function log(msg) { console.log(msg); }

// ── Gateway 调用（OpenAI Chat Completions 格式）──────────────
function callGateway(systemPrompt, userPrompt) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: LLM_MODEL,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    var req = http.request({
      hostname: GATEWAY_HOST,
      port:     GATEWAY_PORT,
      path:     '/v1/chat/completions',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + GATEWAY_TOKEN,
        'x-api-key':     GATEWAY_TOKEN,
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message || JSON.stringify(parsed.error))); return; }
          var text = (parsed.choices || [])
            .filter(function(b) { return b.message && b.message.content; })
            .map(function(b) { return b.message.content; })
            .join('');
          resolve(text);
        } catch(e) { reject(new Error('Gateway parse error: ' + e.message + ' | raw: ' + data.substring(0, 100))); }
      });
    });
    req.setTimeout(LLM_TIMEOUT, function() { req.destroy(); reject(new Error('Gateway timeout (' + LLM_TIMEOUT + 'ms)')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callWithRetry(stepName, systemPrompt, userPrompt) {
  for (var i = 0; i <= LLM_RETRIES; i++) {
    try {
      return await callGateway(systemPrompt, userPrompt);
    } catch(e) {
      if (i < LLM_RETRIES) {
        log('  [' + stepName + '] ⚠ attempt ' + (i+1) + ' failed: ' + e.message + ' — retrying...');
        await new Promise(function(r) { setTimeout(r, 3000); });
      } else {
        throw e;
      }
    }
  }
}

function extractJson(text) {
  try { return JSON.parse(text.trim()); } catch(e) {}
  var fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch(e) {} }
  var start = text.search(/[{\[]/);
  if (start === -1) throw new Error('No JSON found in LLM output');
  var bracket = text[start] === '{' ? ['{', '}'] : ['[', ']'];
  var depth = 0, end = -1;
  for (var i = start; i < text.length; i++) {
    if (text[i] === bracket[0]) depth++;
    else if (text[i] === bracket[1]) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error('Unmatched brackets in LLM output');
  return JSON.parse(text.substring(start, end + 1));
}

// ── System Prompts（精简版，仅含关键规则）────────────────────
var SYSTEM_BASE = [
  'You are an expert Amazon listing analyst.',
  'Output JSON only. No explanation, no markdown.',
  'Rules:',
  '- primary: keywords in ≥40% of competitor titles',
  '- secondary: keywords in 20-39% of competitor titles',
  '- backend: keywords in 10-19% (string array, no brand/stopwords)',
  '- Scores 0-100. Grade A+≥95...F<45',
  '- Bullet rewrite: keep same number of bullets as original',
  '- Cosmo: score 0=not covered, 3=partial, 5=fully answers the question'
].join('\n');

// ── Step 5: 关键词宇宙 ───────────────────────────────────────
async function step5(s2, s4) {
  var competitors = (s4.filteredCompetitors || s4.competitors || []).slice(0, 40);
  var titles = competitors.map(function(c) { return c.title; }).filter(Boolean).join('\n');
  var user = [
    'TARGET TITLE: ' + s2.title,
    'COMPETITOR TITLES (' + competitors.length + '):',
    titles,
    '',
    'TASK: Analyze keyword frequency. Output JSON:',
    '{"primary":[{"keyword":"...","freq":"N/M (X%)","note":"..."}],"secondary":[...],"backend":["kw1","kw2"]}',
    'primary=≥40%, secondary=20-39%, backend=10-19% (plain strings). Exclude brand/stopwords.'
  ].join('\n');

  var raw = await callWithRetry('step5', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.primary)   data.primary = [];
  if (!data.secondary) data.secondary = [];
  if (!data.backend)   data.backend = [];
  return data;
}

// ── Step 6: 标题审计 ─────────────────────────────────────────
async function step6(s2, s5data) {
  var primaryKws = (s5data.primary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', ');
  var user = [
    'TITLE (' + (s2.title || '').length + ' chars): ' + s2.title,
    'PRIMARY KEYWORDS: ' + primaryKws,
    '',
    'TASK: Audit title. Check: char count >200, spelling, missing primaries, promo words, redundant pairs, missing specs, duplicates.',
    'Output JSON:',
    '{"issues":[{"severity":"critical|medium|low","issue":"...","detail":"..."}],"spellErrors":[{"word":"...","suggestion":"...","context":"..."}],"charCount":N,"score":N,"missingPrimary":["..."],"promoWords":["..."],"redundantPairs":["..."]}'
  ].join('\n');

  var raw = await callWithRetry('step6', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.issues) data.issues = [];
  if (!data.charCount) data.charCount = (s2.title || '').length;
  return data;
}

// ── Step 7: 优化标题 ─────────────────────────────────────────
async function step7(s2, s5data, s6data) {
  var primaryKws = (s5data.primary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', ');
  var title = s2.title || '';
  var user = [
    'ORIGINAL TITLE (' + title.length + ' chars): ' + title,
    'PRIMARY KEYWORDS: ' + primaryKws,
    '',
    'TASK: Generate 3 optimized title versions. Each ≤200 chars. Put primary keywords first.',
    'Output JSON:',
    '{"versionA":"...","versionAChars":N,"versionANote":"...","versionAKeywords":["..."],',
    '"versionB":"...","versionBChars":N,"versionBNote":"...","versionBKeywords":["..."],',
    '"versionC":"...","versionCChars":N,"versionCNote":"...","versionCKeywords":["..."],',
    '"recommendation":"..."}'
  ].join('\n');

  var raw = await callWithRetry('step7', SYSTEM_BASE, user);
  return extractJson(raw);
}

// ── Step 8: Backend Keywords ──────────────────────────────────
async function step8(s2, s5data) {
  var primaryKws = (s5data.primary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', ');
  var secondaryKws = (s5data.secondary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', ');
  var user = [
    'TITLE: ' + (s2.title || ''),
    'PRIMARY: ' + primaryKws,
    'SECONDARY: ' + secondaryKws,
    '',
    'TASK: Generate 250-byte backend search terms string (space-separated keywords, no brand).',
    'Output JSON:',
    '{"backend":"kw1 kw2 kw3 ...","byteCount":N}'
  ].join('\n');

  var raw = await callWithRetry('step8', SYSTEM_BASE, user);
  return extractJson(raw);
}

// ── Step 9: Bullet Rewrites ──────────────────────────────────
async function step9(s2, s5data, s11data) {
  var primaryKws = (s5data.primary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', ');
  var bullets = (s2.bullets || []).join('\n---\n');
  var user = [
    'PRODUCT TITLE: ' + (s2.title || ''),
    'PRIMARY KEYWORDS: ' + primaryKws,
    'BULLETS:',
    bullets,
    '',
    'TASK: Rewrite each bullet. Keep same count. Each bullet should: (1) start with benefit, (2) include primary kw, (3) be ≤500 chars.',
    'Output JSON:',
    '{"bullets":[{"original":"...","rewrite":"...","explanation":"..."}]}'
  ].join('\n');

  var raw = await callWithRetry('step9', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.bullets) data.bullets = [];
  return data;
}

// ── Step 10: Rufus Intent ─────────────────────────────────────
async function step10(s2, s5data) {
  var primaryKws = (s5data.primary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', ');
  var user = [
    'PRODUCT: ' + (s2.title || ''),
    'PRIMARY KEYWORDS: ' + primaryKws,
    '',
    'TASK: Generate 5 buying-intent questions a shopper would ask before purchasing this product.',
    'Output JSON:',
    '{"questions":["Q1","Q2","Q3","Q4","Q5"]}'
  ].join('\n');

  var raw = await callWithRetry('step10', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.questions) data.questions = [];
  return data;
}

// ── Step 11: Cosmo Scoring ───────────────────────────────────
async function step11(s2, s10data) {
  var bullets = (s2.bullets || []).join('\n');
  var questions = ((s10data && s10data.questions) || []).join('\n');
  var user = [
    'PRODUCT: ' + (s2.title || ''),
    'BULLETS:',
    bullets,
    '',
    'QUESTIONS TO ANSWER:',
    questions,
    '',
    'TASK: Score how well each question is answered by the bullets (0=not at all, 3=partial, 5=fully answered). Add enhancement suggestions.',
    'Output JSON:',
    '{"scores":[{"question":"...","score":N,"label":"直接回答|间接涉及|完全未提及","evidence":"...","enhancement":"..."}],"avg":N}'
  ].join('\n');

  var raw = await callWithRetry('step11', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.scores) data.scores = [];
  return data;
}

// ── Step 12: 违规检测 ─────────────────────────────────────────
async function step12(s2, s4, s11data) {
  var bullets = (s2.bullets || []).join('\n');
  var title = s2.title || '';
  var user = [
    'TITLE: ' + title,
    'BULLETS:',
    bullets,
    '',
    'TASK: Detect Amazon policy violations. Check:',
    'V1=无注册品牌标，V2=虚假/误导性声明，V3=Promo words(Best/#1/100%), V4=Comparison to competitors,',
    'V5=主观声明(guaranteed/cures/prevents)，V6=缺少法定信息，V7=类目错放',
    'V8=关键词侵权，V9=缺少关键使用信息，V10=重复ASIN，V11=敏感词，V12=变体违规，V13=受限品',
    'Output JSON:',
    '{"explicit":[{"severity":"critical|medium|low","rule":"V-N","id":"V-N","matched":"...","explanation":"..."}],"implicit":[{"severity":"...","rule":"...","id":"...","matched":"...","explanation":"..."}]}'
  ].join('\n');

  var raw = await callWithRetry('step12', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.explicit) data.explicit = [];
  if (!data.implicit) data.implicit = [];
  return data;
}

// ── Step 13: Listing Weight ────────────────────────────────────
async function step13(s2, s4) {
  var title    = s2.title || '';
  var bullets  = (s2.bullets || []).join('\n');
  var bsr      = s2.bsr || 'N/A';
  var rating   = s2.rating || 'N/A';
  var reviews  = s2.reviewCount || 0;
  var price    = s2.price || 'N/A';
  var user = [
    'TITLE (' + title.length + ' chars): ' + title,
    'BULLETS: ' + bullets,
    'BSR: ' + bsr + ' | Rating: ' + rating + ' | Reviews: ' + reviews + ' | Price: ' + price,
    '',
    'TASK: Assess listing quality across: Title(20%), Bullets(25%), SearchTerms(15%), Reviews(20%), PriceValue(10%), Images(10%).',
    'Output JSON:',
    '{"summary":"...","issues":[{"factor":"...","current":"...","action":"...","impact":"high|medium|low"}],"score":N,"grade":"A+..."}'
  ].join('\n');

  var raw = await callWithRetry('step13', SYSTEM_BASE, user);
  return extractJson(raw);
}

// ── Step 14: Action Plan ─────────────────────────────────────
async function step14(s6r, s11r, s12r, s13r) {
  var titleScore = (s6r && s6r.score) || 50;
  var cosmoScore = (s11r && s11r.avg) ? Math.round((s11r.avg / 5) * 100) : 40;
  var violScore  = 100;
  if (s12r) {
    var hasCritical = (s12r.explicit || []).some(function(v) { return v.severity === 'critical'; });
    if (hasCritical) violScore = 20;
    else violScore = 80;
  }
  var bulletScore = 50;
  var backendScore = 50;
  var weightScore  = (s13r && s13r.score) || 50;
  var uspScore     = 50;

  var user = [
    'Based on scores: Title=' + titleScore + ' Cosmo=' + cosmoScore + ' Violations=' + violScore + ' Bullets=' + bulletScore + ' Backend=' + backendScore + ' ListingWeight=' + weightScore,
    '',
    'TASK: Generate prioritized action plan. Include specific actions, locations, and expected impact.',
    'Output JSON:',
    '{"plan":[{"priority":"P0|P1|P2|P3","action":"...","location":"Title|Bullet N|Backend|A+","impact":"..."}],"qualityScore":N,"qualityGrade":"A+..."}'
  ].join('\n');

  var raw = await callWithRetry('step14', SYSTEM_BASE, user);
  var data = extractJson(raw);
  if (!data.plan)         data.plan = [];
  if (!data.qualityScore) data.qualityScore = Math.round(titleScore + cosmoScore + violScore + bulletScore + backendScore + weightScore + uspScore) / 7;
  if (!data.qualityGrade) {
    var s = data.qualityScore;
    data.qualityGrade = s >= 95 ? 'A+' : s >= 85 ? 'A' : s >= 75 ? 'B+' : s >= 65 ? 'B' : s >= 55 ? 'C' : s >= 45 ? 'D' : 'F';
  }
  return data;
}

// ── 检查 Gateway ─────────────────────────────────────────────
async function checkGateway() {
  return new Promise(function(resolve, reject) {
    var req = http.request({
      hostname: GATEWAY_HOST, port: GATEWAY_PORT,
      path: '/v1/models', method: 'GET',
      headers: { 'Authorization': 'Bearer ' + GATEWAY_TOKEN }
    }, function(res) { resolve(); });
    req.setTimeout(5000, function() { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  var asin  = process.argv[2];
  var force = process.argv.includes('--force');

  if (!asin) {
    console.log('Usage: node analyze.js ASIN [--force]');
    console.log('  ASIN   = Amazon ASIN (e.g. B0F9FHN4LX)');
    console.log('  --force = overwrite existing step5-14.json');
    process.exit(1);
  }

  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  Amazon Listing Doctor — Analysis Layer v1.4.4');
  console.log('  ASIN: ' + asin + (force ? ' (--force)' : ' (cached)'));
  console.log('  Gateway: ' + GATEWAY_HOST + ':' + GATEWAY_PORT);
  console.log('  LLM: ' + LLM_MODEL + ' (' + (LLM_TIMEOUT/1000) + 's timeout per step)');
  console.log('════════════════════════════════════════');

  // 加载数据层 checkpoint
  var s2 = loadCp(asin, 2);
  var s4 = loadCp(asin, 4);
  if (!s2) { console.error('❌ step2.json not found. Run: node diagnose.js ' + asin + ' --force'); process.exit(1); }
  if (!s4) { console.error('❌ step4.json not found. Run: node diagnose.js ' + asin + ' --force'); process.exit(1); }

  // 检查 gateway
  try {
    await checkGateway();
    console.log('  ✓ Gateway reachable');
  } catch(e) {
    console.error('❌ Gateway not reachable: ' + e.message);
    console.error('  → Start gateway and retry: node analyze.js ' + asin);
    process.exit(1);
  }

  // 分析步骤（按依赖顺序）
  var s5d, s6d, s10d, s11d;
  var orderedSteps = [
    { n: 5,  name: 'Keyword Universe',    fn: async function() { s5d = await step5(s2, s4);  return s5d; } },
    { n: 6,  name: 'Title Audit',         fn: async function() { s6d = await step6(s2, s5d); return s6d; } },
    { n: 7,  name: 'Optimized Titles',    fn: async function() { return step7(s2, s5d, s6d); } },
    { n: 8,  name: 'Backend Keywords',    fn: async function() { return step8(s2, s5d); } },
    { n: 10, name: 'Rufus Intent',        fn: async function() { s10d = await step10(s2, s5d); return s10d; } },
    { n: 11, name: 'Cosmo Scoring',       fn: async function() { s11d = await step11(s2, s10d); return s11d; } },
    { n: 9,  name: 'Bullet Rewrites',     fn: async function() { return step9(s2, s5d, s11d); } },
    { n: 12, name: 'Violation Detection', fn: async function() { return step12(s2, s4, s11d); } },
    { n: 13, name: 'Listing Weight',      fn: async function() { return step13(s2, s4); } },
    { n: 14, name: 'Action Plan',         fn: async function() {
      var s6r  = loadCp(asin, 6)  || {};
      var s11r = loadCp(asin, 11) || {};
      var s12r = loadCp(asin, 12) || {};
      var s13r = loadCp(asin, 13) || {};
      return step14(s6r, s11r, s12r, s13r);
    }}
  ];

  var completed = 0;
  var failed = 0;

  for (var i = 0; i < orderedSteps.length; i++) {
    var step = orderedSteps[i];
    var t = Date.now();

    // 缓存检查
    if (!force && loadCp(asin, step.n)) {
      log('▶ Step ' + step.n + ': ' + step.name + ' ... (cached — skip)');
      if (step.n === 5)  s5d  = loadCp(asin, 5);
      if (step.n === 6)  s6d  = loadCp(asin, 6);
      if (step.n === 10) s10d = loadCp(asin, 10);
      if (step.n === 11) s11d = loadCp(asin, 11);
      completed++;
      continue;
    }

    log('');
    log('▶ Step ' + step.n + ': ' + step.name + ' ...');
    try {
      var result = await step.fn();
      saveCp(asin, step.n, result);
      var elapsed = ((Date.now() - t) / 1000).toFixed(1);
      log('  ✓ ' + elapsed + 's — done');
      completed++;
    } catch(e) {
      log('  ⚠ FAILED: ' + e.message + ' — skipped');
      failed++;
    }
  }

  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  ✅ Analysis complete — ' + completed + ' succeeded, ' + failed + ' failed');
  console.log('  → Generate report: node report_gen.js ' + asin);
  console.log('════════════════════════════════════════');
}

main().catch(function(e) { console.error('Fatal:', e.message); process.exit(1); });
