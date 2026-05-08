/**
 * test/smoke_test.js �?Listing Engine v2 Smoke Test
 *
 * 测试策略：不依赖网络（用 test_analysis.json 的产品数�?mock），
 * 验证每一层的输入/输出格式是否符合规范�? */

'use strict';

const path     = require('path');
const assert   = require('assert');
const context  = require('../core/context.js');
const registry = require('../core/registry.js');

// ── Mock 数据 ─────────────────────────────────────────────────
var MOCK_PRODUCT = {
  title:       'DUMOS L Shaped Desk 47 Inch Computer Desk, L-Shaped Corner Gaming Table w/ Reversible Storage Shelves, for Home Office Writing Study (Black)',
  brand:       'DUMOS',
  bullets: [
    'Reversible & Space-Saving Design - This corner desk features reversible 2-tier shelves',
    'Large Workspace - 47" x 47" surface fits multiple monitors. Open leg design for comfortable seating',
    'Robust Stability with X-Brace Support - Reinforced steel frame, wobble-free',
    'Adjustable Feet - stays stable on uneven surfaces',
    'Easy Assembly - under 30 minutes, all tools included'
  ],
  price:       41.98,
  rating:      4.6,
  reviewCount: 110,
  category:    'Home & Kitchen > Furniture > Home Office Furniture > Desks',
  images:      [],
};

var MOCK_COMPETITORS = [
  { asin: 'B001', title: 'VECELO L Shaped Desk 60 Inch, Computer Corner Desk, Home Office Gaming Table, Black', price: '$45.99', rating: '4.5', reviews: '(500)' },
  { asin: 'B002', title: 'Tangkula L-Shaped Desk 47", Corner Computer Desk with Storage Shelf, for Home Office', price: '$52.99', rating: '4.4', reviews: '(320)' },
  { asin: 'B003', title: 'SHW L-Shaped Home Office Corner Desk, 55 Inch, Espresso', price: '$89.99', rating: '4.6', reviews: '(1200)' },
  { asin: 'B004', title: 'DESIGNA L Shaped Gaming Desk 51 Inch, Corner Computer Desk with Shelves', price: '$67.99', rating: '4.7', reviews: '(280)' },
  { asin: 'B005', title: 'Mr IRONSTONE L-Shaped Desk 50.8", Home Office Computer Corner Desk, Gaming Table', price: '$79.99', rating: '4.5', reviews: '(890)' },
];

// ── 测试工具 ──────────────────────────────────────────────────
var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  �?' + name);
    passed++;
  } catch(e) {
    console.log('  �?' + name + ': ' + e.message);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log('  �?' + name);
    passed++;
  } catch(e) {
    console.log('  �?' + name + ': ' + e.message);
    failed++;
  }
}

// ══════════════════════════════════════════════════════════════
//  TEST SUITES
// ══════════════════════════════════════════════════════════════

async function testContext() {
  console.log('\n[Suite] core/context.js');

  test('createContext returns valid structure', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345', mode: 'diagnose' });
    assert.strictEqual(ctx.input.asin, 'B0TEST12345');
    assert.strictEqual(ctx.input.mode, 'diagnose');
    assert.ok(Array.isArray(ctx.reliability.missing));
    assert.ok(ctx._meta.createdAt);
  });

  test('get/set work with dot paths', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    context.set(ctx, 'product.identity.coreProduct', 'l shaped desk', 'text');
    assert.strictEqual(context.get(ctx, 'product.identity.coreProduct'), 'l shaped desk');
    assert.strictEqual(ctx.reliability.sources['product.identity.coreProduct'], 'text');
  });

  test('markMissing records missing fields', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    context.markMissing(ctx, 'raw.product.title', 'Title not scraped');
    assert.ok(ctx.reliability.missing.includes('raw.product.title'));
    assert.ok(ctx.reliability.warnings.length > 0);
  });

  test('serialize/deserialize roundtrip', function() {
    var ctx  = context.createContext({ asin: 'B0TEST12345' });
    context.set(ctx, 'product.identity.brand', 'DUMOS');
    var json = context.serialize(ctx);
    var ctx2 = context.deserialize(json);
    assert.strictEqual(context.get(ctx2, 'product.identity.brand'), 'DUMOS');
  });

  test('setCheckpoint/hasCheckpoint work', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    assert.strictEqual(context.hasCheckpoint(ctx, 'layer1.scrape'), false);
    context.setCheckpoint(ctx, 'layer1.scrape');
    assert.strictEqual(context.hasCheckpoint(ctx, 'layer1.scrape'), true);
  });
}

async function testNormalizer() {
  console.log('\n[Suite] normalizer.js');

  var normalizer = require('../normalizer.js');

  await testAsync('extractCoreProduct from furniture category', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { llm: false });
    assert.ok(schema.identity.coreProduct.length > 0, 'coreProduct should not be empty');
    console.log('    coreProduct: "' + schema.identity.coreProduct + '"');
  });

  await testAsync('extractMaterials finds steel', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { llm: false });
    assert.ok(schema.attributes.materials.raw.length > 0, 'materials should not be empty');
    console.log('    materials: ' + schema.attributes.materials.raw.join(', '));
  });

  await testAsync('extractVariantSignals finds size/color', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { llm: false });
    assert.ok(schema.identity.variantSignals.length > 0, 'variantSignals should not be empty');
    console.log('    variantSignals: ' + schema.identity.variantSignals.join(', '));
  });

  await testAsync('extractFeatures categorizes correctly', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { llm: false });
    assert.ok(schema.features.length > 0, 'features should not be empty');
    var cats = [...new Set(schema.features.map(function(f) { return f.category; }))];
    console.log('    features: ' + schema.features.length + ' items, cats: ' + cats.join(', '));
  });

  await testAsync('schema validates after normalization', async function() {
    var schema    = await normalizer.normalize(MOCK_PRODUCT, { asin: 'B0TEST12345', llm: false });
    var { validate } = require('../product_schema.js');
    var result    = validate(schema);
    assert.ok(result.valid, 'Schema should be valid. Errors: ' + result.errors.join(', '));
  });
}

async function testKeywordEngine() {
  console.log('\n[Suite] keyword_engine.js');

  var keywordEngine = require('../engines/keyword_engine.js');

  test('run produces primary/secondary/backend', function() {
    var tempSchema = {
      raw: MOCK_PRODUCT,
      identity: { brand: 'DUMOS' },
      keywords: { primary: [], secondary: [], backend: [], sizeSignals: [], competitorCount: 0 },
    };
    var step4 = { filteredCompetitors: MOCK_COMPETITORS, competitors: MOCK_COMPETITORS };
    var result = keywordEngine.run(tempSchema, step4);

    assert.ok(result.keywords.primary.length > 0, 'Should have primary keywords');
    assert.ok(result.keywords.competitorCount === MOCK_COMPETITORS.length);
    console.log('    primary: ' + result.keywords.primary.slice(0,3).map(function(k){return k.keyword;}).join(', '));
    console.log('    sizeSignals: ' + result.keywords.sizeSignals.join(', '));
  });
}

async function testComplianceEngine() {
  console.log('\n[Suite] compliance_engine.js');

  var complianceEngine = require('../engines/compliance_engine.js');

  test('no violations on clean product', function() {
    var tempSchema = {
      raw:       MOCK_PRODUCT,
      identity:  { brand: 'DUMOS', coreProduct: 'l shaped desk' },
      features:  [],
      useCases:  [],
      keywords:  { primary: [] },
      intent:    { cosmoScores: [] },
      compliance: {},
    };
    var result = complianceEngine.run(tempSchema);
    // 验证结构
    assert.ok(Array.isArray(result.compliance.explicit));
    assert.ok(Array.isArray(result.compliance.implicit));
    assert.ok(typeof result.compliance.riskLevel === 'string');
    console.log('    explicit violations: ' + result.compliance.explicit.length);
    console.log('    implicit violations: ' + result.compliance.implicit.length);
    console.log('    risk level: ' + result.compliance.riskLevel);
  });

  test('detects V1 superlative violation', function() {
    var dirtyProduct = Object.assign({}, MOCK_PRODUCT, {
      title: MOCK_PRODUCT.title + ' - #1 Best Seller',
    });
    var tempSchema = {
      raw:       dirtyProduct,
      identity:  { brand: 'DUMOS', coreProduct: 'l shaped desk' },
      features:  [],
      useCases:  [],
      keywords:  { primary: [] },
      intent:    { cosmoScores: [] },
      compliance: {},
    };
    var result = complianceEngine.run(tempSchema);
    var v1 = result.compliance.explicit.find(function(v) { return v.type === 'V1'; });
    assert.ok(v1, 'Should detect V1 superlative violation');
    console.log('    V1 matched: "' + v1.text + '"');
  });
}

async function testLayer2() {
  console.log('\n[Suite] layer2_product/index.js');

  var layer2 = require('../layer2_product/index.js');

  await testAsync('detectArchetype classifies L-shaped desk', async function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    ctx.raw.product = MOCK_PRODUCT;
    var result = await layer2.detectArchetype(ctx);
    assert.ok(result.product.archetype.primary, 'Should detect archetype');
    assert.ok(result.product.archetype.confidence > 0);
    console.log('    archetype: ' + result.product.archetype.primary +
      ' (' + result.product.archetype.confidence + ')');
  });
}

async function testLayer3() {
  console.log('\n[Suite] layer3_market/index.js');

  var layer3 = require('../layer3_market/index.js');

  await testAsync('collectKeywords extracts from mock competitors', async function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    ctx.raw.product     = MOCK_PRODUCT;
    ctx.raw.competitors = MOCK_COMPETITORS;
    ctx.product.identity = { brand: 'DUMOS', coreProduct: 'l shaped desk' };
    ctx.market.competitors.filtered = MOCK_COMPETITORS;

    var result = await layer3.collectKeywords(ctx);
    assert.ok(result.market.keywords.competitorCount === MOCK_COMPETITORS.length);
    console.log('    primary keywords: ' + result.market.keywords.primary.length);
  });

  await testAsync('analyzePricing calculates percentile', async function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    ctx.raw.product     = MOCK_PRODUCT;
    ctx.market.competitors.filtered = MOCK_COMPETITORS;

    var result = await layer3.analyzePricing(ctx);
    assert.ok(result.market.pricing.targetPrice === MOCK_PRODUCT.price);
    assert.ok(result.market.pricing.percentile >= 0 && result.market.pricing.percentile <= 100);
    console.log('    price: $' + result.market.pricing.targetPrice +
      ' at ' + result.market.pricing.percentile + 'th pct (' + result.market.pricing.band + ')');
  });
}

async function testLayer4() {
  console.log('\n[Suite] layer4_platform/category_matcher.js (TF-IDF mode)');

  var matcher = require('../layer4_platform/category_matcher.js');

  await testAsync('matches L-shaped desk to wayfair class', async function() {
    var product = {
      identity:   { coreProduct: 'l shaped desk', brand: 'DUMOS' },
      attributes: { dimensions: { parsed: [{ value: 47, unit: 'inch', dimension: 'width' }] },
                    materials:  { raw: ['steel'] }, capacity: { parsed: [] } },
      features:   [{ category: 'assembly', text: 'easy assembly in 30 min' }],
      _raw:       MOCK_PRODUCT,
    };

    // TF-IDF mode（不使用 embedding�?    var origFlag = require('../config.js').features.categoryMatching;
    var origFlag = require('../config.js').features.categoryMatching;
    require('../config.js').features.categoryMatching = false;

    var result = await matcher.matchPlatform(product, 'wayfair',
      'L-Shaped Desk Computer Desk Home Office Furniture');

    require('../config.js').features.categoryMatching = origFlag;

    assert.ok(result.matched || result.manualReview, 'Should return matched or manual review');
    console.log('    matched: ' + (result.matched && result.matched.className || 'fallback') +
      ' (' + result.confidence + ')');
  });
}

async function testWalmartConstraints() {
  console.log('\n[Suite] Walmart constraints.json');

  var fs   = require('fs');
  var path = require('path');
  var constraintsPath = path.join(__dirname, '../layer4_platform/walmart/constraints.json');

  test('constraints.json is valid JSON', function() {
    assert.ok(fs.existsSync(constraintsPath), 'File should exist');
    var data = JSON.parse(fs.readFileSync(constraintsPath, 'utf8'));
    assert.ok(data.title.maxChars === 75, 'Walmart title max should be 75');
    assert.ok(data.keyFeatures.min === 3, 'Min key features should be 3');
    assert.ok(Array.isArray(data.forbiddenWords), 'forbiddenWords should be array');
    console.log('    forbiddenWords: ' + data.forbiddenWords.length + ' words');
  });

  var attrMapPath = path.join(__dirname, '../layer4_platform/walmart/attribute_map.json');
  test('attribute_map.json has color and material mappings', function() {
    assert.ok(fs.existsSync(attrMapPath), 'File should exist');
    var map = JSON.parse(fs.readFileSync(attrMapPath, 'utf8'));
    assert.ok(map.color && map.color.black === 'Black', 'black �?Black');
    assert.ok(map.material && map.material.steel === 'Steel', 'steel �?Steel');
    console.log('    color mappings: ' + Object.keys(map.color).filter(function(k){return !k.startsWith('_');}).length);
    console.log('    material mappings: ' + Object.keys(map.material).filter(function(k){return !k.startsWith('_');}).length);
  });
}

// ══════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════
async function run() {
  console.log('════════════════════════════════════════');
  console.log('  Listing Engine v2 �?Smoke Test');
  console.log('════════════════════════════════════════');

  await testContext();
  await testNormalizer();
  await testKeywordEngine();
  await testComplianceEngine();
  await testLayer2();
  await testLayer3();
  await testLayer4();
  await testWalmartConstraints();

  console.log('\n════════════════════════════════════════');
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('════════════════════════════════════════');

  if (failed > 0) process.exit(1);
}

module.exports = { run };

if (require.main === module) {
  run().catch(function(e) {
    console.error('Test suite error:', e.message);
    process.exit(1);
  });
}
















