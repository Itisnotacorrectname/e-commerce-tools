/**
 * normalizer.js — Amazon Listing Doctor v2
 *
 * 职责：把爬虫抓取的原始平台数据转换成统一 Product Schema。
 * 填充层：identity / attributes / features / useCases / targetAudience
 * 不填充：keywords（keyword_engine 负责）/ imageAnalysis（image_analyzer 负责）
 *
 * 设计原则：
 *   - text_extractor：纯规则，零 LLM，快速、可验证
 *   - llm_extractor：调用 LLM 补充语义层（useCases / targetAudience）
 *   - 两层可独立运行：normalize(raw, { llm: false }) 跳过 LLM 步骤
 */

'use strict';

const { createSchema, merge, FEATURE_CATEGORIES } = require('./product_schema.js');

// ══════════════════════════════════════════════════════════════
//  一、规则提取层（text_extractor）
//  输入：raw 字段（title + bullets + description + category）
//  输出：填充 identity / attributes / features
// ══════════════════════════════════════════════════════════════

// ── 1.1 identity 提取 ─────────────────────────────────────────

// 从 category 路径提取 coreProduct（与现有 step3 逻辑对齐）
function extractCoreProduct(raw) {
  var category = raw.category || '';
  var title    = (raw.title   || '').toLowerCase();

  // 取 category 路径最后一段
  var parts   = category.split('>').map(function(p) { return p.trim(); });
  var catLast = (parts[parts.length - 1] || '').toLowerCase().replace(/s$/, '').trim();

  // 从 title 提取 bigrams
  var words   = title.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function(w) { return w.length > 2; });
  var bigrams = [];
  for (var i = 0; i < words.length - 1; i++) {
    bigrams.push(words[i] + ' ' + words[i + 1]);
  }

  // catLast 词与 title 交叉验证（过滤路径噪音词）
  // 单字 generic 类别词（如 desk/sofa/chair）不单独使用，逼向 bigram
  var catWords  = catLast.split(/\s+/);
  var validated = catWords.filter(function(w) {
    var stripped = w.replace(/s$/, '');
    return w.length > 2 && (title.includes(w) || title.includes(stripped));
  });
  var catCombined = (validated.length >= 2 || (validated.length === 1 && validated[0].split(/[\s_-]/).length >= 2))
    ? validated.join(' ') : '';

  var coreProduct = catCombined || bigrams[0] || catLast || words[0] || '';

  // 超过3词降级
  if (coreProduct.split(' ').length > 3) {
    coreProduct = bigrams[0] || catLast || words[0] || '';
  }

  // 如果 coreProduct 是"品牌名+品类词"（第一词只出现在开头的单字词），跳过 brand 用第二 bigram
  var firstWord = coreProduct.split(' ')[0] || '';
  var titleStartsWithFirst = title.indexOf(firstWord) === 0;
  var firstWordAppearsElsewhere = title.indexOf(' ' + firstWord, 1) >= 0 || title.indexOf('-' + firstWord) >= 0;
  if (titleStartsWithFirst && !firstWordAppearsElsewhere && firstWord.length > 2) {
    var fallback = bigrams.length >= 2 ? bigrams[1] : null;
    if (fallback && fallback.split(' ').filter(function(w) { return w.length > 2; }).length <= 3) {
      coreProduct = fallback;
    }
  }

  return coreProduct;

  return coreProduct;
}

// 从 title 提取 variantSignals（尺寸/颜色/材质规格词）
var VARIANT_PATTERNS = [
  // 尺寸数字
  /\b\d+(?:\.\d+)?(?:"|'|in(?:ch)?|ft|cm|mm|oz|lb|lbs|kg|g|ml|l|gallon|watt|w)\b/gi,
  // 颜色词
  /\b(?:black|white|grey|gray|beige|brown|blue|green|red|pink|purple|gold|silver|bronze|oak|walnut|cherry|rustic|natural)\b/gi,
  // 尺寸名称
  /\b(?:twin|full|queen|king|cal king|california king|small|medium|large|xl|xxl|mini|compact|standard)\b/gi,
  // 常见规格词
  /\b(?:single|double|triple|2-pack|3-pack|set of \d+)\b/gi,
];

function extractVariantSignals(title) {
  var signals = new Set();
  VARIANT_PATTERNS.forEach(function(re) {
    var m;
    var r = new RegExp(re.source, re.flags);
    while ((m = r.exec(title)) !== null) {
      signals.add(m[0].toLowerCase().trim());
    }
  });
  return Array.from(signals);
}

// ── 1.2 attributes 提取 ───────────────────────────────────────

// 尺寸解析
var DIMENSION_UNITS = {
  '"':    { unit: 'inch',   type: 'length'   },
  'in':   { unit: 'inch',   type: 'length'   },
  'inch': { unit: 'inch',   type: 'length'   },
  'ft':   { unit: 'foot',   type: 'length'   },
  'cm':   { unit: 'cm',     type: 'length'   },
  'mm':   { unit: 'mm',     type: 'length'   },
  'lbs':  { unit: 'lbs',    type: 'weight'   },
  'lb':   { unit: 'lbs',    type: 'weight'   },
  'kg':   { unit: 'kg',     type: 'weight'   },
  'oz':   { unit: 'oz',     type: 'weight'   },
  'l':    { unit: 'liter',  type: 'capacity' },
  'ml':   { unit: 'ml',     type: 'capacity' },
  'gal':  { unit: 'gallon', type: 'capacity' },
  'w':    { unit: 'watt',   type: 'power'    },
  'watt': { unit: 'watt',   type: 'power'    },
};

var DIMENSION_KEYWORDS = ['height', 'width', 'depth', 'length', 'diameter',
                          'high', 'wide', 'deep', 'long', 'tall',
                          'h:', 'w:', 'd:', 'l:'];

function parseDimensions(text) {
  var raw    = [];
  var parsed = [];

  // 匹配 "14 inch" / '60"' / "800lbs" 等格式
  var re = /(\d+(?:\.\d+)?)\s*("|in(?:ch(?:es)?)?|ft|cm|mm|lbs?|kg|oz|[lg]al(?:lon)?|ml|w(?:att)?)\b/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    var rawStr  = m[0].trim();
    var val     = parseFloat(m[1]);
    var unitKey = m[2].toLowerCase().replace(/es$/, '').replace(/s$/, '');
    var info    = DIMENSION_UNITS[unitKey] || { unit: unitKey, type: 'unknown' };

    // 尝试识别是哪个维度（前面有没有 height/width 等词）
    var before  = text.substring(Math.max(0, m.index - 20), m.index).toLowerCase();
    var dimType = 'unknown';
    DIMENSION_KEYWORDS.forEach(function(kw) {
      if (before.includes(kw)) dimType = kw.replace(':', '').trim();
    });

    raw.push(rawStr);
    parsed.push({ value: val, unit: info.unit, type: info.type, dimension: dimType, raw: rawStr });
  }

  return { raw: raw, parsed: parsed };
}

// 材质词提取
var MATERIAL_PATTERNS = [
  /\b(?:steel|iron|aluminum|aluminium|alloy|chrome)\b/gi,          // 金属
  /\b(?:wood|oak|walnut|pine|bamboo|mdf|plywood|solid wood)\b/gi,  // 木材
  /\b(?:fabric|velvet|linen|cotton|polyester|leather|faux leather|suede|chenille|boucle|microfiber)\b/gi, // 布料
  /\b(?:plastic|acrylic|abs|polypropylene|nylon|silicone|rubber)\b/gi, // 塑料/橡胶
  /\b(?:glass|tempered glass|crystal)\b/gi,                        // 玻璃
  /\b(?:foam|memory foam|gel|latex|spring)\b/gi,                   // 软垫
  /\b(?:marble|granite|stone|concrete|ceramic)\b/gi,               // 石材/陶瓷
];

function extractMaterials(text) {
  var found = new Set();
  MATERIAL_PATTERNS.forEach(function(re) {
    var m;
    var r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      found.add(m[0].toLowerCase().trim());
    }
  });
  return Array.from(found);
}

// 颜色词提取
var COLOR_RE = /\b(?:black|white|grey|gray|beige|cream|ivory|tan|brown|espresso|walnut|oak|rustic|natural|navy|blue|teal|green|olive|red|wine|burgundy|pink|purple|lavender|gold|brass|silver|bronze|copper|chrome|matte|gloss)\b/gi;

function extractColors(text) {
  var found = new Set();
  var m;
  var r = new RegExp(COLOR_RE.source, COLOR_RE.flags);
  while ((m = r.exec(text)) !== null) {
    found.add(m[0].toLowerCase().trim());
  }
  return Array.from(found);
}

// 承重/容量提取
var CAPACITY_RE = /(\d+(?:\.\d+)?)\s*(?:lbs?|kg|pounds?|tons?|gallon|gal|liters?|ml)\b/gi;

function extractCapacity(text) {
  var raw    = [];
  var parsed = [];
  var m;
  var r = new RegExp(CAPACITY_RE.source, CAPACITY_RE.flags);
  while ((m = r.exec(text)) !== null) {
    raw.push(m[0].trim());
    var unitRaw = m[0].replace(m[1], '').trim().toLowerCase();
    var unit = unitRaw.replace(/s$/, '').replace('pound', 'lb').replace('ton', 'lb');
    parsed.push({ value: parseFloat(m[1]), unit: unit, raw: m[0].trim() });
  }
  return { raw: raw, parsed: parsed };
}

// 认证提取
var CERT_RE = /\b(?:CertiPUR-US|OEKO-TEX|CARB|CE|FCC|UL|ETL|FDA|USDA|ISO[\s-]\d+|GREENGUARD|FSC|BIFMA|ANSI|EN[\s-]\d+|ASTM|Proposition\s*65|Prop\s*65)\b/gi;

function extractCertifications(text) {
  var found = new Set();
  var m;
  var r = new RegExp(CERT_RE.source, CERT_RE.flags);
  while ((m = r.exec(text)) !== null) {
    found.add(m[0].trim());
  }
  return Array.from(found);
}

// 安全声明提取
var SAFETY_RE = /\b(?:BPA.?free|lead.?free|phthalate.?free|non.?toxic|food.?grade|child.?safe|pet.?safe|rounded corners?|blunt edges?|anti.?tip|flame.?retardant|fire.?resistant|waterproof|water.?resistant|anti.?rust|rust.?resistant)\b/gi;

function extractSafetyClaims(text) {
  var found = new Set();
  var m;
  var r = new RegExp(SAFETY_RE.source, SAFETY_RE.flags);
  while ((m = r.exec(text)) !== null) {
    found.add(m[0].toLowerCase().trim());
  }
  return Array.from(found);
}

// ── 1.3 features 提取 ─────────────────────────────────────────

// Feature 分类规则（信号词 → category）
var FEATURE_SIGNALS = {
  assembly:    /\b(?:assembl|install|tool.free|setup|step.by.step|minutes?|instructions?)\b/i,
  storage:     /\b(?:storage|drawer|shelf|shelve|organize|compartment|pocket|hidden|under.bed)\b/i,
  stability:   /\b(?:sturdy|stable|wobble.free|heavy.duty|reinforced|brace|anti.wobble|load.bearing|weight.capacity|lbs)\b/i,
  aesthetic:   /\b(?:modern|rustic|minimalist|elegant|style|design|finish|look|appearance|sleek)\b/i,
  comfort:     /\b(?:comfort|cushion|padded|foam|plush|soft|ergonomic|lumbar|breathable)\b/i,
  safety:      /\b(?:safe|rounded|blunt|anti.tip|non.toxic|BPA|child|pet|flame)\b/i,
  compatibility: /\b(?:compatible|fit|works with|universal|adjustable|convertible|standard)\b/i,
  durability:  /\b(?:durable|long.lasting|wear.resistant|scratch.resistant|waterproof|rust.resistant|solid)\b/i,
  smart:       /\b(?:LED|USB|charging|bluetooth|wireless|remote|smart|sensor|adjustable brightness)\b/i,
  eco:         /\b(?:eco|sustainabl|recycled|organic|FSC|certified|green|natural)\b/i,
  convenience: /\b(?:easy.clean|washable|foldable|collapsible|stackable|compact|space.saving|lightweight)\b/i,
};

function categorizeFeature(text) {
  for (var cat in FEATURE_SIGNALS) {
    if (FEATURE_SIGNALS[cat].test(text)) return cat;
  }
  return 'other';
}

// 从 bullets 里提取 features
function extractFeatures(raw) {
  var features = [];
  var bullets  = raw.bullets || [];

  bullets.forEach(function(bullet, idx) {
    if (!bullet) return;
    var source = 'bullet_' + (idx + 1);

    // 每条 bullet 可能包含多个 feature（按句号/分号切割）
    var sentences = bullet.split(/[.;]/).map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 10; });

    sentences.forEach(function(sentence) {
      var category = categorizeFeature(sentence);
      // 过滤太短或纯修饰性的句子
      if (sentence.length < 15) return;

      features.push({
        text:     sentence,
        category: category,
        source:   source,
        verified: true, // 来自原文，天然可验证
      });
    });
  });

  // 从 title 也提取一条 feature（通常包含最核心的卖点）
  if (raw.title) {
    var titleFeature = raw.title.replace(/^[^,–—]+[,–—]\s*/, ''); // 去掉品牌+核心品类词
    if (titleFeature && titleFeature !== raw.title && titleFeature.length > 10) {
      features.push({
        text:     titleFeature.trim(),
        category: categorizeFeature(titleFeature),
        source:   'title',
        verified: true,
      });
    }
  }

  return features;
}

// ── 1.4 全文本合并工具 ───────────────────────────────────────
function getFullText(raw) {
  return [
    raw.title || '',
    (raw.bullets || []).join(' '),
    raw.description || '',
  ].join(' ');
}


// ══════════════════════════════════════════════════════════════
//  二、LLM 提取层（llm_extractor）
//  填充：useCases / targetAudience
//  依赖 OpenClaw Gateway（可跳过）
// ══════════════════════════════════════════════════════════════

const http = require('http');

var GATEWAY_HOST  = '127.0.0.1';
var GATEWAY_PORT  = 18789;
var GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3';
var LLM_MODEL     = process.env.NORMALIZER_LLM_MODEL   || 'minimax/MiniMax-M2.7';
var LLM_TIMEOUT   = 60000;

function callLLM(prompt) {
  return new Promise(function(resolve, reject) {
    var body = JSON.stringify({
      model:      LLM_MODEL,
      max_tokens: 1024,
      system:     'You are a precise product analyst. Output ONLY valid JSON, no markdown, no explanation.',
      messages:   [{ role: 'user', content: prompt }]
    });

    var req = http.request({
      hostname: GATEWAY_HOST,
      port:     GATEWAY_PORT,
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'Authorization':     'Bearer ' + GATEWAY_TOKEN,
        'x-api-key':         GATEWAY_TOKEN,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var parsed  = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message || JSON.stringify(parsed.error))); return; }
          var text = (parsed.content || [])
            .filter(function(b) { return b.type === 'text'; })
            .map(function(b) { return b.text; }).join('');
          resolve(text);
        } catch(e) { reject(new Error('LLM parse error: ' + e.message)); }
      });
    });

    req.setTimeout(LLM_TIMEOUT, function() { req.destroy(); reject(new Error('LLM timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function extractJsonFromLLM(text) {
  // 先试整体
  try { return JSON.parse(text.trim()); } catch(e) {}
  // 去围栏
  var fenced = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch(e) {} }
  // 找第一个 {
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

// LLM 提取 useCases + targetAudience（一次调用，两个字段一起提取）
async function extractSemanticLayers(raw, features) {
  var featureSummary = features.slice(0, 8).map(function(f) { return f.text; }).join('\n');

  var prompt = [
    'Product title: ' + raw.title,
    'Key bullets:',
    (raw.bullets || []).slice(0, 5).map(function(b, i) { return (i+1) + '. ' + b; }).join('\n'),
    '',
    'Extracted features:',
    featureSummary,
    '',
    'Task: Extract useCases and targetAudience from this product listing.',
    '',
    'Output JSON:',
    '{',
    '  "useCases": [',
    '    { "label": "home office", "confidence": 0.9, "evidence": ["exact text from bullets that supports this"], "source": "text" }',
    '  ],',
    '  "targetAudience": {',
    '    "demographic": [',
    '      { "label": "adults", "confidence": 0.95, "evidence": ["supporting text"] }',
    '    ],',
    '    "situational": [',
    '      { "label": "first-time buyers", "confidence": 0.7, "evidence": ["supporting text"] }',
    '    ]',
    '  }',
    '}',
    '',
    'Rules:',
    '- Only include useCases with confidence >= 0.6',
    '- Only include targetAudience labels with confidence >= 0.5',
    '- Evidence must be exact phrases from the title or bullets above',
    '- Do not invent scenarios not supported by the text',
    '- Max 5 useCases, max 4 demographic labels, max 5 situational labels',
  ].join('\n');

  var raw_text = await callLLM(prompt);
  var result   = extractJsonFromLLM(raw_text);

  if (!result) return null;
  return result;
}


// ══════════════════════════════════════════════════════════════
//  三、主入口：normalize(raw, options)
// ══════════════════════════════════════════════════════════════

/**
 * normalize(raw, options) → Product Schema
 *
 * @param {object} raw       - 爬虫原始数据（step2.json 内容）
 * @param {object} options   - 选项
 *   @param {string} options.asin        - ASIN
 *   @param {string} options.platform    - "amazon" | "walmart" | ...
 *   @param {string} options.marketplace - "US" | "UK" | ...
 *   @param {boolean} options.llm        - 是否运行 LLM 提取层（默认 true）
 *
 * @returns {Promise<object>} Product Schema
 */
async function normalize(raw, options) {
  options = options || {};

  var schema = createSchema();

  // ── meta ────────────────────────────────────────────────────
  schema.meta.asin        = options.asin        || raw.asin        || null;
  schema.meta.platform    = options.platform    || 'amazon';
  schema.meta.marketplace = options.marketplace || raw.marketplace || 'US';
  schema.meta.url         = raw.url             || null;
  schema.meta.scrapedAt   = raw.scrapedAt       || new Date().toISOString();

  // ── raw（原始数据快照）──────────────────────────────────────
  schema.raw.title       = raw.title       || null;
  schema.raw.bullets     = raw.bullets     || [];
  schema.raw.description = raw.description || null;
  schema.raw.price       = raw.price       || null;
  schema.raw.currency    = raw.currency    || 'USD';
  schema.raw.rating      = parseFloat(raw.rating) || null;
  schema.raw.reviewCount = raw.reviewCount || null;
  schema.raw.BSR         = raw.BSR         || null;
  schema.raw.category    = raw.category    || null;
  schema.raw.brand       = raw.brand       || null;
  schema.raw.images      = raw.images      || [];
  schema.raw.backend     = raw.backend     || null;

  if (!schema.raw.title) {
    console.error('[normalizer] ⚠ raw.title is empty — schema will be incomplete');
  }

  var fullText = getFullText(raw);

  // ── identity ─────────────────────────────────────────────────
  schema.identity.coreProduct    = extractCoreProduct(raw);
  schema.identity.brand          = raw.brand || null;
  schema.identity.variantSignals = extractVariantSignals(raw.title || '');

  // ── attributes ───────────────────────────────────────────────
  var dimResult  = parseDimensions(fullText);
  schema.attributes.dimensions.raw    = dimResult.raw;
  schema.attributes.dimensions.parsed = dimResult.parsed;
  schema.attributes.dimensions.source = dimResult.raw.length > 0 ? 'text' : null;

  var materials = extractMaterials(fullText);
  schema.attributes.materials.raw    = materials;
  schema.attributes.materials.source = materials.length > 0 ? 'text' : null;

  var colors = extractColors(fullText);
  schema.attributes.colors.raw    = colors;
  schema.attributes.colors.source = colors.length > 0 ? 'text' : null;

  var capResult = extractCapacity(fullText);
  schema.attributes.capacity.raw    = capResult.raw;
  schema.attributes.capacity.parsed = capResult.parsed;
  schema.attributes.capacity.source = capResult.raw.length > 0 ? 'text' : null;

  var certs = extractCertifications(fullText);
  schema.attributes.certifications.raw = certs;

  var safety = extractSafetyClaims(fullText);
  schema.attributes.safetyClaims.raw    = safety;
  schema.attributes.safetyClaims.source = safety.length > 0 ? 'text' : null;

  // ── features ─────────────────────────────────────────────────
  schema.features = extractFeatures(raw);

  // ── LLM 层（useCases + targetAudience）──────────────────────
  var runLLM = options.llm !== false; // 默认 true

  if (runLLM) {
    try {
      var semantic = await extractSemanticLayers(raw, schema.features);
      if (semantic) {
        if (semantic.useCases)       schema.useCases       = semantic.useCases;
        if (semantic.targetAudience) schema.targetAudience = semantic.targetAudience;
      }
    } catch(e) {
      console.error('[normalizer] LLM extraction failed: ' + e.message + ' — useCases/targetAudience will be empty');
      // 不抛出错误：LLM 失败不影响规则提取层的结果
    }
  }

  return schema;
}


// ══════════════════════════════════════════════════════════════
//  四、兼容层：normalize_from_step2(step2Path, options)
//  直接读 step2.json 文件路径，返回 schema
// ══════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');
const os   = require('os');

async function normalizeFromStep2(step2Path, options) {
  if (!fs.existsSync(step2Path)) {
    throw new Error('step2.json not found: ' + step2Path);
  }
  var raw = JSON.parse(fs.readFileSync(step2Path, 'utf8'));
  return normalize(raw, options);
}

// 从 ASIN 直接读对应 checkpoint 目录
async function normalizeFromAsin(asin, options) {
  var WORKSPACE      = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
  var CHECKPOINT_DIR = path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints');
  var step2Path      = path.join(CHECKPOINT_DIR, asin, 'step2.json');
  var opts           = Object.assign({ asin: asin }, options || {});
  return normalizeFromStep2(step2Path, opts);
}


// ══════════════════════════════════════════════════════════════
//  五、CLI 模式（node normalizer.js B0XXXXX）
// ══════════════════════════════════════════════════════════════

if (require.main === module) {
  var asin = process.argv[2];
  if (!asin) {
    console.error('Usage: node normalizer.js <ASIN> [--no-llm]');
    process.exit(1);
  }

  var useLLM = !process.argv.includes('--no-llm');
  console.error('[normalizer] ASIN: ' + asin + (useLLM ? '' : ' (--no-llm)'));

  normalizeFromAsin(asin, { llm: useLLM }).then(function(schema) {
    // 输出统计摘要
    console.error('[normalizer] ✅ Done');
    console.error('  identity.coreProduct:          ' + schema.identity.coreProduct);
    console.error('  identity.variantSignals:        ' + schema.identity.variantSignals.join(', '));
    console.error('  attributes.dimensions (raw):    ' + schema.attributes.dimensions.raw.slice(0,3).join(', '));
    console.error('  attributes.materials:           ' + schema.attributes.materials.raw.join(', '));
    console.error('  attributes.colors:              ' + schema.attributes.colors.raw.join(', '));
    console.error('  attributes.capacity:            ' + schema.attributes.capacity.raw.join(', '));
    console.error('  attributes.certifications:      ' + schema.attributes.certifications.raw.join(', '));
    console.error('  attributes.safetyClaims:        ' + schema.attributes.safetyClaims.raw.join(', '));
    console.error('  features count:                 ' + schema.features.length);
    console.error('  useCases count:                 ' + schema.useCases.length);
    console.error('  targetAudience.demographic:     ' + (schema.targetAudience.demographic || []).map(function(t){return t.label;}).join(', '));
    console.error('  targetAudience.situational:     ' + (schema.targetAudience.situational || []).map(function(t){return t.label;}).join(', '));

    // stdout 输出完整 JSON（供管道使用）
    process.stdout.write(JSON.stringify(schema, null, 2));
  }).catch(function(e) {
    console.error('[normalizer] FATAL: ' + e.message);
    process.exit(1);
  });
}


module.exports = {
  normalize,
  normalizeFromStep2,
  normalizeFromAsin,
  // 导出子函数（供单元测试）
  _extractCoreProduct:    extractCoreProduct,
  _extractVariantSignals: extractVariantSignals,
  _parseDimensions:       parseDimensions,
  _extractMaterials:      extractMaterials,
  _extractColors:         extractColors,
  _extractCapacity:       extractCapacity,
  _extractCertifications: extractCertifications,
  _extractSafetyClaims:   extractSafetyClaims,
  _extractFeatures:       extractFeatures,
};
