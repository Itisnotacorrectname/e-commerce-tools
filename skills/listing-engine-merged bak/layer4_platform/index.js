/**
 * layer4_platform/index.js — Platform Intelligence Layer
 *
 * 来自源A的基础结构 + 源B增强模块：
 * - category_matcher.js (源A)
 * - compliance_runner.js (源A)
 * - walmart_adapter.js (源B)
 * - title_builder.js (源B)
 * - highlight_builder.js (源B)
 * - utils.js (源B)
 */

'use strict';

const categoryMatcher = require('./category_matcher.js');
const complianceRunner = require('./compliance_runner.js');

const walmartAdapter   = require('./walmart_adapter.js');
const titleBuilder     = require('./title_builder.js');
const highlightBuilder = require('./highlight_builder.js');
const utils            = require('./utils.js');

// ── 4a. 类目匹配 ──────────────────────────────────────────────
async function matchCategory(ctx) {
  return categoryMatcher.matchCategory(ctx);
}

// ── 4b. 合规检查 ─────────────────────────────────────────────
async function checkCompliance(ctx) {
  return complianceRunner.checkCompliance(ctx);
}

// ── 4c. 构建诊断（diagnose 模式）─────────────────────────────
async function buildDiagnosis(ctx) {
  // 简单诊断：统计标题/bullets 信息
  var raw = ctx.raw.product || {};
  var score = 0;

  if (raw.title && raw.title.length > 20)  score += 20;
  if (raw.bullets && raw.bullets.length >= 4) score += 25;
  if (ctx.product.features && ctx.product.features.length >= 3) score += 15;
  if (ctx.market.keywords.primary && ctx.market.keywords.primary.length >= 5) score += 15;
  if (ctx.product.archetype && ctx.product.archetype.primary) score += 15;
  if (ctx.market.pricing && ctx.market.pricing.targetPrice) score += 10;

  ctx.diagnosis.qualityScore = Math.min(score, 100);
  ctx.diagnosis.qualityGrade = score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+' : score >= 60 ? 'B' : 'C';

  return ctx;
}

module.exports = { matchCategory, checkCompliance, buildDiagnosis };