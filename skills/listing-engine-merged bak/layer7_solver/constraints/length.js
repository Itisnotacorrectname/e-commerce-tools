/**
 * layer7_solver/constraints/length.js
 */
'use strict';
function enforceLength(text, maxLength) {
  if (!text || text.length <= maxLength) return text;
  var trimmed = text.slice(0, maxLength);
  return trimmed.replace(/\s+\S*$/, '');
}
module.exports = { enforceLength };