/**
 * layer7_solver/constraints/keyword_repeat.js
 */
'use strict';
function limitKeywordRepeat(text, maxRepeat) {
  maxRepeat = maxRepeat || 2;
  var words = text.split(/\s+/);
  var counter = {};
  var result = [];
  words.forEach(function(w) {
    var key = w.toLowerCase();
    counter[key] = (counter[key] || 0) + 1;
    if (counter[key] <= maxRepeat) result.push(w);
  });
  return result.join(' ');
}
module.exports = { limitKeywordRepeat };