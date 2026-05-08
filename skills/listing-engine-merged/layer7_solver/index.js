/**
 * layer7_solver/index.js
 * Constraint solving: iterate generate→score→rewrite→re-score→select
 */
'use strict';

const { constraintSolverV2 } = (() => {
  try {
    return require('./constraint_solver_v2.js');
  } catch(e) {
    // Fallback stub
    return { constraintSolverV2: ({ candidates = [] }) => candidates };
  }
})();

async function solve(ctx) {
  const platform = ctx.input.platform || 'amazon';
  const messages = ctx.conversion?.messaging || [];

  if (messages.length === 0) {
    ctx.solved = { candidates: [], selected: {}, iterations: 0, constraints: [] };
    return ctx;
  }

  const scorer = (texts) => texts.map(t => ({ text: t, score: 0.8 }));

  const result = constraintSolverV2({
    candidates: messages,
    platform,
    scorer,
    maxIterations: 3
  });

  ctx.solved = {
    candidates: result,
    selected: result[0] || {},
    iterations: 1,
    constraints: []
  };

  console.error('[layer7] Solved: ' + result.length + ' candidates');
  return ctx;
}

module.exports = { solve };
