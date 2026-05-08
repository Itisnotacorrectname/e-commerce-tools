/**
 * layer8_constraints/index.js (CJS)
 */
'use strict';

const { runConstraintEngine } = require('./engine/constraint_engine.js');

function applyPlatformConstraints(listing, platform) {
  return runConstraintEngine(listing || {}, platform || 'amazon');
}

module.exports = { applyPlatformConstraints };
