/**
 * layer5_conversion/index.js — Conversion Engine
 *
 * 来自源B完整实现：
 * intent_extractor → pain_mapper → hook_generator → proof_builder → messaging_engine → scoring_engine
 */

'use strict';

var intentExtractorMod = require('./intent/intent_extractor.js');
var painMapperMod      = require('./pain/pain_mapper.js');
var hookGeneratorMod  = require('./hook/hook_generator.js');
var proofBuilderMod  = require('./proof/proof_builder.js');
var messagingMod     = require('./messaging/messaging_engine.js');
var scoringMod       = require('./scoring/scoring_engine.js');

// ── 适配 context API ──────────────────────────────────────────
// 把 context 对象变成 ctx.get('path') 风格的访问器
function makeCtxAdapter(ctx) {
  var adapter = {
    get: function(path) {
      var parts = path.split('.');
      var val = ctx;
      for (var i = 0; i < parts.length; i++) {
        if (val == null) return null;
        val = val[parts[i]];
      }
      return val || null;
    }
  };
  adapter.coreKeyword    = (ctx.product && ctx.product.identity && ctx.product.identity.coreProduct) || '';
  adapter.coreAttributes = ctx.product && ctx.product.attributes || {};
  return adapter;
}

// ── extract intent ────────────────────────────────────────────
async function extractIntent(ctx) {
  var adapter = makeCtxAdapter(ctx);
  var intents = intentExtractorMod.intentExtractor(adapter);
  ctx.conversion.intent.fromFeatures = intents;
  ctx.conversion.intent.merged = intents;
  return ctx;
}

// ── score cosmo (simplified) ──────────────────────────────────
async function scoreCosmo(ctx) {
  return ctx;
}

// ── map pain ───────────────────────────────────────────────────
async function mapPain(ctx) {
  var intents = ctx.conversion.intent.merged || [];
  var pains = painMapperMod.painMapper(intents);
  ctx.conversion.painPoints = pains;
  return ctx;
}

// ── generate hooks ─────────────────────────────────────────────
async function generateHooks(ctx) {
  var pains = ctx.conversion.painPoints || [];
  var hooks = hookGeneratorMod.hookGenerator(pains);
  ctx.conversion.hooks = hooks;
  return ctx;
}

// ── build proof ───────────────────────────────────────────────
async function buildProof(ctx) {
  var attrs = ctx.product && ctx.product.attributes || {};
  var proofs = proofBuilderMod.proofBuilder(attrs);
  ctx.conversion.proof = proofs;
  return ctx;
}

// ── build messaging ────────────────────────────────────────────
async function buildMessaging(ctx) {
  var hooks  = ctx.conversion.hooks  || [];
  var proofs = ctx.conversion.proof  || [];
  var messages = messagingMod.messagingEngine(hooks, proofs);
  ctx.conversion.messages = messages;
  return ctx;
}

// ── differentiate ─────────────────────────────────────────────
async function differentiate(ctx) {
  var competitors = ctx.market && ctx.market.competitors && ctx.market.competitors.filtered || [];
  var gaps = [];
  var usps = ctx.conversion.messages && ctx.conversion.messages.slice(0, 2) || [];
  ctx.conversion.differentiation = { gaps: gaps, usps: usps, strategy: 'performance' };
  return ctx;
}

// ── select strategy ────────────────────────────────────────────
async function selectStrategy(ctx) {
  return ctx;
}

module.exports = {
  extractIntent, scoreCosmo, mapPain, generateHooks,
  buildProof, buildMessaging, differentiate, selectStrategy
};