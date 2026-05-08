/**
 * layer4_platform/compliance_runner.js — Compliance Check
 *
 * 来自源A：读取平台 constraints.json 做合规检查。
 */

'use strict';

const fs   = require('fs');
const path = require('path');

function loadConstraints(platform) {
  var p = path.join(__dirname, platform, 'constraints.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function checkForbiddenWords(text, forbiddenWords) {
  var violations = [];
  var lower = text.toLowerCase();
  (forbiddenWords || []).forEach(function(w) {
    if (lower.includes(w.toLowerCase())) violations.push({ rule: 'ForbiddenWord', matched: w, severity: 'high' });
  });
  return violations;
}

function checkCharLimit(text, max, fieldName) {
  if (text && text.length > max) return [{ rule: 'CharLimit', matched: text.length + ' > ' + max, severity: 'critical', field: fieldName }];
  return [];
}

async function checkCompliance(context) {
  var raw = context.raw.product || {};

  // Amazon 简单合规（复用 normalizer 的规则）
  context.platform.compliance.amazon = {
    violations: [], implicit: [], riskLevel: 'low', factCheck: []
  };

  // Walmart 合规
  var walmartC = loadConstraints('walmart');
  if (walmartC) {
    var wViolations = [];
    wViolations = wViolations.concat(checkCharLimit(raw.title || '', walmartC.title.maxChars, 'title'));
    wViolations = wViolations.concat(checkForbiddenWords([raw.title || '', (raw.bullets || []).join(' ')].join(' '), walmartC.forbiddenWords));
    context.platform.compliance.walmart = {
      violations: wViolations,
      riskLevel: wViolations.some(function(v) { return v.severity === 'critical'; }) ? 'critical' : wViolations.some(function(v) { return v.severity === 'high'; }) ? 'high' : 'low'
    };
  }

  // Wayfair 合规
  var wayfairC = loadConstraints('wayfair');
  if (wayfairC) {
    var wfViolations = [];
    wfViolations = wfViolations.concat(checkCharLimit(raw.title || '', wayfairC.title.maxChars, 'title'));
    wfViolations = wfViolations.concat(checkForbiddenWords([raw.title || '', (raw.bullets || []).join(' ')].join(' '), wayfairC.forbiddenWords));
    context.platform.compliance.wayfair = { violations: wfViolations, riskLevel: wfViolations.length > 0 ? 'medium' : 'low' };
  }

  return context;
}

module.exports = { checkCompliance };