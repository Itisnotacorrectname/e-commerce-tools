/**
 * layer6_composer/walmart_composer.js — Listing Engine v2
 *
 * 职责：将 context 的结构化数据组合成 Walmart listing。
 * 严格遵守 constraints.json 的字段限制和 attribute_map.json 的枚举映射。
 */
'use strict';

const fs     = require('fs');
const path   = require('path');
const http   = require('http');
const config = require('../core/config.js');

var WALMART_DIR = path.join(__dirname, '../layer4_platform/walmart');

function loadJson(file) {
  var p = path.join(WALMART_DIR, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
}

// ── 禁用词清洗 ────────────────────────────────────────────────
function sanitize(text, forbiddenWords) {
  if (!text) return '';
  var result = text;
  (forbiddenWords || []).forEach(function(w) {
    var re = new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
    result = result.replace(re, '');
  });
  return result.replace(/\s{2,}/g, ' ').trim();
}

// ── 属性映射 ──────────────────────────────────────────────────
function mapAttribute(value, category, attributeMap) {
  if (!value || !attributeMap[category]) return value;
  var lower = String(value).toLowerCase().trim();
  return attributeMap[category][lower] || value;
}

// ── 标题生成（≤75字符，按 Walmart 公式）─────────────────────
async function buildTitle(context, constraints, attributeMap, schema) {
  var product  = context.product;
  var raw      = context.raw.product || {};
  var identity = product.identity || {};
  var messages = context.conversion.messages || [];

  // 提取关键元素
  var brand       = identity.brand || '';
  var coreProduct = identity.coreProduct || '';
  var material    = (product.attributes.materials.raw || [])[0] || '';
  var size        = (identity.variantSignals || []).find(function(s) {
    return /twin|full|queen|king|small|medium|large/i.test(s);
  }) || '';
  var color       = (product.attributes.colors.raw || [])[0] || '';

  // 映射到 Walmart 枚举值
  var walmartColor    = mapAttribute(color,    'color',    attributeMap) || '';
  var walmartMaterial = mapAttribute(material, 'material', attributeMap) || '';
  var walmartSize     = mapAttribute(size,     'size',     attributeMap) || '';

  // 按公式组装：[Brand] [ProductType] [Material], [Size], [Color]
  var parts = [brand, coreProduct, walmartMaterial, walmartSize, walmartColor]
    .filter(Boolean).filter(function(p, i, arr) { return arr.indexOf(p) === i; });

  var title = parts.join(' ');

  // 强制 Title Case
  title = title.replace(/\b\w/g, function(c) { return c.toUpperCase(); });

  // 超过 75 字符 → 用 LLM 压缩
  if (title.length > constraints.title.maxChars) {
    title = await compressTitle(title, raw.title || '', constraints.title.maxChars);
  }

  // 清洗禁用词
  title = sanitize(title, constraints.forbiddenWords);

  // 最终截断保底
  if (title.length > constraints.title.maxChars) {
    title = title.substring(0, constraints.title.maxChars).replace(/\s+\S*$/, '');
  }

  return title;
}

async function compressTitle(longTitle, originalTitle, maxChars) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      model: config.llm.models.default, max_tokens: 128,
      system: 'Compress the product title to fit Walmart\'s ' + maxChars + ' character limit. Output ONLY the compressed title, nothing else. Use Title Case.',
      messages: [{ role: 'user', content: 'Original title: ' + longTitle + '\nCompress to ≤' + maxChars + ' chars:' }]
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
          resolve(text.length > 0 ? text : longTitle.substring(0, maxChars));
        } catch(e) { resolve(longTitle.substring(0, maxChars)); }
      });
    });
    req.setTimeout(30000, function() { req.destroy(); resolve(longTitle.substring(0, maxChars)); });
    req.on('error', function() { resolve(longTitle.substring(0, maxChars)); });
    req.write(body); req.end();
  });
}

// ── Key Features 生成（3-10条，每条≤80字符）─────────────────
function buildKeyFeatures(context, constraints) {
  var raw      = context.raw.product || {};
  var bullets  = raw.bullets || [];
  var features = context.product.features || [];
  var messages = (context.conversion.messages || []).slice(0, 5);

  var items = [];

  // 优先使用 conversion 层生成的消息
  messages.forEach(function(m) {
    if (m.message && m.message.length <= constraints.keyFeatures.maxCharsPerItem) {
      items.push(m.message);
    } else if (m.message) {
      // 截断到 80 字符
      var truncated = m.message.substring(0, constraints.keyFeatures.maxCharsPerItem - 3) + '...';
      items.push(truncated);
    }
  });

  // 补充原始 bullets（清洗后）
  if (items.length < constraints.keyFeatures.min) {
    bullets.forEach(function(b) {
      if (!b || items.length >= constraints.keyFeatures.max) return;
      // 移除 Amazon 常见的【】标题格式
      var clean = b.replace(/^【[^】]+】\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim();
      // 取第一句
      var firstSentence = clean.split(/[.!?]/)[0].trim();
      if (firstSentence.length > constraints.keyFeatures.maxCharsPerItem) {
        firstSentence = firstSentence.substring(0, constraints.keyFeatures.maxCharsPerItem - 3) + '...';
      }
      if (firstSentence.length > 20) items.push(firstSentence);
    });
  }

  // 去重、去 emoji、去 URL
  items = items
    .map(function(s) { return s.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').replace(/https?:\/\/\S+/g, '').trim(); })
    .filter(function(s) { return s.length >= 10; })
    .filter(function(s, i, arr) { return arr.indexOf(s) === i; })
    .slice(0, constraints.keyFeatures.max);

  // 保底：至少3条
  while (items.length < constraints.keyFeatures.min) {
    items.push('Quality construction for lasting durability');
  }

  return items;
}

// ── 属性表构建 ────────────────────────────────────────────────
function buildAttributes(context, attributeMap) {
  var product  = context.product;
  var raw      = context.raw.product || {};
  var identity = product.identity || {};
  var attrs    = product.attributes || {};

  var result = {};

  // 颜色
  var color = (attrs.colors.raw || [])[0];
  if (color) result.color = mapAttribute(color, 'color', attributeMap) || color;

  // 材质
  var material = (attrs.materials.raw || [])[0];
  if (material) result.material = mapAttribute(material, 'material', attributeMap) || material;

  // 尺寸
  var size = (identity.variantSignals || []).find(function(s) {
    return /twin|full|queen|king/i.test(s);
  });
  if (size) result.size = mapAttribute(size, 'size', attributeMap) || size;

  // 房间类型
  var useCases = context.product.useCases || [];
  useCases.forEach(function(uc) {
    var mapped = attributeMap.roomType && attributeMap.roomType[uc.label.toLowerCase()];
    if (mapped && !result.recommendedLocation) result.recommendedLocation = mapped;
  });

  // 承重
  var capacity = (attrs.capacity.parsed || [])[0];
  if (capacity) result.weightCapacity = capacity.value + ' ' + capacity.unit;

  // 尺寸（组合成 L x W x H）
  var dims = attrs.dimensions.parsed || [];
  if (dims.length >= 2) {
    var formatted = dims.slice(0, 3).map(function(d) { return d.value + ' ' + d.unit; }).join(' x ');
    result.assembledProductDimensions = formatted;
  }

  // 组装类型
  var features = product.features || [];
  var hasAssembly = features.some(function(f) { return f.category === 'assembly'; });
  if (hasAssembly) result.assemblyRequired = 'Yes';

  // 认证
  var certs = attrs.certifications.raw || [];
  if (certs.length > 0) result.certifications = certs.join(', ');

  return result;
}

// ── 描述生成 ──────────────────────────────────────────────────
function buildDescription(context, constraints) {
  var raw     = context.raw.product || {};
  var bullets = raw.bullets || [];

  // 组合所有 bullets 为段落
  var paras = bullets.filter(Boolean).map(function(b) {
    return b.replace(/^【[^】]+】\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim();
  });

  // 品牌和产品名在前100词出现
  var brand    = (context.product.identity && context.product.identity.brand) || '';
  var product  = (context.product.identity && context.product.identity.coreProduct) || '';
  var intro    = brand + (brand && product ? ' ' : '') + product;

  var desc = '<p><b>' + intro + '</b> ' + paras.slice(0, 2).join(' ') + '</p>\n';
  if (paras.length > 2) {
    desc += '<ul>' + paras.slice(2).map(function(p) { return '<li>' + p + '</li>'; }).join('\n') + '</ul>\n';
  }

  return desc;
}

// ── 主入口 ────────────────────────────────────────────────────
async function compose(context) {
  var constraints  = loadJson('constraints.json');
  var attributeMap = loadJson('attribute_map.json');
  var schema       = loadJson('schema.json');

  console.error('[walmart_composer] Building Walmart listing...');

  var title       = await buildTitle(context, constraints, attributeMap, schema);
  var keyFeatures = buildKeyFeatures(context, constraints);
  var attributes  = buildAttributes(context, attributeMap);
  var description = buildDescription(context, constraints);

  // 最终禁用词清洗
  keyFeatures = keyFeatures.map(function(f) { return sanitize(f, constraints.forbiddenWords); });
  description = sanitize(description, constraints.forbiddenWords);

  context.composed.walmart = {
    title:       title,
    keyFeatures: keyFeatures,
    description: description,
    attributes:  attributes,
    sanitized:   true,
  };

  console.error('[walmart_composer] ✅ title:' + title.length + 'chars, features:' + keyFeatures.length);
  return context;
}

module.exports = { compose };
