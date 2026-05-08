/**
 * layer7_solver/index.js — Constraint Solver
 *
 * 来自源B的 constraint_solver_v2.js 实现。
 */

'use strict';

var forbiddenMod  = require('./constraints/forbidden.js');
var keywordRepMod = require('./constraints/keyword_repeat.js');
var lengthMod     = require('./constraints/length.js');
var platformRulesMod = require('./constraints/platform_rules.js');
var rewriteMod    = require('./rewrite/rewriter.js');
var similarityMod = require('./utils/similarity.js');

function constraintSolverV2(opts) {
  var candidates = opts.candidates || [];
  var platform   = opts.platform   || 'amazon';
  var scorer     = opts.scorer     || function(a) { return a.map(function(t) { return { text: t, score: 0.5 }; }); };
  var maxIter    = opts.maxIterations || 3;

  var rules = platformRulesMod.PLATFORM_CONSTRAINTS[platform] || platformRulesMod.PLATFORM_CONSTRAINTS.amazon;

  var current = candidates.map(function(c) {
    return { text: typeof c === 'string' ? c : c.text || c, history: [typeof c === 'string' ? c : c.text || c] };
  });

  for (var i = 0; i < maxIter; i++) {
    current = current.map(function(item) {
      var text = item.text;
      text = rewriteMod.rewriteText(text);
      text = forbiddenMod.removeForbidden(text, rules.forbidden);
      text = keywordRepMod.limitKeywordRepeat(text, rules.keyword_repeat);
      text = lengthMod.enforceLength(text, rules.max_length);
      return { text: text, history: item.history.concat([text]) };
    });

    current = dedupe(current, similarityMod.similarity);

    var scored = scorer(current.map(function(c) { return c.text; }));
    current = scored.slice(0, 5).map(function(s) {
      return { text: s.text || s, history: [] };
    });
  }

  var finalScored = scorer(current.map(function(c) { return c.text; }));
  return finalScored;
}

function dedupe(items, simFn) {
  var result = [];
  items.forEach(function(item) {
    var exists = result.some(function(r) { return simFn(r.text, item.text) > 0.85; });
    if (!exists) result.push(item);
  });
  return result;
}

async function solve(ctx) {
  var candidates = ctx.solved && ctx.solved.candidates || [];
  var platform  = ctx.input && ctx.input.targetPlatforms && ctx.input.targetPlatforms[0] || 'amazon';
  var scorer    = function(texts) {
    return texts.map(function(t) { return { text: t, score: 0.5 }; });
  };

  try {
    var result = constraintSolverV2({ candidates: candidates, platform: platform, scorer: scorer });
    ctx.solved.candidates = result;
    ctx.solved.selected   = result.slice(0, 3);
  } catch(e) {
    console.error('[layer7_solver] solve failed: ' + e.message);
  }
  return ctx;
}

module.exports = { solve };