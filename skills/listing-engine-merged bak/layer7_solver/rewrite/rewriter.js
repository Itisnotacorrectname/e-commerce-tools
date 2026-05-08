/**
 * layer7_solver/rewrite/rewriter.js
 */
'use strict';
function rewriteText(text) {
  var result = text;
  // 简化表达
  result = result.replace(/perfect for anyone dealing with/gi, 'Ideal for');
  // 去冗余
  result = result.replace(/very|really|extremely/gi, '');
  // 压缩结构
  result = result.replace(/\s—\s/g, ': ');
  // 去重复词
  var seen = {};
  result = result.split(' ').filter(function(w) {
    var key = w.toLowerCase();
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).join(' ');
  return result.trim();
}
module.exports = { rewriteText };