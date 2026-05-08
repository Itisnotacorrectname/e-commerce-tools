var stepLLM = require('./stepLLM.js');

var input = {
  title: 'bella 2 Slice Slim Toaster, Fits-anywhere Kitchenware, 6 Setting Shade Control with Reheat & Cancel Buttons, Fits sourdough, 10" Long Slot, Anti Jam & Auto Shutoff, 900 Watt, Blossom',
  brand: 'BELLA',
  coreProduct: 'slice slim toaster',
  primaryKeywords: ['slice slim','slim toaster','toaster fits','fits anywhere','anywhere kitchenware','kitchenware setting'],
  violations: []
};

console.log('Calling generateOptimizedTitles...');
stepLLM.generateOptimizedTitles(input).then(function(result) {
  console.log('Result:', JSON.stringify(result, null, 2));
}).catch(function(e) {
  console.log('Error:', e.message);
});