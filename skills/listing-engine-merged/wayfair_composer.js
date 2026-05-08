/**
 * layer6_composer/wayfair_composer.js — Listing Engine v2
 *
 * 职责：将 context 的结构化数据组合成 Wayfair listing。
 * 遵守三段式 overview、属性饱和度、合规声明要求。
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const config = require('./core/config.js');

var WAYFAIR_DIR = path.join(__dirname, './layer4_platform/wayfair');

function loadJson(file) {
  var p = path.join(WAYFAIR_DIR, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

function sanitize(text, forbiddenWords) {
  if (!text) return '';
  var result = text;
  (forbiddenWords || []).forEach(function(w) {
    var re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(re, '');
  });
  return result.replace(/\s{2,}/g, ' ').trim();
}

// ── 标题（40-70字符，极简，无营销词）─────────────────────────
function buildTitle(context, constraints) {
  var identity = context.product.identity || {};
  var attrs    = context.product.attributes || {};

  var brand    = identity.brand || '';
  var core     = identity.coreProduct || '';
  var material = (attrs.materials.raw || [])[0] || '';
  var size     = (identity.variantSignals || []).find(function(s) {
    return /twin|full|queen|king|small|medium|large/i.test(s);
  }) || '';
  var color    = (attrs.colors.raw || [])[0] || '';

  // Wayfair 公式：[Brand] [Series] [Material] [ProductType] [Size/Color]
  // Simple exact-duplicate dedup only (no substring dedup, avoids removing valid short words like "Full")
  var parts = [brand, material, core, size, color]
    .map(function(p) { return p ? p.charAt(0).toUpperCase() + p.slice(1) : ''; })
    .filter(Boolean)
    .filter(function(p, i, arr) { return arr.indexOf(p) === i; });

  var title = parts.join(' ');

  // 去除营销词
  title = sanitize(title, constraints.forbiddenWords || []);

  // 截断到 70 字符
  if (title.length > constraints.title.maxChars) {
    title = title.substring(0, constraints.title.maxChars).replace(/\s+\S*$/, '');
  }

  return title;
}

// ── 三段式 Overview ───────────────────────────────────────────
async function buildOverview(context, constraints) {
  var raw      = context.raw.product || {};
  var product  = context.product;
  var identity = product.identity || {};
  var useCases = product.useCases || [];
  var features = product.features || [];
  var attrs    = product.attributes || {};

  // Para 1: 设计意图（风格 + 适用房间）
  var styleFeature = features.find(function(f) { return f.category === 'aesthetic'; });
  var roomLabels   = useCases
    .filter(function(uc) { return uc.confidence >= 0.6; })
    .map(function(uc) { return uc.label; })
    .slice(0, 2);

  var para1 = 'This ' + (identity.coreProduct || 'product') +
    (styleFeature ? ' features ' + styleFeature.text.toLowerCase() : '') +
    (roomLabels.length > 0 ? ', making it ideal for ' + roomLabels.join(' and ') : '') + '.';

  // Para 2: 核心构造（材质 + 结构）
  var materials     = attrs.materials.raw || [];
  var structFeature = features.find(function(f) { return f.category === 'stability' || f.category === 'durability'; });

  var para2 = 'Constructed from ' +
    (materials.length > 0 ? materials.slice(0, 2).join(' and ') : 'quality materials') +
    (structFeature ? ', ' + structFeature.text.toLowerCase() : '') + '.';

  // Para 3: 实用价值（功能 + 关键规格）
  var convFeature  = features.find(function(f) { return f.category === 'convenience' || f.category === 'assembly'; });
  var capacityText = (attrs.capacity.parsed || [])[0];

  var para3 = (convFeature ? convFeature.text : 'Designed for everyday use') +
    (capacityText ? ', supporting up to ' + capacityText.value + ' ' + capacityText.unit : '') + '.';

  var overview = [para1, para2, para3].join(' ');

  // 如果 LLM 可用，用 LLM 润色（第三人称、客观、无营销词）
  if (config.features.llmNormalization) {
    try {
      overview = await refineOverview(overview, raw.bullets || []);
    } catch(e) {
      console.error('[wayfair_composer] Overview LLM refine failed: ' + e.message);
    }
  }

  return sanitize(overview, constraints.forbiddenWords || []);
}

async function refineOverview(draft, bullets) {
  return new Promise(function(resolve) {
    var bulletsText = bullets.slice(0, 3).join('\n');
    // Use OpenClaw gateway's /v1/chat/completions endpoint
    // model MUST be 'openclaw' for the local gateway to route to the agent
    var body = JSON.stringify({
      model: 'openclaw',
      max_tokens: 512,
      messages: [
        { role: 'system', content: 'You are a Wayfair listing writer. Rewrite the draft in professional third-person style. No marketing language. No "you will love". Be objective and factual. Output only the rewritten text.' },
        { role: 'user', content: 'Draft:\n' + draft + '\n\nAdditional context from product bullets:\n' + bulletsText + '\n\nRewrite this in professional Wayfair style:' }
      ]
    });
    var req = http.request({
      hostname: config.llm.gateway.host,
      port: config.llm.gateway.port,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.llm.gateway.token,
        'Content-Length': Buffer.byteLength(body)
      }
    }, function(res) {
      var data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          var p = JSON.parse(data);
          var text = (p.choices || [])[0];
          text = text ? (text.message || {}).content || '' : '';
          resolve(text.trim().length > 20 ? text.trim() : draft);
        } catch(e) {
          console.error('[wayfair_composer] LLM parse error: ' + e.message);
          resolve(draft);
        }
      });
    });
    req.setTimeout(45000, function() { req.destroy(); resolve(draft); });
    req.on('error', function(e) { console.error('[wayfair_composer] LLM request error: ' + e.message); resolve(draft); });
    req.write(body); req.end();
  });
}

// ── 规格属性构建（Wayfair specs 饱和度是关键）────────────────
function buildSpecs(context, classRules) {
  var product  = context.product;
  var identity = product.identity || {};
  var attrs    = product.attributes || {};
  var raw      = context.raw.product || {};
  var features = product.features || [];
  var specs    = {};

  // 找到匹配的 Class 规则
  var matchedClass = context.platform.categoryMatch.wayfair;
  var classRule    = null;
  if (matchedClass && matchedClass.className && classRules.rules) {
    classRule = classRules.rules.find(function(r) {
      return r.className === matchedClass.className;
    });
  }

  // 必填属性基于 Class Rule
  var required = (classRule && classRule.requiredAttributes) || [];

  // 材质
  var materials = attrs.materials.raw || [];
  if (materials.length > 0) specs.material = materials[0];

  // 颜色
  var colors = attrs.colors.raw || [];
  if (colors.length > 0) specs.color = colors[0];

  // 尺寸（L x W x H，Wayfair 要求精确格式）
  var dims = attrs.dimensions.parsed || [];
  if (dims.length >= 2) {
    specs.overallHeight = dims.find(function(d) { return /height|high|tall/i.test(d.dimension); });
    specs.overallWidth  = dims.find(function(d) { return /width|wide/i.test(d.dimension); });
    specs.overallDepth  = dims.find(function(d) { return /depth|deep/i.test(d.dimension); });
    if (specs.overallHeight) specs.overallHeight = specs.overallHeight.value + ' ' + specs.overallHeight.unit;
    if (specs.overallWidth)  specs.overallWidth  = specs.overallWidth.value  + ' ' + specs.overallWidth.unit;
    if (specs.overallDepth)  specs.overallDepth  = specs.overallDepth.value  + ' ' + specs.overallDepth.unit;
  }

  // 承重
  var capacity = (attrs.capacity.parsed || [])[0];
  if (capacity) specs.weightCapacity = capacity.value + ' ' + capacity.unit;

  // 安全认证
  var certs = attrs.certifications.raw || [];
  if (certs.length > 0) specs.certifications = certs.join(', ');

  // 安全声明
  var safety = attrs.safetyClaims.raw || [];
  if (safety.length > 0) specs.safetyClaims = safety.join(', ');

  // 组装
  var assemblyFeature = features.find(function(f) { return f.category === 'assembly'; });
  if (assemblyFeature) {
    specs.assemblyRequired = 'Yes';
    if (/(\d+)\s*min/i.test(assemblyFeature.text)) {
      var timeMatch = assemblyFeature.text.match(/(\d+)\s*min/i);
      specs.estimatedAssemblyTime = timeMatch[1] + ' minutes';
    }
  }

  // Box Spring（从 bullets 检测）
  var fullText = ((raw.bullets || []).join(' ') + ' ' + (raw.title || '')).toLowerCase();
  if (/no box spring/i.test(fullText)) {
    specs.boxSpringRequired = 'No';
    specs.slatKitIncluded   = 'Yes';
  }

  // Slat 数量
  var slatMatch = fullText.match(/(\d+)\s*(?:wooden\s*)?slat/i);
  if (slatMatch) specs.numberOfSlats = parseInt(slatMatch[1]);

  // 标注哪些必填属性缺失（供 reliability 层使用）
  var missing = required.filter(function(req) {
    var key = req.replace(/_([a-z])/g, function(m, c) { return c.toUpperCase(); });
    return !specs[req] && !specs[key];
  });
  if (missing.length > 0) {
    specs._missingRequired = missing;
    console.error('[wayfair_composer] ⚠ Missing required specs: ' + missing.join(', '));
  }

  return specs;
}

// ── 合规声明构建 ──────────────────────────────────────────────
function buildCompliance(context) {
  var raw     = context.raw.product || {};
  var fullText = ((raw.bullets || []).join(' ') + ' ' + (raw.title || '')).toLowerCase();
  var comp    = {};

  // Prop 65（保守默认：需要确认）
  comp.prop65 = 'This product may contain chemicals known to the State of California to cause cancer or reproductive harm. For more information, visit www.P65Warnings.ca.gov.';

  // 阻燃剂（如果是软包类产品）
  var attrs = context.product.attributes || {};
  var materials = (attrs.materials.raw || []).join(' ').toLowerCase();
  if (/velvet|fabric|foam|upholster/i.test(materials)) {
    comp.flameRetardant = 'This product meets California TB 117-2013 flammability requirements.';
  }

  // 复合木（如果含 MDF/engineered wood）
  if (/mdf|engineered wood|particleboard|plywood/i.test(materials)) {
    comp.tsca = 'This product complies with TSCA Title VI formaldehyde emission standards for composite wood products.';
  }

  return comp;
}

// ── 主入口 ────────────────────────────────────────────────────
async function compose(context) {
  var constraints = loadJson('constraints.json');
  var classRules  = loadJson('class_rules.json');

  console.error('[wayfair_composer] Building Wayfair listing...');

  var title    = buildTitle(context, constraints);
  var overview = await buildOverview(context, constraints);
  var specs    = buildSpecs(context, classRules);
  var comp     = buildCompliance(context);

  context.composed.wayfair = {
    title:      title,
    overview:   overview,
    specs:      specs,
    compliance: comp,
  };

  var missingCount = (specs._missingRequired || []).length;
  console.error('[wayfair_composer] ✅ title:' + title.length + 'chars, specs:' +
    Object.keys(specs).filter(function(k) { return !k.startsWith('_'); }).length +
    ' fields' + (missingCount > 0 ? ', ⚠ ' + missingCount + ' required specs missing' : ''));

  return context;
}

module.exports = { compose };
