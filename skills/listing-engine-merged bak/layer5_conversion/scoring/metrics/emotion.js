/**
 * layer5_conversion/scoring/metrics/emotion.js
 *
 * 来自源B scoring/metrics/emotion.js
 */

'use strict';

function scoreEmotion(text) {
  if (!text) return 0;
  if (/(no more|wake up|finally|stop|never again)/i.test(text)) return 1;
  if (/(better|improve|enhance)/i.test(text)) return 0.7;
  return 0.4;
}

module.exports = { scoreEmotion };