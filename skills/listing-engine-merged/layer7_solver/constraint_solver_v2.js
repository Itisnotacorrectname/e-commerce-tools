/**
 * layer7_solver/constraint_solver_v2.js (CJS version)
 * Constraint solving: generate→score→rewrite→re-score→select
 */
'use strict';

const path = require('path');

function enforceLength(text, maxLen) {
  if (!text) return '';
  return text.length <= maxLen ? text : text.substring(0, maxLen - 3) + '...';
}

function removeForbidden(text, forbidden) {
  if (!text || !forbidden) return text || '';
  let result = text;
  forbidden.forEach(function(word) {
    const re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(re, '');
  });
  return result.replace(/\s{2,}/g, ' ').trim();
}

function limitKeywordRepeat(text, maxRepeat) {
  if (!text || !maxRepeat) return text || '';
  const words = text.split(/\s+/);
  const seen = {};
  return words.filter(function(w) {
    const lower = w.toLowerCase();
    seen[lower] = (seen[lower] || 0) + 1;
    return seen[lower] <= maxRepeat;
  }).join(' ');
}

function rewriteText(text) {
  // Simple rewrite: clean up spacing and capitalization
  if (!text) return '';
  return text.replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  const setB = new Set(wordsB);
  const intersection = wordsA.filter(w => setB.has(w)).length;
  return (2 * intersection) / (wordsA.length + wordsB.length);
}

function constraintSolverV2({ candidates = [], platform = 'amazon', scorer, maxIterations = 3 }) {
  const rules = {
    amazon: { max_length: 200, forbidden: [], keyword_repeat: 5 },
    walmart: { max_length: 75, forbidden: ['Amazon', 'Prime', 'FBA', 'free shipping'], keyword_repeat: 3 },
    wayfair: { max_length: 150, forbidden: ['Amazon', 'Prime'], keyword_repeat: 4 }
  };
  const rule = rules[platform] || rules.amazon;

  let current = candidates.map(function(c) {
    return { text: c, history: [c] };
  });

  for (let i = 0; i < maxIterations; i++) {
    current = current.map(function(item) {
      let text = item.text;
      text = rewriteText(text);
      text = removeForbidden(text, rule.forbidden);
      text = limitKeywordRepeat(text, rule.keyword_repeat);
      text = enforceLength(text, rule.max_length);
      return { text: text, history: [...item.history, text] };
    });

    // Dedup
    current = current.filter(function(item, idx, arr) {
      return arr.findIndex(function(r) { return similarity(r.text, item.text) > 0.85; }) === idx;
    });

    // Score
    if (scorer) {
      const scored = scorer(current.map(function(c) { return c.text; }));
      current = scored.slice(0, 5).map(function(s) {
        return { text: s.text || s, history: [] };
      });
    }
  }

  // Final scoring
  if (scorer) {
    const finalScored = scorer(current.map(function(c) { return c.text; }));
    return finalScored;
  }

  return current.map(function(c) { return { text: c.text, score: 0.8 }; });
}

module.exports = { constraintSolverV2 };
