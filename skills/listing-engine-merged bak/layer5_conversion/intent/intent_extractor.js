/**
 * layer5_conversion/intent/intent_extractor.js
 *
 * 来自源B layer5_conversion/intent/intent_extractor.js
 */

'use strict';

var INTENT_RULES = [
  { match: /pain|back|orthopedic/i, intent: 'pain_relief', weight: 0.9 },
  { match: /sleep|comfort|soft|firm/i, intent: 'comfort', weight: 0.85 },
  { match: /small|space|compact/i, intent: 'space_saving', weight: 0.8 },
  { match: /fast|powerful|performance/i, intent: 'performance', weight: 0.8 },
  { match: /design|modern|luxury/i, intent: 'aesthetic', weight: 0.7 },
  { match: /durable|long-lasting/i, intent: 'durability', weight: 0.75 }
];

function intentExtractor(ctx) {
  var keyword = ctx.get && ctx.get('core.keyword') || ctx.coreKeyword || '';
  var attrs = ctx.get && ctx.get('core.attributes') || ctx.coreAttributes || {};
  var signals = [keyword].concat(Object.keys(attrs).map(function(k) { return attrs[k] && attrs[k].value || ''; })).join(' ');
  var intents = INTENT_RULES.filter(function(rule) { return rule.match.test(signals); })
    .map(function(rule) { return { type: rule.intent, weight: rule.weight }; });
  return intents.length ? intents : [{ type: 'generic', weight: 0.5 }];
}

module.exports = { intentExtractor };