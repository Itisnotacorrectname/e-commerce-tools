/**
 * layer5_conversion/scoring/scoring_engine.js (CJS)
 */
'use strict';

const { scoreClarity } = require('./metrics/clarity.js');
const { scoreEmotion } = require('./metrics/emotion.js');
const { scoreSpecificity } = require('./metrics/specificity.js');
const { scoreDifferentiation } = require('./metrics/differentiation.js');
const { scorePlatformFit } = require('./metrics/platform_fit.js');
const PLATFORM_WEIGHTS = require('./weights/platform_weights.js');

function scoreMessagesV2({ messages, platform, competitors }) {
  messages = messages || [];
  platform = platform || 'amazon';
  const weights = PLATFORM_WEIGHTS[platform] || PLATFORM_WEIGHTS.amazon;

  const scored = messages.map(function(text) {
    const clarity = scoreClarity(text);
    const emotion = scoreEmotion(text);
    const specificity = scoreSpecificity(text);
    const differentiation = scoreDifferentiation(text, competitors || []);
    const platform_fit = scorePlatformFit(text, platform);

    const total =
      clarity * weights.clarity +
      emotion * weights.emotion +
      specificity * weights.specificity +
      differentiation * weights.differentiation +
      platform_fit * weights.platform_fit;

    return {
      text: text,
      score: Math.round(total * 100) / 100,
      breakdown: { clarity, emotion, specificity, differentiation, platform_fit }
    };
  });

  return scored.sort(function(a, b) { return b.score - a.score; });
}

module.exports = { scoreMessagesV2 };
