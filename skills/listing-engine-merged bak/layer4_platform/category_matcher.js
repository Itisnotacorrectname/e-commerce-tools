/**
 * layer4_platform/category_matcher.js — Listing Engine v2
 *
 * 四阶段类目匹配算法（来自源A）：
 *   Stage 1: TF-IDF 初筛（fallback when embedding unavailable）
 *   Stage 2: 属性约束反向验证
 *   Stage 3: 确定性规则覆盖
 *   Stage 4: 平台特异性逻辑
 */

'use strict';

const path   = require('path');
const fs     = require('fs');
const config = require('../core/config.js');
const ctx    = require('../core/context.js');

function loadJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch(e) { console.error('[category_matcher] Cannot load ' + filePath + ': ' + e.message); return null; }
}

// TF-IDF 近似
function tfidfSimilarity(textA, textB) {
  var tokensA = new Set(textA.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; }));
  var tokensB = new Set(textB.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; }));
  var intersection = Array.from(tokensA).filter(function(t) { return tokensB.has(t); }).length;
  var union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

function stage2_attributeAlignment(product, candidate) {
  var required = candidate.requiredAttributes || [];
  if (required.length === 0) return 1.0;
  var productSignals = new Set();
  var attrs = product.attributes || {};
  if (attrs.dimensions && attrs.dimensions.parsed && attrs.dimensions.parsed.length > 0) productSignals.add('dimensions');
  if (attrs.materials && attrs.materials.raw && attrs.materials.raw.length > 0) productSignals.add('material');
  if (attrs.capacity && attrs.capacity.parsed && attrs.capacity.parsed.length > 0) productSignals.add('weight_capacity');
  var features = product.features || [];
  features.forEach(function(f) { if (f.category === 'assembly') productSignals.add('assembly_required'); });
  var fullText = ((product._raw && product._raw.bullets) ? product._raw.bullets.join(' ') : '') + ' ' + (product._raw && product._raw.title ? product._raw.title : '');
  if (/no box spring/i.test(fullText)) productSignals.add('box_spring_required');
  if (/(\d+)\s*(?:lbs?|pounds?)/i.test(fullText)) productSignals.add('weight_capacity');
  var matched = required.filter(function(req) {
    return productSignals.has(req) || productSignals.has(req.toLowerCase().replace(/_/g, ' '));
  }).length;
  return matched / required.length;
}

function stage3_ruleMatch(inputText, candidate) {
  var titleLower = inputText.toLowerCase();
  var triggerWords = candidate.triggerKeywords || [];
  var hitCount = triggerWords.filter(function(kw) { return titleLower.includes(kw.toLowerCase()); }).length;
  var score = Math.min(1.0, hitCount / triggerWords.length * 1.5);
  var excludeWords = candidate.excludeKeywords || [];
  var excludeHit = excludeWords.some(function(kw) { return titleLower.includes(kw.toLowerCase()); });
  if (excludeHit) score = Math.max(0, score - 0.5);
  return { ruleScore: score, ruleMatched: hitCount > 0, excludeHit: excludeHit };
}

function stage4_platformLogic(candidate, product, platform) {
  var adjustments = { boost: 0, notes: [] };
  if (platform === 'wayfair') {
    var rawText = ((product._raw && product._raw.bullets) ? product._raw.bullets.join(' ') : '') + ' ' + (product._raw && product._raw.title ? product._raw.title : '');
    if (candidate.boxSpringRequired === false && /no box spring/i.test(rawText)) {
      adjustments.boost += 0.1;
      adjustments.notes.push('box_spring_required=false confirmed');
    }
  }
  return adjustments;
}

async function matchPlatform(product, platform, inputText) {
  var rulesFile = path.join(__dirname, platform, 'class_rules.json');
  var rules = loadJson(rulesFile);
  if (!rules || !rules.rules) return { matched: null, confidence: 0, manualReview: true };

  var candidates = rules.rules;
  var thresholds = config.categoryMatch.thresholds;

  var topCandidates = candidates.map(function(c) {
    return Object.assign({}, c, { vectorScore: tfidfSimilarity(inputText, c.searchText || c.className || '') });
  }).sort(function(a, b) { return b.vectorScore - a.vectorScore; }).slice(0, config.categoryMatch.topN);

  var scored = topCandidates.map(function(c) {
    var attrScore = stage2_attributeAlignment(product, c);
    var ruleResult = stage3_ruleMatch(inputText, c);
    var platformAdj = stage4_platformLogic(c, product, platform);
    var confidence = (config.categoryMatch.weights.rule * ruleResult.ruleScore) + (config.categoryMatch.weights.attribute * attrScore) + (config.categoryMatch.weights.vector * (c.vectorScore || 0));
    confidence = Math.min(1.0, confidence + platformAdj.boost);
    return { classId: c.classId, className: c.className, confidence: parseFloat(confidence.toFixed(3)), vectorScore: parseFloat((c.vectorScore || 0).toFixed(3)), attributeScore: parseFloat(attrScore.toFixed(3)), ruleScore: parseFloat(ruleResult.ruleScore.toFixed(3)), ruleMatched: ruleResult.ruleMatched, excludeHit: ruleResult.excludeHit, platformNotes: platformAdj.notes };
  }).sort(function(a, b) { return b.confidence - a.confidence; });

  var best = scored[0];
  if (!best || best.confidence < thresholds.reject) {
    var fallback = rules.fallback || {};
    return { matched: fallback, confidence: 0, manualReview: true, reason: 'No candidate above threshold ' + thresholds.reject, allScored: scored };
  }
  return { matched: best, confidence: best.confidence, manualReview: best.confidence < thresholds.manualReview, reason: best.confidence >= thresholds.accept ? 'auto-accepted' : 'needs-review', allScored: scored };
}

async function matchCategory(context) {
  var product = context.product;
  var raw = context.raw.product || {};
  var inputText = [raw.title || '', raw.category || '', (product.identity && product.identity.coreProduct) || ''].join(' ').trim();
  if (!inputText) { ctx.flagManualReview(context, 'Cannot match category: no input text'); return context; }

  var mode = context.input.mode;
  var targets = mode === 'transform' ? (context.input.targetPlatforms || []) : ['walmart', 'wayfair'];

  for (var i = 0; i < targets.length; i++) {
    var platform = targets[i];
    if (platform === 'amazon') continue;
    console.error('[category_matcher] Matching ' + platform + ' for: "' + inputText.substring(0, 60) + '"');
    try {
      var result = await matchPlatform(product, platform, inputText);
      context.platform.categoryMatch[platform] = {
        classId: result.matched && result.matched.classId || null,
        className: result.matched && result.matched.className || null,
        confidence: result.confidence,
        ruleMatched: result.matched && result.matched.ruleMatched || false,
        allCandidates: (result.allScored || []).slice(0, 3),
        reason: result.reason
      };
      if (result.manualReview) ctx.flagManualReview(context, platform + ' category confidence ' + result.confidence + ' < ' + config.categoryMatch.thresholds.manualReview);
      console.error('[category_matcher] ' + platform + ': ' + (result.matched && result.matched.className || 'fallback') + ' (' + result.confidence + ') ' + result.reason);
    } catch(e) {
      console.error('[category_matcher] ' + platform + ' failed: ' + e.message);
      ctx.flagManualReview(context, 'category_match.' + platform + ' error: ' + e.message);
    }
  }
  return context;
}

module.exports = { matchCategory, matchPlatform };