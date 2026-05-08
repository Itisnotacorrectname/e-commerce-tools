/**
 * layer4_platform/walmart_adapter.js (CJS)
 */
'use strict';

const walmartSchema = {
  title: { max_length: 75 },
  highlights: { max_length: 300, max_items: 12 },
  description: { max_length: 2000 },
  attributes: ['brand', 'material', 'color', 'size', 'weight', 'dimensions']
};

function smartTruncate(text, max) {
  if (!text) return '';
  text = String(text);
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
}

function adaptToWalmart(draft) {
  let result = {};

  result.title = smartTruncate(draft.title || '', walmartSchema.title.max_length);

  result.highlights = (draft.highlights || [])
    .map(function(h) { return smartTruncate(h, walmartSchema.highlights.max_length); })
    .slice(0, walmartSchema.highlights.max_items);

  result.description = smartTruncate(
    (draft.highlights || []).join(' '),
    walmartSchema.description.max_length
  );

  result.attributes = {};
  for (const key of walmartSchema.attributes) {
    if (draft.attributes && draft.attributes[key]) {
      result.attributes[key] = draft.attributes[key].value;
    }
  }

  return result;
}

module.exports = { adaptToWalmart };
