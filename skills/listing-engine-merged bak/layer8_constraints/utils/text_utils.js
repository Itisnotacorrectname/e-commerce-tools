/**
 * layer8_constraints/utils/text_utils.js
 *
 * 来自源B layer8_constraints/utils/text_utils.js
 */

'use strict';

function smartTruncate(text, max) {
  if (!text || text.length <= max) return text;
  var trimmed = text.slice(0, max);
  return trimmed.replace(/\s+\S*$/, '');
}

module.exports = { smartTruncate };