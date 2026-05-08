/**
 * layer5_conversion/scoring/metrics/platform_fit.js
 *
 * 来自源B scoring/metrics/platform_fit.js
 */

'use strict';

function scorePlatformFit(text, platform) {
  if (!text) return 0;
  switch (platform) {
    case 'amazon':
      return scoreAmazon(text);
    case 'walmart':
      return scoreWalmart(text);
    case 'wayfair':
      return scoreWayfair(text);
    default:
      return 0.5;
  }
}

function scoreAmazon(text) {
  var s = 0.8;
  if (text.length > 80) s += 0.1;
  return Math.min(s, 1);
}

function scoreWalmart(text) {
  if (text.length > 100) return 0.6;
  return 1;
}

function scoreWayfair(text) {
  if (/\d|inch|cm|material/i.test(text)) return 1;
  return 0.7;
}

module.exports = { scorePlatformFit };