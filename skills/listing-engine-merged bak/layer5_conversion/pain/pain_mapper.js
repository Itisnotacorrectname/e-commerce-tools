/**
 * layer5_conversion/pain/pain_mapper.js
 *
 * 来自源B layer5_conversion/pain/pain_mapper.js
 */

'use strict';

var PAIN_MAP = {
  pain_relief: [
    { pain: 'waking up with back pain', emotion: 'frustration', intensity: 0.9 },
    { pain: 'poor sleep quality', emotion: 'fatigue', intensity: 0.85 }
  ],
  comfort: [
    { pain: "can't fall asleep easily", emotion: 'stress', intensity: 0.8 }
  ],
  space_saving: [
    { pain: 'limited room space', emotion: 'stress', intensity: 0.85 }
  ]
};

function painMapper(intents) {
  intents = intents || [];
  var result = [];
  intents.forEach(function(i) {
    var mapped = PAIN_MAP[i.type] || [];
    mapped.forEach(function(p) { result.push(p); });
  });
  return result.slice(0, 5);
}

module.exports = { painMapper };