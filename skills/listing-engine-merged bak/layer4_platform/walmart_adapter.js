/**
 * layer4_platform/walmart_adapter.js — Walmart Adapter
 *
 * 来自源B：把 draft listing 适配成 Walmart 格式。
 * 包含 smartTruncate 从 layer8_constraints/utils/text_utils.js。
 */

'use strict';

function smartTruncate(text, max) {
  if (!text || text.length <= max) return text;
  var trimmed = text.slice(0, max);
  return trimmed.replace(/\s+\S*$/, '');
}

function mapAttributes(attrs, allowedKeys) {
  var result = {};
  for (var key in allowedKeys) {
    if (attrs[key]) result[key] = attrs[key].value || attrs[key];
  }
  return result;
}

function adaptToWalmart(draft) {
  var result = {};

  result.title = smartTruncate(draft.title || '', 75);

  result.highlights = (draft.highlights || [])
    .map(function(h) { return smartTruncate(h, 300); })
    .slice(0, 10);

  result.description = smartTruncate(
    (draft.highlights || []).join(' '),
    2500
  );

  result.attributes = mapAttributes(draft.attributes || {}, {});

  return result;
}

module.exports = { adaptToWalmart };