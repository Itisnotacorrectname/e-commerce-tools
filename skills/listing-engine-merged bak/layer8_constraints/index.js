/**
 * layer8_constraints/index.js — Constraint Engine
 *
 * 来自源B layer8_constraints/
 */

'use strict';

var constraintEngine = require('./engine/constraint_engine.js');

function applyPlatformConstraints(listing, platform) {
  return constraintEngine.runConstraintEngine(listing, platform);
}

module.exports = { applyPlatformConstraints };