/**
 * layer2_product/index.js (CJS)
 * Product intelligence: archetype detection, attribute extraction, image analysis
 */
'use strict';

const { runRules } = require('./rule_engine.js');
const { scoreArchetypes } = require('./scorer.js');
const { extractFeatures } = require('./feature_categorizer.js');

async function detectArchetype(ctx) {
  const raw = ctx.raw.product || {};
  const title = raw.title || '';
  const bullets = raw.bullets || [];

  const ctx_ = { title, attributes: {}, keywords: [] };
  const signals = runRules(ctx_);
  const scored = scoreArchetypes(signals);

  ctx.product = ctx.product || {};
  ctx.product.archetype = { primary: scored.primary, secondary: scored.secondary, confidence: scored.confidence };
  ctx.product.identity = ctx.product.identity || {};
  ctx.product.identity.coreProduct = raw.title || '';
  ctx.product.identity.brand = raw.brand || '';

  // Derive concise product type:
  // 1. Take first comma-delimited segment (main product description)
  // 2. Strip brand prefix, size words, dimension tokens, weight tokens, color words
  // 3. Deduplicate consecutive identical words
  var brand = ctx.product.identity.brand || '';
  var fullTitle = raw.title || '';

  var firstSegment = fullTitle.split(/[,，]/)[0]
    .replace(new RegExp('^' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '')
    .trim();

  var productType = firstSegment
    .replace(/\b(twin|full|queen|king|small|medium|large|xl|xs)\b/gi, '')
    .replace(/\b(size|color|colour)\b/gi, '')
    .replace(/\d+(?:[.-]?\d*)?\s*(?:inches|inch|in|"|')\s*/gi, '')
    .replace(/\d+(?:[.-]?\d*)?\s*(?:lbs?|pounds?|oz)\s*/gi, '')
    .replace(/\b(black|white|brown|gray|grey|red|blue|green|navy|beige|cream|pink|multicolor|natural|espresso|charcoal|camel|navy blue)\b/gi, '')
    .replace(/([A-Za-z]+)\s+(?=\1\b)/gi, '') // deduplicate consecutive identical words
    .replace(/\s+/g, ' ')
    .trim();

  if (productType.length < 4) {
    productType = firstSegment.split(/\s+/).slice(0, 3).join(' ');
  }

  if (productType.length > 3) {
    ctx.product.identity.coreProduct = productType;
    ctx.raw.product.coreProduct = productType;
  }

  console.error('[layer2] archetype:', scored.primary, '(' + scored.confidence + ')');
  return ctx;
}

async function extractAttributes(ctx) {
  const raw = ctx.raw.product || {};
  const bullets = raw.bullets || [];
  const title = raw.title || '';
  const combined = title + ' ' + bullets.join(' ');

  ctx.product = ctx.product || {};
  ctx.product.attributes = ctx.product.attributes || {};

  // Extract materials (expanded list — furniture + cookware + general)
  const materialWords = [
    // metals
    'stainless steel', 'steel', 'carbon steel', 'cast iron', 'iron', 'aluminum',
    'hard-anodized', 'anodized', 'copper', 'copper-core',
    // cookware coatings
    'ceramic', 'non-stick', 'nonstick', 'granite', 'marble coating',
    'enamel', 'enameled', 'porcelain',
    // wood/bamboo
    'solid wood', 'wood', 'bamboo', 'acacia', 'rubberwood', 'pine',
    // boards/shells
    'particle board', 'mdf', 'engineered wood', 'plywood',
    // furniture materials
    'fabric', 'leather', 'faux leather', 'pu leather', 'upholstered',
    'memory foam', 'foam', 'polyester', 'faux fur', 'plush', 'velvet',
    'tempered glass', 'glass', 'glass top', 'metal', 'plastic',
    // eco
    'organic cotton', 'cotton', 'linen',
  ];
  const materials = materialWords.filter(w => combined.toLowerCase().includes(w));
  ctx.product.attributes.materials = { raw: materials, source: 'text' };

  // Extract colors (expanded)
  const colorWords = [
    'black', 'white', 'brown', 'gray', 'grey', 'red', 'blue', 'green', 'natural',
    'espresso', 'camel', 'charcoal', 'navy', 'beige', 'cream', 'pink'
  ];
  const colors = colorWords.filter(w => combined.toLowerCase().includes(w));
  ctx.product.attributes.colors = { raw: colors, source: 'text' };

  // Extract size signals
  const sizeWords = ['twin', 'full', 'queen', 'king', 'small', 'medium', 'large', 'xl'];
  const sizes = sizeWords.filter(w => combined.toLowerCase().includes(w));
  ctx.product.identity = ctx.product.identity || {};
  ctx.product.identity.variantSignals = sizes;

  // Extract dimensions: L x W x H pattern
  const dimMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:inch|in|cm|mm|foot|ft)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inch|in|cm|mm|foot|ft)/i);
  if (dimMatch) {
    ctx.product.attributes.dimensions = {
      raw: [dimMatch[0]],
      parsed: [{ value: parseFloat(dimMatch[1]), unit: 'inch', dimension: 'width' }],
      source: 'text'
    };
  }

  console.error('[layer2] extractAttributes: materials=' + materials.length + ', colors=' + colors.length + ', sizes=' + sizes.length);
  return ctx;
}

async function analyzeImages(ctx) {
  ctx.product.imageAnalysis = { mainImage: null, additionalImages: [], consistencyCheck: { colorMatch: null, materialMatch: null, conflicts: [] } };
  return ctx;
}

async function extractProductFeatures(ctx) {
  const raw = ctx.raw.product || {};
  const bullets = raw.bullets || [];
  const title = raw.title || '';

  const features = extractFeatures(bullets, title);

  ctx.product = ctx.product || {};
  ctx.product.features = features;

  var byCategory = {};
  for (var i = 0; i < features.length; i++) {
    var f = features[i];
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  var catCounts = Object.keys(byCategory).map(function(c) { return c + ':' + byCategory[c].length; }).join(', ');
  console.error('[layer2] extractProductFeatures: ' + features.length + ' features, categories: ' + catCounts);

  return ctx;
}

module.exports = { detectArchetype, extractAttributes, analyzeImages, extractProductFeatures };
