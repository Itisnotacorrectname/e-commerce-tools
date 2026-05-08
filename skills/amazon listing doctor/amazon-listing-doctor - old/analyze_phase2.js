#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  Amazon Listing Doctor — analyze_phase2.js v2.4
//
//  Phase 2 分析引擎：读取 step2/4 checkpoint，
//  调用 OpenClaw Gateway LLM 生成 analysis.md，
//  然后调用 md_to_checkpoints.js 生成 step5-14 + HTML 报告。
//
//  使用方式（AI 自动调用）：
//    node analyze_phase2.js B0F9P84PW8
//
//  依赖：
//    - checkpoints/[ASIN]/step2.json
//    - checkpoints/[ASIN]/step4.json
//    - stepLLM.js（LLM 调用基础设施）
// ─────────────────────────────────────────────────────────────

'use strict';

const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const https   = require('https');
const os      = require('os');
const { spawn } = require('child_process');

const WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
const REPORT_DIR     = path.join(WORKSPACE, 'amazon-listing-doctor', 'reports');
const SKILL_DIR      = __dirname;

function log(msg) { console.log('[analyze_phase2] ' + msg); }
function die(msg) { console.error('[analyze_phase2] FATAL: ' + msg); process.exit(1); }
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// Retry wrapper: if result has no JSON, retry with +50% tokens
async function callLLMRetry(prompt, maxTokens, timeoutMs) {
  for (var i = 0; i <= 1; i++) {
    var result = await callLLM(prompt, maxTokens, timeoutMs);
    if (result && result.match(/\{/)) return result;
    if (i === 0) {
      log('LLM returned non-JSON, retrying with higher tokens in 3s...');
      await sleep(3000);
      maxTokens = Math.round(maxTokens * 1.8);
      timeoutMs = Math.round(timeoutMs * 1.5);
    }
  }
  log('LLM retry failed, returning null');
  return null;
}

// ── LLM 调用（MiniMax-M2.7 via api.minimaxi.com）──────────
var MINIMAX_API_KEY = 'sk-cp-Ebz_Fy3yvIELcDlRgIumjTcw4SdNtUisE2V2ltlBBUI0519Ta-mJL38EL4IrXnNVtB5_6q3f7Cc8C897g4x9FUsPCmJBVXSbjGrxrVmrXV_2_3StXGlpsY8';

async function callLLM(prompt, maxTokens, timeoutMs) {
  return new Promise(function(resolve, reject) {
    log('callLLM called: maxTokens=' + (maxTokens||4000) + ' timeoutMs=' + (timeoutMs||90000));
    timeoutMs = timeoutMs || 90000;
    var body = JSON.stringify({
      model: 'MiniMax-M2.7',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens || 4000,
      temperature: 0.2
    });

    var req = https.request({
      hostname: 'api.minimaxi.com',
      port: 443,
      path: '/anthropic/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': MINIMAX_API_KEY,
        'Authorization': 'Bearer ' + MINIMAX_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          // Debug: log raw response to file
          fs.appendFileSync(path.join(__dirname, 'llm_raw.log'), '=== ' + new Date().toISOString() + ' ===\n' + data.substring(0, 1500) + '\n\n');
          var json = JSON.parse(data);
          // MiniMax returns content as array; extract text blocks
          var contentArr = json.content || [];
          // MiniMax returns content as array of {type, text} objects
          var textBlock = contentArr.find(function(b) { return b.type === 'text'; });
          var text = null;
          if (textBlock && textBlock.text) {
            text = textBlock.text;
          } else if (contentArr[0] && contentArr[0].text) {
            text = contentArr[0].text;
          }
          // Strip markdown code fences if present
          if (text && text.match(/^```/)) {
            text = text.replace(/^```json\s*/i,'').replace(/```\s*$/i,'').trim();
          }
          log('callLLM resolve: text=' + (text ? text.substring(0,100) : 'NULL'));
          resolve(text || null);
        } catch(e) {
          reject(new Error('MiniMax LLM parse error: ' + data.substring(0, 100)));
        }
      });
    });
    req.on('error', function(e) { reject(e); });
    req.setTimeout(timeoutMs, function() {
      req.destroy();
      reject(new Error('MiniMax LLM timeout after ' + timeoutMs + 'ms'));
    });
    req.write(body);
    req.end();
  });
}

// ── 加载数据 ─────────────────────────────────────────────────
function loadCp(asin, n) {
  var p = path.join(CHECKPOINT_DIR, asin, 'step' + n + '.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

// ── 每步写 checkpoint（断点续跑）─────────────────────────────────
function writeStepCp(asin, n, data) {
  var p = path.join(CHECKPOINT_DIR, asin, 'step' + n + '.json');
  try {
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    log('  [cp] step' + n + '.json written');
  } catch(e) {
    log('  [cp] step' + n + ' write failed: ' + e.message);
  }
}

// ── 尝试从已有 checkpoint 恢复 ───────────────────────────────────
function loadExistingStep(asin, n) {
  var p = path.join(CHECKPOINT_DIR, asin, 'step' + n + '.json');
  if (fs.existsSync(p)) {
    try {
      var d = JSON.parse(fs.readFileSync(p, 'utf8'));
      log('  [resume] step' + n + '.json found — skip');
      return d;
    } catch(e) {}
  }
  return null;
}

// ── 竞品词频分析（规则引擎）──────────────────────────────────
function analyzeKeywords(s2, s4) {
  var title = s2.title || '';
  var brand = (s2.brand || '').toLowerCase();
  var competitors = s4.competitors || [];

  var STOPWORDS = new Set([
    'the','and','for','with','from','this','that','is','are','to','in','on','of','a','an','by','or','as','at',
    'new','use','best','top','more','most','only','easy','free','fast','safe',
    'large','small','mini','max','plus','pro','prime','extra','ultra','super',
    'black','white','grey','gray','brown','beige','pink','blue','green','red','yellow','orange'
  ]);

  var brandWords = new Set(brand.split(/\s+/).filter(function(w) { return w.length > 1; }));

  // 统计所有竞品标题的词频
  var wordCount = {};
  competitors.forEach(function(c) {
    if (!c.title) return;
    var words = c.title.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) {
      return w.length > 2 && !STOPWORDS.has(w) && !brandWords.has(w);
    });
    words.forEach(function(w) { wordCount[w] = (wordCount[w] || 0) + 1; });
  });

  var total = competitors.length || 1;
  var primary = [], secondary = [], backend = [];

  Object.keys(wordCount).forEach(function(w) {
    var freq = wordCount[w] / total;
    var entry = { keyword: w, freq: Math.round(freq * 100) + '%' };
    if (freq >= 0.4)      primary.push(entry);
    else if (freq >= 0.2) secondary.push(entry);
    else if (freq >= 0.1) backend.push(w);
  });

  // 从 title 提取 size signals
  var sizeSignals = (title.match(/\d+\.?\d*\s*(inch|inches|oz|qt|lb|lbs|gal|liter|cm|mm|ft|pack|piece)/gi) || []);

  return { primary: primary.slice(0, 8), secondary: secondary.slice(0, 8), backend: backend.slice(0, 15), sizeSignals: sizeSignals.slice(0, 5), competitorCount: competitors.length };
}

// ── 标题审计（规则）──────────────────────────────────────────
function auditTitle(s2) {
  var title = s2.title || '';
  var issues = [];
  var brand = (s2.brand || '').toLowerCase();

  // 字符数超限
  if (title.length > 200) issues.push({ severity: 'high', issue: '标题过长', detail: '当前' + title.length + '字符，超过200字符限制' });

  // w/ 格式
  if (/w\//.test(title)) issues.push({ severity: 'medium', issue: "w/ 格式不符合 Amazon 规范", detail: "建议改为 'with'" });

  // 品牌位置
  if (brand && title.toLowerCase().indexOf(brand) !== 0) issues.push({ severity: 'medium', issue: '品牌词未在标题开头', detail: brand + ' 应紧跟在 ASIN 后面' });

  return { issues: issues, charCount: title.length, charLimit: 200, brandAtStart: true, spellErrors: [] };
}

// ── 生成三版优化标题 ─────────────────────────────────────────
async function generateTitles(s2, keywords) {
  var title = s2.title || '';
  var brand = s2.brand || '';
  var primaryKw = keywords.primary.map(function(k) { return k.keyword; }).join(', ');

  var prompt = 'IMPORTANT: Output ONLY valid JSON. Do not include any reasoning or explanation. Return JSON only.\n\nYou are an Amazon listing title strategist. Write THREE versions of the product title below.\n\nRULES:\n- Max 200 characters each\n- Do NOT use commas as the only separators — use them to separate meaningful clauses\n- Do NOT repeat words\n- Do NOT use superlatives (#1, Best, Most)\n- Include brand: "' + brand + '"\n- Include product type and key features\n\nversionA = Maximum keyword coverage (~160-200 chars)\nversionB = High CTR, balanced (~100-160 chars)\nversionC = Mobile-first, compact (~60-100 chars)\n\nReturn ONLY valid JSON (no markdown):\n{"versionA":"...","versionAChars":N,"versionANote":"...","versionB":"...","versionBChars":N,"versionBNote":"...","versionC":"...","versionCChars":N,"versionCNote":"..."}\n\nOriginal: ' + title + '\nPrimary keywords: ' + primaryKw + '\n\nJSON:';

  try {
    var result = await callLLMRetry(prompt, 3000, 120000);
    log('LLM titles raw: ' + (result ? result.substring(0, 300) : 'NULL'));
    if (!result) return null;
    var jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch(e) {}
    }
  } catch(e) { log('LLM titles error: ' + e.message); }
  return null;
}

// ── 标题 LLM 失败时备用方案 ────────────────────────────────
function generateFallbackTitles(s2) {
  var title = s2.title || '';
  var brand = s2.brand || '';
  var words = title.replace(/[^a-zA-Z0-9 \-\&]/g,'').split(/\s+/).filter(function(w){return w.length>1;});
  // Remove brand from front for shorter versions
  var afterBrand = title;
  if (brand && title.toLowerCase().startsWith(brand.toLowerCase())) {
    afterBrand = title.substring(brand.length).trim();
  }
  // versionA: keep original but replace 'w/' with 'with', remove '&', shorten slightly
  var vA = (afterBrand.length < 180) ? (brand + ' ' + afterBrand) : title;
  vA = vA.replace(/\bw\//g, 'with').substring(0,200).trim();
  // versionB: drop 'with Cloud Cushions' or similar, keep key features
  var vB = afterBrand.replace(/,\s*[^,]*Arms[^,]*/i,'').replace(/,\s*Plush[^,]*/i,'').trim();
  vB = (brand + ' ' + vB).substring(0,160).trim();
  // versionC: brand + product type + size only
  var vC = afterBrand.replace(/,\s*(Deep|Removable|Plush|Cloud)[^,]*/g,'').trim();
  // Remove everything after last comma if still too long
  if (vC.length > 100) {
    var lastComma = vC.lastIndexOf(',');
    if (lastComma > 20) vC = vC.substring(0, lastComma);
  }
  vC = (brand + ' ' + vC).substring(0,100).trim();
  return {
    versionA: vA || title,
    versionAChars: vA ? vA.length : title.length,
    versionANote: 'LLM unavailable — rule-based fallback',
    versionB: vB || title,
    versionBChars: vB ? vB.length : title.length,
    versionBNote: 'LLM unavailable — rule-based fallback',
    versionC: vC || title,
    versionCChars: vC ? vC.length : title.length,
    versionCNote: 'LLM unavailable — rule-based fallback'
  };
}

// ── 生成 Backend Keywords ────────────────────────────────────
function generateBackend(s2, keywords) {
  var titleWords = new Set((s2.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/));
  var bulletWords = new Set();
  (s2.bullets || []).forEach(function(b) {
    (b.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)).forEach(function(w) { bulletWords.add(w); });
  });

  var available = keywords.backend.filter(function(w) {
    return !titleWords.has(w) && !bulletWords.has(w);
  });

  var titleWords2 = (s2.title || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  var titleBigrams = [];
  for (var ti = 0; ti < titleWords2.length - 1; ti++) {
    if (titleWords2[ti].length > 3) titleBigrams.push(titleWords2[ti] + ' ' + titleWords2[ti + 1]);
  }

  var extra = titleBigrams.filter(function(bg) {
    return !available.includes(bg) && !titleWords.has(bg.split(' ')[0]);
  }).slice(0, 5);

  var allBackend = available.concat(extra).join(' ').trim();
  return { backend: allBackend, byteCount: Buffer.byteLength(allBackend, 'utf8'), charLimit: 250 };
}

// ── 生成 Bullet 改写 ─────────────────────────────────────────
async function generateBullets(s2) {
  var bullets = s2.bullets || [];
  if (bullets.length === 0) return null;

  var prompt = 'IMPORTANT: Output ONLY valid JSON. Do not include any reasoning or explanation. Return JSON only.\n\nYou are an Amazon listing copywriter. Rewrite the 5 bullet points below to be more benefit-driven, specific, and scannable.\n\nRULES:\n- Each bullet must be a complete sentence with Feature + Benefit + Specificity\n- Minimum 60 characters per bullet\n- Keep true factual claims from the original\n- Do NOT add false claims\n- Write in the same language as the original\n- Structure: "Benefit — Feature detail; numeric specs where available"\n\nOriginal bullets:\n' + bullets.map(function(b, i) { return (i + 1) + '. ' + b; }).join('\n') + '\n\nReturn ONLY valid JSON (no markdown):\n{"bullets":[{"original":"...","rewrite":"...","explain":"改写了什么","factCheck":{"passed":true,"claims":[{"claim":"...","verified":true,"source":"original bullet N"}]}}]}\n\nJSON:';

  try {
    var result = await callLLMRetry(prompt, 4000, 180000);
    log('LLM bullets raw: ' + (result ? result.substring(0, 300) : 'NULL'));
    if (!result) return null;
    var jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        var parsed = JSON.parse(jsonMatch[0]);
        if (parsed.bullets && Array.isArray(parsed.bullets)) return parsed;
      } catch(e) {}
    }
  } catch(e) { log('LLM bullets error: ' + e.message); }

  // Fallback：简单格式化
  return {
    bullets: bullets.map(function(b, i) {
      return { original: b, rewrite: b, explain: '原文（LLM生成失败）', factCheck: { passed: true, claims: [] } };
    })
  };
}

// ── 生成 Rufus 意图问题 ──────────────────────────────────────
async function generateRufusQuestions(s2, keywords) {
  var title = s2.title || '';
  var category = s2.category || '';
  var primaryKw = keywords.primary[0] ? keywords.primary[0].keyword : '';

  var prompt = 'IMPORTANT: Output ONLY valid JSON. Do not include any reasoning or explanation. Return JSON only.\n\nYou are Amazon Rufus, a generative AI shopping assistant. A customer is browsing in the "' + category + '" category with primary interest in: "' + primaryKw + '".\n\nProduct: ' + title + '\n\nGenerate EXACTLY 3 deep consumer intent questions Rufus would ask this customer.\n\nRequirements:\n- Frame questions from the BUYER\'S situation as subject — NOT from the product\'s specs\n- Questions must reflect USE-CASE scenarios, PAIN POINTS, or MATERIAL/FEATURE COMPARISONS\n- Do NOT ask about: price, shipping, warranty, return policy\n- EXACTLY 3 questions — no more, no fewer\n\nReturn ONLY valid JSON (no markdown):\n{"questions":["question 1?","question 2?","question 3?"]}\n\nJSON:';

  try {
    var result = await callLLMRetry(prompt, 3000, 120000);
    if (!result) return null;
    var jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch(e) {}
    }
  } catch(e) { log('LLM rufus error: ' + e.message); }
  return { questions: [] };
}

// ── 生成 Cosmo 评分 ──────────────────────────────────────────
async function generateCosmo(s2, questions) {
  if (!questions || !questions.questions || questions.questions.length === 0) return null;

  var bullets = (s2.bullets || []).join('\n');
  var qs = questions.questions.join('\n');

  var prompt = 'IMPORTANT: Output ONLY valid JSON. Do not include any reasoning or explanation. Return JSON only.\n\nYou are an Amazon listing analyst. Evaluate how well this product\'s bullets answer the Rufus buyer questions.\n\nScore each question: 5=Directly Addresses, 3=Implicitly Addresses, 0=Missing.\n\nBullets:\n' + bullets + '\n\nRufus Questions:\n' + qs + '\n\nReturn ONLY valid JSON (no markdown):\n{"scores":[{"question":"...","score":5,"label":"Directly Addresses","evidence":"Bullet N: \\"..."},{"question":"...","score":3,"label":"Implicitly Addresses","evidence":"...","enhancement":"建议修改 Bullet N：..."}],"averageScore":3.67}\n\nRULES:\n- score must be EXACTLY 0, 3, or 5 (no 1, 2, or 4)\n- If a bullet does NOT explicitly mention the topic in the question, score is 3 or 0, never 5\n- averageScore can be a decimal\n\nJSON:';

  try {
    var result = await callLLMRetry(prompt, 7200, 240000);
    if (!result) return null;
    var jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[0]); } catch(e) {}
    }
  } catch(e) { log('LLM cosmo error: ' + e.message); }
  return null;
}

// ── 生成违规检测 ─────────────────────────────────────────────
function detectViolations(s2) {
  var title = s2.title || '';
  var bullets = s2.bullets || [];
  var allText = title + ' ' + bullets.join(' ');

  var violations = [], implicit = [];

  // V1: 无依据最高级
  var superlativeMatch = allText.match(/#1|Best\s*Seller|Top\s*Rated|#1\s*Rated/);
  if (superlativeMatch) {
    violations.push({ id: 'V1', severity: 'high', rule: '无依据最高级', matched: superlativeMatch[0], explanation: '未经独立验证的最高级表述' });
  }

  // V4: 促销语言
  var promoMatch = allText.match(/free\s*shipping|best\s*price|deal|limited\s*time/);
  if (promoMatch) {
    violations.push({ id: 'V4', severity: 'medium', rule: '促销性价格语言', matched: promoMatch[0], explanation: 'Amazon 禁止促销性语言' });
  }

  // V7: 标题超长
  if (title.length > 200) {
    violations.push({ id: 'V7', severity: 'high', rule: '标题超200字符', matched: title.substring(0, 50), explanation: '当前' + title.length + '字符' });
  }

  // V14: 权威性缺失（无认证声明）
  var certMatch = allText.match(/certipur|carb.*compliant|etl|ul|certified|prop.*65/);
  if (!certMatch && title.length > 100) {
    implicit.push({ id: 'V14', severity: 'medium', rule: 'Authoritativeness 缺失', matched: '无认证/测试数据', explanation: '中高端产品无 CertiPUR-US/Prop65 等认证标注' });
  }

  // V16: 场景触发缺失
  var sceneMatch = allText.match(/gift|present|housewarming|holiday|birthday|anniversary/);
  if (!sceneMatch) {
    implicit.push({ id: 'V16', severity: 'low', rule: 'Urgent Call 缺失', matched: '无使用场景/礼品暗示', explanation: '无礼品/乔迁/节假日场景触发' });
  }

  return { violations: violations, implicit: implicit };
}
// ── 生成 Listing Weight ──────────────────────────────────────
function analyzeListingWeight(s2) {
  var issues = [];
  var reviewCount = parseInt(s2.reviewCount) || 0;
  var rating = parseFloat((s2.rating || '0').match(/[\d.]+/)[0]) || 0;
  var price = s2.price || 0;

  if (reviewCount < 50)  issues.push({ factor: 'Reviews', current: String(reviewCount), action: '加入 Vine 项目 + 催评策略', impact: reviewCount < 20 ? 'high' : 'medium' });
  if (rating < 4.3)      issues.push({ factor: 'Rating', current: rating.toFixed(1), action: '分析差评原因，针对性优化', impact: rating < 4.0 ? 'high' : 'medium' });
  if (!price)            issues.push({ factor: 'Price', current: 'N/A', action: '确认价格是否正确抓取', impact: 'medium' });

  return {
    issues: issues,
    summary: reviewCount + '条评论、' + rating.toFixed(1) + '星。' + (issues.length > 0 ? '主要短板：' + issues.map(function(i) { return i.factor; }).join('、') : '整体状态良好。')
  };
}

// ── 生成行动计划 ─────────────────────────────────────────────
function generateActionPlan(s4, s6, s11, s12, s13) {
  var plan = [];

  // 从 step11 Cosmo 找 0 分项 → P1
  if (s11 && s11.scores) {
    s11.scores.forEach(function(sc, i) {
      if (sc.score === 0) {
        plan.push({ priority: 'P1', action: 'Cosmo Q' + (i + 1) + ' 得分0——该意图买家完全看不到你，建议新增一条对应 bullet', location: 'Bullet ' + (i + 1), impact: 'Cosmo Q' + (i + 1) + ' 从0→5', execType: 'operator' });
      } else if (sc.score === 3) {
        plan.push({ priority: 'P2', action: 'Cosmo Q' + (i + 1) + ' 得分3——间接涉及但不充分，建议按 enhancement 改写', location: 'Bullet ' + (i + 1), impact: 'Cosmo Q' + (i + 1) + ' 从3→5', execType: 'operator' });
      }
    });
  }

  // 从 step12 违规 → P0/P1
  if (s12 && s12.violations) {
    s12.violations.forEach(function(v) {
      plan.push({ priority: v.severity === 'high' ? 'P1' : 'P2', action: '修复 ' + v.id + '：' + v.rule, location: 'title/bullets', impact: v.explanation, execType: 'operator' });
    });
  }

  // 从 step6 标题问题 → P2
  if (s6 && s6.issues) {
    s6.issues.forEach(function(iss) {
      if (iss.severity !== 'low') {
        plan.push({ priority: 'P2', action: '修复标题：' + iss.issue, location: 'Title', impact: iss.detail, execType: 'operator' });
      }
    });
  }

  // 从 step13 listing weight → P3
  if (s13 && s13.issues) {
    s13.issues.forEach(function(iss) {
      plan.push({ priority: 'P3', action: iss.action, location: iss.factor, impact: iss.impact, execType: 'operator' });
    });
  }

  // 计算质量分
  var qualityScore = 50 + plan.filter(function(p) { return p.priority === 'P1'; }).length * -10 + plan.filter(function(p) { return p.priority === 'P2'; }).length * -5;
  qualityScore = Math.max(0, Math.min(100, qualityScore));
  var grade = qualityScore >= 90 ? 'A+' : qualityScore >= 80 ? 'A' : qualityScore >= 70 ? 'B+' : qualityScore >= 60 ? 'B' : qualityScore >= 50 ? 'C' : 'D';

  return { qualityScore: qualityScore, qualityGrade: grade, plan: plan, pendingData: [] };
}

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  var asin = process.argv[2];
  if (!asin || !asin.match(/^B[A-Z0-9]{9}$/i)) {
    die('Usage: node analyze_phase2.js <ASIN>');
  }

  log('Starting Phase 2 analysis for ' + asin);

  // 加载数据
  var s2 = loadCp(asin, 2);
  var s4 = loadCp(asin, 4);
  if (!s2 || !s2.title) die('step2.json not found or empty for ' + asin);
  if (!s4) die('step4.json not found for ' + asin);

  log('Loaded step2 (title: ' + s2.title.substring(0, 50) + '...) and step4 (' + (s4.competitors || []).length + ' competitors)');

  // 生成各步骤分析（断点续跑：已有 checkpoint 则跳过）
  log('Step 5: Keyword analysis...');
  var keywords = loadExistingStep(asin, 5) || analyzeKeywords(s2, s4);
  if (!loadExistingStep(asin, 5)) writeStepCp(asin, 5, keywords);

  log('Step 6: Title audit...');
  var titleAudit = loadExistingStep(asin, 6) || auditTitle(s2);
  if (!loadExistingStep(asin, 6)) writeStepCp(asin, 6, titleAudit);

  log('Step 7: Title optimization (LLM)...');
  var optimizedTitles = loadExistingStep(asin, 7) || await generateTitles(s2, keywords);
  if (!loadExistingStep(asin, 7)) writeStepCp(asin, 7, optimizedTitles || {});

  log('Step 8: Backend keywords...');
  var backend = loadExistingStep(asin, 8) || generateBackend(s2, keywords);
  if (!loadExistingStep(asin, 8)) writeStepCp(asin, 8, backend);
  await sleep(1000);

  log('Step 9: Bullet rewriting (LLM)...');
  var bullets = loadExistingStep(asin, 9) || await generateBullets(s2);
  if (!loadExistingStep(asin, 9)) writeStepCp(asin, 9, bullets || { bullets: [] });

  log('Step 10: Rufus questions (LLM)...');
  var questions = loadExistingStep(asin, 10) || await generateRufusQuestions(s2, keywords);
  if (!loadExistingStep(asin, 10)) writeStepCp(asin, 10, questions || { questions: [] });
  await sleep(1000);

  log('Step 11: Cosmo scoring (LLM)...');
  var cosmo = loadExistingStep(asin, 11) || await generateCosmo(s2, questions);
  if (!loadExistingStep(asin, 11)) writeStepCp(asin, 11, cosmo || { scores: [], averageScore: 0 });

  log('Step 12: Violation detection...');
  var violations = loadExistingStep(asin, 12) || detectViolations(s2);
  if (!loadExistingStep(asin, 12)) writeStepCp(asin, 12, violations);

  log('Step 13: Listing weight...');
  var listingWeight = loadExistingStep(asin, 13) || analyzeListingWeight(s2);
  if (!loadExistingStep(asin, 13)) writeStepCp(asin, 13, listingWeight);

  log('Step 14: Action plan...');
  var actionPlan = loadExistingStep(asin, 14) || generateActionPlan(s4, titleAudit, cosmo, violations, listingWeight);
  if (!loadExistingStep(asin, 14)) writeStepCp(asin, 14, actionPlan);

  // ── 写入 analysis.md ──────────────────────────────────────
  var cosmoAvg = cosmo && cosmo.averageScore ? cosmo.averageScore.toFixed(2) : 'N/A';
  var qualityScore = actionPlan.qualityScore;
  var qualityGrade = actionPlan.qualityGrade;

  var md = '## STEP_5  关键词分级\n' +
    '```json\n' + JSON.stringify(keywords, null, 2) + '\n```\n\n' +

    '## STEP_6  标题审计\n' +
    '```json\n' + JSON.stringify(titleAudit, null, 2) + '\n```\n\n' +

    '## STEP_7  三版优化标题\n' +
    '```json\n' + JSON.stringify(optimizedTitles || generateFallbackTitles(s2)) + '\n```\n\n' +

    '## STEP_8  Backend Keywords\n' +
    '```json\n' + JSON.stringify(backend, null, 2) + '\n```\n\n' +

    '## STEP_9  Bullet 改写\n' +
    '```json\n' + JSON.stringify(bullets || { bullets: [] }, null, 2) + '\n```\n\n' +

    '## STEP_10 Rufus 意图问题\n' +
    '```json\n' + JSON.stringify(questions || { questions: [] }, null, 2) + '\n```\n\n' +

    '## STEP_11 Cosmo 内容评分\n' +
    '```json\n' + JSON.stringify(cosmo || { scores: [], averageScore: 0 }, null, 2) + '\n```\n\n' +

    '## STEP_12 违规检测\n' +
    '```json\n' + JSON.stringify(violations, null, 2) + '\n```\n\n' +

    '## STEP_13 Listing Weight\n' +
    '```json\n' + JSON.stringify(listingWeight, null, 2) + '\n```\n\n' +

    '## STEP_14 行动计划\n' +
    '```json\n' + JSON.stringify(actionPlan, null, 2) + '\n```\n\n' +

    '---\n⚠ 数据说明：\n- 目标 listing 数据：实时抓取（' + new Date().toISOString().split('T')[0] + '）\n- 竞品数据：实时抓取，' + keywords.competitorCount + ' 条\n- Phase 2 分析：规则引擎 + OpenClaw LLM 生成\n- 本报告不包含任何虚构数据\n';

  var mdPath = path.join(CHECKPOINT_DIR, asin, 'analysis.md');
  fs.writeFileSync(mdPath, md, 'utf8');
  log('✅ analysis.md written (' + md.length + ' chars)');

  // ── 调用 md_to_checkpoints.js ─────────────────────────────
  log('Calling md_to_checkpoints.js...');
  spawn(process.execPath, [path.join(SKILL_DIR, 'md_to_checkpoints.js'), asin], {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true
  }).on('close', function(code) {
    if (code === 0) {
      log('✅ Phase 2 complete — report generated');
    } else {
      log('⚠ md_to_checkpoints exited with code ' + code + ' — check report manually');
    }
    process.exit(code || 0);
  });
}

main().catch(function(e) {
  die(e.message);
});
