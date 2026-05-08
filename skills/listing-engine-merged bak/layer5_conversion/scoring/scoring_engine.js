/**
 * layer5_conversion/scoring/scoring_engine.js
 *
 * 来自源B scoring/scoring_engine.js
 */

'use strict';

var clarityMod        = require('./metrics/clarity.js');
var emotionMod       = require('./metrics/emotion.js');
var specificityMod   = require('./metrics/specificity.js');
var differentiationMod = require('./metrics/differentiation.js');
var platformFitMod   = require('./metrics/platform_fit.js');
var weightsMod       = require('./weights/platform_weights.js');

function scoreMessagesV2(opts) {
  var messages = opts.messages || [];
  var platform = opts.platform || 'amazon';
  var competitors = opts.competitors || [];
  var weights = weightsMod.PLATFORM_WEIGHTS[platform] || weightsMod.PLATFORM_WEIGHTS.amazon;

  var scored = messages.map(function(text) {
    var clarity  = clarityMod.scoreClarity(text);
    var emotion = emotionMod.scoreEmotion(text);
    var spec    = specificityMod.scoreSpecificity(text);
    var diff    = differentiationMod.scoreDifferentiation(text, competitors);
    var pf      = platformFitMod.scorePlatformFit(text, platform);

    var total = clarity * weights.clarity + emotion * weights.emotion +
                spec * weights.specificity + diff * weights.differentiation +
                pf * weights.platform_fit;

    return { text: text, score: Math.round(total * 100) / 100, breakdown: { clarity: clarity, emotion: emotion, specificity: spec, differentiation: diff, platform_fit: pf } };
  });

  return scored.sort(function(a, b) { return b.score - a.score; });
}

module.exports = { scoreMessagesV2 };