/**
 * layer6_composer/index.js — Composer Layer
 *
 * walmart_composer.js — 源A完整实现 + 源B验证
 * wayfair_composer.js — 源A完整实现 + 源B结构
 */

'use strict';

var walmartComposer = require('./walmart_composer.js');
var wayfairComposer = require('./wayfair_composer.js');

async function compose(ctx, platform) {
  switch (platform) {
    case 'walmart': return walmartComposer.compose(ctx);
    case 'wayfair': return wayfairComposer.compose(ctx);
    default:        return ctx;
  }
}

module.exports = { compose };