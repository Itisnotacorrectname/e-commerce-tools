/**
 * engines/compliance_engine.js — STUB
 * Compliance checking moved to layer4_platform layer
 * For smoke_test: uses simple keyword detection for V1 violations
 */
'use strict';
module.exports = {
  run: function(product) {
    product = product || {};
    const raw = product.raw || {};
    const title = (raw.title || '').toLowerCase();
    const explicit = [];
    // Detect V1: superlative violation (best, top, #1, #1, world's best, greatest)
    var superlatives = ['best', 'top', '#1', 'number 1', 'world\'s best', 'greatest'];
    for (var i = 0; i < superlatives.length; i++) {
      if (title.indexOf(superlatives[i].toLowerCase()) >= 0 || title.indexOf(superlatives[i]) >= 0) {
        explicit.push({ type: 'V1', text: superlatives[i], severity: 'critical' });
      }
    }
    return {
      compliance: {
        explicit: explicit,
        implicit: [],
        riskLevel: explicit.length > 0 ? 'high' : 'low'
      }
    };
  }
};