/**
 * layer4_platform/compliance_runner.js
 *
 * 职责：读取平台 constraints.json，对组合后的文案做合规检查。
 * 复用并扩展现有 compliance_engine.js 的规则，加入平台特有检查。
 */
'use strict';

const fs   = require('fs');
const path = require('path');

function loadConstraints(platform) {
  var p = path.join(__dirname, platform, 'constraints.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// 禁用词检查
function checkForbiddenWords(text, forbiddenWords) {
  var violations = [];
  var lower = text.toLowerCase();
  (forbiddenWords || []).forEach(function(w) {
    if (lower.includes(w.toLowerCase())) {
      violations.push({ rule: 'ForbiddenWord', matched: w, severity: 'high' });
    }
  });
  return violations;
}

// 字符限制检查
function checkCharLimit(text, max, fieldName) {
  if (text && text.length > max) {
    return [{ rule: 'CharLimit', matched: text.length + ' > ' + max, severity: 'critical',
              field: fieldName }];
  }
  return [];
}

async function checkCompliance(context) {
  var raw = context.raw.product || {};

  // Amazon 合规（复用已有引擎）
  try {
    var amazonEngine = require('../engines/compliance_engine.js');
    context = amazonEngine.run(context);
    // compliance_engine.run 写入 schema.compliance，需要映射到新结构
    if (context.compliance) {
      context.platform.compliance.amazon = {
        violations: context.compliance.explicit || [],
        implicit:   context.compliance.implicit || [],
        riskLevel:  context.compliance.riskLevel || null,
        factCheck:  context.compliance.factCheckResults || [],
      };
    }
  } catch(e) {
    console.error('[compliance_runner] Amazon compliance skipped: ' + e.message);
  }

  // Walmart 合规
  var walmartC = loadConstraints('walmart');
  if (walmartC) {
    var wViolations = [];
    var title = raw.title || '';

    wViolations = wViolations.concat(checkCharLimit(title, walmartC.title.maxChars, 'title'));
    wViolations = wViolations.concat(checkForbiddenWords(
      [title, (raw.bullets || []).join(' ')].join(' '),
      walmartC.forbiddenWords
    ));

    context.platform.compliance.walmart = {
      violations: wViolations,
      riskLevel:  wViolations.some(function(v) { return v.severity === 'critical'; }) ? 'critical'
                : wViolations.some(function(v) { return v.severity === 'high'; }) ? 'high' : 'low',
    };
  }

  // Wayfair 合规
  var wayfairC = loadConstraints('wayfair');
  if (wayfairC) {
    var wfViolations = [];
    wfViolations = wfViolations.concat(checkCharLimit(raw.title || '', wayfairC.title.maxChars, 'title'));
    wfViolations = wfViolations.concat(checkForbiddenWords(
      [raw.title || '', (raw.bullets || []).join(' ')].join(' '),
      wayfairC.forbiddenWords
    ));

    context.platform.compliance.wayfair = {
      violations: wfViolations,
      riskLevel:  wfViolations.length > 0 ? 'medium' : 'low',
    };
  }

  return context;
}

module.exports = { checkCompliance };
