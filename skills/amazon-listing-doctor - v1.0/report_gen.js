'use strict';
// ─────────────────────────────────────────────────────────────
//  Amazon Listing Doctor — report_gen.js v6.0 (Route B)
//
//  职责：渲染层。只读 checkpoint JSON，生成 HTML 报告。
//  不做任何计算、不做任何分析判断。
//
//  Checkpoint 数据来源：
//    step1-4.json  — diagnose.js（爬虫层）
//    step5-14.json — Claude Agent（分析层，按 SKILL.md 执行）
//
//  Usage:
//    node report_gen.js B0GVRS65WW
//    const html = require('./report_gen.js').generate('B0GVRS65WW')
// ─────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE
  ? path.join(process.env.OPENCLAW_WORKSPACE, 'amazon-listing-doctor')
  : path.join(os.homedir(), '.openclaw', 'workspace', 'amazon-listing-doctor');

// ── Checkpoint IO ─────────────────────────────────────────────
function loadCp(asin, n) {
  var p = path.join(WORKSPACE_DIR, 'checkpoints', asin, 'step' + n + '.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}

// ── Badge helpers ─────────────────────────────────────────────
function badge(cls, text) {
  return '<span class="badge badge-' + cls + '">' + esc(text) + '</span>';
}
function pBadge(p) {
  var cls = (p === 'P0' || p === 'P1') ? 'warn' : p === 'P2' ? 'yellow' : 'info';
  return badge(cls, p);
}
function sevBadge(sev) {
  var s = (sev || '').toLowerCase();
  var cls = (s === 'critical' || s === 'high') ? 'warn'
          : (s === 'medium')                   ? 'yellow'
          : 'info';
  return badge(cls, sev || 'info');
}
function scoreBadge(score) {
  var n = parseFloat(score);
  if (isNaN(n)) return badge('info', 'N/A');
  var cls = n >= 4 ? 'ok' : n >= 3 ? 'yellow' : 'warn';
  return badge(cls, n.toFixed(1));
}

// ── Escape HTML ───────────────────────────────────────────────
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── CSS（继承原版深色主题） ───────────────────────────────────
var CSS = `
:root{--bg:#0f1117;--card:#181b23;--border:#262a36;--accent:#4f8cff;--accent2:#38d9a9;--warn:#ff6b6b;--yellow:#ffd43b;--text:#e1e4ea;--muted:#8b8fa3;--green:#51cf66;}
*{margin:0;padding:0;box-sizing:border-box;}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;line-height:1.6;padding:24px;max-width:1100px;margin:0 auto;font-size:.9rem;}
h1{font-size:1.8rem;font-weight:700;margin-bottom:4px;color:#fff;}
h2{font-size:1.2rem;font-weight:600;color:var(--accent);margin:32px 0 12px;border-bottom:1px solid var(--border);padding-bottom:6px;}
h3{font-size:1rem;font-weight:600;color:var(--accent2);margin:16px 0 8px;}
.subtitle{color:var(--muted);font-size:.9rem;margin-bottom:24px;}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 20px;margin-bottom:14px;}
.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:.78rem;font-weight:600;margin-right:6px;}
.badge-warn{background:rgba(255,107,107,.15);color:var(--warn);}
.badge-ok{background:rgba(81,207,102,.15);color:var(--green);}
.badge-info{background:rgba(79,140,255,.15);color:var(--accent);}
.badge-yellow{background:rgba(255,212,59,.15);color:var(--yellow);}
table{width:100%;border-collapse:collapse;margin:8px 0;}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--border);font-size:.85rem;}
th{color:var(--muted);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.5px;}
td{color:var(--text);}
.title-box{background:#1a2236;border:1px solid #2a3a5c;border-radius:8px;padding:14px 18px;margin:10px 0;font-size:.88rem;line-height:1.5;}
.title-box strong{color:var(--yellow);font-size:.78rem;display:block;margin-bottom:4px;}
.title-box em{color:var(--muted);font-size:.78rem;font-style:normal;display:block;margin-top:4px;}
ul{padding-left:20px;margin:6px 0;}
li{margin-bottom:5px;font-size:.88rem;}
.kw{display:inline-block;background:rgba(79,140,255,.1);border:1px solid rgba(79,140,255,.25);color:var(--accent);padding:2px 8px;border-radius:4px;font-size:.78rem;margin:3px 3px 3px 0;}
.kw-secondary{background:rgba(56,217,169,.1);border-color:rgba(56,217,169,.25);color:var(--accent2);}
.kw-backend{background:rgba(139,143,163,.1);border-color:rgba(139,143,163,.25);color:var(--muted);}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
@media(max-width:700px){.grid2{grid-template-columns:1fr;}}
.footer{text-align:center;color:var(--muted);font-size:.78rem;margin-top:40px;padding-top:16px;border-top:1px solid var(--border);}
.kpi-big{display:flex;gap:14px;margin:16px 0;flex-wrap:wrap;}
.kpi-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 20px;text-align:center;flex:1;min-width:110px;}
.kpi-card .val{font-size:2rem;font-weight:700;color:var(--accent);}
.kpi-card .lbl{font-size:.82rem;color:var(--muted);margin-top:4px;}
.bullet-block{background:#1a2236;border:1px solid #2a3a5c;border-radius:6px;padding:12px 16px;margin:8px 0;}
.bullet-block .bullet-label{color:var(--yellow);font-size:.8rem;font-weight:600;margin-bottom:6px;}
.bullet-block .original{color:var(--muted);font-size:.83rem;margin-bottom:8px;}
.bullet-block .rewrite{color:#a8f0c6;font-size:.85rem;margin-bottom:4px;}
.bullet-block .explain{color:var(--muted);font-size:.78rem;font-style:italic;}
.cosmo-block{border:1px solid var(--border);border-radius:8px;padding:14px 18px;margin:10px 0;}
.cosmo-block .q-text{font-size:.9rem;color:var(--text);margin-bottom:8px;}
.cosmo-block .score-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
.cosmo-block .evidence{color:var(--muted);font-size:.82rem;margin-bottom:6px;}
.cosmo-block .enhancement{background:rgba(56,217,169,.08);border:1px solid rgba(56,217,169,.2);border-radius:6px;padding:10px 14px;margin-top:8px;font-size:.85rem;color:#a8f0c6;}
.cosmo-block .enhancement strong{color:var(--accent2);font-size:.78rem;display:block;margin-bottom:4px;}
.violation-item{padding:10px 0;border-bottom:1px solid var(--border);}
.violation-item:last-child{border-bottom:none;}
.violation-matched{color:var(--warn);font-size:.82rem;margin-top:3px;}
.violation-explain{color:var(--muted);font-size:.8rem;margin-top:3px;}
.missing-tag{color:#ff6b6b;}
.ok-tag{color:#51cf66;}
.notice{background:rgba(255,212,59,.07);border:1px solid rgba(255,212,59,.2);border-radius:6px;padding:10px 14px;color:var(--yellow);font-size:.83rem;margin:8px 0;}
.notice-info{background:rgba(79,140,255,.07);border-color:rgba(79,140,255,.2);color:var(--accent);}
`;

// ── Main render function ──────────────────────────────────────
function generate(asin) {
  // ── 读取所有 checkpoint ───────────────────────────────────
  var s1  = loadCp(asin, 1)  || {};
  var s2  = loadCp(asin, 2)  || {};
  var s3  = loadCp(asin, 3)  || {};
  var s4  = loadCp(asin, 4)  || {};
  var s5  = loadCp(asin, 5)  || null;   // Claude: 关键词分级
  var s6  = loadCp(asin, 6)  || null;   // Claude: 标题审计
  var s7  = loadCp(asin, 7)  || null;   // Claude: 三版优化标题
  var s8  = loadCp(asin, 8)  || null;   // Claude: Backend keywords
  var s9  = loadCp(asin, 9)  || null;   // Claude: Bullet 改写
  var s10 = loadCp(asin, 10) || null;   // Claude: Rufus 意图问题
  var s11 = loadCp(asin, 11) || null;   // Claude: Cosmo 评分 + Intent Enhancement
  var s12 = loadCp(asin, 12) || null;   // Claude: 违规检测
  var s13 = loadCp(asin, 13) || null;   // Claude: Listing Weight
  var s14 = loadCp(asin, 14) || null;   // Claude: 行动计划

  var analysisComplete = !!(s5 && s6 && s7 && s8 && s9 && s10 && s11 && s12 && s13 && s14);
  var missingSteps = [5,6,7,8,9,10,11,12,13,14]
    .filter(function(n) { return !loadCp(asin, n); })
    .map(function(n) { return 'step' + n; });

  // ── 提取数据 ─────────────────────────────────────────────
  var title       = s2.title || '';
  var brand       = s2.brand || '';
  var bullets     = s2.bullets || [];
  var price       = s2.price || null;
  var rating      = s2.rating || null;
  var reviewCount = s2.reviewCount || 0;
  var BSR         = s2.BSR || null;
  var category    = s2.category || '';
  var coreProduct = (s3.coreProduct || '');
  var sizeSignals = s3.sizeSignals || [];
  var competitors = (s4.competitors || []);
  var today       = new Date().toISOString().slice(0, 10);

  // 从分析层读取
  var kwPrimary   = (s5 && s5.primary)   || [];
  var kwSecondary = (s5 && s5.secondary) || [];
  var kwBackend   = (s5 && s5.backend)   || [];

  var titleIssues = (s6 && s6.issues)    || [];
  var spellErrors = (s6 && s6.spellErrors) || [];

  var titleVersions = s7 || null;

  var backendStr  = (s8 && s8.backend)   || '';

  var bulletRewrites = (s9 && s9.bullets) || [];

  var rufusQuestions = (s10 && s10.questions) || [];

  var cosmoScores = (s11 && s11.scores)  || [];
  var cosmoAvg    = (s11 && s11.averageScore != null)
                      ? parseFloat(s11.averageScore).toFixed(1) : null;

  var violations         = (s12 && s12.violations)  || [];
  var implicitViolations = (s12 && s12.implicit)    || [];

  var weightIssues = (s13 && s13.issues) || [];
  var weightSummary = (s13 && s13.summary) || '';

  var plan = (s14 && s14.plan) || [];

  // ── KPI 数据 ──────────────────────────────────────────────
  var kpiScore   = (s14 && s14.qualityScore != null) ? s14.qualityScore : '—';
  var kpiGrade   = (s14 && s14.qualityGrade)         ? s14.qualityGrade : '';
  var kpiViol    = violations.length;
  var kpiImplicit = implicitViolations.length;
  var kpiCosmo   = cosmoAvg || 'N/A';

  // ── HTML 构建 ─────────────────────────────────────────────
  var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '<title>Amazon Listing Doctor — ' + esc(asin) + '</title>\n' +
    '<style>' + CSS + '</style>\n' +
    '</head>\n<body>\n';

  // Header
  html += '<h1>Amazon Listing Doctor</h1>\n';
  html += '<p class="subtitle">ASIN: ' + esc(asin) +
          ' &nbsp;|&nbsp; Brand: ' + esc(brand || 'N/A') +
          ' &nbsp;|&nbsp; Category: ' + esc(category || 'N/A') +
          ' &nbsp;|&nbsp; Date: ' + today + '</p>\n';

  // 分析不完整提示
  if (!analysisComplete) {
    html += '<div class="notice">⚠ 分析层未完成（待 Claude 执行）：' +
            missingSteps.join(', ') +
            '。以下对应板块显示为空。</div>\n';
  }

  // KPI bar
  html += '<div class="kpi-big">\n';
  html += '  <div class="kpi-card"><div class="val">' + esc(String(kpiScore)) + '</div><div class="lbl">Quality Score</div>' + (kpiGrade ? '<div class="lbl">Grade ' + esc(kpiGrade) + '</div>' : '') + '</div>\n';
  html += '  <div class="kpi-card"><div class="val">' + kpiViol + '</div><div class="lbl">显性违规</div></div>\n';
  html += '  <div class="kpi-card"><div class="val">' + kpiImplicit + '</div><div class="lbl">隐性违规</div></div>\n';
  html += '  <div class="kpi-card"><div class="val">' + esc(String(kpiCosmo)) + '</div><div class="lbl">Cosmo Avg</div></div>\n';
  html += '</div>\n';

  // ── SECTION 1: Current Listing Audit ─────────────────────
  html += '<h2>1. Current Listing Audit</h2>\n';
  html += '<div class="card">\n';
  html += '<h3>Current Title</h3>\n';
  html += '<p style="font-size:.95rem;color:var(--yellow);margin:8px 0;">' + esc(title) + '</p>\n';
  html += '<p style="font-size:.8rem;color:var(--muted);">字符数: ' + title.length + ' / 200</p>\n';
  html += '</div>\n';

  html += '<div class="grid2">\n';
  html += '<div class="card"><h3>Product Specs</h3><table>\n';
  html += '<tr><td>ASIN</td><td>' + esc(asin) + '</td></tr>\n';
  html += '<tr><td>Brand</td><td>' + esc(brand || 'N/A') + '</td></tr>\n';
  html += '<tr><td>Rating</td><td>' + esc(String(rating || 'N/A')) + (reviewCount ? ' · ' + reviewCount + ' reviews' : '') + '</td></tr>\n';
  html += '<tr><td>Price</td><td>' + (price ? '$' + esc(String(price)) : 'N/A') + '</td></tr>\n';
  html += '<tr><td>BSR</td><td>' + esc(String(BSR || 'N/A')) + '</td></tr>\n';
  html += '<tr><td>Category</td><td>' + esc(category || 'N/A') + '</td></tr>\n';
  html += '</table></div>\n';

  html += '<div class="card"><h3>Data Snapshot</h3><table>\n';
  html += '<tr><td>Bullets</td><td>' + bullets.length + '/5</td></tr>\n';
  html += '<tr><td>Core Product</td><td>' + esc(coreProduct || 'N/A') + '</td></tr>\n';
  html += '<tr><td>Size Signals</td><td>' + (sizeSignals.length ? esc(sizeSignals.join(', ')) : 'N/A') + '</td></tr>\n';
  html += '<tr><td>Competitors</td><td>' + competitors.length + ' found</td></tr>\n';
  html += '<tr><td>Cosmo Avg</td><td>' + esc(String(kpiCosmo)) + ' / 5.0</td></tr>\n';
  html += '</table></div>\n';
  html += '</div>\n';

  if (bullets.length > 0) {
    html += '<div class="card"><h3>Current Bullets</h3>\n';
    bullets.forEach(function(b, i) {
      html += '<p style="margin:6px 0;font-size:.85rem;"><strong>' + (i+1) + '.</strong> ' + esc(b) + '</p>\n';
    });
    html += '</div>\n';
  }

  // ── SECTION 2: Title Audit ───────────────────────────────
  html += '<h2>2. Title Issues</h2>\n';
  if (!s6) {
    html += '<div class="card notice">待 Claude 分析（step6）</div>\n';
  } else if (titleIssues.length === 0 && spellErrors.length === 0) {
    html += '<div class="card"><p style="color:var(--green);">✓ 未发现标题问题</p></div>\n';
  } else {
    if (spellErrors.length > 0) {
      html += '<div class="card">\n<h3>拼写错误（Critical）</h3>\n';
      spellErrors.forEach(function(e) {
        html += '<div class="violation-item">' + badge('warn', 'Critical') + ' <strong>' + esc(e.word) + '</strong>';
        if (e.suggestion) html += ' → <span style="color:var(--green);">' + esc(e.suggestion) + '</span>';
        html += '<div class="violation-explain">' + esc(e.context || '') + '</div></div>\n';
      });
      html += '</div>\n';
    }
    if (titleIssues.length > 0) {
      html += '<div class="card"><table>\n';
      html += '<tr><th>问题</th><th>严重度</th><th>说明</th></tr>\n';
      titleIssues.forEach(function(i) {
        html += '<tr><td>' + esc(i.issue || '') + '</td><td>' + sevBadge(i.severity) +
                '</td><td style="color:var(--muted);">' + esc(i.detail || '') + '</td></tr>\n';
      });
      html += '</table></div>\n';
    }
  }

  // ── SECTION 3: Competitor Benchmark ─────────────────────
  html += '<h2>3. Competitor Benchmark</h2>\n';
  if (competitors.length === 0) {
    html += '<div class="card notice">竞品数据未获取。如需竞品分析，请重新运行 node diagnose.js ' + esc(asin) + ' --force</div>\n';
  } else {
    html += '<div class="card">\n';
    html += '<p style="color:var(--muted);font-size:.83rem;margin-bottom:12px;">共抓取 ' + competitors.length + ' 个竞品（搜索词："' + esc(coreProduct) + '"）</p>\n';
    html += '<table><tr><th>ASIN</th><th>Title</th><th>Price</th><th>Rating</th></tr>\n';
    competitors.slice(0, 15).forEach(function(c) {
      var t = c.title ? c.title.substring(0, 90) + (c.title.length > 90 ? '…' : '') : '(no title)';
      html += '<tr><td><a href="https://www.amazon.com/dp/' + esc(c.asin || '') + '" target="_blank" style="color:var(--accent);">' + esc(c.asin || '') + '</a></td>' +
              '<td>' + esc(t) + '</td>' +
              '<td>' + esc(String(c.price || '')) + '</td>' +
              '<td>' + esc(String(c.rating || '')) + '</td></tr>\n';
    });
    html += '</table>\n';
    if (s4.cascadeRounds && s4.cascadeRounds.length > 0) {
      html += '<p style="font-size:.78rem;color:var(--muted);margin-top:8px;">Cascade: ' +
              s4.cascadeRounds.map(function(r) { return esc(r.keyword) + '(' + r.found + ')'; }).join(' → ') + '</p>\n';
    }
    html += '</div>\n';
  }

  // ── SECTION 4: Keyword Universe ─────────────────────────
  html += '<h2>4. Keyword Universe</h2>\n';
  if (!s5) {
    html += '<div class="card notice">待 Claude 分析（step5）</div>\n';
  } else {
    html += '<div class="card">\n';
    html += '<h3>Primary Keywords（≥40% 竞品出现）</h3>\n<div>';
    kwPrimary.forEach(function(k) {
      var kw = typeof k === 'string' ? k : (k.keyword || '');
      html += '<span class="kw">' + esc(kw) + '</span>';
    });
    html += '</div>\n';
    html += '<h3>Secondary Keywords（20-39%）</h3>\n<div>';
    kwSecondary.forEach(function(k) {
      var kw = typeof k === 'string' ? k : (k.keyword || '');
      html += '<span class="kw kw-secondary">' + esc(kw) + '</span>';
    });
    html += '</div>\n';
    if (kwBackend.length > 0) {
      html += '<h3>Backend / Long-tail（10-19%）</h3>\n<div>';
      kwBackend.forEach(function(k) {
        var kw = typeof k === 'string' ? k : (k.keyword || '');
        html += '<span class="kw kw-backend">' + esc(kw) + '</span>';
      });
      html += '</div>\n';
    }
    html += '</div>\n';
  }

  // ── SECTION 5: Optimized Titles ─────────────────────────
  html += '<h2>5. Three Optimized Titles</h2>\n';
  if (!s7) {
    html += '<div class="card notice">待 Claude 分析（step7）</div>\n';
  } else {
    var versions = [
      { label: 'Version A — 最大关键词覆盖', text: titleVersions.versionA, chars: titleVersions.versionAChars, kws: titleVersions.versionAKeywords },
      { label: 'Version B — 高 CTR',         text: titleVersions.versionB, chars: titleVersions.versionBChars, kws: titleVersions.versionBKeywords },
      { label: 'Version C — 移动端优化',      text: titleVersions.versionC, chars: titleVersions.versionCChars, kws: titleVersions.versionCKeywords }
    ];
    versions.forEach(function(v) {
      if (!v.text) return;
      html += '<div class="title-box">\n';
      html += '<strong>' + esc(v.label) + (v.chars ? ' (' + v.chars + ' chars)' : '') + '</strong>\n';
      html += esc(v.text) + '\n';
      if (v.kws && v.kws.length > 0) {
        html += '<em>覆盖: ' + v.kws.map(function(k) { return esc(k); }).join(', ') + '</em>\n';
      }
      html += '</div>\n';
    });
    if (titleVersions.recommendation) {
      html += '<div class="card notice notice-info">' + esc(titleVersions.recommendation) + '</div>\n';
    }
  }

  // ── SECTION 6: Backend Keywords ─────────────────────────
  html += '<h2>6. Backend Keywords</h2>\n';
  if (!s8) {
    html += '<div class="card notice">待 Claude 分析（step8）</div>\n';
  } else {
    html += '<div class="card">\n';
    html += '<p style="font-size:.83rem;color:var(--muted);margin-bottom:8px;">字节数: ' + (s8.byteCount || backendStr.length) + ' / 250</p>\n';
    html += '<p style="font-size:.88rem;font-family:monospace;color:var(--accent2);line-height:1.8;">' + esc(backendStr) + '</p>\n';
    html += '</div>\n';
  }

  // ── SECTION 7: Bullet Optimization ──────────────────────
  html += '<h2>7. Bullet Point Optimization</h2>\n';
  if (!s9) {
    html += '<div class="card notice">待 Claude 分析（step9）</div>\n';
  } else if (bulletRewrites.length === 0) {
    html += '<div class="card"><p style="color:var(--muted);">无改写建议</p></div>\n';
  } else {
    bulletRewrites.forEach(function(b, i) {
      html += '<div class="bullet-block">\n';
      html += '<div class="bullet-label">Bullet ' + (i+1) + '</div>\n';
      if (b.original) {
        html += '<div class="original"><strong>原文：</strong>' + esc(b.original) + '</div>\n';
      }
      if (b.rewrite) {
        html += '<div class="rewrite"><strong>改写：</strong>' + esc(b.rewrite) + '</div>\n';
      }
      if (b.explanation) {
        html += '<div class="explain">' + esc(b.explanation) + '</div>\n';
      }
      html += '</div>\n';
    });
  }

  // ── SECTION 8: Rufus Intent Simulation ──────────────────
  html += '<h2>8. Rufus 意图模拟</h2>\n';
  if (!s10) {
    html += '<div class="card notice">待 Claude 分析（step10）</div>\n';
  } else if (rufusQuestions.length === 0) {
    html += '<div class="card notice">无 Rufus 意图问题（step10 数据不完整）</div>\n';
  } else {
    html += '<div class="card">\n';
    html += '<p style="color:var(--muted);font-size:.83rem;margin-bottom:12px;">以下是 Amazon Rufus 在该品类中最可能向买家提出的3个深度意图问题：</p>\n';
    rufusQuestions.forEach(function(q, i) {
      html += '<p style="margin:10px 0;font-size:.88rem;"><span style="color:var(--accent);font-weight:600;">Q' + (i+1) + '.</span> ' + esc(typeof q === 'string' ? q : (q.question || '')) + '</p>\n';
    });
    html += '</div>\n';
  }

  // ── SECTION 9: Cosmo Scoring ────────────────────────────
  html += '<h2>9. Cosmo 内容评分</h2>\n';
  if (!s11) {
    html += '<div class="card notice">待 Claude 分析（step11）</div>\n';
  } else {
    html += '<div class="card" style="margin-bottom:8px;">\n';
    html += '<p style="font-size:.85rem;">平均分: <strong style="color:var(--accent);font-size:1.2rem;">' + esc(String(cosmoAvg || 'N/A')) + '</strong> / 5.0 &nbsp;|&nbsp; 评分标准：5=直接回答 · 3=间接涉及 · 0=完全未提及</p>\n';
    html += '</div>\n';

    cosmoScores.forEach(function(q, i) {
      var score  = q.score != null ? q.score : '?';
      var scoreN = parseFloat(score);
      html += '<div class="cosmo-block">\n';
      html += '<div class="q-text"><strong>Q' + (i+1) + '.</strong> ' + esc(q.question || '') + '</div>\n';
      html += '<div class="score-row">' + scoreBadge(score) + '<span style="color:var(--muted);font-size:.82rem;">' + esc(q.label || '') + '</span></div>\n';
      if (q.evidence) {
        html += '<div class="evidence">Evidence: ' + esc(q.evidence) + '</div>\n';
      }
      // 只在 score ≤ 3 时显示 Intent Enhancement
      if (!isNaN(scoreN) && scoreN <= 3 && q.enhancement) {
        html += '<div class="enhancement"><strong>Intent Enhancement（改写至得 5 分）</strong>' + esc(q.enhancement) + '</div>\n';
      }
      html += '</div>\n';
    });
  }

  // ── SECTION 10: Explicit Violations ─────────────────────
  html += '<h2>10. 显性违规（V1-V8）</h2>\n';
  if (!s12) {
    html += '<div class="card notice">待 Claude 分析（step12）</div>\n';
  } else if (violations.length === 0) {
    html += '<div class="card"><p style="color:var(--green);">✓ 未发现显性违规</p></div>\n';
  } else {
    html += '<div class="card">\n';
    violations.forEach(function(v) {
      html += '<div class="violation-item">\n';
      html += sevBadge(v.severity) + ' <strong>' + esc(v.rule || '') + '</strong>';
      html += ' <span style="color:var(--muted);font-size:.8rem;">— ' + esc(v.id || '') + '</span>\n';
      if (v.matched) html += '<div class="violation-matched">匹配: "' + esc(v.matched) + '" @ ' + esc(v.location || '') + '</div>\n';
      if (v.explanation) html += '<div class="violation-explain">' + esc(v.explanation) + '</div>\n';
      html += '</div>\n';
    });
    html += '</div>\n';
  }

  // ── SECTION 11: Implicit Violations ─────────────────────
  html += '<h2>11. 隐性违规（V9-V18）</h2>\n';
  if (!s12) {
    html += '<div class="card notice">待 Claude 分析（step12）</div>\n';
  } else if (implicitViolations.length === 0) {
    html += '<div class="card"><p style="color:var(--green);">✓ 未发现隐性违规</p></div>\n';
  } else {
    html += '<div class="card">\n';
    implicitViolations.forEach(function(v) {
      html += '<div class="violation-item">\n';
      html += sevBadge(v.severity) + ' <strong>' + esc(v.rule || '') + '</strong>';
      html += ' <span style="color:var(--muted);font-size:.8rem;">— ' + esc(v.id || '') + '</span>\n';
      if (v.matched) html += '<div class="violation-matched">匹配: "' + esc(v.matched) + '"</div>\n';
      if (v.explanation) html += '<div class="violation-explain">' + esc(v.explanation) + '</div>\n';
      html += '</div>\n';
    });
    html += '</div>\n';
  }

  // ── SECTION 12: Listing Weight ───────────────────────────
  html += '<h2>12. Listing Weight 评估</h2>\n';
  if (!s13) {
    html += '<div class="card notice">待 Claude 分析（step13）</div>\n';
  } else {
    if (weightSummary) {
      html += '<div class="card notice notice-info">' + esc(weightSummary) + '</div>\n';
    }
    if (weightIssues.length > 0) {
      html += '<div class="card"><table>\n';
      html += '<tr><th>因素</th><th>当前状态</th><th>建议</th><th>影响</th></tr>\n';
      weightIssues.forEach(function(w) {
        html += '<tr><td>' + esc(w.factor || '') + '</td>' +
                '<td>' + esc(w.current || '') + '</td>' +
                '<td>' + esc(w.action || '') + '</td>' +
                '<td>' + sevBadge(w.impact) + '</td></tr>\n';
      });
      html += '</table></div>\n';
    }
  }

  // ── SECTION 13: Priority Action Plan ────────────────────
  html += '<h2>13. Priority Action Plan</h2>\n';
  if (!s14) {
    html += '<div class="card notice">待 Claude 分析（step14）</div>\n';
  } else if (plan.length === 0) {
    html += '<div class="card"><p style="color:var(--muted);">暂无行动项</p></div>\n';
  } else {
    html += '<div class="card"><table>\n';
    html += '<tr><th>优先级</th><th>行动项</th><th>位置</th><th>预期影响</th></tr>\n';
    plan.forEach(function(p) {
      html += '<tr><td>' + pBadge(p.priority) + '</td>' +
              '<td>' + esc(p.action || '') + '</td>' +
              '<td style="color:var(--muted);">' + esc(p.location || '') + '</td>' +
              '<td style="color:var(--muted);font-size:.8rem;">' + esc(p.impact || '') + '</td></tr>\n';
    });
    html += '</table></div>\n';
  }

  // ── SECTION 14: Data Integrity ───────────────────────────
  html += '<h2>14. 数据说明</h2>\n';
  html += '<div class="card">\n';
  html += '<p style="font-size:.83rem;color:var(--muted);">抓取时间：' +
          esc(s1.scrapedAt || s2.scrapedAt || today) + '</p>\n';
  html += '<ul style="margin-top:8px;">\n';
  html += '<li>目标 listing：实时抓取（Playwright）</li>\n';
  html += '<li>竞品数据：' + (competitors.length > 0 ? '实时抓取，共 ' + competitors.length + ' 条' : '未获取') + '</li>\n';
  html += '<li>分析层：' + (analysisComplete ? '完整（Claude Agent）' : '⚠ 部分缺失 — ' + missingSteps.join(', ')) + '</li>\n';
  html += '<li>以下项目无法从爬虫获取，需人工确认：主图质量、视频、A+内容、Q&A 回复</li>\n';
  html += '<li>本报告不包含任何虚构数据</li>\n';
  html += '</ul>\n';
  if (s2.scrapeError) {
    html += '<div class="notice" style="margin-top:10px;">⚠ 产品页抓取异常：' + esc(s2.scrapeError) + '</div>\n';
  }
  if (s4.scrapeError) {
    html += '<div class="notice" style="margin-top:6px;">⚠ 竞品抓取异常：' + esc(String(s4.scrapeError)) + '</div>\n';
  }
  html += '</div>\n';

  // Footer
  html += '<div class="footer">Amazon Listing Doctor v6.0 (Route B) — ' + today + '</div>\n';
  html += '</body>\n</html>\n';

  return html;
}

// ── CLI ───────────────────────────────────────────────────────
function main() {
  var asin = process.argv[2];
  if (!asin || !asin.match(/^B[A-Z0-9]{9}$/)) {
    console.error('Usage: node report_gen.js <ASIN>');
    process.exit(1);
  }
  var html = generate(asin);
  var outDir = path.join(WORKSPACE_DIR, 'reports', asin);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  var outPath = path.join(outDir, asin + '.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('✅ Report: ' + outPath + ' (' + html.length + ' bytes)');
}

if (require.main === module) {
  main();
} else {
  module.exports = { generate };
}
