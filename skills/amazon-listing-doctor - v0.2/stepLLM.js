#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
//  stepLLM.js — Unified LLM engine for Steps 10, 11, 12
//  Replaces regex-driven violation/E-GEO detection with
//  semantic LLM analysis using KB rules as System Prompt.
// ─────────────────────────────────────────────────────────────

const http = require('http');

// ── LLM call helper with retry ───────────────────────────────
async function callLLMWithRetry(prompt, systemPrompt, maxRetries, timeoutMs) {
  // Gateway is busy when agent is processing — single attempt, long timeout
  maxRetries = maxRetries || 1;
  timeoutMs = timeoutMs || 120000;
  var lastError = null;
  for (var attempt = 0; attempt < maxRetries; attempt++) {
    try {
      var delay = attempt * 2000;
      if (delay > 0) await new Promise(function(res) { setTimeout(res, delay); });
      var result = await llmRequest(prompt, systemPrompt, timeoutMs);
      if (result) return result;
    } catch(e) {
      lastError = e;
    }
  }
  return null; // all retries failed
}

async function llmRequest(prompt, systemPrompt, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var startTime = Date.now();
    var systemContent = systemPrompt || null;
    var messages = systemContent
      ? [{ role: 'system', content: systemContent }, { role: 'user', content: prompt }]
      : [{ role: 'user', content: prompt }];
    var body = JSON.stringify({
      model: 'openclaw',
      messages: messages,
      temperature: 0.1,
      max_tokens: 500
    });

    var authToken = process.env.OPENCLAW_GATEWAY_TOKEN || '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3';
    var req = http.request({
      hostname: '127.0.0.1',
      port: 18789,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': 'Bearer ' + authToken
      }
    }, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          var json = JSON.parse(data);
          var content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
          if (content) { require('fs').appendFileSync('C:/Users/csbd/.openclaw/workspace/e-commerce-tools/skills/amazon-listing-doctor/llm_debug.log', '[' + new Date().toISOString() + '] success, content length: ' + content.length + '\n'); }
          resolve(content || null);
        } catch(e) { console.log('[llmRequest] parse err:', e.message, 'data:', data.substring(0,100)); require('fs').appendFileSync('C:/Users/csbd/.openclaw/workspace/e-commerce-tools/skills/amazon-listing-doctor/llm_debug.log', '[' + new Date().toISOString() + '] parse err: ' + e.message + ' data: ' + data.substring(0, 100) + '\n'); resolve(null); }
      });
    });
    req.on('error', function(e) { console.log('[llmRequest] network err:', e.message); require('fs').appendFileSync('C:/Users/csbd/.openclaw/workspace/e-commerce-tools/skills/amazon-listing-doctor/llm_debug.log', '[' + new Date().toISOString() + '] network err: ' + e.message + '\n'); reject(e); });
    req.setTimeout(timeoutMs, function() {
      req.destroy();
      var waited = Date.now() - startTime;
      console.log('[llmRequest] timeout after', waited, 'ms (limit was', timeoutMs, 'ms)');
      require('fs').appendFileSync('C:/Users/csbd/.openclaw/workspace/e-commerce-tools/skills/amazon-listing-doctor/llm_debug.log', '[' + new Date().toISOString() + '] timeout after ' + waited + 'ms\n');
      reject(new Error('LLM timeout after ' + waited + 'ms'));
    });
    req.write(body);
    req.end();
  });
}

function buildSystemPrompt() {
  // Instructions are embedded directly in the user prompt (no system message).
  // This prevents the model from adding personality/markdown/analysis.
  return '';
}

// ── Main unified analysis function ───────────────────────────
async function analyzeListing(listing) {
  var title = (listing.title || '').substring(0, 150);
  var bulletsRaw = (listing.bullets || []);
  // Truncate each bullet to 80 chars to keep body size manageable
  var bullets = bulletsRaw.slice(0, 4).map(function(b) { return b.substring(0, 80); }).join('\n');
  var fullText = title + '\n' + bullets;

  // Pre-check: V7 (title char limit) — only structural check done via regex
  var charLimitViolation = null;
  if (title.length > 200) {
    charLimitViolation = {
      id: 'V7',
      rule: 'Title exceeds 200 characters',
      matched: title.substring(0, 50) + '...',
      location: 'title',
      severity: 'high',
      explanation: 'Title is ' + title.length + ' chars — exceeds Amazon 200-char limit'
    };
  }

  var systemPrompt = buildSystemPrompt();
  var userPrompt = 'You are an Amazon listing compliance analyst. Always return VALID JSON only -- no markdown, no explanation, no preamble. JSON schema:\n{"violations":[{"id":"V1","rule":"unsubstantiated superlatives","matched":"exact text","location":"title|bullet:N","severity":"high|medium"}],"egeoScores":[{"questionId":"Q1","category":"Use Case","score":1-5,"reason":"evidence from listing","suggestions":["action"]}],"implicitViolations":[{"id":"V9","rule":"vague claim","matched":"text","location":"title|bullet:N","severity":"medium|high"}],"summary":"2-sentence assessment"}\n\nDetect V1-V8 explicit violations: V1=superlatives(#1/Best/Most), V2=competitor comparison, V3=health claims, V4=price language, V5=scarcity, V6=misleading cert, V7=title>200chars, V8=contradictory warranty. E-GEO scoring (1=absent, 5=fully present): Q1=Use Case(who/where), Q2=Dimensions(numeric specs), Q3=Durability(material/longevity), Q4=Warranty(period), Q5=Safety(certifications). Detect V9-V16 implicit violations. Be strict--flag when uncertain.\n\nAnalyze this Amazon listing:\n\nTitle:\n' + title + '\n\nBullet Points:\n' + bullets + '\n\nJSON:';

  var llmResult = await callLLMWithRetry(userPrompt, systemPrompt, 1, 120000);

  if (!llmResult) {
    // LLM failed — return char limit check only, flag partial failure
    return {
      violations: charLimitViolation ? [charLimitViolation] : [],
      egeoScores: [],
      implicitViolations: [],
      missingFeatures: 0,
      egeoFeatures: [],
      method: 'llm_failed_char_check_only',
      summary: '⚠️ LLM analysis unavailable. Only structural checks applied. Manual review recommended.'
    };
  }

  // Parse LLM JSON response
  var parsed = null;
  try {
    // Try direct parse first
    parsed = JSON.parse(llmResult);
  } catch(e) {
    // Try extracting JSON from markdown or partial response
    var jsonMatch = llmResult.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch(e2) { /* still failed */ }
    }
  }

  if (!parsed || !parsed.egeoScores) {
    // LLM returned unparseable response — fallback to char limit only
    return {
      violations: charLimitViolation ? [charLimitViolation] : [],
      egeoScores: [],
      implicitViolations: [],
      missingFeatures: 0,
      egeoFeatures: [],
      method: 'llm_unparseable_char_check_only',
      summary: '⚠️ LLM response unparseable. Only structural checks applied. ' + llmResult.substring(0, 100)
    };
  }

  // Build egeoFeatures from egeoScores (LLM-driven, not regex-driven)
  var featureMap = {
    Q1: { id: 'usecase',     label: 'Specific use case scenarios',              required: true },
    Q2: { id: 'dimension',   label: 'Numeric specs (dimensions/weight/capacity)', required: true },
    Q3: { id: 'quality',     label: 'Material quality or durability claim',        required: true },
    Q4: { id: 'warranty',    label: 'Warranty or guarantee statement',             required: true },
    Q5: { id: 'safety',      label: 'Safety claims or certifications',             required: false }
  };

  var egeoFeatures = [];
  var egeoFeatureExtra = [
    { id: 'certification', label: 'Third-party certification (ETL/UL/CE)',    required: false },
    { id: 'social_proof',  label: 'Social proof (reviews/ratings/testimonials)',  required: false },
    { id: 'urgency',       label: 'Urgency or scarcity signal',                  required: false },
    { id: 'scannable',     label: 'Scannable structure (separators/bullets)',   required: false },
    { id: 'ranking',       label: 'Ranking/award claim',                         required: false }
  ];

  (parsed.egeoScores || []).forEach(function(s) {
    var qId = s.questionId || '';
    var featDef = featureMap[qId];
    if (featDef) {
      egeoFeatures.push({
        id: featDef.id,
        label: featDef.label,
        score: s.score,
        missing: s.score < 3, // score 1-2 = missing
        required: featDef.required
      });
    }
  });

  // Add extra features (certification, social proof, urgency, scannable, ranking)
  // These are detected from the full text context by LLM
  var extraIds = egeoFeatures.map(function(f) { return f.id; });
  egeoFeatureExtra.forEach(function(f) {
    if (extraIds.indexOf(f.id) === -1) {
      egeoFeatures.push({
        id: f.id,
        label: f.label,
        missing: true,
        required: f.required
      });
    }
  });

  // Count missing features (for KPI)
  var missingFeatures = egeoFeatures.filter(function(f) { return f.missing; }).length;

  // Add char limit violation if present
  var violations = (parsed.violations || []).slice();
  if (charLimitViolation) violations.unshift(charLimitViolation);

  // Classify implicit violations severity
  var implicitViolations = (parsed.implicitViolations || []).map(function(v) {
    return {
      id: v.id,
      rule: v.rule,
      matched: v.matched,
      location: v.location,
      severity: v.severity || 'medium',
      explanation: v.explanation
    };
  });

  // E-GEO average score
  var validScores = (parsed.egeoScores || []).filter(function(s) { return typeof s.score === 'number' && s.score >= 1 && s.score <= 5; });
  var avgScore = validScores.length > 0
    ? Math.round(validScores.reduce(function(s, q) { return s + q.score; }, 0) / validScores.length * 10) / 10
    : null;

  return {
    violations: violations,
    totalViolations: violations.length,
    egeoScores: parsed.egeoScores || [],
    egeoFeatures: egeoFeatures,
    missingFeatures: missingFeatures,
    implicitViolations: implicitViolations,
    implicitViolationCount: implicitViolations.length,
    averageScore: avgScore,
    method: 'llm_semantic',
    summary: parsed.summary || ''
  };
}

// ── Generate Optimized Titles ────────────────────────────────
async function generateOptimizedTitles(listing) {
  var title = (listing.title || '').substring(0, 200);
  var brand = listing.brand || '';
  var coreProduct = listing.coreProduct || '';
  var primaryKw = (listing.primaryKeywords || []).slice(0, 6);
  var violations = listing.violations || [];

  var userPrompt = 'You are an Amazon listing title strategist. Write THREE natural-language titles for the product below.\n\nRULES:\n- Each title must be a readable sentence/phrase, NOT a keyword list\n- Include brand if available: "' + brand + '"\n- Include product type: "' + coreProduct + '"\n- Max 200 characters each\n- Do NOT use commas as separators only — use them to separate meaningful clauses\n- Do NOT repeat words\n- Do NOT use superlatives (#1, Best, Most) or unverified claims\n- Address any current violations in the original title\n\nReturn ONLY valid JSON like this (no markdown, no explanation):\n{"versionA":{"text":"...","chars":N,"note":"..."},"versionB":{"text":"...","chars":N,"note":"..."},"versionC":{"text":"...","chars":N,"note":"..."}}\n\nversionA = Maximum keyword coverage, ~160-200 chars\nversionB = Balanced / shopper-friendly, ~100-140 chars\nversionC = Compact / mobile-first, ~60-100 chars\n\nOriginal title: ' + title + '\nBrand: ' + brand + '\nProduct type: ' + coreProduct + '\nPrimary keywords: ' + primaryKw.join(', ') + '\nViolations to fix: ' + (violations.length > 0 ? violations.map(function(v){return v.rule + ' (' + v.severity + ')';}).join('; ') : 'none') + '\n\nJSON:';

  var result = await callLLMWithRetry(userPrompt, '', 1, 120000);
  if (!result) return null;
  try {
    var parsed = JSON.parse(result);
    if (parsed.versionA && parsed.versionA.text) parsed.versionA.chars = parsed.versionA.text.length;
    if (parsed.versionB && parsed.versionB.text) parsed.versionB.chars = parsed.versionB.text.length;
    if (parsed.versionC && parsed.versionC.text) parsed.versionC.chars = parsed.versionC.text.length;
    return parsed;
  } catch(e) {
    var m = result.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch(e2) {} }
    return null;
  }
}

// ── Generate Optimized Bullets ────────────────────────────────
async function generateOptimizedBullets(listing) {
  var bullets = (listing.bullets || []).slice(0, 5);
  var violations = listing.violations || [];
  var implicitViolations = listing.implicitViolations || [];
  var missingEgeo = (listing.missingEgeo || []).map(function(f) { return f.label || f; });
  var bulletTexts = bullets.map(function(b, i) { return 'Bullet ' + (i+1) + ': ' + b; }).join('\n');

  var allIssues = [].concat(violations).concat(implicitViolations);
  var issuesByBullet = {};
  allIssues.forEach(function(v) {
    var loc = v.location || '';
    var match = loc.match(/bullet:?(\d+)/i);
    if (match) {
      var bn = parseInt(match[1]);
      if (!issuesByBullet[bn]) issuesByBullet[bn] = [];
      issuesByBullet[bn].push(v);
    }
  });

  var userPrompt = 'You are an Amazon listing copywriter. Rewrite the bullet points below to fix violations and fill E-GEO gaps.\n\nRULES:\n- Each bullet must be a complete, benefit-driven sentence (NOT a fragment)\n- Minimum 60 characters per bullet\n- Fix violations: ' + (allIssues.length > 0 ? allIssues.map(function(v){return v.rule + ' in ' + v.location + ': "' + (v.matched||'').substring(0,50) + '"';}).join('; ') : 'none') + '\n- Fill E-GEO gaps: ' + (missingEgeo.length > 0 ? missingEgeo.join(', ') : 'none') + '\n- Keep true/factual claims unchanged\n- Do NOT add false claims\n- Write in the same language as the original bullet\n\nReturn ONLY valid JSON like this (no markdown, no explanation):\n{"bullets":[{"index":1,"original":"...","rewritten":"...","actions":["...","..."]},...]}\n\nOriginal bullets:\n' + bulletTexts + '\n\nJSON:';

  var result = await callLLMWithRetry(userPrompt, '', 1, 120000);
  if (!result) return null;
  try {
    var parsed = JSON.parse(result);
    return parsed;
  } catch(e) {
    var m = result.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch(e2) {} }
    return null;
  }
}

module.exports = { analyzeListing, generateOptimizedTitles, generateOptimizedBullets, callLLMWithRetry, buildSystemPrompt };
