/**
 * layer4_platform/category_matcher.js — Listing Engine v2
 *
 * 四阶段类目匹配算法：
 *   Stage 1: 语义向量初筛（MiniMax embedding + 余弦相似度）
 *   Stage 2: 属性约束反向验证（必填属性对齐度）
 *   Stage 3: 确定性规则覆盖（硬规则 rules.json）
 *   Stage 4: 平台特异性逻辑（Walmart vs Wayfair 不同处理）
 *
 * 置信度公式: S = Wr*Sr + Wa*Sa + Wv*Sv
 */

'use strict';

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const config = require('../core/config.js');
const ctx    = require('../core/context.js');

// ── 配置文件路径 ──────────────────────────────────────────────
var PLATFORM_DIR = path.join(__dirname);

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch(e) {
    console.error('[category_matcher] Cannot load ' + filePath + ': ' + e.message);
    return null;
  }
}

// ── MiniMax Embedding 调用 ────────────────────────────────────
function getEmbedding(text) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model: config.llm.models.embedding,
      input: [text.substring(0, 512)],  // embedding 输入限制
    });

    var req = http.request({
      hostname: config.llm.gateway.host,
      port:     config.llm.gateway.port,
      path:     '/v1/embeddings',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'Authorization':     'Bearer ' + config.llm.gateway.token,
        'x-api-key':         config.llm.gateway.token,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed = JSON.parse(data);
          var vector = parsed.data && parsed.data[0] && parsed.data[0].embedding;
          if (!vector) reject(new Error('No embedding in response'));
          else resolve(vector);
        } catch(e) { reject(new Error('Embedding parse error: ' + e.message)); }
      });
    });
    req.setTimeout(config.llm.timeouts.embedding, function() {
      req.destroy(); reject(new Error('Embedding timeout'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 余弦相似度
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  var dot = 0, normA = 0, normB = 0;
  for (var i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// TF-IDF 近似（embedding 不可用时的 fallback）
function tfidfSimilarity(textA, textB) {
  var tokensA = new Set(textA.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; }));
  var tokensB = new Set(textB.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; }));
  var intersection = Array.from(tokensA).filter(function(t) { return tokensB.has(t); }).length;
  var union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ── Stage 1: 语义向量初筛 ─────────────────────────────────────
async function stage1_vectorSearch(inputText, candidates, useEmbedding) {
  if (!useEmbedding || !config.features.categoryMatching) {
    // Fallback: TF-IDF
    return candidates.map(function(c) {
      return Object.assign({}, c, { vectorScore: tfidfSimilarity(inputText, c.searchText || c.className) });
    }).sort(function(a, b) { return b.vectorScore - a.vectorScore; })
      .slice(0, config.categoryMatch.topN);
  }

  try {
    var inputVec = await getEmbedding(inputText);
    var scored = await Promise.all(candidates.map(async function(c) {
      var candVec = c._embedding || await getEmbedding(c.searchText || c.className);
      return Object.assign({}, c, { vectorScore: cosineSimilarity(inputVec, candVec) });
    }));
    return scored.sort(function(a, b) { return b.vectorScore - a.vectorScore; })
                 .slice(0, config.categoryMatch.topN);
  } catch(e) {
    console.error('[category_matcher] Embedding failed, using TF-IDF: ' + e.message);
    return candidates.map(function(c) {
      return Object.assign({}, c, { vectorScore: tfidfSimilarity(inputText, c.searchText || c.className) });
    }).sort(function(a, b) { return b.vectorScore - a.vectorScore; })
      .slice(0, config.categoryMatch.topN);
  }
}

// ── Stage 2: 属性约束反向验证 ─────────────────────────────────
// 检查产品现有属性是否能满足候选类目的必填属性
function stage2_attributeAlignment(product, candidate) {
  var required = candidate.requiredAttributes || [];
  if (required.length === 0) return 1.0;  // 无必填 → 完全对齐

  // 收集产品已有的属性信号
  var productSignals = new Set();
  var attrs = product.attributes || {};

  if (attrs.dimensions && attrs.dimensions.parsed && attrs.dimensions.parsed.length > 0) {
    productSignals.add('dimensions'); productSignals.add('size');
    productSignals.add('frame_height'); productSignals.add('height');
  }
  if (attrs.materials && attrs.materials.raw && attrs.materials.raw.length > 0) {
    productSignals.add('material'); productSignals.add('upholstery_material');
  }
  if (attrs.capacity && attrs.capacity.parsed && attrs.capacity.parsed.length > 0) {
    productSignals.add('weight_capacity'); productSignals.add('capacity');
  }
  if (attrs.certifications && attrs.certifications.raw && attrs.certifications.raw.length > 0) {
    productSignals.add('certifications');
  }

  // 从 features 推断
  var features = product.features || [];
  features.forEach(function(f) {
    if (f.category === 'assembly') { productSignals.add('assembly_required'); productSignals.add('level_of_assembly'); }
    if (f.category === 'storage')  { productSignals.add('storage_capacity'); productSignals.add('number_of_drawers'); }
    if (f.category === 'smart')    { productSignals.add('number_of_slats'); }
  });

  // 从原始 bullets 中检测特定词
  var fullText = '';
  var rawProduct = product._raw || {};
  if (rawProduct.bullets) fullText = rawProduct.bullets.join(' ').toLowerCase();
  if (rawProduct.title)   fullText += ' ' + rawProduct.title.toLowerCase();

  if (/no box spring/i.test(fullText))          { productSignals.add('box_spring_required'); productSignals.add('slat_kit_included'); }
  if (/(\d+)\s*slat/i.test(fullText))           { productSignals.add('number_of_slats'); }
  if (/headboard/i.test(fullText))              { productSignals.add('headboard_height'); productSignals.add('headboard_material'); }
  if (/(\d+)\s*(lbs?|pounds?)/i.test(fullText)) { productSignals.add('weight_capacity'); }
  if (/remote/i.test(fullText))                 { productSignals.add('remote_included'); }

  // 计算对齐度
  var matched = required.filter(function(req) {
    var reqNorm = req.toLowerCase().replace(/_/g, ' ');
    return productSignals.has(req) || productSignals.has(reqNorm) ||
      Array.from(productSignals).some(function(s) { return s.includes(reqNorm) || reqNorm.includes(s); });
  }).length;

  return matched / required.length;
}

// ── Stage 3: 确定性规则覆盖 ───────────────────────────────────
function stage3_ruleMatch(inputText, candidate, rules) {
  var titleLower = inputText.toLowerCase();
  var score = 0;
  var matched = false;

  // 触发关键词匹配
  var triggerWords = candidate.triggerKeywords || [];
  var hitCount = triggerWords.filter(function(kw) { return titleLower.includes(kw.toLowerCase()); }).length;
  if (hitCount > 0) {
    score   = Math.min(1.0, hitCount / triggerWords.length * 1.5);
    matched = true;
  }

  // 排除关键词（命中则降权）
  var excludeWords = candidate.excludeKeywords || [];
  var excludeHit = excludeWords.some(function(kw) { return titleLower.includes(kw.toLowerCase()); });
  if (excludeHit) score = Math.max(0, score - 0.5);

  return { ruleScore: score, ruleMatched: matched, excludeHit: excludeHit };
}

// ── Stage 4: 平台特异性逻辑 ───────────────────────────────────
function stage4_platformLogic(candidate, product, platform) {
  var adjustments = { boost: 0, notes: [] };

  if (platform === 'wayfair') {
    var rawText = '';
    if (product._raw) {
      rawText = ((product._raw.bullets || []).join(' ') + ' ' + (product._raw.title || '')).toLowerCase();
    }

    // Box Spring 逻辑
    if (candidate.boxSpringRequired === false && /no box spring/i.test(rawText)) {
      adjustments.boost += 0.1;
      adjustments.notes.push('box_spring_required=false confirmed');
    }

    // Slat 数量逻辑
    if (candidate.requiredAttributes && candidate.requiredAttributes.includes('number_of_slats')) {
      if (/\d+\s*slat/i.test(rawText)) {
        adjustments.boost += 0.05;
        adjustments.notes.push('slat count found in listing');
      }
    }
  }

  if (platform === 'walmart') {
    // Walmart 需要匹配 spec template
    if (candidate.specTemplate) {
      adjustments.notes.push('spec_template: ' + candidate.specTemplate);
    }
  }

  return adjustments;
}

// ── 综合置信度计算 ────────────────────────────────────────────
function calcConfidence(vectorScore, attributeScore, ruleScore) {
  var W = config.categoryMatch.weights;
  return (W.rule * ruleScore) + (W.attribute * attributeScore) + (W.vector * vectorScore);
}

// ── 主入口：matchPlatform ─────────────────────────────────────
async function matchPlatform(product, platform, inputText) {
  var rulesFile = path.join(PLATFORM_DIR, platform, 'class_rules.json');
  var rules     = loadJson(rulesFile);

  if (!rules || !rules.rules) {
    console.error('[category_matcher] No rules for platform: ' + platform);
    return { matched: null, confidence: 0, manualReview: true };
  }

  var candidates = rules.rules;
  var thresholds = config.categoryMatch.thresholds;

  // Stage 1: 向量初筛
  var topCandidates = await stage1_vectorSearch(inputText, candidates, config.features.categoryMatching);

  // Stage 2 + 3 + 4: 综合评分
  var scored = topCandidates.map(function(c) {
    var attrScore    = stage2_attributeAlignment(product, c);
    var ruleResult   = stage3_ruleMatch(inputText, c, rules);
    var platformAdj  = stage4_platformLogic(c, product, platform);
    var confidence   = calcConfidence(c.vectorScore || 0, attrScore, ruleResult.ruleScore);
    confidence       = Math.min(1.0, confidence + platformAdj.boost);

    return {
      classId:        c.classId,
      className:      c.className,
      confidence:     parseFloat(confidence.toFixed(3)),
      vectorScore:    parseFloat((c.vectorScore || 0).toFixed(3)),
      attributeScore: parseFloat(attrScore.toFixed(3)),
      ruleScore:      parseFloat(ruleResult.ruleScore.toFixed(3)),
      ruleMatched:    ruleResult.ruleMatched,
      excludeHit:     ruleResult.excludeHit,
      platformNotes:  platformAdj.notes,
    };
  }).sort(function(a, b) { return b.confidence - a.confidence; });

  var best = scored[0];

  if (!best || best.confidence < thresholds.reject) {
    // Fallback: 使用 General 模板
    var fallback = rules.fallback || {};
    return {
      matched:      fallback,
      confidence:   0,
      manualReview: true,
      reason:       'No candidate above threshold ' + thresholds.reject,
      allScored:    scored,
    };
  }

  return {
    matched:      best,
    confidence:   best.confidence,
    manualReview: best.confidence < thresholds.manualReview,
    reason:       best.confidence >= thresholds.accept ? 'auto-accepted' : 'needs-review',
    allScored:    scored,
  };
}

// ── 对外接口：matchCategory(context) ─────────────────────────
async function matchCategory(context) {
  var product   = context.product;
  var raw       = context.raw.product || {};
  var inputText = [
    raw.title || '',
    raw.category || '',
    (product.identity && product.identity.coreProduct) || '',
  ].join(' ').trim();

  if (!inputText) {
    ctx.flagManualReview(context, 'Cannot match category: no input text');
    return context;
  }

  // 根据 mode 决定要匹配哪些平台
  var mode     = context.input.mode;
  var targets  = mode === 'transform'
    ? (context.input.targetPlatforms || [])
    : ['walmart', 'wayfair'];  // diagnose/generate 都做全平台匹配

  for (var i = 0; i < targets.length; i++) {
    var platform = targets[i];
    if (platform === 'amazon') continue;  // Amazon 不需要跨平台类目匹配

    console.error('[category_matcher] Matching ' + platform + ' for: "' + inputText.substring(0, 60) + '"');

    try {
      var result = await matchPlatform(product, platform, inputText);

      context.platform.categoryMatch[platform] = {
        classId:      result.matched && result.matched.classId   || null,
        className:    result.matched && result.matched.className || null,
        confidence:   result.confidence,
        ruleMatched:  result.matched && result.matched.ruleMatched || false,
        allCandidates: (result.allScored || []).slice(0, 3),
        reason:       result.reason,
      };

      if (result.manualReview) {
        ctx.flagManualReview(context,
          platform + ' category confidence ' + result.confidence + ' < ' + config.categoryMatch.thresholds.manualReview);
      }

      console.error('[category_matcher] ' + platform + ': ' +
        (result.matched && result.matched.className || 'fallback') +
        ' (' + result.confidence + ') ' + result.reason);
    } catch(e) {
      console.error('[category_matcher] ' + platform + ' failed: ' + e.message);
      ctx.flagManualReview(context, 'category_match.' + platform + ' error: ' + e.message);
    }
  }

  return context;
}

module.exports = { matchCategory, matchPlatform };
