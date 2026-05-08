/**
 * layer8_constraints/engine/constraint_engine.js
 *
 * 来自源B layer8_constraints/engine/constraint_engine.js
 */

'use strict';

var ruleRunner = require('./rule_runner.js');
var fixers     = require('./fixers.js');

var amazonRules  = require('../rules/amazon_rules.json');
var walmartRules = require('../rules/walmart_rules.json');
var wayfairRules = require('../rules/wayfair_rules.json');

function runConstraintEngine(listing, platform) {
  var rules = getRules(platform);
  var result = Object.assign({}, listing);

  for (var field in rules) {
    var fieldRules = rules[field];
    for (var i = 0; i < fieldRules.length; i++) {
      var rule = fieldRules[i];
      if (ruleRunner.runRules(result[field] || '', rule)) {
        result[field] = fixers.applyFix(result[field] || '', rule);
      }
    }
  }

  return result;
}

function getRules(platform) {
  switch (platform) {
    case 'walmart':  return walmartRules;
    case 'wayfair':  return wayfairRules;
    default:         return amazonRules;
  }
}

module.exports = { runConstraintEngine };