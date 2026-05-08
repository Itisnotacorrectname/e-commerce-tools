/**
 * layer5_conversion/scoring/weights/platform_weights.js
 *
 * 来自源B scoring/weights/platform_weights.js
 */

'use strict';

var PLATFORM_WEIGHTS = {
  amazon: { clarity: 0.2, emotion: 0.15, specificity: 0.25, differentiation: 0.2, platform_fit: 0.2 },
  walmart: { clarity: 0.3, emotion: 0.1, specificity: 0.25, differentiation: 0.15, platform_fit: 0.2 },
  wayfair: { clarity: 0.25, emotion: 0.05, specificity: 0.35, differentiation: 0.15, platform_fit: 0.2 }
};

module.exports = { PLATFORM_WEIGHTS };