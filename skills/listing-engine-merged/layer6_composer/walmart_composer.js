/**
 * layer6_composer/walmart_composer.js
 *
 * 来自源A的完整实现（严格遵守75字符约束、attribute_map映射）+ 源B验证。
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var http   = require('http');
var config = require('../core/config.js');

var WALMART_DIR = path.join(__dirname, '../layer4_platform/walmart');

function loadJson(file) {
  var p = path.join(WALMART_DIR, file);
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

function mapAttribute(value, category, attributeMap) {
  if (!value || !attributeMap || !attributeMap[category]) return value;
  var lower = String(value).toLowerCase().trim();
  return attributeMap[category][lower] || value;
}

async function buildTitle(ctx, constraints, attributeMap) {
  var product  = ctx.product;
  var identity = product.identity || {};
  var materials = product.attributes && product.attributes.materials && product.attributes.materials.raw || [];
  var colors    = product.attributes && product.attributes.colors    && product.attributes.colors.raw    || [];
  var variants  = identity.variantSignals || [];

  var brand    = identity.brand    || '';
  var core     = identity.coreProduct || '';
  var material = materials[0] || '';
  var size     = variants.find(function(s) { return /twin|full|queen|king|small|medium|large/i.test(s); }) || '';
  var color    = colors[0] || '';

  var walmartColor    = mapAttribute(color,    'color',    attributeMap) || '';
  var walmartMaterial = mapAttribute(material, 'material', attributeMap) || '';
  var walmartSize     = mapAttribute(size,     'size',     attributeMap) || '';

  var parts = [brand, core, walmartMaterial, walmartSize, walmartColor]
    .filter(Boolean)
    .filter(function(p, i, arr) { return arr.indexOf(p) === i; });

  var title = parts.join(' ');
  title = title.replace(/\b\w/g, function(c) { return c.toUpperCase(); });

  if (title.length > constraints.title.maxChars) {
    title = await compressTitle(title, constraints.title.maxChars);
  }

  title = sanitize(title, constraints.forbiddenWords);

  if (title.length > constraints.title.maxChars) {
    title = title.substring(0, constraints.title.maxChars).replace(/\s+\S*$/, '');
  }

  return title;
}

async function compressTitle(longTitle, maxChars) {
  return new Promise(function(resolve) {
    var body = JSON.stringify({
      model: config.llm.models.default, max_tokens: 128,
      system: 'Compress the product title to fit within ' + maxChars + ' characters. Output ONLY the compressed title in Title Case.',
      messages: [{ role: 'user', content: 'Compress to ≤' + maxChars + ' chars: ' + longTitle }]
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

function buildKeyFeatures(ctx, constraints) {
  var raw      = ctx.raw.product    || {};
  var bullets  = raw.bullets         || [];
  var messages = ctx.conversion.messages || [];

  var items = [];

  messages.forEach(function(m) {
    if (!m) return;
    var text = typeof m === 'string' ? m : m.message || m.text || '';
    if (text.length > 0) {
      items.push(text.length <= constraints.keyFeatures.maxCharsPerItem ? text : text.substring(0, constraints.keyFeatures.maxCharsPerItem - 3) + '...');
    }
  });

  if (items.length < constraints.keyFeatures.min) {
    bullets.forEach(function(b) {
      if (!b || items.length >= constraints.keyFeatures.max) return;
      var clean = b.replace(/^【[^】]+】\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim();
      var first = clean.split(/[.!?]/)[0].trim();
      if (first.length > 20) items.push(first);
    });
  }

  items = items
    .map(function(s) { return s.replace(/[\u{1F300}-\u{1F9FF}]/gu, '').replace(/https?:\/\/\S+/g, '').trim(); })
    .filter(function(s) { return s.length >= 10; })
    .filter(function(s, i, arr) { return arr.indexOf(s) === i; })
    .slice(0, constraints.keyFeatures.max);

  while (items.length < constraints.keyFeatures.min) {
    items.push('Quality construction for lasting durability');
  }

  return items;
}

function buildAttributes(ctx, attributeMap) {
  var product  = ctx.product;
  var identity = product.identity || {};
  var attrs    = product.attributes || {};

  var result = {};
  var color    = (attrs.colors    && attrs.colors.raw    && attrs.colors.raw[0])    || '';
  var material = (attrs.materials && attrs.materials.raw && attrs.materials.raw[0]) || '';
  var size     = (identity.variantSignals || []).find(function(s) { return /twin|full|queen|king/i.test(s); }) || '';
  var capacity = attrs.capacity && attrs.capacity.parsed && attrs.capacity.parsed[0];
  var certs    = attrs.certifications && attrs.certifications.raw || [];

  if (color)    result.color    = mapAttribute(color,    'color',    attributeMap) || color;
  if (material) result.material = mapAttribute(material, 'material', attributeMap) || material;
  if (size)     result.size     = mapAttribute(size,     'size',     attributeMap) || size;
  if (capacity) result.weightCapacity = capacity.value + ' ' + capacity.unit;
  if (certs.length > 0) result.certifications = certs.join(', ');

  var dims = attrs.dimensions && attrs.dimensions.parsed || [];
  if (dims.length >= 2) {
    result.assembledProductDimensions = dims.slice(0,3).map(function(d){return d.value+' '+d.unit;}).join(' x ');
  }

  return result;
}

function buildDescription(ctx, constraints) {
  var raw     = ctx.raw.product || {};
  var bullets = raw.bullets || [];
  var brand   = (ctx.product.identity && ctx.product.identity.brand) || '';
  var core    = (ctx.product.identity && ctx.product.identity.coreProduct) || '';

  var intro = brand + (brand && core ? ' ' : '') + core;
  var paras = bullets.filter(Boolean).map(function(b) {
    return b.replace(/^【[^】]+】\s*/, '').replace(/^\[[^\]]+\]\s*/, '').trim();
  });

  var desc = '<p><b>' + intro + '</b> ' + paras.slice(0,2).join(' ') + '</p>\n';
  if (paras.length > 2) {
    desc += '<ul>' + paras.slice(2).map(function(p){return '<li>'+p+'</li>';}).join('\n') + '</ul>\n';
  }
  return desc;
}

async function compose(ctx) {
  var constraints   = loadJson('constraints.json');
  var attributeMap  = loadJson('attribute_map.json');

  console.error('[walmart_composer] Building Walmart listing...');

  var title       = await buildTitle(ctx, constraints, attributeMap);
  var keyFeatures = buildKeyFeatures(ctx, constraints);
  var attributes  = buildAttributes(ctx, attributeMap);
  var description = buildDescription(ctx, constraints);

  keyFeatures = keyFeatures.map(function(f){ return sanitize(f, constraints.forbiddenWords); });
  description = sanitize(description, constraints.forbiddenWords);

  ctx.composed.walmart = {
    title:       title,
    keyFeatures: keyFeatures,
    description: description,
    attributes:  attributes,
    sanitized:   true
  };

  console.error('[walmart_composer] ✅ title:' + title.length + 'chars, features:' + keyFeatures.length);
  return ctx;
}

module.exports = { compose };