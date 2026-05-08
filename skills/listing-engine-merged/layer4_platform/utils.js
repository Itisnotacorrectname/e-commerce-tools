/**
 * layer4_platform/utils.js (CJS)
 */
'use strict';

function smartJoin(parts) {
  parts = parts || [];
  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(text) {
  text = text || '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\x00-\x7F]/g, '')
    .trim();
}

function truncate(text, max) {
  text = text || '';
  max = max || 100;
  if (text.length <= max) return text;
  const words = text.split(' ');
  let result = '';
  for (const w of words) {
    if ((result + ' ' + w).length > max) break;
    result += (result ? ' ' : '') + w;
  }
  return result;
}

module.exports = { smartJoin, cleanText, truncate };
