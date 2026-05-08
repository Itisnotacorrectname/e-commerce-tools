/**
 * Amazon Universal Price Fetcher
 * Fetches real prices from any Amazon marketplace (com, de, uk, fr, it, es, jp, ca, etc.)
 * Technique: Navigate → click deliver-to → fill ZIP → apply → read updated price
 * Fallback: cookie injection + reload if ZIP approach fails
 *
 * @param {Object} options
 * @param {string} options.url       - Full Amazon product URL
 * @param {string} [options.asin]     - ASIN (optional, extracted from URL if omitted)
 * @param {number} [options.timeout]  - Navigation timeout (default 45000)
 * @returns {Promise<{price, priceRaw, currency, deliverTo, isUnavailable, title, rating, asin, url, scrapedAt}>}
 */
const { chromium } = require('playwright');

// Marketplace → { domain, currency, locale, countryCode, defaultZip }
var MARKETPLACE_CONFIG = {
  'amazon.com':    { domain: '.amazon.com',     currency: 'USD', locale: 'en_US', cc: 'US',   zip: '10001' },
  'amazon.de':     { domain: '.amazon.de',       currency: 'EUR', locale: 'de_DE', cc: 'DE',   zip: '10115' },
  'amazon.co.uk':  { domain: '.amazon.co.uk',   currency: 'GBP', locale: 'en_GB', cc: 'GB',   zip: 'SW1A 1AA' },
  'amazon.fr':     { domain: '.amazon.fr',       currency: 'EUR', locale: 'fr_FR', cc: 'FR',   zip: '75001' },
  'amazon.it':     { domain: '.amazon.it',       currency: 'EUR', locale: 'it_IT', cc: 'IT',   zip: '00100' },
  'amazon.es':     { domain: '.amazon.es',       currency: 'EUR', locale: 'es_ES', cc: 'ES',   zip: '28001' },
  'amazon.co.jp':  { domain: '.amazon.co.jp',   currency: 'JPY', locale: 'ja_JP', cc: 'JP',   zip: '100-0001' },
  'amazon.ca':     { domain: '.amazon.ca',       currency: 'CAD', locale: 'en_CA', cc: 'CA',   zip: 'M1A 1A0' },
  'amazon.com.au': { domain: '.amazon.com.au',   currency: 'AUD', locale: 'en_AU', cc: 'AU',   zip: '2000' },
  'amazon.com.mx': { domain: '.amazon.com.mx',   currency: 'MXN', locale: 'es_MX', cc: 'MX',   zip: '06600' },
  'amazon.in':     { domain: '.amazon.in',        currency: 'INR', locale: 'en_IN', cc: 'IN',   zip: '110001' },
  'amazon.nl':     { domain: '.amazon.nl',        currency: 'EUR', locale: 'nl_NL', cc: 'NL',   zip: '1012 MX' },
  'amazon.se':     { domain: '.amazon.se',        currency: 'SEK', locale: 'sv_SE', cc: 'SE',   zip: '111 21' },
  'amazon.pl':     { domain: '.amazon.pl',        currency: 'PLN', locale: 'pl_PL', cc: 'PL',   zip: '00-001' },
};

function detectMarketplace(url) {
  try {
    var hostname = new URL(url).hostname.replace(/^www\./, '');
    return MARKETPLACE_CONFIG[hostname] || MARKETPLACE_CONFIG['amazon.com'];
  } catch(e) {
    return MARKETPLACE_CONFIG['amazon.com'];
  }
}

function extractAsin(url) {
  try {
    var m = url.match(/\/dp\/([A-Z0-9]{10})/i) || url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  } catch(e) {
    return null;
  }
}

// ── Core fetcher ─────────────────────────────────────────────
async function fetchAmazonPrice(options) {
  var browser;
  var url = options.url;
  var timeout = options.timeout || 45000;

  if (!url) throw new Error('fetchAmazonPrice requires options.url');

  var config = detectMarketplace(url);
  var asin = options.asin || extractAsin(url);

  var isNonUS = (config.cc !== 'US');
  var launchOpts = {
    headless: isNonUS ? false : true,  // Non-US marketplaces block headless — must use real browser
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
  };
  if (isNonUS) {
    launchOpts.viewport = { width: 1920, height: 1080 };
    launchOpts.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  }
  browser = await chromium.launch(launchOpts);
  var pageCtx = isNonUS ? await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: launchOpts.userAgent, acceptLang: 'en-US,en;q=0.9' }) : null;
  var page = pageCtx ? await pageCtx.newPage() : await browser.newPage();

  try {
    // Step 1: Navigate
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeout });
    // Step 1b: Handle Amazon's anti-bot interstitial page ("Continue shopping")
    await handleInterstitial(page);

    // Step 1c: Wait for Amazon to fully load (use networkidle as additional signal)
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(function() {}); } catch(e) {}
    await page.waitForTimeout(2000);

    // Step 2: Extract non-price data FIRST (before any ZIP/cookie changes)
    // Title, bullets, rating, brand, ASIN are stable and available after initial load
    var staticData = await extractStaticData(page, config, asin);

    // Step 3: Change delivery address to trigger correct price display
    var zipWorked = await changeDeliveryAddress(page, config);

    // Step 4: Verify ZIP change actually worked (Amazon sometimes accepts but ignores)
    // Poll deliver-to text for up to 8s to confirm it changed to US location
    var zipVerified = false;
    if (zipWorked) {
      for (var verifyAttempt = 0; verifyAttempt < 8; verifyAttempt++) {
        var dtCheck = await page.evaluate(function() {
          var w = document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPtLabel');
          return w ? w.textContent.trim() : '';
        });
        if (dtCheck.indexOf('10001') !== -1 || dtCheck.indexOf('New York') !== -1 || dtCheck.indexOf('United States') !== -1) {
          zipVerified = true;
          break;
        }
        await page.waitForTimeout(1000);
      }
    }

    // If ZIP didn't actually work, fall back to cookie injection
    if (zipWorked && !zipVerified) {
      console.log('[amazon_price] ZIP change not verified, falling back to cookie injection');
      await page.evaluate(function(conf) {
        document.cookie = 'i18n-prefs=' + conf.currency + '; path=/; domain=' + conf.domain;
        document.cookie = 'lc-main=' + conf.locale + '; path=/; domain=' + conf.domain;
      }, config);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(function() {}); } catch(e) {}
      await page.waitForTimeout(6000);
      zipWorked = false; // reflect actual method used
    } else if (zipVerified) {
      // ZIP worked: close popover and let price update
      await page.keyboard.press('Escape');
      await page.waitForTimeout(3000);
    } else {
      // No widget found at all — cookie injection
      await page.evaluate(function(conf) {
        document.cookie = 'i18n-prefs=' + conf.currency + '; path=/; domain=' + conf.domain;
        document.cookie = 'lc-main=' + conf.locale + '; path=/; domain=' + conf.domain;
      }, config);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: timeout });
      try { await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(function() {}); } catch(e) {}
      await page.waitForTimeout(6000);
    }

    // Step 5: Extract price-specific data (only price/deliverTo change after ZIP)
    var priceData = await extractPriceData(page, config);

    // Merge: use static data (title/bullets/etc) + price data
    var data = Object.assign({}, staticData, priceData);

    return {
      asin:         data.asin || asin || '',
      url:          url,
      title:        data.title,
      price:        data.price,
      priceRaw:     data.priceRaw,
      currency:     data.currency,
      priceStatus:  data.price ? 'found' : (data.isUnavailable ? 'unavailable' : 'not_found'),
      priceSource:  data.priceSource,
      rating:       data.rating,
      reviews:      data.reviews,
      bullets:      data.bullets,
      brand:        data.brand,
      deliverTo:    data.deliverTo,
      isUnavailable: data.isUnavailable,
      bsrHomeKitchen: data.bsrHomeKitchen,
      bsrCategory:   data.bsrCategory,
      marketplace:  config.cc,
      addressMethod: zipWorked ? 'zip' : 'cookie',
      scrapedAt:    new Date().toISOString()
    };

  } finally {
    if (browser) await browser.close();
  }
}

// ── Handle Amazon anti-bot interstitial page ──────────────────
// Amazon sometimes shows a "Click the button below to continue shopping" page
// before the actual product. We detect and click through it.
async function handleInterstitial(page) {
  try {
    // Check if interstitial is present (poll for up to 5 seconds)
    for (var attempt = 0; attempt < 5; attempt++) {
      var hasInterstitial = await page.evaluate(function() {
        return document.body.textContent.indexOf('Continue shopping') !== -1 ||
               document.body.textContent.indexOf('Klicke') !== -1 ||
               document.body.textContent.indexOf('Schaltfläche') !== -1 ||
               document.body.textContent.indexOf('Einkauf fortfahren') !== -1 ||
               document.body.textContent.indexOf('Weiter einkaufen') !== -1 ||
               document.body.textContent.indexOf('Continuar comprando') !== -1 ||
               document.body.textContent.indexOf('Continua') !== -1 ||
               document.body.textContent.indexOf('Fortsæt') !== -1 ||
               document.body.textContent.indexOf('Weiter') !== -1;
      });

      if (hasInterstitial) {
        // Try to find and click the continue button
        var btn = await page.$('button.a-button-text');
        if (btn) {
          await btn.click();
          await page.waitForTimeout(5000); // Wait for page to redirect/unlock after click
          break;
        }
      }
      await page.waitForTimeout(1000);
    }
  } catch(e) {
    // Silently ignore — interstitial handling is best-effort
  }
}
// ── Change delivery address ──────────────────────────────────
// Returns true if the ZIP approach was attempted (widget was found),
// false if no deliver-to widget exists on this page.
async function changeDeliveryAddress(page, config) {
  try {
    // Wait for the deliver-to widget to appear (Amazon renders it dynamically)
    // Use a polling approach since it may take several seconds
    var widgetFound = false;
    for (var attempt = 0; attempt < 6; attempt++) {
      widgetFound = await page.evaluate(function() {
        return !!document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt');
      });
      if (widgetFound) break;
      await page.waitForTimeout(1000);
    }

    if (!widgetFound) return false; // No widget — fall back to cookie injection

    // Click the deliver-to button
    var deliverBtn = await page.$('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt');
    if (!deliverBtn) return false;

    await deliverBtn.click();
    await page.waitForTimeout(4000); // Wait for popover to fully open

    // Fill ZIP code (use fill() for reliability)
    var zipInput = await page.$('#GLUXZipUpdateInput');
    if (!zipInput) return false;

    await zipInput.fill(config.zip);
    await page.waitForTimeout(800);

    // Click Apply
    var applyBtn = await page.$('#GLUXZipUpdate');
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(5000); // Wait for Amazon to process and update price
    }

    return true; // ZIP approach was attempted

  } catch(e) {
    return false; // Any error — fall back to cookie injection
  }
}

// ── Extract static data (available before ZIP change) ────────
// Title, bullets, rating, brand, ASIN — these don't change with delivery location
async function extractStaticData(page, config, asin) {
  return await page.evaluate(function(conf) {
    // Title
    var titleEl = document.querySelector('#productTitle');
    var title = titleEl ? titleEl.textContent.trim() : '';

    // Rating
    var ratingEl = document.querySelector('.a-icon-alt');
    var rating = ratingEl ? ratingEl.textContent.trim() : '';

    // Reviews
    var reviewsEl = document.querySelector('#acrCustomerReviewText');
    var reviews = reviewsEl ? reviewsEl.textContent.trim() : '';

    // Bullets
    var bullets = [];
    var bulletEls = document.querySelectorAll('#feature-bullets li span.a-list-item');
    bulletEls.forEach(function(el) {
      var t = el.textContent.trim();
      if (t && t.length > 10) bullets.push(t);
    });

    // Brand
    var brandEl = document.querySelector('#bylineInfo');
    var brand = brandEl ? brandEl.textContent.trim().replace('Visit the ', '').replace(' Store', '') : '';

    // ASIN from page
    var pageAsin = null;
    var asinEl = document.querySelector('[data-asin]');
    if (asinEl) pageAsin = asinEl.getAttribute('data-asin');
    var asinInput = document.querySelector('input[name="ASIN"]');
    if (asinInput) pageAsin = asinInput.value;

    // BSR — Best Sellers Rank (parse from body text, covers all categories)
    var bsrHomeKitchen = null;
    var bsrCategory = null;
    var bodyText = document.body.textContent;
    // Match patterns like "#2,833,571 in Home & Kitchen" or "#1,496 in Mattresses"
    var bsrMatches = bodyText.match(/#([\d,]+)\s+in\s+([^\(]+)/gi) || [];
    bsrMatches.forEach(function(m) {
      var parts = m.match(/#([\d,]+)\s+in\s+([^\(]+)/i);
      if (!parts) return;
      var rank = parts[1];
      var cat = parts[2].trim();
      // Categorize: Home & Kitchen vs specific category
      if (cat.match(/home.*kitchen/i)) {
        bsrHomeKitchen = '#' + rank + ' in ' + cat;
      } else if (!bsrCategory || parseInt(rank.replace(/,/g,'')) < parseInt(bsrCategory.match(/#([\d,]+)/)[1].replace(/,/g,''))) {
        // Keep the smallest rank (most relevant category)
        bsrCategory = '#' + rank + ' in ' + cat;
      }
    });

    return {
      title: title,
      rating: rating,
      reviews: reviews,
      bullets: bullets,
      brand: brand,
      asin: pageAsin || conf.pageAsin || '',
      bsrHomeKitchen: bsrHomeKitchen,
      bsrCategory: bsrCategory
    };
  }, { currency: config.currency, cc: config.cc, pageAsin: asin });
}

// ── Extract price-specific data (changes after ZIP change) ──
async function extractPriceData(page, config) {
  return await page.evaluate(function(conf) {
    var price = null;
    var priceRaw = null;
    var priceSource = '';

    var selectors = [
      '.a-price .a-offscreen',
      '#corePrice_feature_div .a-price .a-offscreen',
      '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      '#apexPriceToPay .a-offscreen',
      '.apexPriceToPay .a-offscreen',
      '#corePrice .a-price .a-offscreen'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.textContent.trim()) {
        priceRaw = el.textContent.trim();
        var cleaned = priceRaw.replace(/[^\d.,]/g, '').replace(',', '');
        if (cleaned) {
          price = parseFloat(cleaned);
          priceSource = selectors[i];
          break;
        }
      }
    }

    // Fallback: whole + fraction
    if (!price) {
      var whole = document.querySelector('.a-price-whole');
      var frac = document.querySelector('.a-price-fraction');
      if (whole) {
        priceRaw = (conf.currency === 'EUR' ? '€' : conf.currency === 'GBP' ? '£' : conf.currency === 'JPY' ? '¥' : '$') +
                   whole.textContent.trim() + (frac ? '.' + frac.textContent.trim() : '');
        price = parseFloat((whole.textContent.trim() + (frac ? '.' + frac.textContent.trim() : '')).replace(/[^\d.]/g, ''));
        priceSource = '.a-price-whole+.fraction';
      }
    }

    // Detect currency from symbol
    var currencyShown = conf.currency;
    if (priceRaw) {
      if (priceRaw.includes('$') && !priceRaw.includes('US')) currencyShown = 'USD';
      else if (priceRaw.includes('€')) currencyShown = 'EUR';
      else if (priceRaw.includes('£')) currencyShown = 'GBP';
      else if (priceRaw.includes('¥') && !priceRaw.includes('CNY')) currencyShown = 'JPY';
      else if (priceRaw.includes('CNY') || priceRaw.includes('¥')) currencyShown = 'CNY';
    }

    // Delivery location
    var deliverEl = document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPtLabel');
    var deliverTo = deliverEl ? deliverEl.textContent.trim().replace(/\s+/g, ' ') : '';

    // Availability
    var isUnavailable = false;
    var availEl = document.querySelector('#availability');
    if (availEl) {
      var txt = availEl.textContent.trim().toLowerCase();
      if (txt.indexOf('unavailable') !== -1 || txt.indexOf('out of stock') !== -1) isUnavailable = true;
    }

    return {
      price: price,
      priceRaw: priceRaw,
      priceSource: priceSource,
      currency: currencyShown,
      deliverTo: deliverTo,
      isUnavailable: isUnavailable
    };
  }, { currency: config.currency, cc: config.cc });
}

module.exports = { fetchAmazonPrice, detectMarketplace, extractAsin, MARKETPLACE_CONFIG };
