/**
 * layer4_platform/highlight_builder.js — Highlight Builder
 *
 * 来自源B：按平台生成 highlights/bullets。
 */

'use strict';

var utils = require('./utils.js');

function buildHighlights(input, platform) {
  switch (platform) {
    case 'walmart':  return buildWalmartHighlights(input);
    case 'wayfair':  return buildWayfairHighlights(input);
    default:         return buildAmazonBullets(input);
  }
}

function buildAmazonBullets(input) {
  var features = (input.core && input.core.features) || [];
  return features.slice(0, 5).map(function(f) {
    return utils.cleanText(typeof f === 'string' ? f : f.text || '');
  });
}

function buildWalmartHighlights(input) {
  var features = (input.core && input.core.features) || [];
  return features.slice(0, 5).map(function(f) {
    var text = typeof f === 'string' ? f : f.text || '';
    return utils.truncate(emphasizeBenefit(text), 300);
  });
}

function buildWayfairHighlights(input) {
  var features = [];
  var core = input.core || {};
  if (core.attributes && core.attributes.material && core.attributes.material.value) {
    features.push('Material: ' + core.attributes.material.value);
  }
  if (core.attributes && core.attributes.size && core.attributes.size.value) {
    features.push('Size: ' + core.attributes.size.value);
  }
  var rawFeatures = core.features || [];
  rawFeatures.slice(0, 5).forEach(function(f) {
    features.push(typeof f === 'string' ? f : f.text || '');
  });
  return features.map(function(f) { return utils.cleanText(f); });
}

function emphasizeBenefit(text) {
  if (!text) return '';
  return text.replace(/^/, '✔ ').replace(/\.$/, '');
}

module.exports = { buildHighlights };