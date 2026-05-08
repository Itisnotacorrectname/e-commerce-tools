#!/usr/bin/env node
/**
 * inject_analysis.js — v1.4.3 新增
 * 
 * 职责：将对话中生成的 AI 分析结果写入 step5-14 checkpoint，
 *       然后重新生成完整 HTML 报告。
 * 
 * 使用方式：
 *   node inject_analysis.js <asin> <analysis.json>
 *   node inject_analysis.js <asin> --stdin   (从 stdin 读取 JSON)
 * 
 * analysis.json 格式：
 * {
 *   "step5":  { "primary": [...], "secondary": [...], "backend": [...] },
 *   "step6":  { "issues": [...], "score": 85 },
 *   "step7":  { "versionA": "...", "versionB": "...", "versionC": "..." },
 *   "step8":  { "backend": "..." },
 *   "step9":  { "bullets": [{ "original": "...", "rewrite": "...", "explanation": "..." }] },
 *   "step10": { "questions": ["Q1?", "Q2?", "Q3?"] },
 *   "step11": { "scores": [{ "question": "...", "score": 4, "evidence": "..." }], "avg": 4.2 },
 *   "step12": { "explicit": [...], "implicit": [...] },
 *   "step13": { "summary": "...", "issues": [...] },
 *   "step14": { "actions": [{ "priority": "P0", "action": "...", "location": "...", "impact": "..." }] }
 * }
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
const REPORT_DIR     = path.join(WORKSPACE, 'amazon-listing-doctor', 'reports');
const SKILL_DIR      = __dirname;

// ── Helpers ──────────────────────────────────────────────────
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function cpPath(asin, n) {
  return path.join(CHECKPOINT_DIR, asin, 'step' + n + '.json');
}
function writeCp(asin, n, data) {
  const p = cpPath(asin, n);
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.error('[inject] step' + n + '.json written (' + JSON.stringify(data).length + ' bytes)');
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load analysis data ───────────────────────────────────────
function loadAnalysis(args) {
  // Case: --stdin
  if (args[3] === '--stdin') {
    let raw = '';
    process.stdin.on('data', d => raw += d);
    return new Promise(resolve => process.stdin.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch(e) { die('JSON parse error: ' + e.message); }
    }));
  }
  // Case: path provided
  const jsonPath = args[3];
  if (!jsonPath) die('Usage: node inject_analysis.js <ASIN> <analysis.json>');
  if (!fs.existsSync(jsonPath)) die('File not found: ' + jsonPath);
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch(e) {
    die('JSON parse error: ' + e.message);
  }
}

function die(msg) { console.error('[inject] FATAL: ' + msg); process.exit(1); }

// ── 字段规范化：将 analysis.json 字段名映射到 report_gen.js 期望的字段名 ──
// 规则：原字段保留（向后兼容），只补充 report_gen.js 需要但名字不同的字段
function normalizeStep(stepKey, data) {
  if (!data) return data;
  var d = Object.assign({}, data);  // 不修改原对象

  switch (stepKey) {

    case 'step6':
      // report_gen 读 spellErrors，inject schema 没有这个字段
      if (!d.spellErrors) d.spellErrors = [];
      // report_gen 读 score 但命名一致，不需要映射
      // report_gen 读 issues[].detail（注意不是 description）
      if (Array.isArray(d.issues)) {
        d.issues = d.issues.map(function(i) {
          var item = Object.assign({}, i);
          // 容错：有些 LLM 输出 description 而非 detail
          if (!item.detail && item.description) item.detail = item.description;
          return item;
        });
      }
      break;

    case 'step7':
      // report_gen 读 versionAChars/versionBChars/versionCChars
      if (!d.versionAChars && d.versionA) d.versionAChars = d.versionA.length;
      if (!d.versionBChars && d.versionB) d.versionBChars = d.versionB.length;
      if (!d.versionCChars && d.versionC) d.versionCChars = d.versionC.length;
      // report_gen 读 versionANote/versionBNote/versionCNote（已在 test_analysis.json 里）
      if (!d.versionANote) d.versionANote = '';
      if (!d.versionBNote) d.versionBNote = '';
      if (!d.versionCNote) d.versionCNote = '';
      break;

    case 'step8':
      // report_gen 读 byteCount
      if (!d.byteCount && d.backend) {
        d.byteCount = Buffer.byteLength(d.backend, 'utf8');
      }
      break;

    case 'step11':
      // inject schema 用 avg，report_gen 读 averageScore
      if (d.averageScore == null && d.avg != null) d.averageScore = d.avg;
      // 反向兼容：如果只有 averageScore 没有 avg，补上
      if (d.avg == null && d.averageScore != null) d.avg = d.averageScore;
      break;

    case 'step12':
      // inject schema 用 explicit，report_gen 读 violations
      if (!d.violations && d.explicit) d.violations = d.explicit;
      // 反向兼容
      if (!d.explicit && d.violations) d.explicit = d.violations;
      if (!d.implicit) d.implicit = [];
      if (!d.violations) d.violations = [];
      break;

    case 'step14':
      // inject schema 用 actions，report_gen 读 plan
      if (!d.plan && d.actions) d.plan = d.actions;
      // 反向兼容
      if (!d.actions && d.plan) d.actions = d.plan;
      // qualityScore 和 qualityGrade：如果 inject 里在 step14 根级别，保留；如果没有，设默认
      if (d.qualityScore == null) d.qualityScore = null;
      if (!d.qualityGrade) d.qualityGrade = '';
      break;
  }

  return d;
}

// ── Step validators — 验证必要字段存在 ───────────────────
// ── Step validators — 验证规范化后的必要字段存在 ─────────────
// 注意：这里验证的是 normalizeStep 之后的字段名（即 report_gen.js 期望的字段名）
const STEP_DEFS = {
  step5:  ['primary','secondary','backend'],
  step6:  ['issues'],                          // spellErrors 由 normalizeStep 补充，不强制要求
  step7:  ['versionA','versionB','versionC'],
  step8:  ['backend'],                         // byteCount 由 normalizeStep 自动计算
  step9:  ['bullets'],
  step10: ['questions'],
  step11: ['scores','averageScore'],           // 规范化后用 averageScore
  step12: ['violations','implicit'],           // 规范化后用 violations
  step13: ['summary','issues'],
  step14: ['plan']                             // 规范化后用 plan
};

function validate(data, step) {
  const def = STEP_DEFS[step];
  if (!def) return true; // unknown step, skip validation
  const missing = def.filter(k => !data.hasOwnProperty(k));
  if (missing.length > 0) {
    console.error('[inject] Warning: step' + step.replace('step','') + ' missing fields: ' + missing.join(', '));
  }
  return true;
}

// ── Inject all steps ─────────────────────────────────────────
function injectAll(asin, analysis) {
  let count = 0;
  for (let n = 5; n <= 14; n++) {
    const stepKey = 'step' + n;
    if (analysis[stepKey]) {
      // 字段规范化：映射 analysis.json 字段名 → report_gen.js 期望字段名
      const normalized = normalizeStep(stepKey, analysis[stepKey]);
      if (validate(normalized, stepKey)) {
        writeCp(asin, n, normalized);
        count++;
      }
    } else {
      console.error('[inject] step' + n + ': no data provided — skipping');
    }
  }
  return count;
}

// ── Regenerate HTML ──────────────────────────────────────────
function regenerateReport(asin) {
  const reportGenPath = path.join(SKILL_DIR, 'report_gen.js');
  if (!fs.existsSync(reportGenPath)) {
    console.error('[inject] report_gen.js not found at ' + reportGenPath);
    return false;
  }
  try {
    const html = require(reportGenPath).generate(asin);
    const reportDir = path.join(REPORT_DIR, asin);
    ensureDir(reportDir);
    const reportPath = path.join(reportDir, asin + '.html');
    fs.writeFileSync(reportPath, html, 'utf8');
    console.error('[inject] Report regenerated: ' + reportPath + ' (' + html.length + ' bytes)');
    return true;
  } catch(e) {
    console.error('[inject] Report generation error: ' + e.message);
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const asin = process.argv[2];
  if (!asin || !asin.match(/^B[A-Z0-9]{9}$/)) {
    die('Usage: node inject_analysis.js <ASIN> <analysis.json>');
  }

  console.error('===========================================');
  console.error('  inject_analysis.js v1.4.3 — Analysis Injector');
  console.error('  ASIN: ' + asin);
  console.error('===========================================');

  const analysis = await loadAnalysis(process.argv);
  console.error('Loaded analysis data for steps: ' + Object.keys(analysis).join(', '));

  const count = injectAll(asin, analysis);
  console.error('Injected ' + count + ' analysis step(s)');

  const ok = regenerateReport(asin);
  if (!ok) process.exit(1);

  console.error('===========================================');
  console.error('  ✅ Done — 报告已更新');
  console.error('  查看: amazon-listing-doctor/reports/' + asin + '/' + asin + '.html');
  console.error('===========================================');
}

main().catch(e => { console.error('[inject] FATAL:', e.message); process.exit(1); });