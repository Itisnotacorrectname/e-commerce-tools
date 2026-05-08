/**
 * layer2_product/scorer.js (CJS)
 */
'use strict';

function scoreArchetypes(signals) {
  if (!signals || signals.length === 0) {
    return { primary: 'unknown', secondary: [], confidence: 0 };
  }

  const byArchetype = {};
  for (const s of signals) {
    if (!byArchetype[s.archetype]) byArchetype[s.archetype] = [];
    byArchetype[s.archetype].push(s);
  }

  const scores = Object.entries(byArchetype).map(([archetype, sigs]) => ({
    archetype,
    score: sigs.reduce((sum, s) => sum + (s.weight || 1), 0),
    reasons: sigs.map(s => s.reason)
  }));

  scores.sort((a, b) => b.score - a.score);

  return {
    primary: scores[0].archetype,
    secondary: scores.slice(1).map(s => s.archetype),
    confidence: Math.min(scores[0].score / 10, 1),
    _debug: scores
  };
}

module.exports = { scoreArchetypes };
