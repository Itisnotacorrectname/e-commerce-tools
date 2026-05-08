/**
 * layer8_constraints/engine/rule_runner.js (CJS)
 */
'use strict';

function hasRepetition(text) {
  if (!text) return false;
  const words = text.split(' ');
  const seen = {};
  for (const w of words) {
    const key = w.toLowerCase();
    if (seen[key]) return true;
    seen[key] = true;
  }
  return false;
}

function runRules(text, rule) {
  if (!text) return false;
  switch (rule.type) {
    case 'max_length': return text.length > rule.value;
    case 'forbidden_words': return (rule.words || []).some(function(w) {
      return text.toLowerCase().includes(w.toLowerCase());
    });
    case 'no_repeated_words': return hasRepetition(text);
    default: return false;
  }
}

module.exports = { runRules };
