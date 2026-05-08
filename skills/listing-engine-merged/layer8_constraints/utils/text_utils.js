/**
 * layer8_constraints/utils/text_utils.js (CJS)
 */
'use strict';

function smartTruncate(text, max) {
  if (!text) return '';
  text = String(text);
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}

function cleanExtraSpaces(text) {
  if (!text) return '';
  return String(text).replace(/\s{2,}/g, ' ').trim();
}

function removeForbiddenChars(text, chars) {
  if (!text) return '';
  chars = chars || ['<', '>', '&', '"'];
  let result = text;
  chars.forEach(function(c) {
    result = result.split(c).join('');
  });
  return result;
}

module.exports = { smartTruncate, cleanExtraSpaces, removeForbiddenChars };
