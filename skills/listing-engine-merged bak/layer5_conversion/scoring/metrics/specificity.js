/**
 * layer5_conversion/scoring/metrics/specificity.js
 *
 * 来自源B scoring/metrics/specificity.js
 */

'use strict';

function scoreSpecificity(text) {
  if (!text) return 0;
  var score = 0.5;
  if (/\d/.test(text)) score += 0.2;
  if (/certified|premium|engineered|designed/i.test(text)) score += 0.2;
  if (text.split(' ').length > 10) score += 0.1;
  return Math.min(score, 1);
}

module.exports = { scoreSpecificity };