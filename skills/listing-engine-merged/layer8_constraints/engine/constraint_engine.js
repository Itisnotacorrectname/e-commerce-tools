/**
 * layer8_constraints/engine/constraint_engine.js (CJS)
 */
'use strict';

const { applyFix } = require('./fixers.js');

const amazonRules = require('../rules/amazon_rules.json');
const walmartRules = require('../rules/walmart_rules.json');
const wayfairRules = require('../rules/wayfair_rules.json');

function getRules(platform) {
  switch (platform) {
    case 'walmart': return walmartRules;
    case 'wayfair': return wayfairRules;
    default: return amazonRules;
  }
}

function runConstraintEngine(listing, platform) {
  const rules = getRules(platform);
  let result = Object.assign({}, listing);

  for (const field in rules) {
    const fieldRules = rules[field];
    for (const rule of fieldRules) {
      if (rule.type && result[field]) {
        result[field] = applyFix(result[field], rule);
      }
    }
  }

  return result;
}

module.exports = { runConstraintEngine };
