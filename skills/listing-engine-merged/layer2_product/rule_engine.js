/**
 * layer2_product/rule_engine.js (CJS)
 * Rule-based archetype detection for products
 */
'use strict';

function runRules(context) {
  const title = (context.title || '').toLowerCase();
  const attrs = context.attributes || {};
  const keywords = context.keywords || [];

  const signals = [];

  // ── Comfort rules ──
  const comfortWords = ['soft', 'comfortable', 'cozy', ' plush', 'cushion', 'ergonomic', 'memory foam'];
  if (comfortWords.some(w => title.includes(w))) {
    signals.push({ archetype: 'comfort', weight: 2, reason: 'comfort keyword in title' });
  }

  // ── Spec-heavy rules ──
  const specWords = ['steel', 'metal', 'weight capacity', 'dimensions', 'size', 'capacity'];
  if (specWords.some(w => title.includes(w))) {
    signals.push({ archetype: 'spec_heavy', weight: 2, reason: 'spec keyword in title' });
  }

  // ── Dimension-based rules ──
  if (/\d+\s*(?:inch|in|cm|mm|foot|ft)/.test(title)) {
    signals.push({ archetype: 'dimension_based', weight: 1.5, reason: 'dimensions in title' });
  }

  // ── Variant-heavy rules ──
  const variantWords = ['twin', 'full', 'queen', 'king', 'small', 'medium', 'large', 'xl'];
  if (variantWords.some(w => title.includes(w))) {
    signals.push({ archetype: 'variant_heavy', weight: 2, reason: 'size variant in title' });
  }

  // ── Feature-dominant rules ──
  const featureWords = ['with', 'features', 'includes', 'comes with', 'equipped'];
  if (featureWords.some(w => title.includes(w))) {
    signals.push({ archetype: 'feature_dominant', weight: 1.5, reason: 'feature language in title' });
  }

  // ── Tool rules ──
  const toolWords = ['drill', 'saw', 'hammer', 'wrench', 'tool', 'screwdriver'];
  if (toolWords.some(w => title.includes(w))) {
    signals.push({ archetype: 'tool', weight: 2, reason: 'tool keyword in title' });
  }

  // ── Default fallback ──
  if (signals.length === 0) {
    signals.push({ archetype: 'general', weight: 1, reason: 'default fallback' });
  }

  return signals;
}

module.exports = { runRules };
