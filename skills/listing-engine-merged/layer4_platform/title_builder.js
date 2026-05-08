/**
 * layer4_platform/title_builder.js (CJS)
 */
'use strict';

const { smartJoin, cleanText, truncate } = require('./utils.js');

function buildTitle(input, platform) {
  switch (platform) {
    case 'walmart': return buildWalmartTitle(input);
    case 'wayfair': return buildWayfairTitle(input);
    default: return buildAmazonTitle(input);
  }
}

function buildAmazonTitle(input) {
  const core = (input && input.core) || {};
  const brand = (core.attributes && core.attributes.brand && core.attributes.brand.value) || '';
  const keyword = core.keyword || '';
  const material = (core.attributes && core.attributes.material && core.attributes.material.value) || '';
  const size = (core.attributes && core.attributes.size && core.attributes.size.value) || '';

  return cleanText(smartJoin([brand, size, material, keyword]));
}

function buildWalmartTitle(input) {
  const core = (input && input.core) || {};
  const brand = (core.attributes && core.attributes.brand && core.attributes.brand.value) || '';
  const keyword = core.keyword || '';
  const variant = (core.attributes && core.attributes.size && core.attributes.size.value) || '';

  const title = smartJoin([brand, keyword, variant]);
  return truncate(cleanText(title), 75);
}

function buildWayfairTitle(input) {
  const core = (input && input.core) || {};
  const brand = (core.attributes && core.attributes.brand && core.attributes.brand.value) || '';
  const keyword = core.keyword || '';
  const material = (core.attributes && core.attributes.material && core.attributes.material.value) || '';

  return cleanText(smartJoin([brand, material, keyword]));
}

module.exports = { buildTitle };
