/**
 * layer5_conversion/intent/intent_extractor.js
 * Stub: extracts purchase intents from product data
 */
'use strict';

const INTENT_KEYWORDS = {
  'space-saving': ['space', 'compact', 'small', 'room'],
  'easy-assembly': ['assembly', 'easy', 'simple', 'minute'],
  'stability': ['sturdy', 'stable', 'wobble', 'strong'],
  'multi-use': ['multi', 'versatile', 'all-in-one'],
  'portability': ['portable', 'lightweight', 'fold'],
};

function intentExtractor(ctx) {
  const raw = (ctx.raw && ctx.raw.product) || {};
  const bullets = raw.bullets || [];
  const title = raw.title || '';
  const combined = (title + ' ' + bullets.join(' ')).toLowerCase();

  const intents = [];
  for (const intent in INTENT_KEYWORDS) {
    const keywords = INTENT_KEYWORDS[intent];
    let score = 0;
    for (let i = 0; i < keywords.length; i++) {
      if (combined.indexOf(keywords[i]) >= 0) score++;
    }
    if (score > 0) {
      intents.push({ intent: intent, confidence: Math.min(score / 3, 1), source: 'keyword' });
    }
  }
  return intents.length > 0 ? intents : [{ intent: 'general', confidence: 0.5, source: 'default' }];
}

module.exports = { intentExtractor };