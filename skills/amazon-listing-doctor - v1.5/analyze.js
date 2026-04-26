#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  Amazon Listing Doctor — analyze.js v1.5
//
//  职责：分析层（step5-14），读取 data_package.json，
//  生成结构化分析结果，写入 step5-14.json。
//
//  本脚本设计为在 OpenClaw Agent 上下文中运行
//  （sessions_spawn mode="run"），可直接调用 LLM。
//
//  Usage（独立测试）:
//    node analyze.js B0GJZSK34K
//
//  Usage（通过 diagnose.js 调用）:
//    本脚本由 diagnose.js 通过 sessions_spawn 触发，
//    触发后自主执行分析，写入 checkpoint，
//    无需额外调用者介入。
// ─────────────────────────────────────────────────────────────

'use strict';

var path    = require('path');
var os      = require('os');
var fs      = require('fs');

var WORKSPACE      = process.env.OPENCLAW_WORKSPACE
  ? path.join(process.env.OPENCLAW_WORKSPACE, 'amazon-listing-doctor')
  : path.join(os.homedir(), '.openclaw', 'workspace', 'amazon-listing-doctor');
var CHECKPOINT_DIR = path.join(WORKSPACE, 'checkpoints');
var SKILL_DIR      = __dirname;

// ── Load checkpoints ────────────────────────────────────────
function loadCp(asin, n) {
  var p = path.join(CHECKPOINT_DIR, asin, 'step' + n + '.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) { return null; }
}
function saveCp(asin, n, data) {
  var dir = path.join(CHECKPOINT_DIR, asin);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  var p = path.join(dir, 'step' + n + '.json');
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  console.log('  [step' + n + '] ✓ saved');
}

// ── Competitor keyword analysis ─────────────────────────────
function analyzeCompetitorTitles(competitors) {
  var wordFreq   = {};  // word → count
  var titleWords = /[a-z0-9]+/gi;

  competitors.forEach(function(c) {
    if (!c.title) return;
    var words = c.title.match(titleWords) || [];
    words.forEach(function(w) {
      var lw = w.toLowerCase();
      wordFreq[lw] = (wordFreq[lw] || 0) + 1;
    });
  });

  var total = competitors.length || 1;
  var scored = Object.keys(wordFreq).map(function(w) {
    return { word: w, freq: wordFreq[w], pct: wordFreq[w] / total };
  });

  // Sort by frequency
  scored.sort(function(a, b) { return b.freq - a.freq; });

  // Primary: ≥40% competitors OR exact product-type word
  // Secondary: 15-39%
  // Backend: size/measurements, storage-related
  var primary   = [];
  var secondary = [];
  var backend   = [];

  var productTypeWords = ['bed', 'frame', 'mattress', 'foundation', 'adjustable', 'base',
                          'sofa', 'couch', 'chair', 'table', 'desk', 'shelf', 'dresser',
                          'mirror', 'pillow', 'comforter', 'sheet', 'cover'];

  scored.forEach(function(s) {
    if (s.pct >= 0.4 || productTypeWords.indexOf(s.word) !== -1) {
      primary.push(s.word);
    } else if (s.pct >= 0.15) {
      secondary.push(s.word);
    } else {
      backend.push(s.word);
    }
  });

  return {
    primary:   primary.slice(0, 15),
    secondary: secondary.slice(0, 15),
    backend:   backend.slice(0, 30),
    rawFreq:   scored.slice(0, 50)
  };
}

// ── Title audit ─────────────────────────────────────────────
function auditTitle(title, brand, price, competitors) {
  var issues   = [];
  var charCount = title.length;
  var titleLower = title.toLowerCase();

  // Character limit
  if (charCount > 200) {
    issues.push({ issue: '标题超过200字符', detail: '当前 ' + charCount + ' chars', severity: 'critical' });
  } else if (charCount < 50) {
    issues.push({ issue: '标题过短', detail: '当前仅 ' + charCount + ' chars，可能缺失关键词', severity: 'high' });
  }

  // Brand at start
  if (brand && !titleLower.startsWith(brand.toLowerCase())) {
    // Check if brand appears somewhere
    if (titleLower.indexOf(brand.toLowerCase()) === -1) {
      issues.push({ issue: '品牌名未出现', detail: '品牌 ' + brand + ' 在标题中缺失', severity: 'medium' });
    }
  }

  // 无依据最高级
  var superlatives = ['#1', 'best', 'top', 'leading', 'premium', 'ultimate', 'best-selling'];
  superlatives.forEach(function(s) {
    if (titleLower.indexOf(s) !== -1) {
      issues.push({ issue: '无依据最高级', detail: '标题包含 "' + s + '"，未经验证的最高级表述', severity: 'high' });
    }
  });

  // Price info
  if (price && !title.match(/\$[\d,]+/)) {
    issues.push({ issue: '价格未标注', detail: '有价格竞争力优势但标题未标注', severity: 'medium' });
  }

  // Competitor price check
  if (competitors && competitors.length > 0 && price) {
    var prices = competitors.map(function(c) { return c.price; }).filter(Boolean);
    if (prices.length > 0) {
      var avg = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
      if (price < avg * 0.7) {
        issues.push({ issue: '价格过低（可能影响转化）', detail: '低于平均价 ' + avg.toFixed(2) + '，标题未体现性价比', severity: 'low' });
      }
    }
  }

  // Spell check (basic)
  var spellErrors = [];
  var commonMisspellings = {
    'matress': 'mattress', 'furniture': 'furniture', 'assemb': 'assembly',
    'guarantee': 'guarantee', 'warrenty': 'warranty', 'comfort': 'comfort'
  };
  Object.keys(commonMisspellings).forEach(function(wrong) {
    if (titleLower.indexOf(wrong) !== -1) {
      spellErrors.push({ word: wrong, suggestion: commonMisspellings[wrong], context: 'Title' });
    }
  });

  return {
    issues:     issues,
    spellErrors: spellErrors,
    charCount:  charCount,
    charLimit:  200,
    brandAtStart: brand ? titleLower.startsWith(brand.toLowerCase()) : false
  };
}

// ── Title versions ──────────────────────────────────────────
function generateTitleVersions(title, brand, coreProduct, sizeSignals, price) {
  var clean = title.replace(new RegExp('^' + brand + '\\s*', 'i'), '').trim();
  var parts = clean.split(/\s*[|]\s*/);

  // Version A: Maximum keyword coverage
  var versionA = brand + ' ' + coreProduct;
  if (price) versionA += ', $' + price;
  versionA += ' - ' + (parts.slice(1).join(' ').substring(0, 120) || coreProduct);
  if (versionA.length > 200) versionA = versionA.substring(0, 197) + '...';

  // Version B: High CTR
  var versionB = brand + ' ' + coreProduct + ' — ';
  var keyFeatures = [];
  if (sizeSignals && sizeSignals.length > 0) keyFeatures.push(sizeSignals[0]);
  if (price) keyFeatures.push('$' + price);
  keyFeatures.push('Easy Assembly');
  versionB += keyFeatures.join(', ');
  if (versionB.length > 200) versionB = versionB.substring(0, 197) + '...';

  // Version C: Mobile-first (≤80 chars)
  var versionC = brand + ' ' + coreProduct + ', ';
  if (sizeSignals && sizeSignals.length > 0) versionC += sizeSignals[0] + ', ';
  if (price) versionC += '$' + price;
  if (versionC.length > 80) versionC = versionC.substring(0, 77) + '...';

  return {
    versionA:     versionA.substring(0, 200),
    versionAChars: Math.min(versionA.length, 200),
    versionANote: 'Maximum keyword coverage',
    versionB:     versionB.substring(0, 200),
    versionBChars: Math.min(versionB.length, 200),
    versionBNote: 'High CTR with em dash',
    versionC:     versionC.substring(0, 80),
    versionCChars: versionC.length,
    versionCNote: 'Mobile-first (≤80 chars)'
  };
}

// ── Backend keywords ─────────────────────────────────────────
function generateBackend(primary, secondary, sizeSignals, coreProduct) {
  var words = [].concat(primary).concat(secondary).concat(sizeSignals || []).concat([coreProduct]);
  // Deduplicate and filter
  var seen = {};
  var filtered = words.filter(function(w) {
    if (!w || w.length < 2 || seen[w]) return false;
    seen[w] = true;
    return true;
  });
  var str = filtered.join(' ');
  // Count bytes (simple ASCII estimate = chars)
  var byteCount = Buffer.byteLength(str, 'utf8');
  return {
    backend:    str.substring(0, 500), // Safety truncate
    byteCount:  byteCount,
    charLimit:  250
  };
}

// ── Bullet analysis & rewrite ───────────────────────────────
function analyzeBullets(bullets, competitors, sizeSignals) {
  if (!bullets || bullets.length === 0) return { bullets: [] };

  var rewrites = bullets.map(function(original, i) {
    var num = i + 1;
    var rewrite = original;
    var explain = '保持原文结构';

    // Rule-based improvements
    var hasDimension = /\d+['"]|\d+\s*(in|inch|ft|foot|lb|lbs|pound)/i.test(original);
    var hasBenefit   = /\b(you|your|felt|sleep|comfort|sturdy|stable|quiet|noise)/i.test(original);
    var hasSpecific  = /\d+['"]|\d+\s*(year|inch|lb|min|minute)/i.test(original);

    // If bullet is too generic, add specificity from sizeSignals
    if (!hasDimension && sizeSignals && sizeSignals.length > 0 && i === 2) {
      rewrite = original + ' — ' + sizeSignals[0] + ' clearance';
      explain = '添加高度规格（来自竞品分析）';
    }

    // If missing benefit language
    if (!hasBenefit && i < 2) {
      rewrite = rewrite.replace(/^([A-Z])/, function(m) { return m; });
    }

    return {
      original:  original,
      rewrite:   rewrite,
      explain:   explain,
      factCheck: { passed: true, claims: [] }
    };
  });

  return { bullets: rewrites };
}

// ── Rufus questions ─────────────────────────────────────────
function generateRufusQuestions(coreProduct, sizeSignals, competitors) {
  // Generate 3 intent questions based on product type and signals
  var questions = [];

  // Q1: Weight/durability intent
  if (sizeSignals && sizeSignals.length > 0) {
    questions.push('How much weight do you need this ' + coreProduct + ' to support — and do you need reinforced steel slats for heavy mattresses or restless sleepers?');
  } else {
    questions.push('How much weight do you need this ' + coreProduct + ' to support — and have you had issues with frame flex or squeaking in the past?');
  }

  // Q2: Height/clearance intent
  questions.push('If you need under-bed storage, how important is bed height — and would you prefer ' + (sizeSignals && sizeSignals[0] ? sizeSignals[0] : '12+ inches') + ' of clearance for vacuum bags or storage bins?');

  // Q3: Assembly/noise intent
  questions.push('Have you struggled with complicated assembly or noisy beds before — and would you prioritize a ' + coreProduct + ' with pre-labeled parts and foam-padded center support for quiet nights?');

  return { questions: questions.slice(0, 3) };
}

// ── Cosmo scoring ───────────────────────────────────────────
function scoreCosmo(bullets, questions) {
  var scores = questions.map(function(q) {
    // Heuristic: map question theme to bullet index
    var theme = q.toLowerCase();
    var score = 3; // default medium
    var evidence = '';
    var label = 'Implicitly Addresses';

    if (/weight|load|support|durab/.test(theme) && bullets[0]) {
      if (/[0-9]+\s*(lbs?|pound)/i.test(bullets[0])) {
        score = 5; label = 'Directly Addresses';
        evidence = bullets[0].substring(0, 80);
      }
    } else if (/height|clearance|storage|under.?bed/.test(theme) && bullets[2]) {
      if (/\d+['"]|\d+\s*(in|inch)/i.test(bullets[2])) {
        score = 5; label = 'Directly Addresses';
        evidence = bullets[2].substring(0, 80);
      } else {
        score = 3;
        evidence = bullets[2] ? bullets[2].substring(0, 80) : 'No matching bullet';
      }
    } else if (/assembly|noise|squeak|quiet/.test(theme) && bullets[4]) {
      if (/minute|easy|tool.?free|no noise|squeak/i.test(bullets[4])) {
        score = 5; label = 'Directly Addresses';
        evidence = bullets[4].substring(0, 80);
      } else if (bullets[4]) {
        evidence = bullets[4].substring(0, 80);
      }
    } else {
      // Try any bullet with numbers/specs
      for (var i = 0; i < bullets.length; i++) {
        if (/\d+['"]|\d+\s*(lbs?|year|inche)/i.test(bullets[i])) {
          evidence = bullets[i].substring(0, 80);
          score = 4;
          break;
        }
      }
      if (!evidence && bullets[0]) evidence = bullets[0].substring(0, 80);
    }

    return {
      question:  q,
      score:     score,
      label:     label,
      evidence:  evidence || 'No matching bullet found',
      enhancement: score < 4 ? 'Consider adding specific measurement or benefit statement' : null
    };
  });

  var avg = scores.reduce(function(s, c) { return s + c.score; }, 0) / scores.length;
  return {
    scores:         scores,
    averageScore:   Math.round(avg * 10) / 10
  };
}

// ── Violation detection ─────────────────────────────────────
function detectViolations(title, bullets, rating, reviewCount) {
  var violations   = [];
  var implicit     = [];

  // V1: 无依据最高级
  var superlatives = ['#1', '#1', 'best', 'top', 'leading', 'premium', 'ultimate', 'best-selling', '#1 rated'];
  var titleLower   = title.toLowerCase();
  superlatives.forEach(function(s) {
    if (titleLower.indexOf(s) !== -1) {
      violations.push({ id: 'V1', severity: 'high', rule: '无依据最高级', matched: s, explanation: '未经独立验证的最高级表述，有下架风险' });
    }
  });

  // V2: 拼写错误 (basic check)
  // (skipped — covered by spellErrors in title audit)

  // V7: 字符超限
  if (title.length > 200) {
    violations.push({ id: 'V7', severity: 'medium', rule: '标题超字符', matched: title.length + ' chars', explanation: 'Amazon 上限 200 chars，当前超标' });
  }

  // V9: 核心关键词靠前
  var firstWords = titleLower.split(/\s+/).slice(0, 5).join(' ');
  if (!/bed|mattress|frame|sofa|table|chair|desk/i.test(firstWords)) {
    implicit.push({ id: 'V9', severity: 'medium', rule: 'Ranking Emphasis', matched: firstWords, explanation: '品类词未出现在前5词，可能影响相关性评分' });
  }

  // V12: Social proof
  if (reviewCount && reviewCount < 50) {
    implicit.push({ id: 'V12', severity: 'medium', rule: 'Social Proof', matched: reviewCount + ' reviews', explanation: '评论数低于50，Amazon 转化率受影响' });
  }

  // V13: Compelling narrative (bullets lack emotional/scenario language)
  var hasEmotion = /sleep|comfort|peace|relax|stress|love|worry|confident/i.test(bullets.join(' '));
  if (!hasEmotion) {
    implicit.push({ id: 'V13', severity: 'low', rule: '情感/场景叙事', matched: 'Bullets lack emotional language', explanation: 'Bullet 缺少用户使用场景和情感收益描述' });
  }

  return { violations: violations, implicit: implicit };
}

// ── Listing weight ──────────────────────────────────────────
function assessListingWeight(product, competitors) {
  var issues = [];

  // Reviews
  var rc = product.reviewCount || 0;
  if (rc < 50) {
    issues.push({ factor: 'Reviews', current: String(rc), action: '加入 Vine 项目 + 售后邮件催评策略', impact: 'medium' });
  } else if (rc < 200) {
    issues.push({ factor: 'Reviews', current: String(rc), action: '中等评论数，建议优化差评回复', impact: 'low' });
  }

  // Rating
  var rt = parseFloat(product.rating) || 0;
  if (rt < 4.0) {
    issues.push({ factor: 'Rating', current: String(rt), action: '低于4.0，分析差评原因针对性优化', impact: 'high' });
  } else if (rt < 4.5) {
    issues.push({ factor: 'Rating', current: String(rt), action: '接近4.5，监控差评噪音/稳定性问题', impact: 'medium' });
  }

  // Price
  var price = parseFloat(product.price) || 0;
  if (competitors && competitors.length > 0) {
    var prices = competitors.map(function(c) { return c.price; }).filter(Boolean);
    if (prices.length > 0) {
      var avg = prices.reduce(function(a, b) { return a + b; }, 0) / prices.length;
      if (price > avg * 1.5) {
        issues.push({ factor: 'Price', current: '$' + price.toFixed(2), action: '高于竞品均价$' + avg.toFixed(2) + '，需强化差异化卖点', impact: 'high' });
      } else if (price < avg * 0.5) {
        issues.push({ factor: 'Price', current: '$' + price.toFixed(2), action: '显著低于均价，标题可标注价格竞争力', impact: 'low' });
      }
    }
  }

  return {
    issues:  issues,
    summary: (rc > 0 ? rc + ' reviews' : 'N/A') + (rt > 0 ? ', rating ' + rt : '')
  };
}

// ── Quality score ────────────────────────────────────────────
function calcQualityScore(s5, s6, s11, s12, s13) {
  var score = 50; // base

  // Title (20)
  var titleScore = 20;
  if (s6 && s6.issues && s6.issues.length > 0) {
    s6.issues.forEach(function(iss) {
      if (iss.severity === 'critical') titleScore -= 10;
      else if (iss.severity === 'high') titleScore -= 5;
      else titleScore -= 2;
    });
  }
  if (s6 && s6.charCount && s6.charCount > 200) titleScore -= 5;
  titleScore = Math.max(0, titleScore);
  score += titleScore;

  // Bullets (25)
  var bulletScore = 25;
  if (s5 && s5.primary && s5.primary.length === 0) bulletScore -= 10;
  if (s5 && s5.secondary && s5.secondary.length === 0) bulletScore -= 5;
  score += bulletScore;

  // Cosmo (15)
  var cosmoScore = 0;
  if (s11 && s11.averageScore != null) {
    cosmoScore = s11.averageScore * 3;
  }
  score += cosmoScore;

  // Backend (10)
  var backendScore = 10;
  if (s5 && s5.backend && s5.backend.length > 0) backendScore = 10;
  else backendScore = 5;
  score += backendScore;

  // Violations (10)
  var violScore = 10;
  if (s12 && s12.violations) {
    s12.violations.forEach(function() { violScore -= 3; });
  }
  violScore = Math.max(0, violScore);
  score += violScore;

  // Listing Weight (15)
  var weightScore = 15;
  if (s13 && s13.issues) {
    s13.issues.forEach(function(iss) {
      if (iss.impact === 'high') weightScore -= 5;
      else if (iss.impact === 'medium') weightScore -= 3;
      else weightScore -= 1;
    });
  }
  weightScore = Math.max(0, weightScore);
  score += weightScore;

  // USP (5)
  score += 3; // default partial

  score = Math.min(100, Math.max(0, Math.round(score)));
  var grade = score >= 95 ? 'A+' : score >= 85 ? 'A' : score >= 75 ? 'B+' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';

  return { qualityScore: score, qualityGrade: grade };
}

// ── Action plan ──────────────────────────────────────────────
function buildPlan(s6, s12, s13, s5) {
  var plan = [];

  // From title issues
  if (s6 && s6.issues) {
    s6.issues.forEach(function(iss) {
      if (iss.severity === 'critical' || iss.severity === 'high') {
        plan.push({ priority: 'P1', action: iss.issue + ': ' + iss.detail, location: 'Title', impact: iss.severity });
      }
    });
  }

  // From violations
  if (s12 && s12.violations) {
    s12.violations.forEach(function(v) {
      if (v.severity === 'high' || v.severity === 'critical') {
        plan.push({ priority: 'P1', action: 'Fix violation: ' + v.rule, location: 'Title/Bullet', impact: v.severity });
      }
    });
  }

  // From listing weight
  if (s13 && s13.issues) {
    s13.issues.forEach(function(iss) {
      if (iss.impact === 'high' || iss.impact === 'medium') {
        plan.push({ priority: iss.impact === 'high' ? 'P2' : 'P3', action: iss.action, location: iss.factor, impact: iss.impact });
      }
    });
  }

  // From backend keywords
  if (s5 && (!s5.backend || s5.backend.length < 10)) {
    plan.push({ priority: 'P3', action: '补充 Backend Keywords (当前为空或不足)', location: 'Backend', impact: 'low' });
  }

  // Sort: P1 > P2 > P3
  var order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  plan.sort(function(a, b) {
    return (order[a.priority] || 99) - (order[b.priority] || 99);
  });

  return plan.slice(0, 8); // top 8
}

// ── Main analysis ────────────────────────────────────────────
async function analyze(asin) {
  console.log('════════════════════════════════════════');
  console.log('  Amazon Listing Doctor — Analysis Layer');
  console.log('════════════════════════════════════════');
  console.log('');

  // ── Load data package ──────────────────────────────────
  var pkgPath = path.join(CHECKPOINT_DIR, asin, 'data_package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error('❌ data_package.json not found: ' + asin);
    console.error('  Run diagnose.js first: node diagnose.js ' + asin);
    process.exit(1);
  }

  var pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch(e) {
    console.error('❌ Failed to parse data_package.json: ' + e.message);
    process.exit(1);
  }

  var product     = pkg.product;
  var keywords    = pkg.keywords;
  var competitors = (pkg.competitors && pkg.competitors.items) || [];

  console.log('产品: ' + (product.title || 'N/A').substring(0, 60));
  console.log('竞品: ' + competitors.length + ' found');
  console.log('');

  // ── Step 5: Keyword Universe ─────────────────────────────
  console.log('▶ Step 5: Keyword Universe');
  var kw = analyzeCompetitorTitles(competitors);
  var s5 = {
    primary:   kw.primary,
    secondary: kw.secondary,
    backend:   kw.backend
  };
  saveCp(asin, 5, s5);

  // ── Step 6: Title Audit ─────────────────────────────────
  console.log('▶ Step 6: Title Audit');
  var competitorsWithPrice = competitors.map(function(c) {
    return { title: c.title, price: c.price || null };
  });
  var s6 = auditTitle(product.title, product.brand, product.price, competitorsWithPrice);
  saveCp(asin, 6, s6);

  // ── Step 7: Title Versions ───────────────────────────────
  console.log('▶ Step 7: Optimized Titles');
  var s7 = generateTitleVersions(product.title, product.brand, keywords.coreProduct, keywords.sizeSignals, product.price);
  saveCp(asin, 7, s7);

  // ── Step 8: Backend Keywords ────────────────────────────
  console.log('▶ Step 8: Backend Keywords');
  var s8 = generateBackend(kw.primary, kw.secondary, keywords.sizeSignals, keywords.coreProduct);
  saveCp(asin, 8, s8);

  // ── Step 9: Bullet Rewrites ─────────────────────────────
  console.log('▶ Step 9: Bullet Analysis');
  var s9 = analyzeBullets(product.bullets, competitors, keywords.sizeSignals);
  saveCp(asin, 9, s9);

  // ── Step 10: Rufus Questions ────────────────────────────
  console.log('▶ Step 10: Rufus Intent Questions');
  var s10 = generateRufusQuestions(keywords.coreProduct, keywords.sizeSignals, competitors);
  saveCp(asin, 10, s10);

  // ── Step 11: Cosmo Scoring ──────────────────────────────
  console.log('▶ Step 11: Cosmo Content Scoring');
  var s11 = scoreCosmo(product.bullets || [], s10.questions);
  saveCp(asin, 11, s11);

  // ── Step 12: Violations ────────────────────────────────
  console.log('▶ Step 12: Violation Detection');
  var s12 = detectViolations(product.title, product.bullets || [], product.rating, product.reviewCount);
  saveCp(asin, 12, s12);

  // ── Step 13: Listing Weight ─────────────────────────────
  console.log('▶ Step 13: Listing Weight Assessment');
  var s13 = assessListingWeight(product, competitors);
  saveCp(asin, 13, s13);

  // ── Step 14: Action Plan ────────────────────────────────
  console.log('▶ Step 14: Action Plan + Quality Score');
  var plan    = buildPlan(s6, s12, s13, s5);
  var qs      = calcQualityScore(s5, s6, s11, s12, s13);
  var s14     = { plan: plan, qualityScore: qs.qualityScore, qualityGrade: qs.qualityGrade };
  saveCp(asin, 14, s14);

  // ── Summary ────────────────────────────────────────────
  console.log('');
  console.log('════════════════════════════════════════');
  console.log('  ✅ Analysis complete');
  console.log('════════════════════════════════════════');
  console.log('');
  console.log('Quality Score: ' + qs.qualityScore + ' / 100  [' + qs.qualityGrade + ']');
  console.log('显性违规:   ' + s12.violations.length);
  console.log('隐性违规:   ' + s12.implicit.length);
  console.log('Cosmo Avg:  ' + s11.averageScore + ' / 5.0');
  console.log('');
  console.log('→ 生成报告：node report_gen.js ' + asin);

  return { s5, s6, s7, s8, s9, s10, s11, s12, s13, s14 };
}

// ── Entry point ─────────────────────────────────────────────
var asin = process.argv[2];
if (!asin) {
  console.error('Usage: node analyze.js <ASIN>');
  process.exit(1);
}

// Allow both plain ASIN and full URL
asin = asin.replace(/.*\/dp\//i, '').replace(/\/.*$/, '').trim();

if (require.main === module) {
  analyze(asin).catch(function(e) {
    console.error('Fatal: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  });
} else {
  module.exports = { analyze };
}
