/**
 * lib/amazon_scraper.js
 * ====================
 * 通用 Amazon 爬虫核心 — 基于 amazon-universal-scraper 的成功模式
 * 
 * 关键 anti-bot 技术：
 * 1. handleInterstitial — 检测并点击 "Continue shopping" / "Weiter einkaufen" 弹窗
 * 2. changeDeliveryAddress — 操作 ZIP widget，触发 reload 解锁 geo 锁定
 * 3. cookieInject — fallback 方式（ZIP 失败时使用）
 * 4. 充分的等待时间（6000ms）确保页面完全渲染
 *
 * Usage:
 *   const { scrapeProductPage, scrapeCompetitorSearch } = require('./lib/amazon_scraper.js');
 */
const { chromium } = require('playwright');
const cheerio = require('cheerio');

// ── Marketplace Config ─────────────────────────────────────────
const MARKETPLACE_CONFIG = {
  'US': { domain: '.amazon.com',   currency: 'USD', locale: 'en_US', zip: '10001', name: 'United States' },
  'DE': { domain: '.amazon.de',   currency: 'EUR', locale: 'de_DE', zip: '10115', name: 'Germany' },
  'GB': { domain: '.amazon.co.uk', currency: 'GBP', locale: 'en_GB', zip: 'SW1A 1AA', name: 'United Kingdom' },
  'FR': { domain: '.amazon.fr',   currency: 'EUR', locale: 'fr_FR', zip: '75001', name: 'France' },
  'IT': { domain: '.amazon.it',   currency: 'EUR', locale: 'it_IT', zip: '00100', name: 'Italy' },
  'ES': { domain: '.amazon.es',   currency: 'EUR', locale: 'es_ES', zip: '28001', name: 'Spain' },
  'JP': { domain: '.amazon.co.jp', currency: 'JPY', locale: 'ja_JP', zip: '100-0001', name: 'Japan' },
  'CA': { domain: '.amazon.ca',   currency: 'CAD', locale: 'en_CA', zip: 'M1A 1A0', name: 'Canada' },
  'AU': { domain: '.amazon.com.au', currency: 'AUD', locale: 'en_AU', zip: '2000', name: 'Australia' },
};

const DOMAIN_MAP = {
  'US': 'amazon.com', 'DE': 'amazon.de', 'GB': 'amazon.co.uk',
  'FR': 'amazon.fr',  'IT': 'amazon.it',  'ES': 'amazon.es',
  'JP': 'amazon.co.jp', 'CA': 'amazon.ca', 'AU': 'amazon.com.au'
};

const DEFAULT_TIMEOUT = 30000;
const GENERIC_SINGLE_WORD_BLACKLIST = new Set([
  'shower','bathroom','bedroom','kitchen','home','furniture','decor','household',
  'living','dining','office','garden','outdoor','floor','wall','walls',
  'room','up','bar','top','best','new','pro','plus','max','mini',
  'product','item','unit'
]);
const STOPWORDS = new Set([
  'the','and','for','with','from','this','that','is','are','was','it','be',
  'to','in','on','of','a','an','by','or','as','at','your','you',
  'not','but','can','all','one','two','three','four','five','six',
  'new','use','used','best','top','more','most','only','easy','free','fast','safe',
  'large','small','mini','max','plus','pro','prime','extra','ultra','super'
]);

// ── Browser Launcher ─────────────────────────────────────────
function createBrowser(cc) {
  // 所有市场都用 headless: false — Amazon 搜索页反爬会拦截 headless Playwright
  return chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
  });
}

function createPageContext(cc) {
  const config = MARKETPLACE_CONFIG[cc] || MARKETPLACE_CONFIG['US'];
  return {
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptLang: config.locale + ',en;q=0.9',
    locale: config.locale,
    timezoneId: 'America/New_York'
  };
}

// ── Anti-Bot: Interstitial/CAPTCHA Handler ───────────────────
// Based on amazon-universal-scraper/lib/amazon_price.js handleInterstitial
async function handleInterstitial(page) {
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      var hasInter = await page.evaluate(function() {
        return document.body.textContent.indexOf('Continue shopping') !== -1 ||
               document.body.textContent.indexOf('Klicke') !== -1 ||
               document.body.textContent.indexOf('Weiter einkaufen') !== -1 ||
               document.body.textContent.indexOf('Click the button below') !== -1 ||
               document.body.textContent.indexOf('Schaltfläche') !== -1;
      });
      if (!hasInter) return;
      var btn = await page.$('button.a-button-text');
      if (btn) {
        await btn.click();
        await page.waitForTimeout(5000);
        break;
      }
      await page.waitForTimeout(1000);
    }
  } catch(e) { /* best-effort */ }
}

// ── Anti-Bot: Cookie Injection ───────────────────────────────
async function cookieInject(page, config) {
  try {
    await page.evaluate(function(conf) {
      document.cookie = 'i18n-prefs=' + conf.currency + '; path=/; domain=' + conf.domain;
      document.cookie = 'lc-main=' + conf.locale + '; path=/; domain=' + conf.domain;
    }, config);
  } catch(e) { /* best-effort */ }
}

// ── Anti-Bot: ZIP Delivery Address Change ───────────────────
// Based on amazon-universal-scraper/lib/amazon_price.js changeDeliveryAddress
async function changeDeliveryAddress(page, config) {
  try {
    // Wait for widget (up to 6s)
    var widgetFound = false;
    for (var attempt = 0; attempt < 6; attempt++) {
      widgetFound = await page.evaluate(function() {
        return !!document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt');
      });
      if (widgetFound) break;
      await page.waitForTimeout(1000);
    }
    if (!widgetFound) return false;

    var btn = await page.$('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt');
    if (!btn) return false;

    await btn.click();
    await page.waitForTimeout(4000);

    var zipInput = await page.$('#GLUXZipUpdateInput');
    if (!zipInput) return false;

    await zipInput.fill(config.zip);
    await page.waitForTimeout(800);

    var applyBtn = await page.$('#GLUXZipUpdate');
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(5000);
    }
    return true;
  } catch(e) {
    return false;
  }
}

// ── ZIP+Reload for US ─────────────────────────────────────────
// ── Set Delivery Address + Reload (search pages, US only) ───────────────────────
// Based on amazon-universal-scraper/lib/amazon_search.js setLocalDeliveryAndReload.
async function scrapeSetDeliveryAndReload(page, config, timeout) {
  try {
    var widgetFound = false;
    for (var attempt = 0; attempt < 6; attempt++) {
      widgetFound = await page.evaluate(function() {
        return !!document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt, #glow-ingress-block');
      });
      if (widgetFound) break;
      await page.waitForTimeout(1000);
    }
    if (!widgetFound) {
      await cookieInject(page, config);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
      await page.waitForTimeout(6000);
      return;
    }
    var addrBtn = await page.$('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt, #glow-ingress-block');
    await addrBtn.click();
    await page.waitForTimeout(4000);
    var zInput = await page.$('#GLUXZipUpdateInput');
    if (!zInput) {
      await page.keyboard.press('Escape');
      await cookieInject(page, config);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
      await page.waitForTimeout(6000);
      return;
    }
    await zInput.fill(config.zip);
    await page.waitForTimeout(800);
    var aplBtn = await page.$('#GLUXZipUpdate');
    if (aplBtn) { await aplBtn.click(); await page.waitForTimeout(5000); }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
    await page.waitForTimeout(6000);
  } catch(e) {
    try {
      await cookieInject(page, config);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
      await page.waitForTimeout(6000);
    } catch(e2) {}
  }
}

async function zipAndReload(page, config, timeout) {
  const zipWorked = await changeDeliveryAddress(page, config);
  if (zipWorked) {
    // Verify ZIP applied
    var zipVerified = false;
    for (var v = 0; v < 8; v++) {
      var dtText = await page.evaluate(function() {
        var w = document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPtLabel');
        return w ? w.textContent.trim() : '';
      });
      if (dtText.indexOf(config.zip.substring(0, 2)) !== -1 ||
          dtText.indexOf('United States') !== -1 ||
          dtText.indexOf('New York') !== -1) {
        zipVerified = true;
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!zipVerified) {
      // ZIP not verified — fallback to cookie + reload
      await cookieInject(page, config);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
      await page.waitForTimeout(6000);
      return 'cookie';
    } else {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(3000);
      return 'zip';
    }
  } else {
    // No ZIP widget — cookie + reload
    await cookieInject(page, config);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
    await page.waitForTimeout(6000);
    return 'cookie';
  }
}

// ── Scrape Product Page ───────────────────────────────────────
/**
 * Scrape Amazon product page (step2)
 * @param {string} asin
 * @param {string} [cc='US']
 * @returns {Object}
 */
async function scrapeProductPage(asin, cc) {
  cc = cc || 'US';
  const domain = DOMAIN_MAP[cc] || 'amazon.com';
  const config = MARKETPLACE_CONFIG[cc] || MARKETPLACE_CONFIG['US'];
  const url = 'https://www.' + domain + '/dp/' + asin;
  const timeout = DEFAULT_TIMEOUT;

  let browser;
  const result = {
    title: '', bullets: [], price: null, priceStatus: 'not_found', currency: config.currency || 'USD',
    rating: null, reviewCount: 0, BSR: null, category: null,
    marketplace: cc, url: url, error: null
  };

  try {
    browser = await createBrowser(cc);
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeout });
    await handleInterstitial(page);
    try { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(function() {}); } catch(e) {}
    await page.waitForTimeout(2000);

    // US: apply ZIP to get correct prices
    if (cc === 'US') {
      await zipAndReload(page, config, timeout);
    }

    const html = await page.content();
    const $ = cheerio.load(html);

    // Title
    result.title = trimText($('#productTitle').text()) ||
                  trimText($('h1.product-title-word-break').text()) || '';

    // Brand — try multiple selectors
    var brandEl = '';
    brandEl = $('#bylineInfo').text() || brandEl;
    brandEl = $('#brand').text() || brandEl;
    var brandText = trimText(brandEl)
      .replace(/^Brand:\s+/i, '')
      .replace(/^Visit the\s+/i, '')
      .replace(/\s+Store$/i, '')   // trailing "Store"
      .replace(/\s+Official Store$/i, '')  // trailing "Official Store"
      .trim();
    result.brand = brandText || undefined;

    // Bullets
    $('#feature-bullets li').each(function() {
      const t = trimText($(this).text()).replace(/^[\s•]+|[\s•]+$/g, '');
      if (t && t.length > 5) result.bullets.push(t);
    });
    if (result.bullets.length === 0) {
      $('[data-feature="bullets"] li').each(function() {
        const t = trimText($(this).text()).replace(/^[\s•]+|[\s•]+$/g, '');
        if (t && t.length > 5) result.bullets.push(t);
      });
    }

    // Price — try multiple selectors (Amazon 2024+ uses dynamic pricing blocks)
    var priceEl = '';
    priceEl = $('.a-price .a-offscreen').first().text() || priceEl;
    priceEl = $('#priceblock_ourprice').text() || priceEl;
    priceEl = $('#priceblock_dealprice').text() || priceEl;
    priceEl = $('#priceblock_saleprice').text() || priceEl;
    priceEl = $('.a-section .a-price .a-offscreen').first().text() || priceEl;
    priceEl = $('[data-a-color="price"] .a-offscreen').first().text() || priceEl;
    priceEl = $('#corePrice_feature_div .a-price .a-offscreen').text() || priceEl;
    priceEl = $('#corePrice .a-price-whole').text() || priceEl;
    priceEl = $('[class*="price"] .a-offscreen').first().text() || priceEl;
    // Handle inline price without .a-offscreen wrapper
    if (!priceEl) {
      var inlinePrice = $('#corePrice_feature_div').text() || '';
      var inlineMatch = inlinePrice.match(/\$[\d,]+\.?\d*/);
      priceEl = inlineMatch ? inlineMatch[0] : '';
    }
    // Determine availability
    var unavailableEl = $('#out-of-stock-trap').text() ||
                        $('[data-strike-color="red"]').text() ||
                        $('.a-text-price').text() ||
                        '';
    var isCurrentlyUnavailable = /currently unavailable|not sure|out of stock| Temporarily out of stock/i.test(unavailableEl);
    if (isCurrentlyUnavailable) {
      result.priceStatus = 'unavailable';
      result.price = null;
    } else if (priceEl) {
      result.priceStatus = 'available';
      result.price = parseFloat(priceEl.replace(/[^0-9.]/g, '')) || null;
    } else {
      result.priceStatus = 'not_found';
      result.price = null;
    }
    // Currency from marketplace config
    result.currency = config.currency || 'USD';

    // Rating — try multiple selectors
    var ratEl = '';
    ratEl = $('#acrPopover').attr('title') || ratEl;
    ratEl = $('.a-icon-alt').first().text() || ratEl;
    ratEl = $('[data-hook="rating-out-of-text"]').text() || ratEl;
    var ratMatch = ratEl.match(/([\d.]+)/);
    result.rating = ratMatch ? parseFloat(ratMatch[1]) + ' out of 5 stars' : null;

    // Review count — try multiple selectors
    var revEl = '';
    revEl = $('#acrCustomerReviewText').text() || revEl;
    revEl = $('[data-hook="total-review-count"]').text() || revEl;
    revEl = $('#acrCustomerWriteReviewText').text() || revEl; // fallback even if no reviews
    var revMatch = revEl.match(/([\d,]+)/);
    result.reviewCount = revMatch ? (parseInt(revMatch[1].replace(/,/g, ''), 10) || 0) : 0;

    // BSR — try multiple locations (Amazon restructured this in 2023-2024)
    var bsrEl = '';
    bsrEl = $('#Salesrank').text() || bsrEl;
    // New location: inside #productDetails_detailBullets_sections1 as "#1 in X > Y > Z"
    bsrEl = $('#productDetails_detailBullets_sections1').text() || bsrEl;
    bsrEl = $('#detailBullets_feature_div').text() || bsrEl;
    bsrEl = $('[data-feature-name="detailBullets"]').text() || bsrEl;
    var bsrMatch = bsrEl.match(/#1\s+in\s+([^|]+)/i) || bsrEl.match(/#([\d,]+)\s+in\s+/);
    result.BSR = (bsrMatch && bsrMatch[1]) ? parseInt(bsrMatch[1].replace(/\D/g, ''), 10) || null : null;

    // Category
    const cat = [];
    $('#wayfinding-breadcrumbs_feature_div a, #wayfinding-breadcrumbs ul li a').each(function() {
      cat.push(trimText($(this).text()));
    });
    result.category = cat.join(' > ').replace(/>\s*$/, '');

    await browser.close();
    browser = null;
  } catch(e) {
    if (browser) await browser.close().catch(() => {});
    result.error = e.message;
  }

  return result;
}

// ── Scrape Competitor Search ──────────────────────────────────
/**
 * Scrape competitor search results (step4)
 * @param {string} keyword
 * @param {string} [cc='US']
 * @param {Object} [opts]
 * @returns {Object}
 */
async function scrapeCompetitorSearch(keyword, cc, opts) {
  cc = cc || 'US';
  opts = opts || {};
  const maxCompetitors = opts.maxCompetitors || 60;
  const maxPerRound = opts.maxPerRound || 30;
  const sort = opts.sort || 'review-rank';
  const domain = DOMAIN_MAP[cc] || 'amazon.com';
  const config = MARKETPLACE_CONFIG[cc] || MARKETPLACE_CONFIG['US'];
  const timeout = DEFAULT_TIMEOUT;
  const isUS = (cc === 'US');

  // Build cascade plan
  const plan = buildSearchCascade(keyword);
  const allCompetitors = [];
  const cascadeRounds = [];
  const seenAsin = new Set();
  let browser;

  try {
    browser = await createBrowser(cc);

    // Create ONE persistent context shared by all rounds — mirrors amazon-universal-scraper.
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLang: 'en-US,en;q=0.9'
    });

    for (let ri = 0; ri < plan.length; ri++) {
      const round = plan[ri];
      const isSingleWord = round.keyword.indexOf(' ') === -1;
      if (isSingleWord) {
        cascadeRounds.push({ round: round.num, keyword: round.keyword, found: 0, skipped: true, reason: 'single-word-generic' });
        continue;
      }

      try {
        const page = await context.newPage();
        const searchUrl = 'https://www.' + domain + '/s?k=' + encodeURIComponent(round.keyword) + '&s=' + sort;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: timeout });
        await page.waitForTimeout(4000);

        // Accept cookie consent
        try {
          const spCcAccept = await page.$('#sp-cc-accept');
          if (spCcAccept) {
            try { await spCcAccept.click({ timeout: 3000 }); await page.waitForTimeout(2000); } catch(e) {}
          }
        } catch(e) {}

        // Handle interstitial (multi-language, universal_scraper pattern)
        const hasInter = await page.evaluate(function() {
          return document.body.textContent.indexOf('Continue shopping') !== -1 ||
                 document.body.textContent.indexOf('Klicke') !== -1 ||
                 document.body.textContent.indexOf('Schaltfläche') !== -1 ||
                 document.body.textContent.indexOf('Weiter einkaufen') !== -1;
        });
        if (hasInter) {
          const interBtnSelectors = [
            '#a-autoid-0-announce', '#a-autoid-1-announce',
            'button.a-button-text', 'button[data-action-impcost]',
            'a:has-text("Continue")', 'a:has-text("Weiter")'
          ];
          for (var sel of interBtnSelectors) {
            try {
              var ibtn = await page.$(sel);
              if (ibtn && await ibtn.isVisible()) {
                await ibtn.click({ timeout: 5000 });
                await page.waitForTimeout(4000);
                break;
              }
            } catch(e) {}
          }
        }

        // US only: set delivery ZIP + reload. Non-US: skip entirely.
        if (isUS) {
          await scrapeSetDeliveryAndReload(page, config, timeout);
        }

        // Extract results using page.evaluate (same approach as amazon-universal-scraper)
        // This runs in browser DOM context, more reliable than cheerio HTML parsing
        const comps = await page.evaluate(function(opts) {
          var results = document.querySelectorAll("div[data-component-type='s-search-result']");
          var compData = [];
          results.forEach(function(el, i) {
            if (i >= opts.maxPerRound) return;
            var casin = el.getAttribute('data-asin');
            if (!casin || casin.length < 8) return;

            // Skip ads
            var isAd = el.getAttribute('data-ad') || el.getAttribute('data-sponsored') ||
                        el.querySelector('[data-ad], [data-sponsored]');
            if (isAd) return;

            // Title
            var titleEl = el.querySelector('h2 .a-text-normal') || el.querySelector('h2 span') || el.querySelector('h2');
            var title = titleEl ? titleEl.textContent.trim() : '';

            // Price
            var priceEl = el.querySelector('.a-price .a-offscreen');
            var price = priceEl ? priceEl.textContent.trim() : '';

            // Rating
            var ratingEl = el.querySelector('.a-icon-alt');
            var rating = ratingEl ? ratingEl.textContent.trim() : '';

            // Reviews — try multiple selectors (Amazon uses different classes)
            var reviews = '';
            var reviewEls = el.querySelectorAll('span.a-size-base, span.a-size-mini.puis-normal-weight-text');
            reviewEls.forEach(function(r) {
              var t = r.textContent.trim();
              if (t.match(/^\(\d/) && !reviews) { reviews = t; }
            });

            if (title.length > 5) {
              compData.push({ asin: casin, title: title, price: price, rating: rating, reviews: reviews });
            }
          });
          return compData;
        }, { maxPerRound: maxPerRound });

        // Process results from page.evaluate
        comps.forEach(function(c) {
          if (seenAsin.has(c.asin)) return;
          seenAsin.add(c.asin);
          // Clean title
          c.title = c.title.replace(/\s*[\d.]+\s+out\s+of\s+\d+\s+stars.*$/i, '').trim();
          c.title = c.title.replace(/\s*#\d+\s+in\s+[^|]*\|.*$/i, '').trim();
          c.title = c.title.replace(/\s*Sponsored.*$/i, '').trim();
          allCompetitors.push(c);
          found++;
        });
        var found = comps.length;

        cascadeRounds.push({ round: round.num, keyword: round.keyword, found });
        console.error('  Round ' + round.num + ': "' + round.keyword + '" found=' + found + ' total=' + allCompetitors.length);

        await page.close();

        if (allCompetitors.length >= maxCompetitors) break;
      } catch(e) {
        console.error('  Round ' + round.num + ' error:', e.message.split('\n')[0]);
        cascadeRounds.push({ round: round.num, keyword: round.keyword, found: 0, error: e.message.split('\n')[0] });
      }
    }
    await context.close().catch(() => {});
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Sort by title length
  const competitors = allCompetitors.sort((a, b) => b.title.length - a.title.length);

  return { competitors, cascadeRounds, totalFound: competitors.length };
}

// ── Build Search Cascade ─────────────────────────────────────
function buildSearchCascade(keyword) {
  const plan = [];
  let num = 1;
  plan.push({ num: num++, keyword: keyword }); // full keyword always used

  // Detect if first word is a brand name (ALL CAPS when uppercased)
  // Even if coreProduct is lowercased ("vevor commercial..."), we can detect brand names
  // by checking if the UPPERCASE version of the first word looks like a brand acronym/format.
  // Heuristic: brand words are >=3 chars, ALL CAPS when uppercased, not common English words.
  const origWords = keyword.trim().split(/\s+/);
  const lowerWords = keyword.toLowerCase().trim().split(/\s+/);
  const firstWordLower = lowerWords[0] || '';
  const firstWordUpper = firstWordLower.toUpperCase();
  // "VEVOR" when uppercased is still "VEVOR" (all caps brand format)
  // "power" when uppercased is "POWER" (common word, not necessarily brand)
  // We filter out words that are ALL CAPS English words (POWER, WATER, etc.)
  const COMMON_UPPERCASE_WORDS = new Set(['POWER', 'WATER', 'LIGHT', 'SPORT', 'HOME', 'BEST', 'TOP', 'PRO', 'MAX', 'PLUS', 'ONE', 'NEW', 'MAXI', 'MULTI']);
  const isBrandFirst = firstWordLower.length >= 3 &&
                        firstWordUpper === firstWordUpper.toUpperCase() &&
                        !COMMON_UPPERCASE_WORDS.has(firstWordUpper) &&
                        firstWordUpper.match(/^[A-Z]{3,}$/);

  if (lowerWords.length >= 1) {
    const w1 = lowerWords[0];
    // Skip single-word ALL-CAPS keywords — these are brand names, not product types.
    // Searching Amazon for "VEVOR" returns ALL VEVOR products (table cloths, etc.),
    // not relevant competitors for a specific product line.
    if (!isBrandFirst && w1.length >= 4 && !STOPWORDS.has(w1) && !GENERIC_SINGLE_WORD_BLACKLIST.has(w1)) {
      plan.push({ num: num++, keyword: w1 });
    }
  }
  if (lowerWords.length >= 2) {
    plan.push({ num: num++, keyword: lowerWords.slice(0, 2).join(' ') });
  }
  if (lowerWords.length >= 2) {
    const last = lowerWords[lowerWords.length - 1];
    if (!STOPWORDS.has(last) && !GENERIC_SINGLE_WORD_BLACKLIST.has(last) && last.length >= 4) {
      plan.push({ num: num++, keyword: last });
    }
  }

  // Deduplicate
  const seen = {};
  return plan.filter(p => { if (!seen[p.keyword]) { seen[p.keyword] = true; return true; } return false; });
}

// ── Utility ───────────────────────────────────────────────────
function trimText(t) { return (t || '').toString().trim().replace(/\s+/g, ' '); }

// Extract title from Amazon URL slug.
// Input: "/VEVOR-Commercial-Margarita-Stainless-Restaurants/dp/B0F4QMG852/..."
// Output: "VEVOR Commercial Margarita Stainless Restaurants"
function titleFromUrl(url) {
  if (!url) return '';
  var m = url.match(/(?:amazon\.com)?\/([^/]+)\/dp\//i) || url.match(/\/dp\/([A-Z0-9]{10})/i);
  if (!m) return '';
  var slug = m[1] || '';
  // URL-decode and convert hyphens/underscores to spaces, strip trailing numbers/crap
  slug = decodeURIComponent(slug).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Remove trailing numbers like "/1" or "-1" (pagination artifacts)
  slug = slug.replace(/\s+\d+\s*$/i, '').trim();
  return slug;
}

// Detect if a title is just a brand name (short ALL-CAPS, likely brand only, no product info)
// e.g. "VEVOR", "SAMSUNG" — but not "POWER Tower" or "NIKE shoes"
function isBrandOnlyTitle(title) {
  if (!title || title.length < 3 || title.length > 15) return false;
  // All uppercase letters, at least 3 chars, looks like an acronym/brand
  return title === title.toUpperCase() && title.match(/^[A-Z]{3,}$/);
}

module.exports = {
  scrapeProductPage,
  scrapeCompetitorSearch,
  buildSearchCascade,
  handleInterstitial,
  changeDeliveryAddress,
  cookieInject,
  zipAndReload,
  GENERIC_SINGLE_WORD_BLACKLIST,
  STOPWORDS,
  MARKETPLACE_CONFIG,
  DOMAIN_MAP
};