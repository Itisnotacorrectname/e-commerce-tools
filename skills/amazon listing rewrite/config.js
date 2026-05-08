/**
 * core/config.js — Listing Engine v2
 *
 * 职责：全局配置。功能开关、权重参数、模型配置。
 * 支持通过环境变量覆盖任意配置项。
 */

'use strict';

var config = {

  // ── 功能开关 ────────────────────────────────────────────────
  features: {
    imageAnalysis:     true,   // 是否运行图片分析（需要 vision 模型）
    llmNormalization:  true,   // 是否运行 LLM 语义提取（useCases/targetAudience）
    categoryMatching:  true,   // 是否运行跨平台类目匹配
    reviewAnalysis:    false,  // 评论分析（爬虫就绪后开启）
    constraintSolver:  true,   // 是否运行约束求解迭代
  },

  // ── LLM 配置 ────────────────────────────────────────────────
  llm: {
    gateway: {
      host:  process.env.OPENCLAW_GATEWAY_HOST  || '127.0.0.1',
      port:  parseInt(process.env.OPENCLAW_GATEWAY_PORT) || 18789,
      token: process.env.OPENCLAW_GATEWAY_TOKEN || '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3',
    },
    models: {
      default:   process.env.LLM_MODEL_DEFAULT   || 'minimax/MiniMax-M2.7',
      embedding: process.env.LLM_MODEL_EMBEDDING || 'minimax/text-embedding-3',
      vision:    process.env.LLM_MODEL_VISION    || 'minimax/MiniMax-M2.7',
    },
    timeouts: {
      default:   90000,   // 90s
      embedding: 30000,
      vision:    60000,
    },
    retries: 2,
  },

  // ── 类目匹配权重（confidence scorer 公式）──────────────────
  // S = Wr*Sr + Wa*Sa + Wv*Sv
  // 规则权重 > 属性对齐权重 > 向量相似度权重
  categoryMatch: {
    weights: {
      rule:      0.50,   // Wr：确定性规则命中
      attribute: 0.30,   // Wa：属性重合度
      vector:    0.20,   // Wv：语义向量相似度
    },
    thresholds: {
      accept:      0.70,  // >= 0.70 自动接受
      manualReview: 0.50, // 0.50-0.69 标记人工审核
      reject:      0.50,  // < 0.50 触发 fallback
    },
    topN: 5,  // 向量初筛取前 N 个候选
  },

  // ── 竞品抓取配置 ────────────────────────────────────────────
  competitors: {
    maxTotal:           60,
    maxPerRound:        30,
    minRequired:        5,    // 少于此数触发 fallback 搜索
    fallbackTerms:      5,    // 最多尝试几个 fallback 搜索词
    filterThreshold:    0.30, // 过滤掉超过 (1-threshold) 比例触发安全阀
    qualityMinRatio:    0.40, // 竞品质量评分低于此值触发重搜
  },

  // ── 平台输出限制 ────────────────────────────────────────────
  platforms: {
    amazon: {
      titleMaxChars:   200,
      titleIdealChars: [100, 180],
      bulletMaxChars:  500,
      bulletCount:     5,
      backendMaxBytes: 250,
    },
    walmart: {
      titleMaxChars:   75,
      titleIdealChars: [50, 75],
      bulletMaxChars:  80,
      bulletMin:       3,
      bulletMax:       10,
      descMinWords:    150,
      descIdealWords:  [400, 600],
    },
    wayfair: {
      titleMaxChars:   70,
      titleIdealChars: [40, 70],
      descMinWords:    200,
    },
  },

  // ── 质量评分权重 ────────────────────────────────────────────
  qualityScore: {
    title:          20,
    bullets:        25,
    cosmo:          15,
    backend:        10,
    violations:     10,
    weight:         15,
    usp:             5,
  },

  // ── Cosmo 评分约束 ──────────────────────────────────────────
  cosmo: {
    validScores:    [0, 3, 5],   // 只允许这三个值
    minQuestions:   3,
    maxQuestions:   3,
  },

  // ── 约束求解器 ──────────────────────────────────────────────
  solver: {
    maxIterations:  3,     // 最多迭代次数
    minScoreTarget: 0.80,  // 目标最低分
  },

};

// ── 环境变量覆盖 ──────────────────────────────────────────────
if (process.env.DISABLE_IMAGE_ANALYSIS === 'true') config.features.imageAnalysis = false;
if (process.env.DISABLE_LLM === 'true') {
  config.features.llmNormalization = false;
  config.features.categoryMatching = false;
}

module.exports = config;
