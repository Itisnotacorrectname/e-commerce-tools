/**
 * layer2_product/index.js — Product Intelligence Layer
 *
 * 职责：产品原型检测、属性提取、图片分析。
 * 保持源A结构，融合源B的 rule_engine 增强 archetype 检测。
 */

'use strict';

// ── 规则引擎（来自源B layer2_product/rule_engine.js）────────
const comfortRules = [
  { pattern: /memory foam|gel|orthopedic|lumbar|cushion/i, archetype: 'comfort', weight: 0.9, reason: 'comfort product detected' }
];
const specRules = [
  { pattern: /\d+\s*(?:inch|cm|ft)|lbs|kg|watt/i, archetype: 'spec_heavy', weight: 0.8, reason: 'dimension/weight specs found' }
];
const dimensionRules = [
  { pattern: /twin|full|queen|king|cal king/i, archetype: 'dimension_based', weight: 0.85, reason: 'standard size detected' },
  { pattern: /\d+\s*(?:x|×)\s*\d+/, archetype: 'dimension_based', weight: 0.8, reason: 'dimension string found' }
];
const consumableRules = [
  { pattern: /refill|replace|cast|bandage/i, archetype: 'consumable', weight: 0.8, reason: 'consumable product' }
];
const toolRules = [
  { pattern: /drill|screwdriver|wrench|tool/i, archetype: 'tool', weight: 0.9, reason: 'tool detected' }
];
const defaultRules = [
  { pattern: /./, archetype: 'generic', weight: 0.5, reason: 'default fallback' }
];

function runRules(context) {
  const allRules = [...comfortRules, ...specRules, ...dimensionRules, ...consumableRules, ...toolRules, ...defaultRules];
  const signals = [];
  for (const rule of allRules) {
    const title = context.title || '';
    if (rule.pattern.test(title)) {
      signals.push({ archetype: rule.archetype, weight: rule.weight, reason: rule.reason });
    }
  }
  return signals;
}

function scoreArchetypes(signals) {
  const scores = {};
  signals.forEach(function(s) {
    scores[s.archetype] = (scores[s.archetype] || 0) + s.weight;
  });
  var sorted = Object.keys(scores).sort(function(a, b) { return scores[b] - scores[a]; });
  var top = sorted[0] || 'generic';
  return {
    primary: top,
    secondary: sorted.slice(1, 3),
    confidence: scores[top] || 0.5
  };
}

function detectArchetype(input) {
  const signals = runRules(input);
  return scoreArchetypes(signals);
}

// ── 2a. 检测 Archetype ────────────────────────────────────────
async function detectArchetype(ctx) {
  var raw = ctx.raw.product || {};
  var title = raw.title || '';

  var result = detectArchetype({ title: title, attributes: ctx.product.attributes, keywords: [] });

  ctx.product.archetype = {
    primary: result.primary,
    secondary: result.secondary || [],
    confidence: result.confidence
  };

  console.error('[layer2_product] Archetype: ' + result.primary + ' (' + result.confidence.toFixed(2) + ')');
  return ctx;
}

// ── 2b. 提取属性 ─────────────────────────────────────────────
async function extractAttributes(ctx) {
  var raw = ctx.raw.product || {};
  var normalizer = require('../core/normalizer.js');

  try {
    var schema = await normalizer.normalize(raw, { asin: ctx.input.asin, llm: false });
    ctx.product.identity = schema.identity;
    ctx.product.attributes = schema.attributes;
    ctx.product.features = schema.features || [];
    console.error('[layer2_product] Attributes extracted: ' + Object.keys(ctx.product.attributes).join(', '));
  } catch(e) {
    console.error('[layer2_product] Attribute extraction failed: ' + e.message);
  }

  return ctx;
}

// ── 2c. 图片分析（可选）──────────────────────────────────────
async function analyzeImages(ctx) {
  if (!require('../core/config.js').features.imageAnalysis) {
    return ctx;
  }

  console.error('[layer2_product] Image analysis skipped (no vision model)');
  return ctx;
}

module.exports = { detectArchetype, extractAttributes, analyzeImages };