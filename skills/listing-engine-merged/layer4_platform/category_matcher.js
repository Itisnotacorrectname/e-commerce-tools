/**
 * layer4_platform/category_matcher.js — STUB
 * Category matching moved to layer4_platform/index.js
 */
'use strict';
module.exports = {
  matchPlatform: function(product, platform, keywordString) {
    // Simple stub: try to match to a furniture class based on keyword
    const title = (keywordString || product.raw?.title || '').toLowerCase();
    let className = 'Furniture';
    let confidence = 0.6;
    if (title.indexOf('desk') >= 0 || title.indexOf('table') >= 0) {
      className = 'Desks & Tables';
      confidence = 0.75;
    }
    if (title.indexOf('bed') >= 0 || title.indexOf('mattress') >= 0) {
      className = 'Beds & Mattresses';
      confidence = 0.75;
    }
    return {
      matched: { className: className },
      confidence: confidence,
      manualReview: confidence < 0.7
    };
  },
  match: function(ctx) {
    ctx.platform = ctx.platform || {};
    ctx.platform.categoryMatch = { amazon: { confidence: 0.8 }, walmart: { confidence: 0.7 }, wayfair: { confidence: 0.6 } };
    return ctx;
  }
};