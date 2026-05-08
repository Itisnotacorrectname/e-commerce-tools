/**
 * core/config.js — Listing Engine v2.0
 *
 * 全局配置：功能开关 / LLM / 平台约束 / 权重参数
 */

'use strict';

var config = {

  // ── 功能开关 ────────────────────────────────────────────────
  features: {
    imageAnalysis:    true,   // 图片分析（需 vision 模型）
    llmNormalization: false, // LLM 语义层（useCases/targetAudience），默认关闭
    categoryMatching: true,   // 跨平台类目匹配
    reviewAnalysis:   false,  // 评论分析（爬虫就绪后开启）
    constraintSolver: true,   // 约束求解迭代
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
      default:   90000,
      embedding: 30000,
      vision:    60000,
    },
    retries: 2,
  },

  // ── 竞品配置 ────────────────────────────────────────────────
  competitors: {
    maxTotal:        60,
    maxPerRound:     30,
    minRequired:     5,
    fallbackTerms:  5,
    filterThreshold: 0.30,
    qualityMinRatio: 0.40,
  },

  // ── 各平台输出限制 ─────────────────────────────────────────
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

  // ── 质量评分权重 ───────────────────────────────────────────
  qualityScore: {
    title:          20,
    bullets:        25,
    cosmo:          15,
    backend:        10,
    violations:     10,
    weight:         15,
    usp:             5,
  },

  // ── Cosmo 评分约束 ─────────────────────────────────────────
  cosmo: {
    validScores:  [0, 3, 5],
    minQuestions: 3,
    maxQuestions: 3,
  },

  // ── 约束求解器 ──────────────────────────────────────────────
  solver: {
    maxIterations:  3,
    minScoreTarget: 0.80,
  },

};

// ── 环境变量覆盖 ──────────────────────────────────────────────
if (process.env.DISABLE_IMAGE_ANALYSIS === 'true')  config.features.imageAnalysis    = false;
if (process.env.DISABLE_LLM === 'true')             config.features.llmNormalization = false;

module.exports = config;