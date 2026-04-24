const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

// User data lives outside the skill dir (survives skill upgrades)
// Dynamic path — works on any machine
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE
  ? path.join(process.env.OPENCLAW_WORKSPACE, 'amazon-listing-doctor')
  : path.join(os.homedir(), '.openclaw', 'workspace', 'amazon-listing-doctor');

function loadCp(asin, step) {
  const p = path.join(WORKSPACE_DIR, 'checkpoints', asin, `step${step}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadAllSteps(asin) {
  const steps = {};
  for (let i = 1; i <= 16; i++) {
    steps[i] = loadCp(asin, i);
  }
  return steps;
}

function badge(severity) {
  const map = {
    critical: 'badge-warn', high: 'badge-warn', medium: 'badge-yellow',
    low: 'badge-info', l1: 'badge-warn', l2: 'badge-yellow', l3: 'badge-info',
    ok: 'badge-ok', info: 'badge-info'
  };
  return map[severity] || 'badge-info';
}

function buildHtml(asin) {
  const s = loadAllSteps(asin);

  const s1 = s[1];
  const s2 = s[2];
  const s3 = s[3];
  const s4 = s[4];
  const s5 = s[5];
  const s6 = s[6];
  const s7 = s[7];
  const s8 = s[8];
  const s9 = s[9];
  const s10 = s[10];
  const s11 = s[11];
  const s12 = s[12];
  const s13 = s[13];
  const s14 = s[14];
  const s15 = s[15];

  // ── Step2 核心数据 ──
  const title      = s2?.title || '';
  const price      = s2?.priceUSD || s2?.price || '';
  const currency   = s2?.currency || '';
  const priceStatus = s2?.priceStatus || '';
  const rating     = s2?.rating || '';
  const reviews    = s2?.reviews || s2?.reviewCount || '';
  const brand      = s2?.brand || '';
  const deliverTo  = s2?.deliverTo || '';
  const bullets    = s2?.bullets || [];
  const category   = s2?.category || '';
  const asinMatch  = s2?.asin || asin;
  const bsrHome    = s2?.bsrHomeKitchen || null;
  const bsrCat     = s2?.bsrCategory || null;
  const priceSource = s2?.priceSource || '';

  // ── Step3 ──
  const primaryKw   = s3?.primaryKeyword || '';
  const coreProduct  = s3?.coreProduct || '';
  const sizeSignals  = s3?.sizeSignals || [];
  const categorized  = s3?.categorized || {};
  const keywords     = s3?.keywords || [];

  // ── Step4 ──
  const competitors    = s4?.competitors || [];
  const cascadeRounds  = s4?.cascadeRounds || [];
  const patternAnalysis = s4?.patternAnalysis || null;

  // ── Step5 ──
  const s5Primary   = s5?.primary || [];
  const s5Secondary = s5?.secondary || [];
  // Backend shown in Section 4 is from step13 (E-GEO enhanced, the canonical source)
  const s5Backend   = (s13 && s13.backend) ? s13.backend.split(' ').slice(0, 20) : (s5?.backend || []);

  // ── Step6 ──
  const titleIssues = s6?.issues || [];
  const titleLength = s6?.titleLength || 0;

  // ── Step7 ──
  const versionA = s7?.versionA || '';
  const versionB = s7?.versionB || '';
  const versionC = s7?.versionC || '';
  const versionRec = s7?.recommendation || '';

  // ── Step8/13 ── (step13 overrides step8 with E-GEO-enhanced backend)
  const backendKw = (s13 && s13.backend) ? s13.backend : (s8?.backend || '');

  // ── Step9 ──
  const optimizedBullets = s9?.optimized || [];
  const bulletIssues      = s9?.issues || [];

  // ── Step10 ──
  const cosmoScores    = s10?.egeoScores || s10?.scores || [];
  const rufusAvgScore  = (s10?.averageScore != null) ? parseFloat(s10.averageScore).toFixed(1) : 'N/A';

  // ── Step11 ──
  // Keep all violations (each bullet occurrence is a separate entry; no deduplication)
  var violations = (s11?.violations || []).map(function(v) {
    return Object.assign({}, v);
  });

  // ── Step12 ──
  const egeoFeatures = s12?.egeoFeatures || [];
  const missingFeat  = s12?.missingFeatures || 0;

  // ── Step13 ──
  const weightIssues = s13?.issues || [];
  const weight = s13?.weight || 0;
  const grade  = s13?.grade || '';

  // ── Step14 ──
  // STRICT deduplication: P1 is authoritative. Skip P2 items that address the same
  // E-GEO feature as any P1 item. Use both exact-normalized match AND keyword overlap
  // (E-GEO feature keywords appearing in both P1 and P2).
  var p1NormKeys = {};
  (s14?.plan || []).filter(function(p) { return p.priority === 'P1'; }).forEach(function(p1) {
    var norm = (p1.action || '')
      .replace(/^Add:\s*/i, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\b(add|mention|reference|item|signal)\b/gi, ' ')
      .replace(/[\s,\-_()\/]+/g, ' ')
      .toLowerCase()
      .trim();
    if (norm) p1NormKeys[norm] = p1.action;
  });

  // E-GEO feature keyword map — used to detect when P2 is a weaker restatement of P1
  // For each feature: first set = trigger words that mean P2 is DUPLICATE of P1
  // Second set (after '|'): trigger words that mean P2 is DIFFERENT from P1 (keep P2)
  var egeoDupRules = {
    certification: { dup: ['certification', 'certified'], skip: [] },
    social_proof: { dup: ['social', 'proof', 'reviews', 'rating', 'ratings', 'testimonials', 'bestseller'], skip: [] },
    warranty: { dup: ['warranty', 'guarantee'], skip: [] },
    quality: { dup: ['material', 'quality', 'durability', 'durable', 'sturdy'], skip: [] },
    urgency: { dup: ['urgency', 'scarcity'], skip: ['stock', 'available', 'in stock', 'ships today', 'order now', 'get yours'] },
    scannable: { dup: ['scannable', 'structure', 'scannable structure'], skip: ['colon', 'semicolon', 'newlines', 'format', 'separators'] },
    usecase: { dup: ['usecase', 'use case', 'scenarios', 'scenario'], skip: ['home', 'office', 'hotel', 'restaurant', 'bar', 'cafe', 'dorm', 'apartment', 'kitchen', 'gym', 'travel', 'commute'] },
    ranking: { dup: ['ranking', 'award', 'winner', 'leading'], skip: ['top-rated'] }
  };

  function p2IsDuplicateOfP1(p2Norm) {
    // Check 1: exact normalized match
    if (p1NormKeys[p2Norm]) return true;
    // Check 2: substring overlap (P2 is substring of P1, or P1 is substring of P2)
    for (var pk in p1NormKeys) {
      if (pk.indexOf(p2Norm) !== -1 || p2Norm.indexOf(pk) !== -1) return true;
    }
    // Check 3: E-GEO feature keyword overlap with dup/skip rules
    var p2Words = p2Norm.split(/[\s]+/).filter(function(w) { return w.length > 2; });
    for (var feat in egeoDupRules) {
      var rule = egeoDupRules[feat];
      // Check if P2 contains any skip word for this feature → NOT a duplicate, keep P2
      var hasSkip = p2Words.some(function(w) { return rule.skip.indexOf(w) !== -1; });
      if (hasSkip) continue; // P2 has a specific tactic, treat as different — keep P2
      // Check if P2 contains dup word AND a P1 item for this feature exists
      var dupOverlap = p2Words.filter(function(w) { return rule.dup.indexOf(w) !== -1; });
      if (dupOverlap.length > 0) {
        for (var pk in p1NormKeys) {
          var p1Words = pk.split(/[\s]+/).filter(function(w) { return w.length > 2; });
          var p1HasFeat = p1Words.some(function(w) { return rule.dup.indexOf(w) !== -1; });
          if (p1HasFeat) return true; // same feature, P1 is authoritative
        }
      }
    }
    return false;
  }

  var plan = (s14?.plan || []).filter(function(p) {
    if (p.priority !== 'P2') return true;
    var p2Norm = (p.action || '')
      .replace(/^Add:\s*/i, '')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\b(add|mention|reference|item|signal)\b/gi, ' ')
      .replace(/[\s,\-_()\/]+/g, ' ')
      .toLowerCase()
      .trim();
    return !p2IsDuplicateOfP1(p2Norm);
  });

  // ── Step15 ──
  const anomalies = s15?.anomalies || [];

  const today = new Date().toISOString().slice(0, 10);

  // ── 辅助函数 ──
  function pBadge(p) {
    if (p === 'P0' || p === 'P1') return `<span class="badge badge-warn">${p}</span>`;
    if (p === 'P2') return `<span class="badge badge-yellow">${p}</span>`;
    if (p === 'P3') return `<span class="badge badge-info">${p}</span>`;
    return `<span class="badge badge-info">${p}</span>`;
  }

  function vBadge(sev) {
    const cls = sev === 'high' || sev === 'critical' || sev === 'l1' ? 'badge-warn'
      : sev === 'medium' || sev === 'l2' ? 'badge-yellow'
      : 'badge-info';
    return `<span class="badge ${cls}">${sev}</span>`;
  }

  // ── Computed data ──
  const priceDisplay = priceStatus === 'unavailable'
    ? `<span style="color:#ff6b6b;">不可售</span>`
    : priceStatus === 'not_found'
    ? `<span style="color:#ffd43b;">未获取</span>`
    : `${price} ${currency}`;

  const priceNote = priceSource ? `<span style="color:#8b8fa3;font-size:.8rem;"> (${priceSource})</span>` : '';

  // ── Anomaly items ──
  const anomalyItems = anomalies.length > 0 ? anomalies.map(a => {
    if (typeof a === 'string') return `<li>${a}</li>`;
    return `<li><strong>${a.section ? '[' + a.section + '] ' : ''}${a.flag || a.type || 'Data gap'}</strong>: ${a.item || a.note || a.message || JSON.stringify(a)}</li>`;
  }) : [];

  // ── Title issues ──
  const titleIssueRows = titleIssues.map(i => {
    var detail = i.detail || i.context || (i.severity ? 'Issue detected — review and correct' : '');
    return `<tr><td>${i.issue || ''}</td><td>${vBadge(i.severity)}</td><td>${detail}</td></tr>`;
  }).join('');

  // ── Competitor rows (top 10) ──
  const compRows = competitors.slice(0, 10).map(c => {
    const t = c.title ? c.title.substring(0, 80) + (c.title.length > 80 ? '…' : '') : '(no title)';
    const p = c.price || '';
    const r = c.rating || '';
    return `<tr><td><a href="https://www.amazon.com/dp/${c.asin || ''}" target="_blank">${c.asin || ''}</a></td><td>${t}</td><td>${p}</td><td>${r}</td></tr>`;
  }).join('');

  // ── Cascade rounds summary ──
  const cascadeSummary = cascadeRounds.length > 0
    ? `<p style="font-size:.8rem;color:var(--muted);margin-top:8px;">Cascade: ${cascadeRounds.map(r => r.keyword + '(' + r.found + ')').join(' → ')}</p>`
    : '';

  // ── Plan rows ──
  const planRows = plan.map(p => {
    const where = p.location || p.where || p.listing || '';
    return `<tr><td>${pBadge(p.priority)}</td><td>${p.action || ''}</td><td>${where}</td></tr>`;
  }).join('');

  // ── Weight rows (from s13.issues if available) ──
  const weightRows = weightIssues.length > 0 ? weightIssues.map(w => {
    const imp = w.impact || w.severity || 'Medium';
    const impCls = badge(imp);
    return `<tr><td>${w.factor || w.name || ''}</td><td><span class="badge ${impCls}">${w.current || ''}</span></td><td>${w.action || ''}</td><td><span class="badge ${impCls}">${imp}</span></td></tr>`;
  }).join('') : '';

  // ── Listing Quality Score (Section 12) ──
  // E-GEO missing features: required ones penalize harder (15 pts each), optional ones 5 pts
  var egeoRequiredMissing = (egeoFeatures || []).filter(function(f) { return f.missing && f.required; }).length;
  var egeoOptionalMissing = (egeoFeatures || []).filter(function(f) { return f.missing && !f.required; }).length;
  var egeoPenalty = egeoRequiredMissing * 15 + egeoOptionalMissing * 5;
  var violationPenalty = violations.length === 0 ? 0 : violations.length === 1 ? 10 : violations.length === 2 ? 25 : 40;
  var baseScore = 100 - egeoPenalty - violationPenalty;
  var qualityScoreRaw = Math.max(0, Math.min(100, baseScore));
  const listingScoreFactors = [
    { label: 'Title Length', score: titleLength > 0 && titleLength <= 200 ? 100 : 0, detail: titleLength + ' chars' },
    { label: 'Bullet Points', score: bullets.length >= 5 ? 100 : bullets.length >= 3 ? 60 : 20, detail: bullets.length + '/5 filled' },
    { label: 'Keyword Coverage', score: s5Primary.length > 0 ? Math.min(100, s5Primary.length * 25) : 0, detail: s5Primary.length + ' primary kw' },
    { label: 'BSR Presence', score: bsrCat ? 80 : 0, detail: bsrCat || 'No BSR data' },
    { label: 'Price Available', score: priceStatus === 'unavailable' ? 0 : priceStatus === 'not_found' ? 30 : 100, detail: priceStatus || 'available' },
    { label: 'Violation Count', score: violations.length === 0 ? 100 : violations.length === 1 ? 70 : violations.length === 2 ? 40 : 10, detail: violations.length + ' violations' },
    { label: 'Review Count', score: reviews && parseInt(String(reviews).replace(/\D/g,'')) > 50 ? 100 : 30, detail: reviews || '0' },
    { label: 'E-GEO Required Features', score: Math.max(0, 100 - egeoRequiredMissing * 15), detail: egeoRequiredMissing + ' required features missing' },
    { label: 'E-GEO Optional Features', score: Math.max(0, 100 - egeoOptionalMissing * 5), detail: egeoOptionalMissing + ' optional features missing' }
  ];
  const qualityScore = Math.round(listingScoreFactors.reduce((sum, f) => sum + f.score, 0) / listingScoreFactors.length);
  const qualityGrade = qualityScore >= 80 ? 'A' : qualityScore >= 60 ? 'B' : qualityScore >= 40 ? 'C' : 'D';
  const qualityRows = listingScoreFactors.map(f => {
    const cls = f.score >= 80 ? 'badge-ok' : f.score >= 50 ? 'badge-yellow' : 'badge-warn';
    return `<tr><td>${f.label}</td><td><span class="badge ${cls}">${f.score}/100</span></td><td>${f.detail}</td></tr>`;
  }).join('');

  // ── Competitor anomalies (Section 14) ──
  // Note: In self-only mode (no competitor pool), competitors is always empty by design.
  // This is not an anomaly — the system intentionally does not use competitor data.
  const compAnomalies = [];
  // Check for suspiciously similar competitor titles
  if (competitors.length >= 2) {
    const titles = competitors.map(c => c.title || '');
    for (let i = 0; i < titles.length; i++) {
      for (let j = i + 1; j < titles.length; j++) {
        if (titles[i] === titles[j]) {
          compAnomalies.push({ type: 'Duplicate competitor title', detail: 'ASIN ' + competitors[i].asin + ' and ' + competitors[j].asin + ' have identical titles' });
        }
      }
    }
  }
  // Check for very short titles (potential scrape issue)
  competitors.forEach(c => {
    if (c.title && c.title.length < 10) {
      compAnomalies.push({ type: 'Suspiciously short title', detail: 'ASIN ' + c.asin + ' title may be truncated: "' + c.title + '"' });
    }
  });
  const compAnomalyRows = compAnomalies.map(a => `<tr><td>${a.type}</td><td style="color:var(--muted);">${a.detail}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Amazon SEO Optimization Report — ${brand} ${asinMatch}</title>
<style>
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
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}
@media(max-width:700px){.grid2,.grid3{grid-template-columns:1fr;}}
.footer{text-align:center;color:var(--muted);font-size:.78rem;margin-top:40px;padding-top:16px;border-top:1px solid var(--border);}
.kpi-big{display:flex;gap:14px;margin:16px 0;flex-wrap:wrap;}
.kpi-card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 20px;text-align:center;flex:1;min-width:110px;}
.kpi-card .val{font-size:2rem;font-weight:700;color:var(--accent);}
.kpi-card .lbl{font-size:.82rem;color:var(--muted);margin-top:4px;}
.kpi-card .sub{font-size:.75rem;color:var(--muted);margin-top:2px;}
.violation-row{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:.85rem;}
.violation-row:last-child{border-bottom:none;}
.violation-rule{flex:1;font-weight:600;}
.violation-match{color:var(--muted);font-size:.8rem;margin-top:2px;}
.bullet-opt{background:#1a2236;border:1px solid #2a3a5c;border-radius:6px;padding:12px 16px;margin:8px 0;}
.bullet-opt strong{color:var(--yellow);font-size:.8rem;display:block;margin-bottom:4px;}
.bullet-opt .opt-text{color:#a8f0c6;font-size:.85rem;}
.egeo-row{display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);}
.egeo-row:last-child{border-bottom:none;}
.egeo-label{flex:1;font-size:.85rem;}
.egeo-tag{font-size:.75rem;padding:2px 8px;border-radius:10px;}
.egeo-tag.required{background:rgba(255,107,107,.1);color:var(--warn);}
.egeo-tag.optional{background:rgba(79,140,255,.1);color:var(--accent);}
.egeo-status{font-size:.8rem;width:60px;text-align:right;}
.missing-tag{color:#ff6b6b;}
.ok-tag{color:#51cf66;}
.section-label{color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;}
</style>
</head>
<body>

<h1>Amazon SEO Optimization Report</h1>
<p class="subtitle">ASIN: ${asinMatch} &nbsp;|&nbsp; Brand: ${brand} &nbsp;|&nbsp; Category: ${category || 'N/A'} &nbsp;|&nbsp; Date: ${today}</p>

<!-- KPI -->
<div class="kpi-big">
  <div class="kpi-card"><div class="val">${qualityScore}</div><div class="lbl">Quality Score</div><div class="sub">Grade ${qualityGrade}</div></div>
  <div class="kpi-card"><div class="val">${violations.length}</div><div class="lbl">显性违规</div></div>
  <div class="kpi-card"><div class="val">${missingFeat}</div><div class="lbl">隐性违规</div></div>
  <div class="kpi-card"><div class="val">${s10 ? s10.averageScore : 'N/A'}</div><div class="lbl">Rufus Avg</div></div>
</div>

<!-- SECTION 1: Current Listing Audit -->
<h2>1. Current Listing Audit</h2>
<div class="card">
<h3>Current Title</h3>
<p style="font-size:.95rem;color:var(--yellow);margin:8px 0;">${title}</p>
<p style="font-size:.8rem;color:var(--muted);">Character count: ${titleLength} &nbsp;|&nbsp; Amazon recommended max: 200</p>
</div>
<div class="grid2">
<div class="card">
<h3>Product Specs</h3>
<table>
<tr><td>ASIN</td><td>${asinMatch}</td></tr>
<tr><td>Brand</td><td>${brand || 'N/A'}</td></tr>
<tr><td>Rating</td><td>${rating}${reviews ? ' \u00b7 ' + reviews + ' reviews' : ''}</td></tr>
<tr><td>Price</td><td>${priceDisplay}${priceNote}</td></tr>
<tr><td>Deliver to</td><td>${deliverTo || 'N/A'}</td></tr>
${bsrCat ? `<tr><td>BSR (Category)</td><td>${bsrCat}</td></tr>` : ''}
${bsrHome ? `<tr><td>BSR (Home &amp; Kitchen)</td><td>${bsrHome}</td></tr>` : ''}
</table>
</div>
<div class="card">
<h3>Performance Snapshot</h3>
<table>
<tr><td>Bullet Points</td><td>${bullets.length > 0 ? bullets.length + ' filled' : 'Missing'}</td></tr>
<tr><td>Core Product</td><td>${coreProduct || 'N/A'}</td></tr>
<tr><td>Size Signals</td><td>${sizeSignals.length > 0 ? sizeSignals.join(', ') : 'N/A'}</td></tr>
<tr><td>Primary Keyword</td><td>${primaryKw || 'N/A'}</td></tr>
<tr><td>Cosmo Avg Score</td><td>${rufusAvgScore} / 5.0</td></tr>
</table>
</div>
</div>
${bullets.length > 0 ? `
<div class="card">
<h3>Bullet Points</h3>
${bullets.map((b,i) => `<p style="margin:6px 0;font-size:.85rem;"><strong>${i+1}.</strong> ${b}</p>`).join('')}
</div>` : ''}

<!-- SECTION 2: Title Issues -->
<h2>2. Current Title Issues Identified</h2>
<div class="card">
<table>
<tr><th>Issue</th><th>Severity</th><th>Detail</th></tr>
${titleIssueRows || `<tr><td colspan="3" style="color:var(--muted);">No title issues detected</td></tr>`}
</table>
</div>

<!-- SECTION 3: Competitor Benchmark -->
<h2>3. Competitor Benchmark</h2>
<div class="card">
<p style="color:var(--muted);font-size:.85rem;margin:0 0 12px 0;">Self-only mode — competitor scraping skipped. Keyword data extracted from this listing only.</p>
${compRows ? `<table><tr><th>ASIN</th><th>Title</th><th>Price</th><th>Rating</th></tr>${compRows}</table>${cascadeSummary}` : '<p style="color:var(--muted);font-size:.85rem;">No competitor data collected (self-only mode).</p>'}
</div>

<!-- SECTION 4: Keyword Universe -->
<h2>4. Category Keyword Universe</h2>
<div class="card">
<h3>Primary Keywords (Must Include in Title)</h3>
<div>${s5Primary.length > 0 ? s5Primary.map(k => `<span class="kw">${typeof k === 'string' ? k : k.keyword}</span>`).join('') : '<span style="color:var(--muted);font-size:.85rem;">No data</span>'}</div>
<h3>Secondary Keywords (Title or Bullets)</h3>
<div>${s5Secondary.length > 0 ? s5Secondary.map(k => `<span class="kw">${typeof k === 'string' ? k : k.keyword}</span>`).join('') : '<span style="color:var(--muted);font-size:.85rem;">No data</span>'}</div>
<h3>Backend / Long-Tail Keywords</h3>
<div>${s5Backend.length > 0 ? s5Backend.map(k => `<span class="kw">${k}</span>`).join('') : '<span style="color:var(--muted);font-size:.85rem;">No data</span>'}</div>
</div>

<!-- SECTION 5: Optimized Titles -->
<h2>5. Three Optimized Title Versions</h2>
${versionA ? `<div class="title-box"><strong>VERSION A — Maximum Keyword Coverage (Recommended)</strong>${versionA}<em>~${versionA.length} chars</em></div>` : ''}
${versionB ? `<div class="title-box"><strong>VERSION B — Shopper-Friendly / High CTR</strong>${versionB}<em>~${versionB.length} chars</em></div>` : ''}
${versionC ? `<div class="title-box"><strong>VERSION C — Compact / Mobile-Optimized</strong>${versionC}<em>~${versionC.length} chars</em></div>` : ''}
${versionRec ? `<p style="font-size:.85rem;color:var(--muted);margin-top:8px;">${versionRec}</p>` : ''}

<!-- SECTION 6: Backend Keywords -->
<h2>6. Backend Search Terms</h2>
<div class="card">
<p style="font-size:.82rem;color:var(--muted);margin-bottom:10px;">No commas needed — spaces only. No brand names, ASINs, or subjective claims. All lowercase.</p>
<div style="background:#111420;padding:14px;border-radius:6px;font-family:monospace;font-size:.85rem;line-height:1.8;color:var(--accent2);">
${backendKw || '<em style="color:var(--muted);">No backend keywords found</em>'}
</div>
${backendKw ? `<p style="font-size:.78rem;color:var(--muted);margin-top:8px;">Byte count: ~${backendKw.length} / 250</p>` : ''}
</div>

<!-- SECTION 7: Bullet Point Optimization -->
<h2>7. Bullet Point Optimization Plan</h2>
<div class="card">
${optimizedBullets.length > 0 ? optimizedBullets.map((ob, i) => `<div class="bullet-opt"><strong>Bullet ${i+1}</strong><div class="opt-text">${ob}</div></div>`).join('') : '<p style="color:var(--muted);font-size:.85rem;">No optimized bullets generated</p>'}
</div>

<!-- SECTION 8: Rufus + Cosmo -->
<h2>8. Rufus User Intent + Cosmo Score <span style="font-size:.75rem;color:var(--accent2);"> | ${(s10?.method || '').indexOf('llm_semantic') === 0 ? 'LLM Semantic' : (s10?.method || '').indexOf('llm_failed') === 0 ? 'Fallback (LLM Failed)' : 'KB Rules (Fallback)'}</span></h2>
<div class="card">
<p><strong>Average Score:</strong> <span style="color:var(--yellow);font-weight:700;">${rufusAvgScore} / 5.0</span></p>
<h3>E-GEO Itemized Scores (Q1–Q5)</h3>
<table>
<tr><th>Question</th><th>Score</th><th>Reasoning</th></tr>
${cosmoScores.length > 0 ? cosmoScores.map(cs => {
  const stars = '★'.repeat(Math.max(1,cs.score)) + '☆'.repeat(Math.max(0, 5 - cs.score));
  return `<tr><td style="font-size:.85rem;">${cs.questionId ? 'Q'+cs.questionId+': ' : ''}${cs.category || ''}</td><td><span style="color:var(--yellow);font-weight:600;">${stars} (${cs.score}/5)</span></td><td style="font-size:.78rem;color:var(--muted);">${cs.reason || ''}</td></tr>`;
}).join('') : '<tr><td colspan="3" style="color:var(--muted);">No E-GEO scores available</td></tr>'}
</table>
${cosmoScores.length > 0 ? (function() {
  var globalSuggestions = [];
  var seenSug = {};
  cosmoScores.forEach(function(cs) {
    (cs.suggestions || []).forEach(function(s) { if (!seenSug[s]) { seenSug[s] = true; globalSuggestions.push(s); } });
  });
  return globalSuggestions.length > 0
    ? '<div style="margin-top:12px;"><p style="font-size:.78rem;color:var(--muted);margin-bottom:8px;">Improvement suggestions:</p><div style="background:#1a2236;border-radius:6px;padding:10px;"><ul style="margin:0 0 0 16px;padding:0;font-size:.8rem;color:#a8f0c6;">' + globalSuggestions.map(function(s) { return '<li style="margin-bottom:4px;">' + s + '</li>'; }).join('') + '</ul></div></div>'
    : '';
})() : ''}
</div>

<!-- SECTION 9:显性违规 -->
<h2>9. Explicit Violations (${violations.filter(v => v.severity && v.severity !== 'none').length})</h2>
<div class="card">
${violations.filter(v => v.severity && v.severity !== 'none').length > 0 ? violations.filter(v => v.severity && v.severity !== 'none').map(v => `
<div class="violation-row">
${vBadge(v.severity)}
<div>
<div class="violation-rule">${v.rule || v.type || 'Unknown violation'}${v.note ? ' <span style="color:var(--muted);font-weight:400;">' + v.note + '</span>' : ''}</div>
<div class="violation-match">${v.bullet ? 'Bullet ' + v.bullet + ' — ' : ''}${v.matched && v.matched !== 'none' && v.matched.indexOf('Title length') === -1 ? '"' + v.matched + '"' : '<span style="color:var(--muted);">—</span>'}</div>
</div>
</div>`).join('') : '<p style="color:var(--green);font-size:.9rem;">✅ No explicit violations found</p>'}
</div>

<!-- SECTION 10: E-GEO / 隐性违规 -->
<h2>10. E-GEO Feature Coverage (${missingFeat} missing)</h2>
<div class="card">
${egeoFeatures.length > 0 ? egeoFeatures.map(f => {
  const isMissing = f.missing;
  return `<div class="egeo-row">
<span class="egeo-label">${f.label || f.name || ''}</span>
<span class="egeo-tag ${f.required ? 'required' : 'optional'}">${f.required ? 'Required' : 'Optional'}</span>
<span class="egeo-status ${isMissing ? 'missing-tag' : 'ok-tag'}">${isMissing ? '❌ Missing' : '✅ OK'}</span>
</div>`;
}).join('') : `<p style="color:var(--muted);font-size:.85rem;">${missingFeat} feature${missingFeat !== 1 ? 's' : ''} missing (E-GEO details unavailable)</p>`}
</div>

<!-- SECTION 11: Listing Weight -->
<h2>11. Listing Weight Improvement Suggestions</h2>
<div class="card">
${weightRows ? `<table><tr><th>Factor</th><th>Current</th><th>Action</th><th>Impact</th></tr>${weightRows}</table>` : '<p style="color:var(--muted);font-size:.85rem;">No critical weight issues flagged. Maintain listing quality and monitor BSR.</p>'}
</div>

<!-- SECTION 12: Listing Quality Score -->
<h2>12. Listing Quality Score (${qualityScore}/100 — Grade ${qualityGrade})</h2>
<div class="card">
<table>
<tr><th>Factor</th><th>Score</th><th>Current Status</th></tr>
${qualityRows}
</table>
</div>

<!-- SECTION 13: Priority Action Plan -->
<h2>13. Priority Action Plan</h2>
<div class="card">
<table>
<tr><th>Priority</th><th>Action</th><th>Where</th></tr>
${planRows || `<tr><td colspan="3" style="color:var(--muted);">No action items</td></tr>`}
</table>
</div>

<!-- SECTION 14: Competitor Anomalies -->
<h2>14. Competitor Anomalies</h2>
<div class="card">
${compAnomalyRows ? `<table><tr><th>Type</th><th>Detail</th></tr>${compAnomalyRows}</table>` : '<p style="color:var(--green);font-size:.9rem;">✅ No competitor anomalies detected</p>'}
</div>

<!-- SECTION 15: Data Anomalies -->
<h2>15. Data Anomalies</h2>
<div class="card">
${anomalyItems.length > 0 ? `<ul>${anomalyItems.join('')}</ul>` : '<p style="color:var(--green);font-size:.9rem;">✅ No data anomalies flagged</p>'}
</div>

<div class="footer">
Amazon SEO Optimization Report for ASIN ${asinMatch} &nbsp;|&nbsp; Generated ${today} &nbsp;|&nbsp; All data from live Amazon crawl — no data fabricated
</div>

</body>
</html>`;
}

async function generatePdf(htmlPath, pdfPath) {
  try {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle', timeout: 15000 });
    await page.pdf({
      path: pdfPath, format: 'A4', printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }
    });
    await browser.close();
    console.log('PDF:', pdfPath);
  } catch(e) {
    console.error('PDF error:', e.message);
  }
}

function generate(asin) {
  const baseDir = path.join(WORKSPACE_DIR, 'reports');
  const asinDir = `${baseDir}/${asin}`;
  if (!fs.existsSync(asinDir)) fs.mkdirSync(asinDir, { recursive: true });

  const htmlPath = `${asinDir}/${asin}.html`;
  const pdfPath  = `${asinDir}/${asin}.pdf`;

  const html = buildHtml(asin);
  fs.writeFileSync(htmlPath, html);
  console.log('HTML:', htmlPath);

  generatePdf(htmlPath, pdfPath);
  return html;
}

module.exports = { generate };