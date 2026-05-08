/**
 * layer8_constraints/engine/fixers.js (CJS)
 */
'use strict';

const { smartTruncate } = require('../utils/text_utils.js');

function removeForbidden(text, words) {
  if (!text || !words) return text || '';
  let result = text;
  for (const w of words) {
    const regex = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(regex, '');
  }
  return result.replace(/\s+/g, ' ').trim();
}

function deduplicate(text) {
  if (!text) return '';
  const words = text.split(' ');
  return [...new Set(words)].join(' ');
}

function applyFix(text, rule) {
  if (!text) return '';
  switch (rule.type) {
    case 'max_length': return smartTruncate(text, rule.value);
    case 'forbidden_words': return removeForbidden(text, rule.words);
    case 'no_repeated_words': return deduplicate(text);
    default: return text;
  }
}

module.exports = { applyFix };
