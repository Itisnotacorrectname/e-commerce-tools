/**
 * core/context.js — Listing Engine v2.0
 *
 * 全局数据总线。所有 layer 通过 context 读写数据，不直接互相调用。
 * 不可变历史：每次写入记录来源和时间戳。
 * 显式缺失：未填充字段用 null，不用 undefined。
 * 可序列化：整个 context 可 JSON.stringify 存档/恢复。
 */

'use strict';

// ── Context 结构定义 ──────────────────────────────────────────
function createContext(input) {
  return {

    // ── 输入参数 ────────────────────────────────────────────
    input: {
      url:           input.url           || null,
      asin:          input.asin          || null,
      platform:      input.platform      || 'amazon',
      marketplace:  input.marketplace    || 'US',
      mode:          input.mode          || 'diagnose',
      sourcePlatform: input.sourcePlatform || null,
      targetPlatform: input.targetPlatform || null,
      options:       input.options       || {},
    },

    // ── Layer 0: 可靠性元数据 ───────────────────────────────
    reliability: {
      scores:       {},    // { fieldPath: confidence 0-1 }
      missing:      [],     // string[]，缺失字段路径
      sources:      {},     // { fieldPath: 'title'|'bullet_N'|'image'|'llm' }
      manualReview: false,
      warnings:     [],
    },

    // ── Layer 1: 原始数据 ───────────────────────────────────
    raw: {
      product:     null,   // 爬虫返回的原始产品数据
      competitors: [],     // 竞品数组
      reviews:     [],     // { text, rating, date }[]
      qa:          [],     // { question, answer }[]
    },

    // ── Layer 2: 产品智能 ───────────────────────────────────
    product: {
      identity: {
        coreProduct:    null,
        brand:          null,
        modelNumber:    null,
        variantSignals: [],
      },
      archetype: {
        primary:    null,
        secondary:  [],
        confidence: null,
      },
      attributes: {
        dimensions:     { raw: [], parsed: [], source: null },
        materials:      { raw: [], source: null },
        colors:         { raw: [], source: null },
        capacity:       { raw: [], parsed: [], source: null },
        certifications: { raw: [], source: 'text' },
        safetyClaims:   { raw: [], source: null },
        specs:          { raw: [], source: null },
      },
      features:   [],
      useCases:   [],
      targetAudience: {
        demographic: [],
        situational: [],
      },
      imageAnalysis: {
        mainImage:        null,
        additionalImages: [],
        consistencyCheck: { colorMatch: null, materialMatch: null, conflicts: [] },
      },
    },

    // ── Layer 3: 市场智能 ───────────────────────────────────
    market: {
      keywords: {
        primary:     [],
        secondary:   [],
        backend:     [],
        sizeSignals: [],
        intentMap:   {},
        competitorCount: null,
      },
      competitors: {
        filtered:      [],
        filterApplied: false,
        qualityScore:  null,
        topFeatures:   [],
        titlePatterns: [],
        reviewStrength: null,
      },
      pricing: {
        targetPrice:  null,
        marketMin:    null,
        marketMax:    null,
        marketMedian: null,
        percentile:   null,
        band:         null,
        positioning:  null,
      },
    },

    // ── Layer 4: 平台智能 ───────────────────────────────────
    platform: {
      categoryMatch: {
        amazon:    { categoryPath: null, confidence: null },
        walmart:   { categoryId: null, categoryName: null, specTemplate: null, confidence: null },
        wayfair:   { classId: null, className: null, requiredSpecs: [], confidence: null },
        manualReviewNeeded: false,
      },
      compliance: {
        amazon:  { violations: [], implicit: [], riskLevel: null, factCheck: [] },
        walmart: { violations: [], riskLevel: null },
        wayfair: { violations: [], riskLevel: null },
      },
      activeConstraints: null,
    },

    // ── Layer 5: 转化引擎 ───────────────────────────────────
    conversion: {
      intent: {
        fromReviews:  [],
        fromQA:       [],
        fromFeatures: [],
        merged:       [],
      },
      painPoints:    [],
      hooks:         [],
      proof:         [],
      messages:      [],
      differentiation: {
        gaps:     [],
        usps:     [],
        strategy: null,
      },
      scores: {
        clarity:        null,
        emotion:        null,
        specificity:    null,
        differentiation: null,
        platformFit:   null,
        overall:        null,
      },
    },

    // ── Layer 6: 组合输出 ───────────────────────────────────
    composed: {
      amazon: {
        title:      null,
        titleChars: null,
        bullets:    [],
        backend:    null,
        byteCount:  null,
      },
      walmart: {
        title:       null,
        keyFeatures: [],
        description: null,
        attributes:  {},
        sanitized:   false,
      },
      wayfair: {
        title:      null,
        overview:   null,
        specs:      {},
        compliance: {},
      },
    },

    // ── Layer 7: 约束求解结果 ───────────────────────────────
    solved: {
      candidates:  [],
      selected:    {},
      iterations: 0,
      constraints: [],
    },

    // ── 诊断报告 ─────────────────────────────────────────────
    diagnosis: {
      qualityScore: null,
      qualityGrade: null,
      actionPlan:   [],
      pendingData:  [],
    },

    // ── 系统元数据 ──────────────────────────────────────────
    _meta: {
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      version:      '2.0.0',
      executionLog: [],
      checkpoints:  {},
    },

  };
}

// ── 读写工具 ──────────────────────────────────────────────────

function get(ctx, dotPath) {
  return dotPath.split('.').reduce(function(obj, key) {
    return (obj != null && obj[key] !== undefined) ? obj[key] : null;
  }, ctx);
}

function set(ctx, dotPath, value, source) {
  var parts = dotPath.split('.');
  var obj   = ctx;
  for (var i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;
  if (source) ctx.reliability.sources[dotPath] = source;
  ctx._meta.updatedAt = new Date().toISOString();
  return ctx;
}

function markMissing(ctx, dotPath, reason) {
  if (!ctx.reliability.missing.includes(dotPath)) {
    ctx.reliability.missing.push(dotPath);
  }
  if (reason) ctx.reliability.warnings.push('[missing] ' + dotPath + ': ' + reason);
  return ctx;
}

function setConfidence(ctx, dotPath, confidence) {
  ctx.reliability.scores[dotPath] = confidence;
  return ctx;
}

function logExecution(ctx, layer, module, status, duration, error) {
  ctx._meta.executionLog.push({
    layer:     layer,
    module:    module,
    status:    status,
    duration:  duration || 0,
    error:     error || null,
    timestamp: new Date().toISOString(),
  });
  return ctx;
}

function setCheckpoint(ctx, layerName) {
  ctx._meta.checkpoints[layerName] = new Date().toISOString();
  return ctx;
}

function hasCheckpoint(ctx, layerName) {
  return !!ctx._meta.checkpoints[layerName];
}

function flagManualReview(ctx, reason) {
  ctx.reliability.manualReview = true;
  ctx.reliability.warnings.push('[manual_review] ' + reason);
  return ctx;
}

function serialize(ctx) {
  return JSON.stringify(ctx, null, 2);
}

function deserialize(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
}

// ── 批量合并辅助（用于济南接多个竞品结果）─────────────────
function mergeRaw(ctx, newRaw) {
  if (!ctx.raw.product && newRaw.product) {
    set(ctx, 'raw.product', newRaw.product, 'scrape');
  }
  if (newRaw.competitors && newRaw.competitors.length > 0) {
    var existing = ctx.raw.competitors.map(function(c) { return c.asin; });
    var merged = ctx.raw.competitors.concat(
      newRaw.competitors.filter(function(c) { return !existing.includes(c.asin); })
    );
    ctx.raw.competitors = merged;
  }
  return ctx;
}

module.exports = {
  createContext,
  get,
  set,
  markMissing,
  setConfidence,
  logExecution,
  setCheckpoint,
  hasCheckpoint,
  flagManualReview,
  serialize,
  deserialize,
  mergeRaw,
};