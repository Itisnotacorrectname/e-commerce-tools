var llm = require('./stepLLM.js');
var start = Date.now();
llm.analyzeListing({
  title: 'Owala 2-in-1 Water Bottle Brush Cleaner',
  bullets: [
    'Bottle brush with hidden, removable straw brush',
    'Twist n Hide straw brush nests inside the handle',
    'Removable brush head with firm bristles',
    'Convenient hanging loop'
  ]
}).then(function(r) {
  console.log('method:', r.method, 'took:', Date.now()-start, 'ms');
  console.log('violations:', r.totalViolations, 'egeo missing:', r.missingFeatures);
  if (r.summary) console.log('summary:', r.summary.substring(0, 200));
  process.exit(0);
}).catch(function(e) {
  console.log('ERROR:', e.message);
  process.exit(1);
});