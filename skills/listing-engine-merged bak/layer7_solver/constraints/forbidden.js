/**
 * layer7_solver/constraints/forbidden.js
 */
'use strict';
function removeForbidden(text, forbidden) {
  forbidden = forbidden || [];
  var result = text;
  forbidden.forEach(function(word) {
    var re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(re, '');
  });
  return result.replace(/\s{2,}/g, ' ').trim();
}
module.exports = { removeForbidden };