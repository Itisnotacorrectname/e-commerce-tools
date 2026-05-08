/**
 * layer7_solver/constraints/forbidden.js (CJS)
 */
'use strict';

function removeForbidden(text, forbidden) {
  if (!text || !forbidden || !Array.isArray(forbidden)) return text || '';
  let result = text;
  forbidden.forEach(function(word) {
    const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(re, '');
  });
  return result.replace(/\s{2,}/g, ' ').trim();
}

module.exports = { removeForbidden };
