/**
 * layer5_conversion/pain/pain_mapper.js
 * Maps intents to customer pain points
 */
'use strict';

function painMapper(intents) {
  if (!intents || intents.length === 0) return [];
  return intents.map(function(item) {
    return {
      pain: item.intent || item.pain || 'general',
      intensity: item.confidence || 0.5,
      evidence: ['Inferred from ' + (item.intent || item.pain || 'general') + ' intent']
    };
  });
}

module.exports = { painMapper };