/**
 * layer8_constraints/engine/fixers.js
 *
 * 来自源B layer8_constraints/engine/fixers.js
 */

'use strict';

var textUtils = require('../utils/text_utils.js');

function applyFix(text, rule) {
  switch (rule.type) {
    case 'max_length':
      return textUtils.smartTruncate(text, rule.value);
    case 'forbidden_words':
      return removeForbidden(text, rule.words || []);
    case 'no_repeated_words':
      return deduplicate(text);
    default:
      return text;
  }
}

function removeForbidden(text, words) {
  var result = text;
  words.forEach(function(w) {
    var re = new RegExp('\\b' + w + '\\b', 'gi');
    result = result.replace(re, '');
  });
  return result.replace(/\s{2,}/g, ' ').trim();
}

function deduplicate(text) {
  var words = text.split(' ');
  return [...new Set(words)].join(' ');
}

module.exports = { applyFix };