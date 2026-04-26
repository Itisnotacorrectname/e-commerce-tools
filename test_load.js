try {
  var d = require('./skills/amazon-listing-doctor/diagnose.js');
  console.log('diagnose.js loads OK');
  var steps = Object.keys(d).filter(function(k) { return k.match(/^step/); });
  console.log('Steps exported:', steps.join(', '));
} catch(e) {
  console.log('ERROR:', e.message);
}
