/**
 * layer5_conversion/index.js
 * Conversion engine: intent → pain → hooks → proof → messaging → scoring
 * FIXED: wire up all modules properly
 */
'use strict';

const { intentExtractor } = require('./intent/intent_extractor.js');
const { painMapper } = require('./pain/pain_mapper.js');
const { hookGenerator } = require('./hook/hook_generator.js');
const { messagingEngine } = require('./messaging/messaging_engine.js');
const { scoreMessagesV2 } = require('./scoring/scoring_engine.js');

// ── proof_builder stub (adapts ctx.product.attributes to proof structure) ──
function proofBuilderFromContext(ctx) {
  const attrs = (ctx.product && ctx.product.attributes) || {};
  const identity = (ctx.product && ctx.product.identity) || {};
  const bullets = (ctx.raw && ctx.raw.product && ctx.raw.product.bullets) || [];
  const proofs = [];

  // material
  const mats = attrs.materials && attrs.materials.raw;
  if (mats && mats.length > 0) {
    proofs.push({ type: 'material', text: 'Made with ' + mats[0] });
  }
  // cert (look in bullets for cert-related keywords)
  const certPatterns = /certipur|carb.*compliant|etl|ul|certified|prop.*65/i;
  const certMatch = bullets.join(' ').match(certPatterns);
  if (certMatch) {
    proofs.push({ type: 'cert', text: certMatch[0] + ' certified' });
  }
  // size/variant
  const sizes = identity.variantSignals || [];
  if (sizes.length > 0) {
    proofs.push({ type: 'usage', text: 'Available in ' + sizes.join(', ') + ' sizes' });
  }
  // dimension
  const dims = attrs.dimensions && attrs.dimensions.raw;
  if (dims && dims.length > 0) {
    proofs.push({ type: 'dimension', text: 'Dimensions: ' + dims[0] });
  }

  return proofs;
}

async function extractIntent(ctx) {
  const intents = intentExtractor(ctx);
  ctx.conversion = ctx.conversion || {};
  ctx.conversion.intent = intents;
  return ctx;
}

async function mapPain(ctx) {
  const intents = (ctx.conversion && ctx.conversion.intent) || [];
  ctx.conversion = ctx.conversion || {};
  ctx.conversion.painPoints = painMapper(intents);
  return ctx;
}

async function generateHooks(ctx) {
  const pains = (ctx.conversion && ctx.conversion.painPoints) || [];
  const features = (ctx.product && ctx.product.features) || [];
  const bullets = (ctx.raw && ctx.raw.product && ctx.raw.product.bullets) || [];
  ctx.conversion = ctx.conversion || {};
  ctx.conversion.hooks = hookGenerator(pains, features, bullets);
  return ctx;
}

async function buildProof(ctx) {
  ctx.conversion = ctx.conversion || {};
  ctx.conversion.proof = proofBuilderFromContext(ctx);
  return ctx;
}

async function buildMessaging(ctx) {
  const hooks = (ctx.conversion && ctx.conversion.hooks) || [];
  const proofs = (ctx.conversion && ctx.conversion.proof) || [];
  const messages = messagingEngine({ hooks: hooks, proofs: proofs });
  ctx.conversion.messages = messages;
  return ctx;
}

async function scoreCosmo(ctx) {
  const messages = (ctx.conversion && ctx.conversion.messages) || [];
  const competitors = (ctx.market && ctx.market.keywords) || [];
  const platform = (ctx.platform && ctx.platform.target) || 'amazon';
  ctx.conversion = ctx.conversion || {};
  ctx.conversion.cosmoScores = messages.length > 0
    ? scoreMessagesV2({ messages: messages, platform: platform, competitors: competitors })
    : [];
  return ctx;
}

async function differentiate(ctx) {
  ctx.conversion = ctx.conversion || {};
  ctx.conversion.differentiation = { gaps: [], usps: [], strategy: 'performance' };
  return ctx;
}

async function selectStrategy(ctx) {
  ctx.conversion = ctx.conversion || {};
  const scores = ctx.conversion.cosmoScores || [];
  const avg = scores.length > 0
    ? scores.reduce(function(s, m) { return s + m.score; }, 0) / scores.length
    : 0;
  ctx.conversion.scores = {
    clarity: avg > 0 ? avg * 0.2 : 0.7,
    emotion: avg > 0 ? avg * 0.15 : 0.6,
    specificity: avg > 0 ? avg * 0.25 : 0.7,
    differentiation: avg > 0 ? avg * 0.2 : 0.6,
    platformFit: avg > 0 ? avg * 0.2 : 0.7,
    overall: avg > 0 ? avg : 0.7
  };
  return ctx;
}

module.exports = { extractIntent, scoreCosmo, mapPain, generateHooks, buildProof, buildMessaging, differentiate, selectStrategy };
