/**
 * layer3_market/index.js — Market Intelligence Layer
 */
'use strict';

const keywordEngine = require('../engines/keyword_engine.js');
const http          = require('http');
const config        = require('../core/config.js');

// ── scrapeCompetitors ─────────────────────────────────────────
// 竞品已由 layer1 从 step4.json 读入 context.raw.competitors
// 这里做过滤和质量评估
async function scrapeCompetitors(context) {
  var raw         = context.raw.competitors || [];
  var step4       = context._step4 || {};
  var coreProduct = (context.product.identity && context.product.identity.coreProduct) || '';

  if (raw.length === 0) {
    console.error('[layer3] No competitors in context.raw.competitors — market analysis limited');
    context.market.competitors.filtered    = [];
    context.market.competitors.filterApplied = false;
    return context;
  }

  context.market.competitors.filtered      = raw;
  context.market.competitors.filterApplied = step4.filterApplied || false;
  context.market.competitors.qualityScore  = step4.filteredCompetitorCount
    ? step4.filteredCompetitorCount / (step4.originalCompetitorCount || step4.filteredCompetitorCount)
    : 1.0;

  console.error('[layer3] competitors: ' + raw.length + ' (quality: ' +
    (context.market.competitors.qualityScore * 100).toFixed(0) + '%)');

  return context;
}

// ── analyzeCompetitors ────────────────────────────────────────
function analyzeCompetitors(context) {
  var competitors = context.market.competitors.filtered || [];
  if (competitors.length === 0) return context;

  // 高频特征词提取
  var featureFreq = {};
  competitors.forEach(function(c) {
    if (!c.title) return;
    var title = c.title.toLowerCase();
    // 提取括号内的特征词（如 "No Box Spring Needed"）
    var bracketMatches = title.match(/\(([^)]+)\)/g) || [];
    bracketMatches.forEach(function(m) {
      var phrase = m.replace(/[()]/g, '').trim();
      if (phrase.length > 5 && phrase.split(' ').length <= 4) {
        featureFreq[phrase] = (featureFreq[phrase] || 0) + 1;
      }
    });
  });

  context.market.competitors.topFeatures = Object.keys(featureFreq)
    .filter(function(f) { return featureFreq[f] >= 3; })
    .sort(function(a, b) { return featureFreq[b] - featureFreq[a]; })
    .slice(0, 10);

  // 标题结构模式（取前三节点）
  var patterns = {};
  competitors.forEach(function(c) {
    if (!c.title) return;
    var nodes = c.title.split(/[,–—]/)[0].trim().split(/\s+/).slice(0, 4).join(' ');
    patterns[nodes] = (patterns[nodes] || 0) + 1;
  });
  context.market.competitors.titlePatterns = Object.keys(patterns)
    .sort(function(a, b) { return patterns[b] - patterns[a]; })
    .slice(0, 5);

  // 评论强度
  var reviewData = competitors.filter(function(c) { return c.reviews || c.reviewCount; });
  if (reviewData.length > 0) {
    var avgReviews = reviewData.reduce(function(s, c) {
      var n = parseInt(String(c.reviews || c.reviewCount || '0').replace(/[^0-9]/g, '')) || 0;
      return s + n;
    }, 0) / reviewData.length;
    context.market.competitors.reviewStrength = Math.round(avgReviews);
  }

  return context;
}

// ── collectKeywords ───────────────────────────────────────────
function collectKeywords(context) {
  var competitors = context.market.competitors.filtered || [];
  if (competitors.length === 0) {
    console.error('[layer3] No competitors for keyword analysis');
    return context;
  }

  // 复用现有 keyword_engine
  var tempSchema = {
    raw:      context.raw.product || {},
    identity: context.product.identity || {},
    keywords: { primary: [], secondary: [], backend: [], sizeSignals: [], competitorCount: 0 },
  };

  var step4Data = { filteredCompetitors: competitors, competitors: competitors };
  var result    = keywordEngine.run(tempSchema, step4Data);

  context.market.keywords.primary         = result.keywords.primary;
  context.market.keywords.secondary       = result.keywords.secondary;
  context.market.keywords.backend         = result.keywords.backend;
  context.market.keywords.sizeSignals     = result.keywords.sizeSignals;
  context.market.keywords.competitorCount = result.keywords.competitorCount;

  return context;
}

// ── mapKeywordIntent ──────────────────────────────────────────
// 把关键词映射到买家意图（purchase/research/pain_relief/comparison/gifting）
async function mapKeywordIntent(context) {
  var primary   = context.market.keywords.primary || [];
  var secondary = context.market.keywords.secondary || [];

  if (primary.length === 0) return context;

  // 规则层快速分类（不需要 LLM）
  var INTENT_RULES = {
    purchase:    /\b(?:buy|order|cheap|affordable|deal|best price|free shipping)\b/i,
    pain_relief: /\b(?:back pain|neck pain|hot sleeper|snoring|insomnia|ache|support)\b/i,
    comparison:  /\b(?:vs|versus|compare|difference|better|alternative|review)\b/i,
    gifting:     /\b(?:gift|birthday|christmas|holiday|anniversary|present)\b/i,
    research:    /\b(?:how to|what is|guide|type|kind|best|top|review)\b/i,
  };

  var intentMap = {};
  primary.concat(secondary).forEach(function(k) {
    var kw = typeof k === 'string' ? k : k.keyword;
    var intent = 'purchase';  // 默认
    Object.keys(INTENT_RULES).forEach(function(i) {
      if (INTENT_RULES[i].test(kw)) intent = i;
    });
    intentMap[kw] = intent;
  });

  context.market.keywords.intentMap = intentMap;
  return context;
}

// ── analyzePricing ────────────────────────────────────────────
function analyzePricing(context) {
  var competitors = context.market.competitors.filtered || [];
  var targetPrice = context.raw.product && context.raw.product.price;

  if (competitors.length === 0 || !targetPrice) {
    context.market.pricing.targetPrice = targetPrice;
    return context;
  }

  // 解析竞品价格
  var prices = competitors
    .map(function(c) {
      var p = parseFloat(String(c.price || '').replace(/[^0-9.]/g, ''));
      return isNaN(p) ? null : p;
    })
    .filter(function(p) { return p !== null && p > 0; })
    .sort(function(a, b) { return a - b; });

  if (prices.length === 0) return context;

  var min    = prices[0];
  var max    = prices[prices.length - 1];
  var median = prices[Math.floor(prices.length / 2)];
  var pct    = Math.round(prices.filter(function(p) { return p <= targetPrice; }).length / prices.length * 100);

  var band   = pct >= 75 ? 'premium' : pct >= 35 ? 'mid' : 'budget';

  var positioning;
  if (pct >= 90) {
    positioning = '价格处于市场 Top ' + (100 - pct) + '%，需要在 listing 中明确差异化依据';
  } else if (pct >= 60) {
    positioning = '中高端定位（第 ' + pct + ' 百分位），突出核心差异点以支撑溢价';
  } else if (pct >= 35) {
    positioning = '市场中段（第 ' + pct + ' 百分位），关键词覆盖和内容质量是核心竞争手段';
  } else {
    positioning = '价格竞争优势明显（低于 ' + (100 - pct) + '% 竞品），强调性价比';
  }

  context.market.pricing = {
    targetPrice:  targetPrice,
    marketMin:    min,
    marketMax:    max,
    marketMedian: median,
    percentile:   pct,
    band:         band,
    positioning:  positioning,
  };

  console.error('[layer3] pricing: $' + targetPrice + ' at ' + pct + 'th percentile (' + band + ')');
  return context;
}

module.exports = {
  scrapeCompetitors,
  analyzeCompetitors,
  collectKeywords,
  mapKeywordIntent,
  analyzePricing,
};
