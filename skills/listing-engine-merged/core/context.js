/**
 * core/context.js — Listing Engine v2
 *
 * 职责：全局数据总线。所有 layer 通过 context 读写数据，不直接互相调用。
 *
 * 设计原则：
 *   - 单一数据源：所有中间结果都在这里
 *   - 不可变历史：每次写入都记录来源和时间戳
 *   - 显式缺失：未填充的字段明确标注为 null，不用 undefined
 *   - 可序列化：整个 context 可以 JSON.stringify 存档/恢复
 */

'use strict';

// ── Context 结构定义 ──────────────────────────────────────────
function createContext(input) {
  return {

    // ── 输入参数 ────────────────────────────────────────────
    input: {
      url:         input.url         || null,
      asin:        input.asin        || null,
      platform:    input.platform    || 'amazon',   // 目标平台
      marketplace: input.marketplace || 'US',
      mode:        input.mode        || 'diagnose', // diagnose | generate | transform
      sourcePlatform: input.sourcePlatform || null, // transform 模式的来源平台
      targetPlatform: input.targetPlatform || null, // transform 模式的目标平台
      options:     input.options     || {},
    },

    // ── Layer 0: 可靠性元数据 ───────────────────────────────
    reliability: {
      scores:       {},    // { fieldPath: confidence 0-1 }
      missing:      [],    // string[]，缺失字段路径列表
      sources:      {},    // { fieldPath: 'title'|'bullet_N'|'image'|'llm'|'manual' }
      manualReview: false, // 是否需要人工审核
      warnings:     [],    // string[]，非阻断性警告
    },

    // ── Layer 1: 原始数据 ───────────────────────────────────
    raw: {
      // 目标产品
      product:     null,   // 爬虫返回的原始产品数据（step2.json 结构）
      // 竞品
      competitors: [],     // 爬虫返回的原始竞品数组
      // 评论（可手动导入或爬虫抓取）
      reviews:     [],     // { text, rating, date }[]
      // Q&A
      qa:          [],     // { question, answer }[]
    },

    // ── Layer 2: 产品智能 ───────────────────────────────────
    product: {
      // 核心识别
      identity: {
        coreProduct:    null,   // string
        brand:          null,   // string
        modelNumber:    null,   // string | null
        variantSignals: [],     // string[]
      },
      // Archetype（产品结构类型）
      archetype: {
        primary:    null,   // 'dimension_based'|'spec_heavy'|'variant_heavy'|
                            // 'feature_dominant'|'bundle'|'consumable'|
                            // 'compatibility'|'emotional'
        secondary:  [],     // string[]
        confidence: null,   // 0-1
      },
      // 通用属性
      attributes: {
        dimensions:     { raw: [], parsed: [], source: null },
        materials:      { raw: [], source: null },
        colors:         { raw: [], source: null },
        capacity:       { raw: [], parsed: [], source: null },
        certifications: { raw: [], source: 'text' },
        safetyClaims:   { raw: [], source: null },
        specs:          { raw: [], source: null },
      },
      // 功能特征（结构化提取，100%可验证）
      features:   [],   // { text, category, source, verified }[]
      // 使用场景（LLM推断，带置信度）
      useCases:   [],   // { label, confidence, evidence[], source }[]
      // 目标用户
      targetAudience: {
        demographic:  [],  // { label, confidence, evidence[] }[]
        situational:  [],  // { label, confidence, evidence[] }[]
      },
      // 图片分析
      imageAnalysis: {
        mainImage:          null,  // 分析结果对象
        additionalImages:   [],
        consistencyCheck:   { colorMatch: null, materialMatch: null, conflicts: [] },
      },
    },

    // ── Layer 3: 市场智能 ───────────────────────────────────
    market: {
      // 关键词
      keywords: {
        primary:         [],   // { keyword, freq, note }[]
        secondary:       [],
        backend:         [],   // string[]
        sizeSignals:     [],
        intentMap:       {},   // { keyword: 'purchase'|'research'|'pain_relief'|... }
        competitorCount: null,
      },
      // 竞品分析
      competitors: {
        filtered:        [],   // 过滤后的竞品列表
        filterApplied:   false,
        qualityScore:    null, // 0-1，竞品相关性评分
        topFeatures:     [],   // 竞品高频功能特征
        titlePatterns:   [],   // 竞品标题结构模式
        reviewStrength:  null, // 竞品平均评论数/评分
      },
      // 价格定位
      pricing: {
        targetPrice:  null,
        marketMin:    null,
        marketMax:    null,
        marketMedian: null,
        percentile:   null,   // 目标产品在市场中的百分位
        band:         null,   // 'budget'|'mid'|'premium'
        positioning:  null,   // 定位建议文字
      },
    },

    // ── Layer 4: 平台智能 ───────────────────────────────────
    platform: {
      // 类目匹配结果
      categoryMatch: {
        amazon:  { categoryPath: null, confidence: null },
        walmart: { categoryId: null, categoryName: null, specTemplate: null, confidence: null },
        wayfair: { classId: null, className: null, requiredSpecs: [], confidence: null },
        manualReviewNeeded: false,
      },
      // 平台规则校验结果（每个平台独立）
      compliance: {
        amazon:  { violations: [], implicit: [], riskLevel: null, factCheck: [] },
        walmart: { violations: [], riskLevel: null },
        wayfair: { violations: [], riskLevel: null },
      },
      // 当前目标平台的约束（从配置文件读取）
      activeConstraints: null,
    },

    // ── Layer 5: 转化引擎 ───────────────────────────────────
    conversion: {
      // 意图分析
      intent: {
        fromReviews:  [],  // { intent, sentiment, confidence, sourceReview }[]
        fromQA:       [],  // { intent, confidence, sourceQA }[]
        fromFeatures: [],  // { intent, confidence }[]
        merged:       [],  // 合并去重后的最终意图列表
      },
      // 痛点
      painPoints: [],  // { pain, intensity, evidence[] }[]
      // 情绪钩子
      hooks: [],       // { type: 'outcome'|'removal'|'scenario', text, targetIntent }[]
      // 信任信号
      proof: [],       // { type: 'material'|'cert'|'spec'|'social', text, source }[]
      // 消息组合（hook + proof → message）
      messages: [],    // { message, hook, proof, intent, score }[]
      // 差异化
      differentiation: {
        gaps:       [],  // 竞品缺失但本品有的特征
        usps:       [],  // 独特卖点
        strategy:   null, // 'premium'|'budget'|'performance'|'comfort'|'lifestyle'
      },
      // 评分维度
      scores: {
        clarity:        null,
        emotion:        null,
        specificity:    null,
        differentiation: null,
        platformFit:    null,
        overall:        null,
      },
    },

    // ── Layer 6: 组合输出 ───────────────────────────────────
    composed: {
      amazon: {
        title:      null,   // string
        titleChars: null,   // number
        bullets:    [],     // string[]
        backend:    null,   // string
        byteCount:  null,
      },
      walmart: {
        title:            null,
        keyFeatures:      [],  // max 10 items, max 80 chars each
        description:      null,
        attributes:       {},  // 填充好的属性表
        sanitized:        false, // 是否已过禁用词
      },
      wayfair: {
        title:       null,
        overview:    null,   // 三段式概述
        specs:       {},     // 属性规格
        compliance:  {},     // Prop65/TSCA等合规声明
      },
    },

    // ── Layer 7: 约束求解结果 ────────────────────────────────
    solved: {
      candidates:   [],    // 多个候选版本 { platform, field, text, score }[]
      selected:     {},    // 最终选定版本 { platform: { field: text } }
      iterations:   0,     // 求解迭代次数
      constraints:  [],    // 应用的约束列表
    },

    // ── 诊断报告（Amazon Listing Doctor 兼容层）────────────
    diagnosis: {
      qualityScore: null,
      qualityGrade: null,
      actionPlan:   [],    // { priority, action, location, impact, execType }[]
      pendingData:  [],    // { dataType, usedFor, purpose }[]
    },

    // ── 系统元数据 ──────────────────────────────────────────
    _meta: {
      createdAt:    new Date().toISOString(),
      updatedAt:    new Date().toISOString(),
      version:      '2.0.0',
      executionLog: [],    // { layer, module, status, duration, error }[]
      checkpoints:  {},    // { layerName: timestamp }，用于断点续跑
    },

  };
}

// ── 读写接口 ──────────────────────────────────────────────────

// 深度读取（支持点路径，如 'product.attributes.materials.raw'）
function get(ctx, dotPath) {
  return dotPath.split('.').reduce(function(obj, key) {
    return (obj != null && obj[key] !== undefined) ? obj[key] : null;
  }, ctx);
}

// 深度写入（支持点路径）
function set(ctx, dotPath, value, source) {
  var parts = dotPath.split('.');
  var obj   = ctx;
  for (var i = 0; i < parts.length - 1; i++) {
    if (obj[parts[i]] == null) obj[parts[i]] = {};
    obj = obj[parts[i]];
  }
  obj[parts[parts.length - 1]] = value;

  // 记录来源
  if (source) ctx.reliability.sources[dotPath] = source;
  ctx._meta.updatedAt = new Date().toISOString();

  return ctx;
}

// 标记字段缺失
function markMissing(ctx, dotPath, reason) {
  if (!ctx.reliability.missing.includes(dotPath)) {
    ctx.reliability.missing.push(dotPath);
  }
  if (reason) {
    ctx.reliability.warnings.push('[missing] ' + dotPath + ': ' + reason);
  }
  return ctx;
}

// 设置置信度
function setConfidence(ctx, dotPath, confidence) {
  ctx.reliability.scores[dotPath] = confidence;
  return ctx;
}

// 记录执行日志
function logExecution(ctx, layer, module, status, duration, error) {
  ctx._meta.executionLog.push({
    layer:     layer,
    module:    module,
    status:    status,     // 'success'|'failed'|'skipped'
    duration:  duration,   // ms
    error:     error || null,
    timestamp: new Date().toISOString(),
  });
  return ctx;
}

// 设置断点（用于断点续跑）
function setCheckpoint(ctx, layerName) {
  ctx._meta.checkpoints[layerName] = new Date().toISOString();
  return ctx;
}

// 检查某层是否已完成
function hasCheckpoint(ctx, layerName) {
  return !!ctx._meta.checkpoints[layerName];
}

// 标记需要人工审核
function flagManualReview(ctx, reason) {
  ctx.reliability.manualReview = true;
  ctx.reliability.warnings.push('[manual_review] ' + reason);
  return ctx;
}

// 序列化（存档）
function serialize(ctx) {
  return JSON.stringify(ctx, null, 2);
}

// 反序列化（恢复）
function deserialize(json) {
  return typeof json === 'string' ? JSON.parse(json) : json;
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
};
