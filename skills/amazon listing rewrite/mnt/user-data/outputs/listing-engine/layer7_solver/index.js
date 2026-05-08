/**
 * layer7_solver/index.js — Constraint Solver
 *
 * 职责：对 layer6 生成的 listing 进行约束验证和迭代优化。
 * 流程：generate → score → rewrite → re-score → select best
 *
 * 约束来源：
 *   - 平台字符限制（constraints.json）
 *   - 禁用词（constraints.json）
 *   - 关键词覆盖率（keywords）
 *   - Cosmo 评分（intent）
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const config = require('../core/config.js');

var PLATFORM_DIR = path.join(__dirname, '../layer4_platform');

function loadConstraints(platform) {
  var p = path.join(PLATFORM_DIR, platform, 'constraints.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

// ── 评分函数 ──────────────────────────────────────────────────
function scoreOutput(composed, platform, context) {
  var scores = { total: 0, breakdown: {} };
  var c      = loadConstraints(platform);
  var keywords = context.market.keywords || {};
  var primary  = (keywords.primary || []).map(function(k) { return typeof k === 'string' ? k : k.keyword; });

  if (platform === 'amazon') {
    var title   = composed.title || '';
    var bullets = composed.bullets || [];
    var backend = composed.backend || '';

    // 标题分（30分）
    var titleScore = 0;
    if (title.length >= 80 && title.length <= 200) titleScore += 15;
    else if (title.length > 0) titleScore += 8;
    var titleLower   = title.toLowerCase();
    var primaryInTitle = primary.filter(function(k) { return titleLower.includes(k.toLowerCase()); }).length;
    titleScore += Math.min(15, primaryInTitle * 5);
    scores.breakdown.title = titleScore;

    // Bullet 分（30分）
    var bulletScore = Math.min(30, bullets.length * 6);
    scores.breakdown.bullets = bulletScore;

    // Backend 分（10分）
    var backendScore = composed.byteCount >= 200 ? 10 : composed.byteCount >= 100 ? 6 : 3;
    scores.breakdown.backend = backendScore;

    // Cosmo 分（30分）
    var cosmoScores = (context.conversion && context.conversion.intent &&
                       context.conversion.intent.merged) || [];
    var cosmoAvg = cosmoScores.length > 0
      ? cosmoScores.reduce(function(s, q) { return s + (q.score || 0); }, 0) / cosmoScores.length
      : 0;
    var cosmoScore = Math.round(cosmoAvg / 5 * 30);
    scores.breakdown.cosmo = cosmoScore;

    scores.total = titleScore + bulletScore + backendScore + cosmoScore;

  } else if (platform === 'walmart') {
    var title = composed.title || '';
    var feat  = composed.keyFeatures || [];

    // 标题分（40分）
    var ts = 0;
    if (title.length >= 50 && title.length <= 75) ts += 30;
    else if (title.length > 0 && title.length <= 75) ts += 20;
    else if (title.length > 75) ts += 10;  // 超长扣分
    // 无禁用词
    var forbidden = (c.forbiddenWords || []).some(function(w) {
      return title.toLowerCase().includes(w.toLowerCase());
    });
    if (!forbidden) ts += 10;
    scores.breakdown.title = ts;

    // Key Features 分（35分）
    var fs_ = 0;
    if (feat.length >= 3 && feat.length <= 10) fs_ += 20;
    var allShort = feat.every(function(f) { return f.length <= 80; });
    if (allShort) fs_ += 15;
    scores.breakdown.keyFeatures = fs_;

    // 属性完整度（25分）
    var attrs = composed.attributes || {};
    var attrCount = Object.keys(attrs).filter(function(k) { return !k.startsWith('_'); }).length;
    var attrScore = Math.min(25, attrCount * 5);
    scores.breakdown.attributes = attrScore;

    scores.total = ts + fs_ + attrScore;

  } else if (platform === 'wayfair') {
    var title = composed.title || '';
    var specs = composed.specs || {};

    // 标题分（30分）
    var ts = title.length >= 40 && title.length <= 70 ? 30 :
             title.length > 0 && title.length <= 70 ? 20 : 10;
    scores.breakdown.title = ts;

    // 规格完整度（50分）
    var specCount = Object.keys(specs).filter(function(k) { return !k.startsWith('_'); }).length;
    var specScore = Math.min(50, specCount * 8);
    // 缺失必填属性扣分
    var missingRequired = (specs._missingRequired || []).length;
    specScore = Math.max(0, specScore - missingRequired * 10);
    scores.breakdown.specs = specScore;

    // 合规声明（20分）
    var comp      = composed.compliance || {};
    var compScore = Object.keys(comp).length * 7;
    scores.breakdown.compliance = Math.min(20, compScore);

    scores.total = ts + specScore + Math.min(20, compScore);
  }

  scores.total = Math.min(100, scores.total);
  return scores;
}

// ── 违规检测 ──────────────────────────────────────────────────
function findViolations(composed, platform) {
  var violations = [];
  var c = loadConstraints(platform);
  var platformConf = config.platforms[platform] || {};

  // 字符限制
  if (composed.title) {
    var max = platformConf.titleMaxChars || 200;
    if (composed.title.length > max) {
      violations.push({ field: 'title', rule: 'CharLimit',
        detail: composed.title.length + ' > ' + max + ' chars', severity: 'critical' });
    }
  }

  // 禁用词
  var allText = [
    composed.title || '',
    (composed.bullets || composed.keyFeatures || []).join(' '),
  ].join(' ').toLowerCase();

  (c.forbiddenWords || []).forEach(function(w) {
    if (allText.includes(w.toLowerCase())) {
      violations.push({ field: 'content', rule: 'ForbiddenWord',
        detail: '"' + w + '"', severity: 'high' });
    }
  });

  return violations;
}

// ── LLM 重写 ──────────────────────────────────────────────────
async function rewrite(composed, platform, violations, context) {
  if (violations.length === 0) return composed;

  var issueList = violations.map(function(v) {
    return v.rule + ' on ' + v.field + ': ' + v.detail;
  }).join('\n');

  return new Promise(function(resolve) {
    var body = JSON.stringify({
      model: config.llm.models.default, max_tokens: 1024,
      system: 'You are a ' + platform + ' listing optimization expert. Fix the listed issues and output ONLY the corrected JSON object.',
      messages: [{ role: 'user', content:
        'Platform: ' + platform + '\n' +
        'Issues to fix:\n' + issueList + '\n\n' +
        'Current output:\n' + JSON.stringify(composed, null, 2) + '\n\n' +
        'Output the corrected JSON object only:'
      }]
    });

    var req = http.request({
      hostname: config.llm.gateway.host, port: config.llm.gateway.port,
      path: '/v1/messages', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.llm.gateway.token,
        'x-api-key': config.llm.gateway.token, 'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body) }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var p = JSON.parse(data);
          var text = (p.content||[]).filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('').trim();
          // 提取 JSON
          var start = text.search(/[{\[]/);
          if (start === -1) { resolve(composed); return; }
          var bracket = text[start] === '{' ? ['{','}'] : ['[',']'];
          var depth = 0, end = -1;
          for (var i = start; i < text.length; i++) {
            if (text[i] === bracket[0]) depth++;
            else if (text[i] === bracket[1]) { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end === -1) { resolve(composed); return; }
          var fixed = JSON.parse(text.substring(start, end + 1));
          resolve(Object.assign({}, composed, fixed));
        } catch(e) { resolve(composed); }
      });
    });
    req.setTimeout(60000, function() { req.destroy(); resolve(composed); });
    req.on('error', function() { resolve(composed); });
    req.write(body); req.end();
  });
}

// ── 主入口 ────────────────────────────────────────────────────
async function solve(context) {
  var platforms = Object.keys(context.composed).filter(function(p) {
    var c = context.composed[p];
    return c && (c.title || c.bullets);
  });

  var maxIter   = config.solver.maxIterations;
  var minTarget = config.solver.minScoreTarget * 100;

  for (var pi = 0; pi < platforms.length; pi++) {
    var platform = platforms[pi];
    var composed = context.composed[platform];
    if (!composed) continue;

    console.error('[solver] Solving ' + platform + '...');

    var bestScore     = -1;
    var bestComposed  = composed;
    var allCandidates = [];

    for (var iter = 0; iter < maxIter; iter++) {
      var scores     = scoreOutput(composed, platform, context);
      var violations = findViolations(composed, platform);

      allCandidates.push({
        iteration: iter,
        composed:  composed,
        score:     scores.total,
        breakdown: scores.breakdown,
        violations: violations,
      });

      console.error('[solver] ' + platform + ' iter' + iter +
        ' score:' + scores.total + ' violations:' + violations.length);

      if (scores.total > bestScore) {
        bestScore    = scores.total;
        bestComposed = composed;
      }

      // 目标达成或无违规 → 停止迭代
      if (scores.total >= minTarget && violations.length === 0) break;

      // 最后一次迭代不重写
      if (iter === maxIter - 1) break;

      // 有问题 → 重写
      if (violations.length > 0) {
        composed = await rewrite(composed, platform, violations, context);
      }
    }

    // 写入最终结果
    context.composed[platform]  = bestComposed;
    context.solved.candidates   = context.solved.candidates.concat(allCandidates);
    context.solved.selected[platform] = bestComposed;
    context.solved.iterations   = Math.max(context.solved.iterations, allCandidates.length);

    // 把约束应用情况写入
    var appliedConstraints = findViolations(bestComposed, platform);
    context.solved.constraints = context.solved.constraints.concat(
      appliedConstraints.map(function(v) {
        return { platform: platform, field: v.field, rule: v.rule, resolved: false };
      })
    );

    console.error('[solver] ' + platform + ' final score: ' + bestScore);
  }

  return context;
}

module.exports = { solve };
