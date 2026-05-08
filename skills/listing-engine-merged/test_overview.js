// Quick test for Wayfair overview generation
const { transform } = require('./index.js');

(async () => {
  console.error('=== Testing Wayfair Overview Generation ===\n');
  
  var ctx = await transform('B0F2937DQQ', 'amazon', ['wayfair'], {});
  
  var wf = ctx.composed.wayfair;
  console.log('=== WAYFAIR OUTPUT ===');
  console.log('Title:', wf.title);
  console.log('\nOverview:');
  console.log(wf.overview);
  console.log('\nSpecs:', JSON.stringify(wf.specs, null, 2));
  
  console.log('\n=== PRODUCT FEATURES ===');
  console.log(JSON.stringify(ctx.product.features, null, 2));
  
  console.log('\n=== ATTRIBUTES ===');
  console.log('materials:', ctx.product.attributes.materials);
  console.log('colors:', ctx.product.attributes.colors);
  console.log('capacity:', ctx.product.attributes.capacity);
  
  process.exit(0);
})().catch(function(e) {
  console.error('ERROR:', e.message);
  process.exit(1);
});
