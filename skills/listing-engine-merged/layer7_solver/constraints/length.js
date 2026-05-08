/**
 * layer7_solver/constraints/length.js (CJS)
 */
'use strict';

function enforceLength(text, maxLen) {
  if (!text) return '';
  return text.length <= maxLen ? text : text.substring(0, maxLen - 3) + '...';
}

module.exports = { enforceLength };
