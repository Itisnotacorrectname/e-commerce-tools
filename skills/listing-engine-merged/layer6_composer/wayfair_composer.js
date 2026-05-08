/**
 * layer6_composer/wayfair_composer.js
 *
 * 来自源A完整实现（三段式overview、spec饱和度、Prop65）+ 源B结构。
 */

'use strict';

var fs     = require('fs');
var path   = require('path');
var http   = require('http');
var config = require('../core/config.js');

var WAYFAIR_DIR = path.join(__dirname, '../layer4_platform/wayfair');

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

function buildTitle(ctx, constraints) {
  var identity = ctx.product.identity || {};
  var attrs    = ctx.product.attributes || {};
  var brand    = identity.brand    || '';
  var core     = identity.coreProduct || '';
  var material = (attrs.materials && attrs.materials.raw && attrs.materials.raw[0]) || '';
  var size     = (identity.variantSignals || []).find(function(s) { return /twin|full|queen|king|small|medium|large/i.test(s); }) || '';
  var color    = (attrs.colors    && attrs.colors.raw    && attrs.colors.raw[0])    || '';

  var parts = [brand, material, core, size, color]
    .map(function(p){ return p ? p.charAt(0).toUpperCase() + p.slice(1) : ''; })
    .filter(Boolean)
    .filter(function(p, i, arr) { return arr.indexOf(p) === i; });

  var title = parts.join(' ');
  title = sanitize(title, constraints.forbiddenWords || []);

  if (title.length > constraints.title.maxChars) {
    title = title.substring(0, constraints.title.maxChars).replace(/\s+\S*$/, '');
  }
  return title;
}

async function buildOverview(ctx, constraints) {
  var raw      = ctx.raw.product    || {};
  var product  = ctx.product;
  var identity = product.identity   || {};
  var useCases = product.useCases   || [];
  var features = product.features  || [];
  var attrs    = product.attributes || {};

  var styleFeature = features.find(function(f) { return f.category === 'aesthetic'; });
  var roomLabels   = useCases.filter(function(uc){ return uc.confidence >= 0.6; }).map(function(uc){ return uc.label; }).slice(0,2);

  var para1 = 'This ' + (identity.coreProduct || 'product') +
    (styleFeature ? ' features ' + styleFeature.text.toLowerCase() : '') +
    (roomLabels.length > 0 ? ', making it ideal for ' + roomLabels.join(' and ') : '') + '.';

  var materials     = attrs.materials && attrs.materials.raw || [];
  var structFeature = features.find(function(f) { return f.category === 'stability' || f.category === 'durability'; });
  var para2 = 'Constructed from ' + (materials.length > 0 ? materials.slice(0,2).join(' and ') : 'quality materials') +
    (structFeature ? ', ' + structFeature.text.toLowerCase() : '') + '.';

  var convFeature = features.find(function(f) { return f.category === 'convenience' || f.category === 'assembly'; });
  var capacityText = attrs.capacity && attrs.capacity.parsed && attrs.capacity.parsed[0];
  var para3 = (convFeature ? convFeature.text : 'Designed for everyday use') +
    (capacityText ? ', supporting up to ' + capacityText.value + ' ' + capacityText.unit : '') + '.';

  var overview = [para1, para2, para3].join(' ');
  overview = sanitize(overview, constraints.forbiddenWords || []);
  return overview;
}

function buildSpecs(ctx, classRules) {
  var product  = ctx.product;
  var identity = product.identity || {};
  var attrs    = product.attributes || {};
  var raw      = ctx.raw.product || {};
  var features = product.features || [];
  var specs    = {};

  var materials = attrs.materials && attrs.materials.raw || [];
  if (materials.length > 0) specs.material = materials[0];

  var colors = attrs.colors && attrs.colors.raw || [];
  if (colors.length > 0) specs.color = colors[0];

  var dims = attrs.dimensions && attrs.dimensions.parsed || [];
  if (dims.length >= 2) {
    var h = dims.find(function(d){ return /height|high|tall/i.test(d.dimension); });
    var w = dims.find(function(d){ return /width|wide/i.test(d.dimension); });
    var d = dims.find(function(d){ return /depth|deep/i.test(d.dimension); });
    if (h) specs.overallHeight = h.value + ' ' + h.unit;
    if (w) specs.overallWidth  = w.value + ' ' + w.unit;
    if (d) specs.overallDepth  = d.value + ' ' + d.unit;
  }

  var capacity = attrs.capacity && attrs.capacity.parsed && attrs.capacity.parsed[0];
  if (capacity) specs.weightCapacity = capacity.value + ' ' + capacity.unit;

  var certs = attrs.certifications && attrs.certifications.raw || [];
  if (certs.length > 0) specs.certifications = certs.join(', ');

  var safety = attrs.safetyClaims && attrs.safetyClaims.raw || [];
  if (safety.length > 0) specs.safetyClaims = safety.join(', ');

  var assemblyFeature = features.find(function(f) { return f.category === 'assembly'; });
  if (assemblyFeature) {
    specs.assemblyRequired = 'Yes';
    var m = assemblyFeature.text.match(/(\d+)\s*min/i);
    if (m) specs.estimatedAssemblyTime = m[1] + ' minutes';
  }

  var fullText = ((raw.bullets||[]).join(' ') + ' ' + (raw.title||'')).toLowerCase();
  if (/no box spring/i.test(fullText)) {
    specs.boxSpringRequired = 'No';
    specs.slatKitIncluded   = 'Yes';
  }

  var slatMatch = fullText.match(/(\d+)\s*(?:wooden\s*)?slat/i);
  if (slatMatch) specs.numberOfSlats = parseInt(slatMatch[1]);

  return specs;
}

function buildCompliance(ctx) {
  var raw = ctx.raw.product || {};
  var fullText = ((raw.bullets||[]).join(' ') + ' ' + (raw.title||'')).toLowerCase();
  var comp = {};
  comp.prop65 = 'This product may contain chemicals known to the State of California to cause cancer or reproductive harm. Visit www.P65Warnings.ca.gov for more information.';
  var attrs = ctx.product.attributes || {};
  var materials = (attrs.materials && attrs.materials.raw || []).join(' ').toLowerCase();
  if (/velvet|fabric|foam|upholstered/i.test(materials)) {
    comp.flameRetardant = 'This product meets California TB 117-2013 flammability requirements.';
  }
  if (/mdf|engineered wood|particleboard|plywood/i.test(materials)) {
    comp.tsca = 'This product complies with TSCA Title VI formaldehyde emission standards for composite wood products.';
  }
  return comp;
}

async function compose(ctx) {
  var constraints = loadJson('constraints.json');
  var classRules  = loadJson('class_rules.json');

  console.error('[wayfair_composer] Building Wayfair listing...');

  var title    = buildTitle(ctx, constraints);
  var overview = await buildOverview(ctx, constraints);
  var specs    = buildSpecs(ctx, classRules);
  var comp     = buildCompliance(ctx);

  ctx.composed.wayfair = {
    title:      title,
    overview:   overview,
    specs:      specs,
    compliance: comp
  };

  console.error('[wayfair_composer] ✅ title:' + title.length + 'chars, specs:' + Object.keys(specs).length + ' fields');
  return ctx;
}

module.exports = { compose };