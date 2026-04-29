#!/usr/bin/env node
/**
 * md_to_checkpoints.js — v1.8
 *
 * 职责：将 Claude session 输出的 analysis.md 解析为 step5-14.json，
 *       然后调用 report_gen.js 重新生成 HTML 报告。
 *
 * 使用方式：
 *   node md_to_checkpoints.js <ASIN>
 *
 * 输入文件：
 *   checkpoints/[ASIN]/analysis.md
 *
 * 输出文件：
 *   checkpoints/[ASIN]/step5.json ~ step14.json
 *   reports/[ASIN]/[ASIN].html
 *
 * analysis.md 必须使用以下固定 section 标题（由 SKILL.md 规定）：
 *   ## STEP_5  关键词分级
 *   ## STEP_6  标题审计
 *   ## STEP_7  三版优化标题
 *   ## STEP_8  Backend Keywords
 *   ## STEP_9  Bullet 改写
 *   ## STEP_10 Rufus 意图问题
 *   ## STEP_11 Cosmo 内容评分
 *   ## STEP_12 违规检测
 *   ## STEP_13 Listing Weight
 *   ## STEP_14 行动计划
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
const REPORT_DIR     = path.join(WORKSPACE, 'amazon-listing-doctor', 'reports');
const SKILL_DIR      = __dirname;

function die(msg) { console.error('[md2cp] FATAL: ' + msg); process.exit(1); }
function log(msg) { console.error('[md2cp] ' + msg); }

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ── Section 标题定义 ─────────────────────────────────────────
// key: step 编号，value: 正则（匹配 ## STEP_N 开头的行，忽略后面的中文说明）
const SECTION_PATTERNS = [
  { step: 5,  re: /^##\s+STEP_5\b/i  },
  { step: 6,  re: /^##\s+STEP_6\b/i  },
  { step: 7,  re: /^##\s+STEP_7\b/i  },
  { step: 8,  re: /^##\s+STEP_8\b/i  },
  { step: 9,  re: /^##\s+STEP_9\b/i  },
  { step: 10, re: /^##\s+STEP_10\b/i },
  { step: 11, re: /^##\s+STEP_11\b/i },
  { step: 12, re: /^##\s+STEP_12\b/i },
  { step: 13, re: /^##\s+STEP_13\b/i },
  { step: 14, re: /^##\s+STEP_14\b/i },
];

// ── 切割 md 为各 section ────────────────────────────────────
function splitSections(mdText) {
  var lines = mdText.split('\n');
  var sections = {};   // step -> 该 section 的原始文本行数组
  var current  = null; // 当前 step 编号

  lines.forEach(function(line) {
    // 检查是否命中 section 标题
    var hit = SECTION_PATTERNS.find(function(p) { return p.re.test(line); });
    if (hit) {
      current = hit.step;
      sections[current] = [];
      return; // 标题行本身不纳入内容
    }
    if (current !== null) {
      sections[current] = sections[current] || [];
      sections[current].push(line);
    }
  });

  // 把行数组转换成字符串，去掉首尾空行
  var result = {};
  Object.keys(sections).forEach(function(step) {
    result[step] = sections[step].join('\n').trim();
  });
  return result;
}

// ── 通用工具函数 ──────────────────────────────────────────────

// 从 md 文本里提取 JSON（支持 ```json 围栏和裸 JSON）
function extractJson(text) {
  // 优先找 ```json ... ``` 围栏
  var fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch(e) {}
  }
  // 找第一个 { 或 [ 到匹配结尾
  var start = text.search(/[{\[]/);
  if (start === -1) return null;
  var bracket = text[start] === '{' ? ['{', '}'] : ['[', ']'];
  var depth = 0, end = -1;
  for (var i = start; i < text.length; i++) {
    if (text[i] === bracket[0]) depth++;
    else if (text[i] === bracket[1]) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  try { return JSON.parse(text.substring(start, end + 1)); } catch(e) { return null; }
}

// 把文本里的 bullet list 行解析成字符串数组
// 支持 "- item" / "* item" / "1. item" 格式
function parseListItems(text) {
  return text.split('\n')
    .map(function(l) { return l.replace(/^[\s]*[-*]\s+/, '').replace(/^[\s]*\d+\.\s+/, '').trim(); })
    .filter(function(l) { return l.length > 0; });
}

// ── Step 解析器 ───────────────────────────────────────────────

// STEP_5: 关键词分级
// 格式：JSON 对象，或用 ### Primary / ### Secondary / ### Backend 分节的列表
function parseStep5(text) {
  // 优先尝试 JSON
  var json = extractJson(text);
  if (json && json.primary) return json;

  // Fallback: 解析分节列表
  var result = { primary: [], secondary: [], backend: [], sizeSignals: [] };

  var sections = { primary: /###?\s*primary/i, secondary: /###?\s*secondary/i, backend: /###?\s*backend/i };
  var lines = text.split('\n');
  var current = null;

  lines.forEach(function(line) {
    if (sections.primary.test(line))   { current = 'primary';   return; }
    if (sections.secondary.test(line)) { current = 'secondary'; return; }
    if (sections.backend.test(line))   { current = 'backend';   return; }
    if (!current) return;

    // 解析 "- keyword (N/M, X%)" 或 "- keyword"
    var m = line.match(/^[\s]*[-*]\s+(.+?)(?:\s+[\(\[]([^\)\]]+)[\)\]])?$/);
    if (m) {
      var kw = m[1].trim();
      var freq = m[2] ? m[2].trim() : '';
      if (current === 'backend') {
        result.backend.push(typeof kw === 'string' ? kw : kw);
      } else {
        result[current].push(freq ? { keyword: kw, freq: freq, note: '' } : kw);
      }
    }
  });

  // 从文本里提取 size signals
  var sizeMatch = text.match(/size[\s\S]*?:[\s\S]*?([\d"']+[^,\n]*)/i);
  if (sizeMatch) result.sizeSignals = [sizeMatch[1].trim()];

  // 尝试提取 competitorCount
  var countMatch = text.match(/(\d+)\s*(?:个)?竞品/);
  if (countMatch) result.competitorCount = parseInt(countMatch[1]);

  return result;
}

// STEP_6: 标题审计
// 格式：JSON，或 "- [severity] issue: detail" 列表
function parseStep6(text) {
  var json = extractJson(text);
  if (json && json.issues) {
    if (!json.spellErrors) json.spellErrors = [];
    return json;
  }

  var issues = [];
  var lines = text.split('\n');
  lines.forEach(function(line) {
    // 匹配 "- 🔴 / 🟡 / ✅ 标题文字" 或 "[critical/high/medium/low] ..."
    var sev = 'medium';
    if (/critical|🔴|严重/i.test(line))         sev = 'critical';
    else if (/high|⚠️|🟠|高/i.test(line))        sev = 'high';
    else if (/medium|🟡|中/i.test(line))         sev = 'medium';
    else if (/low|🟢|低/i.test(line))            sev = 'low';
    else if (/✅|ok|good/i.test(line))           return; // 跳过 OK 项

    var clean = line.replace(/^[\s\-*]+/, '').replace(/[🔴🟡🟠🟢✅⚠️]/g, '').trim();
    if (clean.length < 5) return;

    // 尝试分割 "issue: detail"
    var colonIdx = clean.indexOf('：') !== -1 ? clean.indexOf('：') : clean.indexOf(':');
    var issue  = colonIdx > 0 ? clean.substring(0, colonIdx).trim() : clean;
    var detail = colonIdx > 0 ? clean.substring(colonIdx + 1).trim() : '';

    if (issue) issues.push({ severity: sev, issue: issue, detail: detail });
  });

  // 提取字符数
  var charMatch = text.match(/(\d+)\s*chars?\b/i) || text.match(/字符[\s:：]*(\d+)/);
  var charCount = charMatch ? parseInt(charMatch[1]) : 0;
  var scoreMatch = text.match(/(?:score|分数|得分)[\s:：]*(\d+)/i);

  return {
    issues: issues,
    spellErrors: [],
    score: scoreMatch ? parseInt(scoreMatch[1]) : null,
    charCount: charCount || 0
  };
}

// STEP_7: 三版优化标题
// 格式：JSON，或分段文本 "Version A / Version B / Version C"
function parseStep7(text) {
  var json = extractJson(text);
  if (json && json.versionA) {
    if (!json.versionAChars && json.versionA) json.versionAChars = json.versionA.length;
    if (!json.versionBChars && json.versionB) json.versionBChars = json.versionB.length;
    if (!json.versionCChars && json.versionC) json.versionCChars = json.versionC.length;
    if (!json.versionANote) json.versionANote = '';
    if (!json.versionBNote) json.versionBNote = '';
    if (!json.versionCNote) json.versionCNote = '';
    return json;
  }

  // Fallback：逐行解析
  var result = { versionA: '', versionB: '', versionC: '', versionANote: '', versionBNote: '', versionCNote: '' };
  var currentVer = null;
  var lines = text.split('\n');

  lines.forEach(function(line) {
    if (/version\s*[aA]|版本\s*[aA]/i.test(line) && !line.includes('chars') && !line.includes('字符')) {
      currentVer = 'A'; return;
    }
    if (/version\s*[bB]|版本\s*[bB]/i.test(line) && !line.includes('chars') && !line.includes('字符')) {
      currentVer = 'B'; return;
    }
    if (/version\s*[cC]|版本\s*[cC]/i.test(line) && !line.includes('chars') && !line.includes('字符')) {
      currentVer = 'C'; return;
    }
    if (!currentVer) return;

    var clean = line.replace(/^[\s\-*>`]+/, '').trim();
    if (!clean) return;

    // 括号内是字符数或说明
    if (/^\d+\s*chars?/i.test(clean) || /字符数/.test(clean)) return;

    var key = 'version' + currentVer;
    // 第一行有内容的就是标题文本，后面是注释
    if (!result[key]) {
      result[key] = clean;
    } else if (!result[key + 'Note']) {
      result[key + 'Note'] = clean;
    }
  });

  if (result.versionA) result.versionAChars = result.versionA.length;
  if (result.versionB) result.versionBChars = result.versionB.length;
  if (result.versionC) result.versionCChars = result.versionC.length;

  return result;
}

// STEP_8: Backend Keywords
// 格式：JSON，或一段纯文本（空格分隔的关键词）
function parseStep8(text) {
  var json = extractJson(text);
  if (json && json.backend) {
    if (!json.byteCount) json.byteCount = Buffer.byteLength(json.backend, 'utf8');
    return json;
  }

  // Fallback：提取第一段连续的小写词字符串
  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  var backend = '';

  // 找最长的一行（关键词字符串往往是最长的一行）
  var candidate = lines.reduce(function(best, l) {
    return l.length > best.length ? l : best;
  }, '');

  // 清理：去掉引号、去掉 "Backend Keywords:" 前缀
  backend = candidate
    .replace(/^["`']|["`']$/g, '')
    .replace(/^backend\s*keywords?\s*[:：]/i, '')
    .trim()
    .toLowerCase();

  return {
    backend: backend,
    byteCount: Buffer.byteLength(backend, 'utf8'),
    charLimit: 250
  };
}

// STEP_9: Bullet 改写
// 格式：JSON，或分块的 "Bullet 1 / Original / Rewrite" 格式
function parseStep9(text) {
  var json = extractJson(text);
  if (json && json.bullets) return json;

  var bullets = [];
  // 按 "Bullet N" 或 "B1/B2..." 切块
  var blocks = text.split(/\n(?=(?:###?\s*)?Bullet\s*\d|(?:###?\s*)?B\d\s*[：:])/i);

  blocks.forEach(function(block) {
    if (!block.trim()) return;
    var lines = block.split('\n');

    var original = '', rewrite = '', explain = '';
    var mode = null;

    lines.forEach(function(line) {
      var l = line.replace(/^[\s\-*>]+/, '').trim();
      if (!l) return;

      if (/^(?:原文|original)[：:]/i.test(l))  { mode = 'original'; original = l.replace(/^(?:原文|original)[：:]\s*/i, ''); return; }
      if (/^(?:改写|rewrite)[：:]/i.test(l))   { mode = 'rewrite';  rewrite  = l.replace(/^(?:改写|rewrite)[：:]\s*/i, ''); return; }
      if (/^(?:说明|explain(?:ation)?)[：:]/i.test(l)) { mode = 'explain'; explain = l.replace(/^(?:说明|explain(?:ation)?)[：:]\s*/i, ''); return; }

      // 没有明确标签时按顺序累积
      if (mode === 'original' && !rewrite) original += ' ' + l;
      else if (mode === 'rewrite' && !explain) rewrite += ' ' + l;
      else if (mode === 'explain') explain += ' ' + l;
    });

    if (rewrite || original) {
      bullets.push({
        original:    original.trim(),
        rewrite:     rewrite.trim(),
        explain:     explain.trim(),
        factCheck:   { passed: true, claims: [] }
      });
    }
  });

  return { bullets: bullets };
}

// STEP_10: Rufus 意图问题
// 格式：JSON，或编号列表 "1. ..." / "Q1: ..."
function parseStep10(text) {
  var json = extractJson(text);
  if (json && json.questions) return json;

  var questions = text.split('\n')
    .map(function(l) { return l.replace(/^[\s]*(?:[Q\d]+[\.:]\s*|[-*]\s*)/, '').trim(); })
    .filter(function(l) { return l.length > 20; }) // 过滤太短的行（非问题文本）
    .slice(0, 3); // 严格取前3个

  return { questions: questions };
}

// STEP_11: Cosmo 内容评分
// 格式：JSON，或 "Q1: ... Score: 5/3/0 ... Evidence: ... Enhancement: ..." 分块
function parseStep11(text) {
  var json = extractJson(text);
  if (json && json.scores) {
    if (json.averageScore == null && json.avg != null) json.averageScore = json.avg;
    if (json.averageScore == null && json.scores.length > 0) {
      json.averageScore = json.scores.reduce(function(s, q) { return s + (q.score || 0); }, 0) / json.scores.length;
    }
    return json;
  }

  var scores = [];
  // 按 Q1/Q2/Q3 切块
  var blocks = text.split(/\n(?=Q\d[\s:：])/);

  blocks.forEach(function(block) {
    if (!block.trim()) return;
    var lines = block.split('\n');

    var question = '', score = null, label = '', evidence = '', enhancement = '';
    var mode = null;

    lines.forEach(function(line) {
      var l = line.trim();
      if (!l) return;

      // 问题文本（Q1: ...）
      var qMatch = l.match(/^Q\d[\s:：]\s*(.+)/);
      if (qMatch) { question = qMatch[1].trim(); return; }

      // 分数行 "Score: 5" 或 "得分：3"
      var scoreMatch = l.match(/(?:score|得分|分数)[：:\s]*([053])/i);
      if (scoreMatch) {
        score = parseInt(scoreMatch[1]);
        // 提取 label
        if (/directly|直接/i.test(l))      label = 'Directly Addresses';
        else if (/implicit|间接/i.test(l)) label = 'Implicitly Addresses';
        else if (/missing|缺失|未/i.test(l)) label = 'Missing';
        else label = score === 5 ? 'Directly Addresses' : score === 3 ? 'Implicitly Addresses' : 'Missing';
        return;
      }

      if (/^(?:evidence|匹配|对应)[：:]/i.test(l)) { mode = 'evidence'; evidence = l.replace(/^[^：:]+[：:]\s*/, ''); return; }
      if (/^(?:enhancement|建议|改写)[：:]/i.test(l)) { mode = 'enhancement'; enhancement = l.replace(/^[^：:]+[：:]\s*/, ''); return; }

      if (mode === 'evidence')     evidence    += ' ' + l;
      else if (mode === 'enhancement') enhancement += ' ' + l;
    });

    if (question && score !== null) {
      var entry = { question: question, score: score, label: label, evidence: evidence.trim() };
      if (enhancement) entry.enhancement = enhancement.trim();
      scores.push(entry);
    }
  });

  var avg = scores.length > 0
    ? scores.reduce(function(s, q) { return s + q.score; }, 0) / scores.length
    : 0;

  return { scores: scores, averageScore: parseFloat(avg.toFixed(2)) };
}

// STEP_12: 违规检测
// 格式：JSON，或 "V1: ... / V9: ..." 列表
function parseStep12(text) {
  var json = extractJson(text);
  if (json) {
    // 字段映射：explicit → violations
    if (!json.violations && json.explicit) json.violations = json.explicit;
    if (!json.implicit) json.implicit = [];
    if (!json.violations) json.violations = [];
    return json;
  }

  var violations = [], implicit = [];

  text.split('\n').forEach(function(line) {
    var l = line.replace(/^[\s\-*]+/, '').trim();
    if (!l) return;

    // 匹配 "V1 ..." 或 "V9 ..."
    var vMatch = l.match(/^(V(\d+))\s*[：:]?\s*(.+)/i);
    if (!vMatch) return;

    var id  = vMatch[1].toUpperCase();
    var num = parseInt(vMatch[2]);
    var rest = vMatch[3].trim();

    var sev = /critical|严重/i.test(rest) ? 'critical'
            : /high|高/i.test(rest)       ? 'high'
            : /medium|中/i.test(rest)     ? 'medium'
            : /low|低/i.test(rest)        ? 'low'
            : 'medium';

    var entry = { id: id, severity: sev, rule: id, matched: '', explanation: rest };

    if (num <= 8) violations.push(entry);
    else          implicit.push(entry);
  });

  return { violations: violations, implicit: implicit };
}

// STEP_13: Listing Weight
// 格式：JSON，或表格/列表
function parseStep13(text) {
  var json = extractJson(text);
  if (json && (json.issues || json.summary)) return json;

  var issues = [];
  var summaryLines = [];

  text.split('\n').forEach(function(line) {
    var l = line.trim();
    if (!l) return;

    // 表格行 "| factor | current | action | impact |"
    if (l.startsWith('|')) {
      var cells = l.split('|').map(function(c) { return c.trim(); }).filter(Boolean);
      if (cells.length >= 3 && !/^[-:]+$/.test(cells[0])) {
        issues.push({
          factor:  cells[0],
          current: cells[1],
          action:  cells[2] || '',
          impact:  cells[3] || 'medium'
        });
      }
      return;
    }

    // 非表格行归入 summary
    if (!/^#+/.test(l)) summaryLines.push(l);
  });

  return {
    issues:  issues,
    summary: summaryLines.slice(0, 3).join(' ').trim()
  };
}

// STEP_14: 行动计划
// 格式：JSON，或 "P0/P1/P2/P3 行动 → 位置 → 影响" 列表
function parseStep14(text) {
  var json = extractJson(text);
  if (json) {
    if (!json.plan && json.actions) json.plan = json.actions;
    if (!json.pendingData) json.pendingData = [];
    return json;
  }

  var plan = [], pendingData = [];

  text.split('\n').forEach(function(line) {
    var l = line.replace(/^[\s\-*]+/, '').trim();
    if (!l) return;

    // 匹配 "P0 ..." 或 "[P1] ..."
    var pMatch = l.match(/^\[?(P[0-3])\]?\s*[：:]?\s*(.+)/i);
    if (pMatch) {
      var priority = pMatch[1].toUpperCase();
      var rest = pMatch[2];

      // 尝试用 → 或 | 分割 action / location / impact
      var parts = rest.split(/\s*[→|]\s*/);
      var action   = parts[0] ? parts[0].trim() : rest;
      var location = parts[1] ? parts[1].trim() : '';
      var impact   = parts[2] ? parts[2].trim() : '';

      // 判断 execType：含"供应商/supplier/确认"的归 supplier，其余为 operator
      var execType = /供应商|supplier|向.*确认|待.*确认/i.test(action) ? 'supplier' : 'operator';

      plan.push({ priority: priority, action: action, location: location, impact: impact, execType: execType });
      return;
    }

    // 待确认数据清单 "□ 数据类型：用途"
    var pendingMatch = l.match(/^[□☐]\s*(.+?)[：:]\s*(.+)/);
    if (pendingMatch) {
      pendingData.push({
        dataType: pendingMatch[1].trim(),
        usedFor:  '',
        purpose:  pendingMatch[2].trim()
      });
    }
  });

  // 提取质量分
  var scoreMatch = text.match(/(?:quality\s*score|质量\s*(?:得分|评分))[：:\s]*(\d+)/i);
  var gradeMatch = text.match(/(?:grade|等级)[：:\s]*([A-F][+\-]?)/i);

  return {
    plan:         plan,
    pendingData:  pendingData,
    qualityScore: scoreMatch ? parseInt(scoreMatch[1]) : null,
    qualityGrade: gradeMatch ? gradeMatch[1] : ''
  };
}

// ── 把 step 编号映射到解析器 ─────────────────────────────────
const PARSERS = {
  5:  parseStep5,
  6:  parseStep6,
  7:  parseStep7,
  8:  parseStep8,
  9:  parseStep9,
  10: parseStep10,
  11: parseStep11,
  12: parseStep12,
  13: parseStep13,
  14: parseStep14,
};

// ── 主流程 ───────────────────────────────────────────────────
async function main() {
  var asin = process.argv[2];
  if (!asin || !asin.match(/^B[A-Z0-9]{9}$/i)) {
    die('Usage: node md_to_checkpoints.js <ASIN>');
  }

  var mdPath = path.join(CHECKPOINT_DIR, asin, 'analysis.md');
  if (!fs.existsSync(mdPath)) {
    die('analysis.md not found: ' + mdPath);
  }

  var mdText = fs.readFileSync(mdPath, 'utf8');
  log('Loaded analysis.md (' + mdText.length + ' chars)');

  // 切割各 section
  var sections = splitSections(mdText);
  var foundSteps = Object.keys(sections).map(Number).sort();
  log('Found sections: STEP_' + foundSteps.join(', STEP_'));

  var cpDir = path.join(CHECKPOINT_DIR, asin);
  ensureDir(cpDir);

  var written = 0, failed = 0, skipped = 0;

  // 逐步解析并写入 checkpoint
  for (var n = 5; n <= 14; n++) {
    var sectionText = sections[n];
    if (!sectionText) {
      log('STEP_' + n + ': section not found in md — skipping');
      skipped++;
      continue;
    }

    var parser = PARSERS[n];
    if (!parser) {
      log('STEP_' + n + ': no parser defined — skipping');
      skipped++;
      continue;
    }

    try {
      var result = parser(sectionText);
      var cpPath = path.join(cpDir, 'step' + n + '.json');
      fs.writeFileSync(cpPath, JSON.stringify(result, null, 2), 'utf8');
      log('STEP_' + n + ': ✅ written (' + JSON.stringify(result).length + ' bytes)');
      written++;
    } catch(e) {
      log('STEP_' + n + ': ❌ parse error — ' + e.message);
      failed++;
    }
  }

  log('');
  log('Result: ' + written + ' written, ' + skipped + ' skipped, ' + failed + ' failed');

  if (written === 0) {
    die('No steps written. Check that analysis.md uses ## STEP_N section headers.');
  }

  // 生成 HTML 报告
  log('');
  log('Generating HTML report...');
  var reportGenPath = path.join(SKILL_DIR, 'report_gen.js');
  if (!fs.existsSync(reportGenPath)) {
    die('report_gen.js not found at ' + reportGenPath);
  }

  try {
    // 清除 require 缓存，确保读取最新 checkpoint
    delete require.cache[require.resolve(reportGenPath)];
    var html = require(reportGenPath).generate(asin);
    var reportDir = path.join(REPORT_DIR, asin);
    ensureDir(reportDir);
    var reportPath = path.join(reportDir, asin + '.html');
    fs.writeFileSync(reportPath, html, 'utf8');
    log('✅ Report: ' + reportPath + ' (' + html.length + ' bytes)');
  } catch(e) {
    log('❌ report_gen failed: ' + e.message);
    log('   Run manually: node report_gen.js ' + asin);
    process.exit(1);
  }

  log('');
  log('══════════════════════════════════════');
  log('  ✅ Done — ' + asin);
  log('  Report: reports/' + asin + '/' + asin + '.html');
  log('══════════════════════════════════════');
}

main().catch(function(e) {
  die(e.message);
});
