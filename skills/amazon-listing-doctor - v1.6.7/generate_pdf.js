/**
 * generate_pdf.js — PDF generator for Amazon Listing Doctor
 * Uses Playwright to render HTML report and export as PDF A4.
 * Signature: generatePdf(htmlPath, pdfPath, callback)
 *   callback(err) — called on completion
 */
const { chromium } = require('playwright');

function generatePdf(htmlPath, pdfPath, callback) {
  chromium.launch({ headless: true, args: ['--no-sandbox'] })
    .then(browser => {
      return browser.newPage()
        .then(page => {
          return page.goto('file://' + htmlPath, { waitUntil: 'networkidle', timeout: 15000 })
            .then(() => page.pdf({
              path: pdfPath,
              format: 'A4',
              printBackground: true,
              margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
            }))
            .then(() => browser.close())
            .then(() => { console.log('PDF:', pdfPath); if (callback) callback(null); })
            .catch(e => { browser.close().catch(() => {}); if (callback) callback(e); });
        })
        .catch(e => { browser.close().catch(() => {}); if (callback) callback(e); });
    })
    .catch(e => { if (callback) callback(e); });
}

module.exports = generatePdf;