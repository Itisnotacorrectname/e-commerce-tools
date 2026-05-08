/**
 * layer2_product/index.js — Product Intelligence Layer
 */
'use strict';

const normalizer    = require('../normalizer.js');
const imageAnalyzer = require('../engines/image_analyzer.js');
const config        = require('../core/config.js');

// ── detectArchetype ───────────────────────────────────────────
// 识别产品结构类型（8 archetypes）
function detectArchetype(context) {
  var raw     = context.raw.product || {};
  var fullText = [raw.title || '', (raw.bullets || []).join(' ')].join(' ').toLowerCase();

  var ARCHETYPE_SIGNALS = {
    dimension_based:  /\b\d+(?:\.\d+)?\s*(?:"|inch|in|cm|ft)\b|\bqueen|king|twin|full\b/i,
    spec_heavy:       /\b(?:watt|volt|amp|mhz|ghz|bluetooth|wifi|usb|hdmi|rpm)\b/i,
    variant_heavy:    /\b(?:color|colour|size|style|pattern|available in|comes in)\b/i,
    feature_dominant: /\b(?:features?|function|design|ideal for|perfect for)\b/i,
    bundle:           /\b(?:set of|pack of|includes?|comes with|bundle|kit)\b/i,
    consumable:       /\b(?:count|pack|oz|fl oz|liter|ml|gallon|servings?|doses?)\b/i,
    compatibility:    /\b(?:compatible with|fits|works with|for use with|replacement)\b/i,
    emotional:        /\b(?:gift|decor|aesthetic|beautiful|elegant|charming|cozy)\b/i,
  };

  var scores = {};
  Object.keys(ARCHETYPE_SIGNALS).forEach(function(type) {
    var matches = (fullText.match(ARCHETYPE_SIGNALS[type]) || []).length;
    scores[type] = matches;
  });

  // 排序取最高两个
  var sorted = Object.keys(scores).sort(function(a, b) { return scores[b] - scores[a]; });
  var primary   = sorted[0];
  var secondary = sorted.slice(1, 3).filter(function(t) { return scores[t] > 0; });

  // 置信度：主类型的信号数 / 总信号数
  var totalSignals = Object.values(scores).reduce(function(s, v) { return s + v; }, 0);
  var confidence   = totalSignals > 0 ? Math.min(0.95, scores[primary] / totalSignals + 0.3) : 0.5;

  context.product.archetype = {
    primary:    primary,
    secondary:  secondary,
    confidence: parseFloat(confidence.toFixed(2)),
  };

  console.error('[layer2] archetype: ' + primary + ' (' + confidence.toFixed(2) + ')' +
    (secondary.length > 0 ? ' + ' + secondary.join(', ') : ''));

  return context;
}

// ── extractAttributes ─────────────────────────────────────────
// 使用 normalizer.js 的规则提取层填充 product 层
async function extractAttributes(context) {
  var raw = context.raw.product;
  if (!raw) return context;

  var opts = {
    asin:        context.input.asin,
    platform:    context.input.platform || 'amazon',
    marketplace: context.input.marketplace || 'US',
    llm:         config.features.llmNormalization,
  };

  // 调用 normalizer（不用 normalizeFromStep2，直接传 raw 对象）
  var schema = await normalizer.normalize(raw, opts);

  // 把 schema 结果映射到 context.product
  context.product.identity   = schema.identity;
  context.product.attributes = schema.attributes;
  context.product.features   = schema.features;
  context.product.useCases   = schema.useCases;
  context.product.targetAudience = schema.targetAudience;

  // 把原始数据引用存一份（供 compliance engine 使用）
  context.product._raw = raw;

  console.error('[layer2] extracted: ' + context.product.features.length + ' features, ' +
    context.product.useCases.length + ' useCases, ' +
    (context.product.attributes.materials.raw || []).length + ' materials');

  return context;
}

// ── analyzeImages ─────────────────────────────────────────────
async function analyzeImages(context) {
  if (!config.features.imageAnalysis) {
    console.error('[layer2] Image analysis disabled');
    return context;
  }

  var images = (context.raw.product && context.raw.product.images) || [];
  if (images.length === 0) {
    console.error('[layer2] No images available for analysis');
    return context;
  }

  // 把 raw.images 写入 schema 结构（imageAnalyzer 读 schema.raw.images）
  var tempSchema = { raw: context.raw.product, attributes: context.product.attributes, imageAnalysis: context.product.imageAnalysis };
  var result = await imageAnalyzer.analyze(tempSchema, { additionalImages: false });

  context.product.imageAnalysis  = result.imageAnalysis;
  context.product.attributes     = result.attributes;   // 图片可能补充了颜色/材质

  return context;
}

module.exports = { detectArchetype, extractAttributes, analyzeImages };
