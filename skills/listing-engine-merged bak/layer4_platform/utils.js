/**
 * layer4_platform/utils.js — Utility Functions
 *
 * 来自源B：smartJoin, cleanText, truncate。
 */

'use strict';

function smartJoin(parts) {
  parts = parts || [];
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function cleanText(text) {
  if (!text) return '';
  return text.replace(/\s+/g, ' ').replace(/[^\x00-\x7F]/g, '').trim();
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  var words = text.split(' ');
  var result = '';
  for (var i = 0; i < words.length; i++) {
    if ((result + ' ' + words[i]).length > max) break;
    result += (result ? ' ' : '') + words[i];
  }
  return result || text.substring(0, max);
}

module.exports = { smartJoin, cleanText, truncate };