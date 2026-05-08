/**
 * layer0_reliability/index.js — Listing Engine v2
 *
 * 职责：数据可靠性层。贯穿全流程，在各层写入数据后评估可信度。
 * 三个模块：
 *   confidence_scorer  — 给每个字段打置信度分
 *   missing_handler    — 显式标注缺失字段，提供降级策略
 *   source_tracker     — 记录每个字段的数据来源
 */

'use strict';

const ctx = require('../core/context.js');

// ══════════════════════════════════════════════════════════════
//  1. confidence_scorer — 字段置信度评估
// ══════════════════════════════════════════════════════════════

// 置信度规则：字段路径 → 评估函数
// 返回 0-1 的置信度分，以及可选的降级说明
var CONFIDENCE_RULES = [

  // 核心产品识别
  { path: 'product.identity.coreProduct',
    eval: function(val, context) {
      if (!val) return 0;
      // coreProduct 在产品 title 里出现 → 高可信
      var title = (context.raw.product && context.raw.product.title || '').toLowerCase();
      return title.includes(val.toLowerCase()) ? 0.9 : 0.6;
    }
  },

  // 尺寸数据
  { path: 'product.attributes.dimensions',
    eval: function(val) {
      if (!val || !val.raw || val.raw.length === 0) return 0;
      // parsed 有数据且来源是 text → 较高可信
      if (val.parsed && val.parsed.length > 0) return val.source === 'both' ? 0.95 : 0.85;
      return 0.60;  // 只有 raw 字符串，未解析
    }
  },

  // 材质数据
  { path: 'product.attributes.materials',
    eval: function(val) {
      if (!val || !val.raw || val.raw.length === 0) return 0;
      return val.source === 'both' ? 0.90 : 0.80;
    }
  },

  // 承重/容量
  { path: 'product.attributes.capacity',
    eval: function(val) {
      if (!val || !val.parsed || val.parsed.length === 0) return 0;
      return 0.90;
    }
  },

  // useCase 置信度：取 LLM 输出的平均 confidence
  { path: 'product.useCases',
    eval: function(val) {
      if (!val || val.length === 0) return 0;
      var avg = val.reduce(function(s, uc) { return s + (uc.confidence || 0); }, 0) / val.length;
      return parseFloat(avg.toFixed(2));
    }
  },

  // 竞品数量
  { path: 'market.competitors.filtered',
    eval: function(val) {
      if (!val || val.length === 0) return 0;
      if (val.length >= 20) return 0.95;
      if (val.length >= 10) return 0.80;
      if (val.length >= 5)  return 0.60;
      return 0.30;
    }
  },

  // 类目匹配
  { path: 'platform.categoryMatch.walmart',
    eval: function(val) {
      return (val && val.confidence) ? val.confidence : 0;
    }
  },
  { path: 'platform.categoryMatch.wayfair',
    eval: function(val) {
      return (val && val.confidence) ? val.confidence : 0;
    }
  },

  // Cosmo 评分
  { path: 'conversion.intent.merged',
    eval: function(val) {
      if (!val || val.length === 0) return 0;
      return val.length >= 3 ? 0.85 : 0.60;
    }
  },
];

function scoreConfidence(context) {
  CONFIDENCE_RULES.forEach(function(rule) {
    var val   = ctx.get(context, rule.path);
    var score = rule.eval(val, context);
    ctx.setConfidence(context, rule.path, score);
  });
  return context;
}

// ══════════════════════════════════════════════════════════════
//  2. missing_handler — 缺失字段处理
// ══════════════════════════════════════════════════════════════

// 关键字段定义：path + 是否阻断 + 降级说明
var CRITICAL_FIELDS = [
  { path: 'raw.product.title',          blocking: true,  desc: 'Product title is required for all analysis' },
  { path: 'raw.product.bullets',        blocking: false, desc: 'Bullets missing — bullet analysis will be skipped' },
  { path: 'raw.product.price',          blocking: false, desc: 'Price missing — pricing analysis will be skipped' },
  { path: 'product.identity.coreProduct', blocking: false, desc: 'Core product undetected — keyword search may be inaccurate' },
  { path: 'product.attributes.dimensions.raw', blocking: false, desc: 'No dimensions found — size-based analysis limited' },
  { path: 'market.competitors.filtered', blocking: false, desc: 'No competitors — keyword analysis will use title-only mode' },
];

function checkMissing(context) {
  CRITICAL_FIELDS.forEach(function(field) {
    var val = ctx.get(context, field.path);
    var isEmpty = (val === null || val === undefined ||
                   (Array.isArray(val) && val.length === 0) ||
                   (typeof val === 'string' && val.trim() === ''));

    if (isEmpty) {
      ctx.markMissing(context, field.path, field.desc);
      if (field.blocking) {
        throw new Error('[reliability] Blocking field missing: ' + field.path + ' — ' + field.desc);
      }
    }
  });
  return context;
}

// ══════════════════════════════════════════════════════════════
//  3. source_tracker — 数据来源追踪
// ══════════════════════════════════════════════════════════════

// 为没有 source 标注的字段推断来源
var SOURCE_INFERENCE = [
  { path: 'product.attributes.dimensions.source',
    inferFrom: 'product.attributes.dimensions.raw',
    defaultSource: 'text' },
  { path: 'product.attributes.materials.source',
    inferFrom: 'product.attributes.materials.raw',
    defaultSource: 'text' },
  { path: 'product.attributes.colors.source',
    inferFrom: 'product.attributes.colors.raw',
    defaultSource: 'text' },
  { path: 'product.useCases',
    fixedSource: 'llm' },
  { path: 'product.targetAudience',
    fixedSource: 'llm' },
  { path: 'market.keywords',
    fixedSource: 'competitor_titles' },
];

function trackSources(context) {
  SOURCE_INFERENCE.forEach(function(rule) {
    if (rule.fixedSource) {
      ctx.set(context, rule.path + '._source', rule.fixedSource, rule.fixedSource);
      return;
    }
    var existing = ctx.get(context, rule.path);
    if (!existing) {
      ctx.set(context, rule.path, rule.defaultSource, rule.defaultSource);
    }
  });
  return context;
}

// ══════════════════════════════════════════════════════════════
//  主入口：applyReliability(context)
// ══════════════════════════════════════════════════════════════

// 在每个 layer 执行后调用，更新可靠性元数据
function applyReliability(context) {
  checkMissing(context);
  scoreConfidence(context);
  trackSources(context);

  // 汇总整体可靠性状态
  var scores  = Object.values(context.reliability.scores);
  var avgConf = scores.length > 0
    ? scores.reduce(function(s, v) { return s + v; }, 0) / scores.length
    : 0;

  context.reliability.overallConfidence = parseFloat(avgConf.toFixed(2));

  // 低可信度字段超过 3 个 → 标记人工审核
  var lowConfFields = Object.keys(context.reliability.scores).filter(function(k) {
    return context.reliability.scores[k] < 0.5;
  });
  if (lowConfFields.length >= 3) {
    ctx.flagManualReview(context,
      'Low confidence on ' + lowConfFields.length + ' fields: ' + lowConfFields.slice(0,3).join(', '));
  }

  return context;
}

// 生成可靠性摘要报告（供诊断报告使用）
function getSummary(context) {
  var rel = context.reliability;
  return {
    overallConfidence: rel.overallConfidence || 0,
    missingCount:      rel.missing.length,
    missing:           rel.missing,
    lowConfFields:     Object.keys(rel.scores).filter(function(k) { return rel.scores[k] < 0.5; }),
    warnings:          rel.warnings,
    manualReview:      rel.manualReview,
    sources:           rel.sources,
  };
}

module.exports = {
  applyReliability,
  scoreConfidence,
  checkMissing,
  trackSources,
  getSummary,
};
