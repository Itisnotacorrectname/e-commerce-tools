/**
 * layer0_reliability/index.js — Listing Engine v2.0
 *
 * 职责：Layer 0 — 可靠性检查。
 * 在任何数据层之前运行，验证输入 ASIN/URL 是否合法。
 * 填充 reliability 元数据。
 */

'use strict';

function run(ctx, input) {
  var missing = [];

  // 检查有 ASIN 或 URL 其一即可
  if (!input.asin && !input.url) {
    missing.push('input.asin or input.url');
  }

  // ASIN 格式校验（Amazon ASIN 是 10 位字母数字）
  if (input.asin && !/^[A-Z0-9]{10}$/.test(input.asin.toUpperCase())) {
    missing.push('input.asin (invalid format — expected 10-char alphanumeric)');
  }

  // URL 格式校验
  if (input.url && !/^https?:\/\//.test(input.url)) {
    missing.push('input.url (must start with http:// or https://)');
  }

  // 平台支持性检查
  var supportedPlatforms = ['amazon', 'walmart', 'wayfair', 'tiktok'];
  if (input.platform && !supportedPlatforms.includes(input.platform.toLowerCase())) {
    ctx.reliability.warnings.push('Platform "' + input.platform + '" not in known list: ' + supportedPlatforms.join(', '));
  }

  if (missing.length > 0) {
    missing.forEach(function(f) { ctx.reliability.missing.push(f); });
    ctx.reliability.warnings.push('[layer0] Missing required fields: ' + missing.join(', '));
  } else {
    ctx.reliability.scores['input'] = 1.0;
  }

  return ctx;
}

module.exports = { run: run };