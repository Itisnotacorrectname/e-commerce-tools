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

// ── Step validators — 验证必要字段存在 ───────────────────
const STEP_DEFS = {
  step5:  ['primary','secondary','backend'],
  step6:  ['issues','score'],
  step7:  ['versionA','versionB','versionC'],
  step8:  ['backend'],
  step9:  ['bullets'],
  step10: ['questions'],
  step11: ['scores','avg'],
  step12: ['explicit','implicit'],
  step13: ['summary','issues'],
  step14: ['actions']
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
      if (validate(analysis[stepKey], stepKey)) {
        writeCp(asin, n, analysis[stepKey]);
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