/**
 * layer5_conversion/index.js — Conversion Engine
 *
 * 职责：把产品数据 + 市场数据 + 意图 转化为高转化的 messaging。
 * 模块：intent → pain → hooks → proof → messaging → differentiation → strategy → scoring
 */
'use strict';

const http   = require('http');
const config = require('../core/config.js');

// ── LLM 调用工具 ──────────────────────────────────────────────
function callLLM(system, user, maxTokens) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: config.llm.models.default,
      max_tokens: maxTokens || 1024,
      system: system,
      messages: [{ role: 'user', content: user }]
    });
    var req = http.request({
      hostname: config.llm.gateway.host, port: config.llm.gateway.port,
      path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.llm.gateway.token,
        'x-api-key': config.llm.gateway.token,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body) }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var p = JSON.parse(data);
          if (p.error) { reject(new Error(p.error.message)); return; }
          var text = (p.content||[]).filter(function(b){return b.type==='text';})
                                   .map(function(b){return b.text;}).join('');
          resolve(text);
        } catch(e) { reject(new Error('LLM parse: ' + e.message)); }
      });
    });
    req.setTimeout(config.llm.timeouts.default, function() { req.destroy(); reject(new Error('LLM timeout')); });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function extractJson(text) {
  try { return JSON.parse(text.trim()); } catch(e) {}
  var fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch(e) {} }
  var start = text.search(/[{\[]/);
  if (start === -1) return null;
  var bracket = text[start] === '{' ? ['{','}'] : ['[',']'];
  var depth = 0, end = -1;
  for (var i = start; i < text.length; i++) {
    if (text[i] === bracket[0]) depth++;
    else if (text[i] === bracket[1]) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  try { return JSON.parse(text.substring(start, end + 1)); } catch(e) { return null; }
}

// ── extractIntent ─────────────────────────────────────────────
// 从 reviews / Q&A / features 提取买家意图
async function extractIntent(context) {
  var reviews  = context.raw.reviews || [];
  var features = context.product.features || [];
  var useCases = context.product.useCases || [];

  var intents = [];

  // 从 useCases 直接转换（已经是意图标签）
  useCases.forEach(function(uc) {
    intents.push({
      intent:     uc.label,
      sentiment:  'positive',
      confidence: uc.confidence,
      source:     'useCase',
    });
  });

  // 从 reviews 提取（如果有数据）
  if (reviews.length > 0) {
    try {
      var reviewSample = reviews.slice(0, 20).map(function(r, i) {
        return (i+1) + '. [' + (r.rating || '?') + '★] ' + (r.text || '').substring(0, 150);
      }).join('\n');

      var raw = await callLLM(
        'You are a product intent analyst. Output ONLY valid JSON array.',
        'Analyze these customer reviews and extract buyer intents:\n' + reviewSample + '\n\n' +
        'Output JSON array:\n[{"intent":"back_support","sentiment":"positive","confidence":0.85,"evidence":"mentions back pain relief"}]',
        512
      );

      var reviewIntents = extractJson(raw);
      if (Array.isArray(reviewIntents)) {
        reviewIntents.forEach(function(ri) {
          ri.source = 'review';
          intents.push(ri);
        });
      }
    } catch(e) {
      console.error('[layer5] Review intent extraction failed: ' + e.message);
    }
  }

  // 去重合并（相同 intent 取最高置信度）
  var merged = {};
  intents.forEach(function(i) {
    if (!merged[i.intent] || i.confidence > merged[i.intent].confidence) {
      merged[i.intent] = i;
    }
  });

  context.conversion.intent.fromFeatures = features.slice(0, 5).map(function(f) {
    return { intent: f.category, confidence: 0.7 };
  });
  context.conversion.intent.merged = Object.values(merged)
    .sort(function(a, b) { return b.confidence - a.confidence; });

  console.error('[layer5] intents: ' + context.conversion.intent.merged.length);
  return context;
}

// ── scoreCosmo ────────────────────────────────────────────────
// 复用现有 intent_engine + scoring_engine
async function scoreCosmo(context) {
  var intentEngine  = require('../engines/intent_engine.js');
  var scoringEngine = require('../engines/scoring_engine.js');

  // 把 context 映射成 engine 期望的 schema 格式
  var tempSchema = {
    raw:      context.raw.product || {},
    identity: context.product.identity || {},
    keywords: context.market.keywords || {},
    intent:   { questions: [], cosmoScores: [], averageScore: null },
    features: context.product.features || [],
    diagnosis: {},
    compliance: context.platform.compliance.amazon || {},
  };

  // 生成 Rufus 问题
  tempSchema = await intentEngine.run(tempSchema);
  // 评分
  tempSchema = await scoringEngine.run(tempSchema);

  // 写回 context
  context.conversion.intent.rufusQuestions = tempSchema.intent.questions;
  context.conversion.scores.overall        = tempSchema.diagnosis.qualityScore;

  // 把 cosmoScores 格式化为 conversion.intent.merged 的补充
  if (tempSchema.intent.cosmoScores && tempSchema.intent.cosmoScores.length > 0) {
    context.conversion.cosmoScores  = tempSchema.intent.cosmoScores;
    context.conversion.cosmoAverage = tempSchema.intent.averageScore;
    context.diagnosis.qualityScore  = tempSchema.diagnosis.qualityScore;
    context.diagnosis.qualityGrade  = tempSchema.diagnosis.qualityGrade;
  }

  console.error('[layer5] Cosmo avg: ' + context.conversion.cosmoAverage +
    ' quality: ' + context.diagnosis.qualityScore);
  return context;
}

// ── mapPain ───────────────────────────────────────────────────
function mapPain(context) {
  var intents  = context.conversion.intent.merged || [];
  var keywords = context.market.keywords || {};

  // 意图 → 痛点映射规则
  var PAIN_MAP = {
    'home office':    { pain: 'Limited workspace causing poor focus and productivity', intensity: 0.8 },
    'small apartment':{ pain: 'Space constraints making room feel cluttered and cramped', intensity: 0.9 },
    'storage':        { pain: 'Clutter and disorganization reducing living quality', intensity: 0.8 },
    'back_support':   { pain: 'Back or neck pain from inadequate support during sleep/sitting', intensity: 0.95 },
    'assembly':       { pain: 'Wasting hours on complicated assembly with unclear instructions', intensity: 0.7 },
    'stability':      { pain: 'Wobbling furniture creating noise and safety concerns', intensity: 0.85 },
    'gifting':        { pain: 'Finding a gift that is thoughtful, practical, and appropriate', intensity: 0.6 },
  };

  var painPoints = intents
    .map(function(i) {
      var mapped = PAIN_MAP[i.intent];
      if (!mapped) return null;
      return {
        pain:      mapped.pain,
        intensity: mapped.intensity * i.confidence,
        evidence:  [i.intent],
      };
    })
    .filter(Boolean)
    .sort(function(a, b) { return b.intensity - a.intensity });

  context.conversion.painPoints = painPoints;
  return context;
}

// ── generateHooks ─────────────────────────────────────────────
async function generateHooks(context) {
  var painPoints = context.conversion.painPoints || [];
  var features   = context.product.features || [];
  var intents    = context.conversion.intent.merged || [];

  if (painPoints.length === 0 && intents.length === 0) {
    context.conversion.hooks = [];
    return context;
  }

  var topPain     = (painPoints[0] && painPoints[0].pain) || '';
  var topFeatures = features.slice(0, 3).map(function(f) { return f.text; }).join('; ');
  var topIntents  = intents.slice(0, 3).map(function(i) { return i.intent; }).join(', ');

  try {
    var raw = await callLLM(
      'You are an Amazon listing copywriter. Output ONLY valid JSON.',
      'Generate 3 emotional hooks for this product:\n' +
      'Top pain: ' + topPain + '\n' +
      'Key features: ' + topFeatures + '\n' +
      'Target intents: ' + topIntents + '\n\n' +
      'Output JSON:\n' +
      '[{"type":"outcome","text":"hook text","targetIntent":"intent"},{"type":"removal","text":"..."},{"type":"scenario","text":"..."}]',
      512
    );

    var hooks = extractJson(raw);
    if (Array.isArray(hooks)) {
      context.conversion.hooks = hooks.slice(0, 5);
    }
  } catch(e) {
    console.error('[layer5] Hook generation failed: ' + e.message);
    context.conversion.hooks = [];
  }

  return context;
}

// ── buildProof ────────────────────────────────────────────────
function buildProof(context) {
  var attrs    = context.product.attributes || {};
  var features = context.product.features || [];
  var proof    = [];

  // 材质信任信号
  (attrs.materials.raw || []).slice(0, 2).forEach(function(m) {
    proof.push({ type: 'material', text: m, source: 'text' });
  });

  // 认证信号
  (attrs.certifications.raw || []).forEach(function(c) {
    proof.push({ type: 'cert', text: c, source: 'text' });
  });

  // 规格信号（承重、尺寸）
  (attrs.capacity.parsed || []).slice(0, 1).forEach(function(c) {
    proof.push({ type: 'spec', text: 'Supports up to ' + c.value + ' ' + c.unit, source: 'text' });
  });

  // 安全声明
  (attrs.safetyClaims.raw || []).slice(0, 2).forEach(function(s) {
    proof.push({ type: 'safety', text: s, source: 'text' });
  });

  // 社会证明（如果有评论数据）
  var reviewCount = context.raw.product && context.raw.product.reviewCount;
  var rating      = context.raw.product && context.raw.product.rating;
  if (reviewCount >= 100 && rating >= 4.0) {
    proof.push({ type: 'social', text: rating + '★ from ' + reviewCount + ' reviews', source: 'raw' });
  }

  context.conversion.proof = proof;
  return context;
}

// ── buildMessaging ────────────────────────────────────────────
async function buildMessaging(context) {
  var hooks    = context.conversion.hooks || [];
  var proof    = context.conversion.proof || [];
  var features = context.product.features || [];

  if (hooks.length === 0) {
    // 没有 hooks，用 features 直接构建消息
    context.conversion.messages = features.slice(0, 5).map(function(f) {
      return { message: f.text, hook: null, proof: null, intent: f.category, score: 0.5 };
    });
    return context;
  }

  // hook + proof → message
  var messages = [];
  hooks.forEach(function(hook, i) {
    var matchedProof = proof[i % proof.length];
    messages.push({
      message:     hook.text + (matchedProof ? ' — ' + matchedProof.text : ''),
      bulletText:  hook.text,
      hook:        hook.type,
      proof:       matchedProof ? matchedProof.type : null,
      intent:      hook.targetIntent || '',
      score:       0.7,
    });
  });

  // 补充 feature-based messages
  features.forEach(function(f) {
    if (messages.length >= 8) return;
    messages.push({ message: f.text, bulletText: f.text, hook: null,
                    proof: null, intent: f.category, score: 0.6 });
  });

  context.conversion.messages = messages;
  return context;
}

// ── differentiate ─────────────────────────────────────────────
function differentiate(context) {
  var myFeatures    = (context.product.features || []).map(function(f) { return f.text.toLowerCase(); });
  var compFeatures  = context.market.competitors.topFeatures || [];
  var myText        = myFeatures.join(' ');

  // 找竞品有但本品缺失的特征
  var gaps = compFeatures.filter(function(cf) {
    return !myText.includes(cf.toLowerCase());
  });

  // 找本品有但竞品标题里没有的特征（独特卖点）
  var compTitles = (context.market.competitors.filtered || [])
    .map(function(c) { return (c.title || '').toLowerCase(); })
    .join(' ');

  var usps = myFeatures.filter(function(f) {
    var words = f.split(/\s+/).slice(0, 3).join(' ');
    return words.length > 5 && !compTitles.includes(words);
  }).slice(0, 3);

  context.conversion.differentiation = {
    gaps: gaps.slice(0, 5),
    usps: usps,
    strategy: null,
  };

  return context;
}

// ── selectStrategy ────────────────────────────────────────────
function selectStrategy(context) {
  var pricing = context.market.pricing || {};
  var band    = pricing.band || 'mid';
  var intents = context.conversion.intent.merged || [];

  var hasPainIntent = intents.some(function(i) {
    return ['back_support', 'stability', 'durability'].includes(i.intent);
  });
  var hasLifestyle = intents.some(function(i) {
    return ['home office', 'aesthetic', 'gifting'].includes(i.intent);
  });

  var strategy;
  if (band === 'premium') {
    strategy = hasPainIntent ? 'performance' : 'premium';
  } else if (band === 'budget') {
    strategy = 'value';
  } else {
    strategy = hasLifestyle ? 'lifestyle' : hasPainIntent ? 'comfort' : 'balanced';
  }

  context.conversion.differentiation.strategy = strategy;
  console.error('[layer5] strategy: ' + strategy + ' (band: ' + band + ')');
  return context;
}

module.exports = {
  extractIntent,
  scoreCosmo,
  mapPain,
  generateHooks,
  buildProof,
  buildMessaging,
  differentiate,
  selectStrategy,
};
