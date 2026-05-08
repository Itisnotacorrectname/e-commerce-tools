/**
 * layer3_market/index.js
 * Market intelligence: scrape competitors / analyze / collect keywords / map intent / analyze pricing
 */
'use strict';

async function scrapeCompetitors(ctx) {
  // Simplified: use keyword-based competitor scraping
  const raw = ctx.raw.product || {};
  const keyword = ctx.product?.identity?.coreProduct || raw.title || '';
  ctx.market = ctx.market || {};
  ctx.market.competitors = { filtered: [], filterApplied: false, qualityScore: null, topFeatures: [], titlePatterns: [], reviewStrength: null };
  ctx.market.keywords = { primary: [], secondary: [], backend: [], sizeSignals: [], intentMap: {}, competitorCount: 0 };
  console.error('[layer3] scrapeCompetitors: keyword="' + keyword + '"');
  return ctx;
}

async function analyzeCompetitors(ctx) {
  return ctx;
}

async function collectKeywords(ctx) {
  const raw = ctx.raw.product || {};
  const title = raw.title || '';
  const bullets = raw.bullets || [];

  // Extract keywords from title + bullets using simple frequency analysis
  const stopWords = new Set(['the', 'a', 'an', 'for', 'and', 'or', 'with', 'in', 'on', 'to', 'of', 'is', 'it', 'this', 'that', 'your', 'you']);
  const words = (title + ' ' + bullets.join(' '))
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  const freq = {};
  words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });

  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  ctx.market.keywords.primary = sorted.slice(0, 10).map(([keyword, freq]) => ({ keyword, freq }));
  ctx.market.keywords.competitorCount = ctx.raw.competitors ? ctx.raw.competitors.length : 0;
  console.error('[layer3] collectKeywords: ' + sorted.length + ' unique words');
  return ctx;
}

async function mapKeywordIntent(ctx) {
  ctx.market.keywords.intentMap = {};
  return ctx;
}

async function analyzePricing(ctx) {
  const raw = ctx.raw.product || {};
  const price = raw.price || 0;
  const competitors = ctx.market.competitors.filtered || [];

  // Calculate percentile if we have competitor prices
  let percentile = null, marketMin = null, marketMax = null, marketMedian = null, band = null, positioning = null;

  if (competitors.length > 0) {
    const prices = competitors.map(function(c) {
      var m = String(c.price || '').match(/[\d,]+\.?\d*/);
      return m ? parseFloat(m[0].replace(/,/g, '')) : null;
    }).filter(function(p) { return p !== null && p > 0; });

    if (prices.length > 0) {
      marketMin = Math.min.apply(null, prices);
      marketMax = Math.max.apply(null, prices);
      prices.sort(function(a, b) { return a - b; });
      var mid = Math.floor(prices.length / 2);
      marketMedian = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];

      if (price > 0) {
        var below = prices.filter(function(p) { return p <= price; }).length;
        percentile = Math.round((below / prices.length) * 100);
      }
    }
  } else {
    // No competitor data — set default percentile 50 (unknown position)
    percentile = 50;
  }

  // Band classification
  if (percentile !== null && marketMin !== null && marketMax !== null) {
    if (percentile <= 25) band = 'budget';
    else if (percentile <= 75) band = 'mid-market';
    else band = 'premium';
  }

  // Positioning relative to median
  if (price > 0 && marketMedian !== null) {
    positioning = price < marketMedian ? 'below-median' : price > marketMedian ? 'above-median' : 'at-median';
  }

  ctx.market.pricing = {
    targetPrice: price,
    marketMin:   marketMin,
    marketMax:   marketMax,
    marketMedian: marketMedian,
    percentile:  percentile,
    band:        band,
    positioning: positioning,
  };
  return ctx;
}

module.exports = { scrapeCompetitors, analyzeCompetitors, collectKeywords, mapKeywordIntent, analyzePricing };
