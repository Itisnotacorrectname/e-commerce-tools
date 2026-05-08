/**
 * layer6_composer/index.js
 * Compose listings for each platform using the composer modules
 */
'use strict';

const walmartComposer = require('../walmart_composer.js');
const wayfairComposer = require('../wayfair_composer.js');
const amazonComposer = null; // Use the existing amazon listing doctor logic

async function compose(ctx, platform) {
  ctx.composed = ctx.composed || {};

  switch (platform) {
    case 'walmart':
      ctx = await walmartComposer.compose(ctx);
      break;
    case 'wayfair':
      ctx = await wayfairComposer.compose(ctx);
      break;
    case 'amazon':
      // Amazon composition handled by amazon-listing-doctor skill
      ctx.composed.amazon = { title: ctx.raw.product?.title || '', bullets: ctx.raw.product?.bullets || [] };
      break;
  }
  return ctx;
}

module.exports = { compose };
