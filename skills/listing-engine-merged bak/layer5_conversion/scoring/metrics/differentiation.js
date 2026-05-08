/**
 * layer5_conversion/scoring/metrics/differentiation.js
 *
 * 来自源B scoring/metrics/differentiation.js
 */

'use strict';

function textSimilarity(a, b) {
  var aWords = new Set(a.toLowerCase().split(' '));
  var bWords = new Set(b.toLowerCase().split(' '));
  var intersection = Array.from(aWords).filter(function(w) { return bWords.has(w); });
  return intersection.length / Math.max(aWords.size, 1);
}

function scoreDifferentiation(text, competitors) {
  if (!text) return 0;
  competitors = competitors || [];
  var score = 1;
  competitors.forEach(function(c) {
    if (!c.title) return;
    var overlap = textSimilarity(text, c.title);
    if (overlap > 0.7) score -= 0.3;
  });
  return Math.max(score, 0.3);
}

module.exports = { scoreDifferentiation };