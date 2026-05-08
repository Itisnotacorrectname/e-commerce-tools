/**
 * layer1_data/index.js
 * Data ingestion layer — scrape product from Amazon using universal-scraper lib
 */
'use strict';

const path = require('path');

// The universal-scraper skill is at workspace/skills/
const SCRAPER_DIR = 'C:/Users/csbd/.openclaw/workspace/skills/universal-scraper - v2.0';

async function scrapeProduct(ctx) {
  const asin = ctx.input.asin || ctx.input.url;
  if (!asin) return ctx;

  try {
    const scraperCore = require(path.join(SCRAPER_DIR, 'lib', 'scraper_core.js'));
    const marketplaces = require(path.join(SCRAPER_DIR, 'lib', 'marketplaces.js'));
    const extractAmazon = require(path.join(SCRAPER_DIR, 'lib', 'extract_amazon.js'));

    const cc = ctx.input.marketplace || 'US';
    const config = marketplaces.getConfig('amazon', cc);
    const url = marketplaces.buildProductUrl('amazon', asin, cc);

    console.error('[layer1] Launching browser for:', url);
    const browser = await scraperCore.launchBrowser('amazon', config);
    const productData = await scraperCore.scrapePage(browser, url, {
      platform: 'amazon', cc, config, timeout: 60000
    });

    let data = extractAmazon.extractProduct(productData.html, productData.url || url, config);
    data.url = productData.url;
    data.htmlLength = productData.htmlLength;

    // Extract images
    const imgPage = await browser.newPage();
    await imgPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await imgPage.waitForTimeout(3000);
    await scraperCore.scrollPage(imgPage, 2000);
    const imgData = await extractAmazon.extractImages(imgPage);
    data.images = { thumbnails: imgData.thumbnails, hiRes: imgData.hiRes, total: imgData.total };
    await imgPage.close();

    await browser.close();

    ctx.raw.product = data;
    ctx.reliability.sources['raw.product'] = 'scraper';
    console.error('[layer1] Scraped:', asin, '| HTML:', productData.htmlLength, 'bytes');

  } catch(e) {
    ctx.reliability.warnings.push('[layer1.scrape_product] ' + e.message);
    ctx.reliability.manualReview = true;
    console.error('[layer1] Scrape failed:', e.message);
  }
  return ctx;
}

async function clean(ctx) {
  const raw = ctx.raw.product;
  if (!raw) return ctx;
  if (typeof raw.bullets === 'string') {
    raw.bullets = raw.bullets.split('\n').filter(Boolean);
  }
  if (raw.price) {
    const m = String(raw.price).match(/[\d,]+\.?\d*/);
    if (m) raw.price = parseFloat(m[0].replace(/,/g, ''));
  }
  return ctx;
}

async function importReviews(ctx, reviewsPath) {
  if (reviewsPath) {
    try {
      const fs = require('fs');
      const data = JSON.parse(fs.readFileSync(reviewsPath, 'utf8'));
      ctx.raw.reviews = Array.isArray(data) ? data : [];
    } catch(e) {
      ctx.reliability.warnings.push('[layer1.import_reviews] ' + e.message);
    }
  }
  return ctx;
}

module.exports = { scrapeProduct, clean, importReviews };