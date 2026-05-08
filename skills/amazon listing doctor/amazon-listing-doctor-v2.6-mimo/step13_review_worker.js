#!/usr/bin/env node
/**
 * step13_review_worker.js — Review scraper for diagnose.js
 * Uses Playwright to load product page, scroll reviews into view,
 * and extract structured review data.
 *
 * Usage: node step13_review_worker.js <ASIN> <marketplace> [maxReviews]
 */
const path = require('path');
const { chromium } = require('playwright');
const os = require('os');

const MARKETPLACE_CONFIG = {
  'US': { domain: '.amazon.com',   currency: 'USD', zip: '10001' },
  'DE': { domain: '.amazon.de',   currency: 'EUR', zip: '10115' },
  'GB': { domain: '.amazon.co.uk', currency: 'GBP', zip: 'SW1A 1AA' },
  'JP': { domain: '.amazon.co.jp', currency: 'JPY', zip: '100-0001' },
  'CA': { domain: '.amazon.ca',   currency: 'CAD', zip: 'M1A 1A0' },
};

const TIMEOUT = 30000;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handleInterstitial(page) {
  try {
    for (var attempt = 0; attempt < 5; attempt++) {
      var hasSpecific = await page.evaluate(function() {
        var body = document.body.textContent || '';
        return (body.indexOf('Continue shopping') !== -1) ||
               (body.indexOf('Click the button below') !== -1) ||
               (body.indexOf('Weiter einkaufen') !== -1) ||
               (body.indexOf('Klicke') !== -1) ||
               (body.indexOf('Continuer vos achats') !== -1);
      });
      if (!hasSpecific) return;

      var selectors = ['button.a-button-text', '#a-autoid-0-announce', '#a-autoid-1-announce', '#continue-shopping', 'input[name="ref"]'];
      for (var s = 0; s < selectors.length; s++) {
        try {
          var btn = await page.$(selectors[s]);
          if (btn && await btn.isVisible()) {
            await btn.click({ timeout: 3000 });
            await page.waitForTimeout(4000);
            return;
          }
        } catch(e) {}
      }
      await sleep(1000);
    }
  } catch(e) {}
}

async function changeDeliveryAddress(page, config) {
  try {
    // Wait for widget (up to 6s)
    var widgetFound = false;
    for (var attempt = 0; attempt < 6; attempt++) {
      widgetFound = await page.evaluate(function() {
        return !!document.querySelector('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt, #glow-ingress-block');
      });
      if (widgetFound) break;
      await sleep(1000);
    }
    if (!widgetFound) return false;

    var btn = await page.$('#contextualIngressPtLabel_deliveryShortLine, #contextualIngressPt, #glow-ingress-block');
    if (!btn) return false;
    await btn.click();
    await sleep(4000);

    var zipInput = await page.$('#GLUXZipUpdateInput');
    if (!zipInput) {
      await page.keyboard.press('Escape');
      await sleep(1000);
      return true;
    }
    await zipInput.fill(config.zip);
    await sleep(800);

    var applyBtn = await page.$('#GLUXZipUpdate');
    if (applyBtn) {
      await applyBtn.click();
      await sleep(5000);
      return true;
    }
    await page.keyboard.press('Enter');
    await sleep(5000);
    return true;
  } catch(e) {
    return false;
  }
}

function parseStars(stars) {
  if (!stars) return 0;
  if (typeof stars === 'number') return stars;
  const m = String(stars).match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

async function scrapeReviews(asin, cc, maxReviews) {
  cc = cc || 'US';
  maxReviews = maxReviews || 60;
  const config = MARKETPLACE_CONFIG[cc] || MARKETPLACE_CONFIG['US'];
  const domain = config.domain;   // e.g. '.amazon.com'
  const productUrl = 'https://www' + domain + '/dp/' + asin;

  // Page context matching universal-scraper v2.0
  const TZ_MAP = { US: 'America/New_York', GB: 'Europe/London', DE: 'Europe/Berlin', FR: 'Europe/Paris', JP: 'Asia/Tokyo', CA: 'America/Toronto', AU: 'Australia/Sydney' };
  const pageCtx = {
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    acceptLang: config.locale + ',en;q=0.9',
    locale: config.locale,
    timezoneId: TZ_MAP[cc] || 'America/New_York'
  };

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--lang=en-US'
      ]
    });
    const context = await browser.newContext(pageCtx);
    const page = await context.newPage();

    console.error('Navigating to product page...');
    await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await sleep(10000);

    // Handle cookie consent (universal-scraper v2.0 style)
    try {
      var consentSel = ['#sp-cc-accept','#sp-cc-accept-all','button:has-text("Accept")','button:has-text("Akzeptieren")','button:has-text("Tout accepter")','button:has-text("Accetta")','button:has-text("Aceptar")'];
      for (var ci = 0; ci < consentSel.length; ci++) {
        try { var cb = await page.$(consentSel[ci]); if (cb && await cb.isVisible()) { await cb.click({ timeout: 3000 }); await sleep(2000); break; } } catch(e) {}
      }
    } catch(e) {}

    // Handle interstitial
    await handleInterstitial(page);

    // ZIP reload for US
    if (cc === 'US') {
      await changeDeliveryAddress(page, config);
      await sleep(3000);
      // Close any remaining popovers with Escape
      await page.keyboard.press('Escape');
      await sleep(2000);
    }

    // ── Scroll to lazy-loaded reviews section ─────────────────
    console.error('Scrolling to reviews section...');

    // Try to click "See all reviews" button (links to in-page reviews)
    var seeAllClicked = false;
    try {
      // Try multiple selectors for "See all reviews"
      var seeAllSelectors = [
        'a[data-hook="see-all-reviews-url-foot"]',
        'a[data-hook="see-all-reviews-url"]',
        '#acrCustomerReviewLink',
        'a[href*="reviews"]',
        '#reviewsRedirect a'
      ];
      for (var selIdx = 0; selIdx < seeAllSelectors.length; selIdx++) {
        var link = await page.$(seeAllSelectors[selIdx]);
        if (link) {
          var href = await link.getAttribute('href');
          console.error('Found see-all link: ' + seeAllSelectors[selIdx] + ' -> ' + (href || 'no href'));
          try {
            // Use JS click to bypass popover pointer interception
            await page.evaluate(function(sel) {
              var el = document.querySelector(sel);
              if (el) el.click();
            }, seeAllSelectors[selIdx]);
            seeAllClicked = true;
            console.error('JS-clicked see-all reviews: ' + seeAllSelectors[selIdx]);
            await sleep(5000);
          } catch(e) {
            console.error('Could not JS-click: ' + e.message);
          }
          break;
        }
      }
    } catch(e) { console.error('see-all search error: ' + e.message); }

    // Scroll down in steps, waiting for reviews to appear
    var prevReviewCount = 0;
    var sameCount = 0;
    var foundReviews = 0;
    for (var scrollStep = 0; scrollStep < 25; scrollStep++) {
      await page.evaluate(function() { window.scrollBy(0, 600); });
      await sleep(1800);

      // Check current review count
      var currentCount = await page.evaluate(function() {
        return document.querySelectorAll('[data-hook="review"]').length;
      });

      if (currentCount > foundReviews) {
        foundReviews = currentCount;
        console.error('  Scroll ' + scrollStep + ': ' + currentCount + ' reviews loaded');
        sameCount = 0;
      } else {
        sameCount++;
        if (sameCount >= 4) {
          console.error('No new reviews for 4 scrolls, stopping at ' + foundReviews);
          break;
        }
      }

      if (foundReviews >= maxReviews) {
        console.error('Reached max reviews target (' + maxReviews + ')');
        break;
      }
    }

    await sleep(3000);

    // ── Extract review data ────────────────────────────────────
    console.error('Extracting review data (' + foundReviews + ' found)...');
    const reviewData = await page.evaluate(function(max) {
      const result = {
        ratingValue: null,
        reviewCount: null,
        starDistribution: {},
        reviews: []
      };

      // Rating
      const ratingEl = document.querySelector('#acrPopover .a-icon-alt');
      if (ratingEl) {
        const m = ratingEl.textContent.trim().match(/(\d+(\.\d+)?)\s*out of/i);
        if (m) result.ratingValue = parseFloat(m[1]);
      }

      // Review count
      const countEl = document.querySelector('#acrCustomerReviewText');
      if (countEl) {
        const m = countEl.textContent.trim().match(/[\d,]+/);
        if (m) result.reviewCount = m[0].replace(/,/g, '');
      }

      // Star distribution bars
      try {
        const bars = document.querySelectorAll('.a-span5, [data-hook="review-star-statistics"] .a-row');
        bars.forEach(function(container) {
          const labelEl = container.querySelector('.a-size-mini, .a-color-secondary');
          const barEl = container.querySelector('.a-progress-bar');
          if (labelEl && barEl) {
            const labelText = labelEl.textContent.trim();
            const barAria = barEl.getAttribute('aria-valuenow') || barEl.style.width || '';
            const starMatch = labelText.match(/(\d)\s*star/i);
            const pctMatch = (barAria.match(/(\d+)/) || [''])[1];
            if (starMatch && pctMatch) {
              result.starDistribution[starMatch[1] + ' star'] = parseInt(pctMatch);
            }
          }
        });
      } catch(e) {}

      // Reviews
      const reviewEls = document.querySelectorAll('[data-hook="review"]');
      console.error('Found ' + reviewEls.length + ' review elements');

      for (let i = 0; i < Math.min(reviewEls.length, max); i++) {
        const el = reviewEls[i];

        // Stars
        let stars = 0;
        const starSources = [
          el.querySelector('[data-hook="review-star-rating"] .a-icon-alt'),
          el.querySelector('.a-icon-alt'),
          el.querySelector('[data-hook="review-rating"]')
        ];
        for (let si = 0; si < starSources.length && !stars; si++) {
          if (starSources[si]) {
            const st = starSources[si].textContent.trim();
            const sm = st.match(/(\d+(\.\d+)?)\s*out of/i);
            if (sm) stars = parseFloat(sm[1]);
          }
        }
        if (!stars) {
          const starIcon = el.querySelector('[data-hook="review-star-rating"]');
          if (starIcon) {
            const ariaLabel = starIcon.getAttribute('aria-label') || '';
            const am = ariaLabel.match(/(\d+(\.\d+)?)/);
            if (am && parseFloat(am[1]) <= 5) stars = parseFloat(am[1]);
          }
        }

        // Title — extract only text, not star rating
        let title = '';
        const titleEl = el.querySelector('[data-hook="review-title"]');
        if (titleEl) {
          title = titleEl.textContent
            .replace(/\d+\s*out of\s*5\s*stars/gi, '')
            .replace(/^[\d.]+\.\s*/g, '')   // remove leading "5. " etc
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        }

        // Body
        let body = '';
        const bodySlots = [
          el.querySelector('[data-hook="review-body"]'),
          el.querySelector('[data-hook="reviewRichContentContainer"]'),
          el.querySelector('span[data-hook="review-body"]'),
          el.querySelector('.a-size-base.review-text span')
        ];
        for (let b = 0; b < bodySlots.length && !body; b++) {
          if (bodySlots[b]) {
            const txt = bodySlots[b].textContent.trim();
            if (txt.indexOf('{"') === 0 || txt.indexOf('clickstreamNexus') !== -1) continue;
            if (txt.length > 20) body = txt;
          }
        }
        if (!body || body.length < 20) {
          body = el.textContent || '';
        }
        body = body
          .replace(/\{["']?clickstream[^"']{0,200}?\}/gi, ' ')
          .replace(/\{[^}]{50,}\}/g, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/Verified Purchase/gi, '')
          .replace(/Report[^\n]*/gi, '')
          .replace(/\d+\s*out of\s*5\s*stars/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        // Helpful votes
        let helpfulVotes = 0;
        const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');
        if (helpfulEl) {
          const hm = helpfulEl.textContent.match(/(\d+)\s*people found this helpful/);
          if (hm) helpfulVotes = parseInt(hm[1]);
        }

        // Reviewer name
        let reviewerName = '';
        const nameEl = el.querySelector('.a-profile-name');
        if (nameEl) reviewerName = nameEl.textContent.trim();

        // Verified
        const isVerified = !!el.querySelector('[data-hook="avp-badge"]') ||
                           el.textContent.indexOf('Verified Purchase') !== -1;

        // Date
        let date = '';
        const dateEl = el.querySelector('[data-hook="review-date"]');
        if (dateEl) date = dateEl.textContent.trim();

        if (body.length > 10 || title.length > 3) {
          result.reviews.push({
            stars: stars,
            title: title.substring(0, 300),
            body: body.substring(0, 2000),
            helpfulVotes: helpfulVotes,
            reviewerName: reviewerName,
            isVerified: isVerified,
            date: date
          });
        }
      }

      return result;
    }, maxReviews);

    await browser.close();

    return {
      asin: asin,
      ratingValue: reviewData.ratingValue,
      reviewCount: reviewData.reviewCount,
      starDistribution: reviewData.starDistribution,
      reviews: reviewData.reviews,
      totalExtracted: reviewData.reviews.length,
      scrapedAt: new Date().toISOString()
    };

  } catch(e) {
    if (browser) await browser.close().catch(function() {});
    return {
      asin: asin,
      ratingValue: null,
      reviewCount: null,
      starDistribution: {},
      reviews: [],
      totalExtracted: 0,
      scrapeError: e.message,
      scrapedAt: new Date().toISOString()
    };
  }
}

// ── CLI entry point ──────────────────────────────────────────
const asin = String(process.argv[2] || '').trim();
const marketplace = String(process.argv[3] || 'US').toUpperCase();
const maxReviews = parseInt(process.argv[4] || '60');

if (!asin) {
  console.error('Usage: node step13_review_worker.js <ASIN> [marketplace] [maxReviews]');
  process.exit(1);
}

console.error('step13_review_worker: asin=' + asin + ' cc=' + marketplace + ' maxReviews=' + maxReviews);

scrapeReviews(asin, marketplace, maxReviews)
  .then(function(result) {
    console.log('__STEP13_OUTPUT__' + JSON.stringify(result) + '__STEP13_OUTPUT__');
    process.exit(0);
  })
  .catch(function(e) {
    console.error('step13_review_worker error:', e.message);
    process.exit(1);
  });
