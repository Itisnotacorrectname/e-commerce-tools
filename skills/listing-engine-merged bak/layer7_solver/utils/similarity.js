/**
 * layer7_solver/utils/similarity.js
 */
'use strict';
function similarity(a, b) {
  var aWords = new Set(a.toLowerCase().split(' '));
  var bWords = new Set(b.toLowerCase().split(' '));
  var overlap = Array.from(aWords).filter(function(w) { return bWords.has(w); });
  return overlap.length / Math.max(aWords.size, 1);
}
module.exports = { similarity };