/**
 * layer4_platform/highlight_builder.js (CJS)
 */
'use strict';

const { truncate, cleanText } = require('./utils.js');

function buildHighlights(input, platform) {
  switch (platform) {
    case 'walmart': return buildWalmartHighlights(input);
    case 'wayfair': return buildWayfairHighlights(input);
    default: return buildAmazonBullets(input);
  }
}

function buildAmazonBullets(input) {
  const core = (input && input.core) || {};
  const features = core.features || [];
  return features.slice(0, 5).map(function(f) { return cleanText(String(f)); });
}

function buildWalmartHighlights(input) {
  const core = (input && input.core) || {};
  const features = core.features || [];
  return features.slice(0, 5).map(function(f) {
    const text = String(f);
    const emphasis = text.replace(/^/, '✔ ').replace(/\.$/, '');
    return truncate(emphasis, 300);
  });
}

function buildWayfairHighlights(input) {
  const core = (input && input.core) || {};
  const attrs = core.attributes || {};
  const features = [];
  if (attrs.material && attrs.material.value) features.push('Material: ' + attrs.material.value);
  if (attrs.size && attrs.size.value) features.push('Size: ' + attrs.size.value);
  features.push.apply(features, (core.features || []).slice(0, 5));
  return features.map(function(f) { return cleanText(String(f)); });
}

module.exports = { buildHighlights };
