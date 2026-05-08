/**
 * layer4_platform/title_builder.js — Title Builder
 *
 * 来自源B：按平台生成标题。
 */

'use strict';

var utils = require('./utils.js');

function buildTitle(input, platform) {
  switch (platform) {
    case 'walmart':  return buildWalmartTitle(input);
    case 'wayfair':  return buildWayfairTitle(input);
    default:         return buildAmazonTitle(input);
  }
}

function buildAmazonTitle(input) {
  var core = input.core || {};
  var brand    = core.attributes && core.attributes.brand && core.attributes.brand.value || '';
  var keyword  = core.keyword || '';
  var material = core.attributes && core.attributes.material && core.attributes.material.value || '';
  var size     = core.attributes && core.attributes.size && core.attributes.size.value || '';

  return utils.cleanText(utils.smartJoin([brand, size, material, keyword]));
}

function buildWalmartTitle(input) {
  var core = input.core || {};
  var brand   = core.attributes && core.attributes.brand && core.attributes.brand.value || '';
  var keyword = core.keyword || '';
  var variant = core.attributes && core.attributes.size && core.attributes.size.value || '';

  var title = utils.smartJoin([brand, keyword, variant]);
  return utils.truncate(utils.cleanText(title), 75);
}

function buildWayfairTitle(input) {
  var core = input.core || {};
  var brand    = core.attributes && core.attributes.brand && core.attributes.brand.value || '';
  var keyword  = core.keyword || '';
  var material = core.attributes && core.attributes.material && core.attributes.material.value || '';

  return utils.cleanText(utils.smartJoin([brand, material, keyword]));
}

module.exports = { buildTitle };