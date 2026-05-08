/**
 * layer8_constraints/engine/rule_runner.js
 *
 * 来自源B layer8_constraints/engine/rule_runner.js
 */

'use strict';

function runRules(text, rule) {
  if (!text) return false;
  switch (rule.type) {
    case 'max_length':
      return text.length > rule.value;
    case 'forbidden_words':
      return (rule.words || []).some(function(w) { return text.toLowerCase().indexOf(w.toLowerCase()) !== -1; });
    case 'no_repeated_words':
      return hasRepetition(text);
    default:
      return false;
  }
}

function hasRepetition(text) {
  var words = text.toLowerCase().split(' ');
  var set   = new Set(words);
  return set.size !== words.length;
}

module.exports = { runRules };