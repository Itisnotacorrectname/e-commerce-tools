/**
 * layer7_solver/rewrite/rewriter.js (CJS)
 */
'use strict';

const REWRITE_PATTERNS = [
  function(text) { return text.replace(/perfect for anyone dealing with/gi, 'Ideal for'); },
  function(text) { return text.replace(/very|really|extremely/gi, ''); },
  function(text) { return text.replace(/\s—\s/g, ': '); },
  function(text) {
    const seen = new Set();
    return text.split(' ').filter(function(w) {
      const key = w.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).join(' ');
  }
];

function rewriteText(text) {
  let result = text;
  for (const fn of REWRITE_PATTERNS) {
    result = fn(result);
  }
  return result.trim();
}

module.exports = { rewriteText };
