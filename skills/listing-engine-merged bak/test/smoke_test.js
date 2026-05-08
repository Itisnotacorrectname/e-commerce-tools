/**
 * test/smoke_test.js — Listing Engine Merged Smoke Test
 *
 * 来自源A smoke_test.js，移除 engines/ 依赖测试（engines/ 不在合并范围内）。
 */

'use strict';

var assert  = require('assert');
var context = require('../core/context.js');
var normalizer = require('../core/normalizer.js');

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
  { asin: 'B001', title: 'VECELO L Shaped Desk 60 Inch, Computer Corner Desk, Black', price: 45.99, rating: 4.5, reviews: 500 },
  { asin: 'B002', title: 'Tangkula L-Shaped Desk 47", Corner Computer Desk with Storage Shelf', price: 52.99, rating: 4.4, reviews: 320 },
  { asin: 'B003', title: 'SHW L-Shaped Home Office Corner Desk 55 Inch Espresso', price: 89.99, rating: 4.6, reviews: 1200 },
  { asin: 'B004', title: 'DESIGNA L Shaped Gaming Desk 51 Inch, Corner Computer Desk with Shelves', price: 67.99, rating: 4.7, reviews: 280 },
  { asin: 'B005', title: 'Mr IRONSTONE L-Shaped Desk 50.8" Home Office Computer Corner Desk Gaming Table', price: 79.99, rating: 4.5, reviews: 890 },
];

var passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✅ ' + name); passed++; }
  catch(e) { console.log('  ❌ ' + name + ': ' + e.message); failed++; }
}

async function testAsync(name, fn) {
  try { await fn(); console.log('  ✅ ' + name); passed++; }
  catch(e) { console.log('  ❌ ' + name + ': ' + e.message); failed++; }
}

async function run() {
  console.log('════════════════════════════════════════');
  console.log('  Listing Engine Merged — Smoke Test');
  console.log('════════════════════════════════════════');

  // context
  console.log('\n[Suite] core/context.js');
  test('createContext returns valid structure', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345', mode: 'diagnose' });
    assert.strictEqual(ctx.input.asin, 'B0TEST12345');
    assert.strictEqual(ctx.input.mode, 'diagnose');
    assert.ok(Array.isArray(ctx.reliability.missing));
  });
  test('get/set dot paths', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    context.set(ctx, 'product.identity.coreProduct', 'l shaped desk', 'text');
    assert.strictEqual(context.get(ctx, 'product.identity.coreProduct'), 'l shaped desk');
  });
  test('serialize/deserialize roundtrip', function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    context.set(ctx, 'product.identity.brand', 'DUMOS');
    var ctx2 = context.deserialize(context.serialize(ctx));
    assert.strictEqual(context.get(ctx2, 'product.identity.brand'), 'DUMOS');
  });

  // normalizer
  console.log('\n[Suite] normalizer.js');
  await testAsync('extractCoreProduct', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { llm: false });
    assert.ok(schema.identity.coreProduct.length > 0);
    console.log('    coreProduct: "' + schema.identity.coreProduct + '"');
  });
  await testAsync('extractMaterials finds steel', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { llm: false });
    assert.ok(schema.attributes.materials.raw.length > 0);
    console.log('    materials: ' + schema.attributes.materials.raw.join(', '));
  });
  await testAsync('schema validates', async function() {
    var schema = await normalizer.normalize(MOCK_PRODUCT, { asin: 'B0TEST12345', llm: false });
    var v = require('../core/product_schema.js').validate(schema);
    assert.ok(v.valid, 'Errors: ' + v.errors.join(', '));
  });

  // layer2
  console.log('\n[Suite] layer2_product/index.js');
  await testAsync('detectArchetype', async function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    ctx.raw.product = MOCK_PRODUCT;
    var Layer2 = require('../layer2_product/index.js');
    var result = await Layer2.detectArchetype(ctx);
    assert.ok(result.product.archetype.primary);
    console.log('    archetype: ' + result.product.archetype.primary + ' (' + result.product.archetype.confidence.toFixed(2) + ')');
  });

  // layer3
  console.log('\n[Suite] layer3_market/index.js');
  await testAsync('collectKeywords', async function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    ctx.raw.product = MOCK_PRODUCT;
    ctx.market.competitors.filtered = MOCK_COMPETITORS;
    ctx.product.identity = { brand: 'DUMOS', coreProduct: 'l shaped desk' };
    var Layer3 = require('../layer3_market/index.js');
    var result = await Layer3.collectKeywords(ctx);
    assert.ok(result.market.keywords.primary.length > 0);
    console.log('    keywords: ' + result.market.keywords.primary.length);
  });
  await testAsync('analyzePricing', async function() {
    var ctx = context.createContext({ asin: 'B0TEST12345' });
    ctx.raw.product = MOCK_PRODUCT;
    ctx.market.competitors.filtered = MOCK_COMPETITORS;
    var Layer3 = require('../layer3_market/index.js');
    var result = await Layer3.analyzePricing(ctx);
    assert.ok(result.market.pricing.targetPrice === 41.98);
    console.log('    ' + result.market.pricing.band + ' @ ' + result.market.pricing.percentile + 'th pct');
  });

  // walmart constraints
  console.log('\n[Suite] walmart config files');
  test('constraints.json valid', function() {
    var data = require('../layer4_platform/walmart/constraints.json');
    assert.strictEqual(data.title.maxChars, 75);
    assert.strictEqual(data.keyFeatures.min, 3);
  });
  test('attribute_map.json has steel→Steel', function() {
    var map = require('../layer4_platform/walmart/attribute_map.json');
    assert.strictEqual(map.material.steel, 'Steel');
    assert.strictEqual(map.color.black, 'Black');
  });

  // layer5 conversion
  console.log('\n[Suite] layer5_conversion');
  await testAsync('scoring_engine produces ranked scores', async function() {
    var scoringMod = require('../layer5_conversion/scoring/scoring_engine.js');
    var messages = [
      'Wake up without back pain',
      'No more poor sleep quality',
      'Perfect for anyone dealing with back pain'
    ];
    var scored = scoringMod.scoreMessagesV2({ messages: messages, platform: 'amazon', competitors: [] });
    assert.ok(scored.length === 3);
    assert.ok(scored[0].score >= scored[1].score);
    console.log('    scores: ' + scored.map(function(s){return s.score;}).join(', '));
  });

  // layer8 constraints
  console.log('\n[Suite] layer8_constraints');
  test('amazon_rules.json enforces title length', function() {
    var rules = require('../layer8_constraints/rules/amazon_rules.json');
    var titleRule = rules.title.find(function(r){return r.type==='max_length';});
    assert.strictEqual(titleRule.value, 200);
  });

  console.log('\n════════════════════════════════════════');
  console.log('  Results: ' + passed + ' passed, ' + failed + ' failed');
  console.log('════════════════════════════════════════');
  if (failed > 0) process.exit(1);
}

module.exports = { run };
if (require.main === module) { run().catch(function(e){console.error(e.message); process.exit(1);}); }