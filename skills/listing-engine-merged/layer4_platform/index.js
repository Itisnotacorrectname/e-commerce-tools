/**
 * layer4_platform/index.js
 * Platform intelligence: category matching, specs extraction, compliance checking
 */
'use strict';

const path = require('path');

// ── Walmart 类目映射 ─────────────────────────────────────────────
const WALMART_CATEGORIES = [
  { id: '991', name: 'Bed Frames',           keywords: ['bed frame', 'metal frame', 'steel frame', 'platform bed', 'box spring'] },
  { id: '1085636', name: 'Desks',           keywords: ['desk', 'writing desk', 'computer desk', 'standing desk', 'folding desk'] },
  { id: '11138', name: 'Folding Tables',     keywords: ['folding table', 'foldable table', 'utility table', 'plastic table'] },
  { id: '11136', name: 'Dining Tables',      keywords: ['dining table', 'kitchen table', 'dinner table', 'breakfast table'] },
  { id: '9891', name: 'Sofas',              keywords: ['sofa', 'couch', 'loveseat', 'sectional'] },
  { id: '9193', name: 'Indoor Furniture',    keywords: ['shelf', 'bookshelf', 'cabinet', 'storage cabinet', 'side table'] },
];

// ── Wayfair Class ID 映射（对照规范文档）───────────────────────
const WAYFAIR_CLASSES = [
  // ── Kitchen / Cookware ──────────────────────────────────
  {
    classId: '22', className: 'Pots and Pans Set', isCookware: true,
    trigger: ['pots and pans set', 'cookware set', 'cooking set', 'kitchen set', 'pots set', 'pans set'],
    exclude: ['air fryer', 'slow cooker', 'electric cooker', 'pressure cooker', 'blender', 'mixer'],
    requiredSpecs: ['material', 'oven_safe_temperature', 'stovetop_type', 'dishwasher_safe', 'handle_type', 'piece_count']
  },
  {
    classId: '23', className: 'Skillets & Frying Pans', isCookware: true,
    trigger: ['frying pan', 'skillet', 'saute pan', 'fry pan', 'omelette pan', 'crepe pan'],
    exclude: ['air fryer', 'wok'],
    requiredSpecs: ['material', 'oven_safe_temperature', 'stovetop_type', 'dishwasher_safe', 'diameter', 'handle_type']
  },
  {
    classId: '24', className: 'Bakeware', isCookware: true,
    trigger: ['baking sheet', 'baking pan', 'cake pan', 'muffin tin', 'cookie sheet', 'roasting pan', 'bread loaf pan', 'pie dish'],
    exclude: [],
    requiredSpecs: ['material', 'color', 'dimensions', 'oven_safe_temperature', 'dishwasher_safe']
  },
  // ── Furniture ──────────────────────────────────────────────
  {
    classId: '49', className: 'Platform Beds', isBed: true,
    trigger: ['platform bed', 'no box spring', 'slat support', 'with headboard'],
    exclude: ['adjustable base', 'box spring'],
    requiredSpecs: ['weight_capacity', 'number_of_slats', 'headboard_height', 'assembly_required', 'box_spring_required']
  },
  {
    classId: '52', className: 'Bed Frames', isBed: true,
    trigger: ['bed frame', 'metal frame', 'steel frame', 'panel bed'],
    exclude: ['adjustable', 'upholstered'],
    requiredSpecs: ['weight_capacity', 'frame_height', 'assembly_required', 'box_spring_required', 'slat_kit_included']
  },
  {
    classId: '51', className: 'Sofas', isSofa: true,
    trigger: ['sofa', 'couch', 'loveseat'],
    exclude: ['sleeper', 'futon', 'sectional'],
    requiredSpecs: ['seat_depth', 'seat_height', 'weight_capacity', 'upholstery_material', 'leg_material', 'assembly_required']
  },
  {
    classId: '57', className: 'Desks & Tables', isDesk: true,
    trigger: ['desk', 'table', 'workstation'],
    exclude: ['dining'],
    requiredSpecs: ['table_top_material', 'base_material', 'shape', 'seating_capacity', 'assembly_required', 'weight_capacity']
  },
  {
    classId: '54', className: 'Dining Tables', isDining: true,
    trigger: ['dining table', 'kitchen table', 'dinner table'],
    exclude: [],
    requiredSpecs: ['table_top_material', 'base_material', 'shape', 'seating_capacity', 'assembly_required']
  },
];

// ── 从产品数据提规格 ───────────────────────────────────────────
function extractSpecs(ctx) {
  const raw = ctx.raw.product || {};
  const attrs = ctx.product?.attributes || {};
  const identity = ctx.product?.identity || {};
  const title = (raw.title || '').toLowerCase();
  const bullets = (raw.bullets || []).join(' ');
  const combined = title + ' ' + bullets;

  const specs = {};

  // Weight Capacity: 找 "XX lbs" 或 "XX pounds"
  const wcMatch = combined.match(/(\d+(?:\.\d+)?)\s*(lbs?|pounds?)/i);
  if (wcMatch) specs.weight_capacity = { value: parseFloat(wcMatch[1]), unit: 'lbs' };

  // Dimensions: 找 "L x W x H" 格式
  const dimMatch = combined.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:in|inch|")?/i);
  if (dimMatch) {
    specs.dimensions = { value: dimMatch[1] + ' x ' + dimMatch[2] + ' x ' + dimMatch[3], unit: 'inches' };
    specs.dimensions_parsed = { length: parseFloat(dimMatch[1]), width: parseFloat(dimMatch[2]), height: parseFloat(dimMatch[3]) };
  }

  // Assembly Required
  if (/no\s*assembly|assembled|ready\s*to\s*use/i.test(combined)) specs.assembly_required = 'No';
  else if (/some\s*assembly|partial\s*assembly/i.test(combined)) specs.assembly_required = 'Partial';
  else if (/assembly\s*required/i.test(combined)) specs.assembly_required = 'Yes';

  // Material
  const matRaw = (attrs.materials?.raw || [])[0];
  if (matRaw) specs.material = matRaw;

  // Number of Slats（床架）
  const slatsMatch = combined.match(/(\d+)\s*(?:slat|słat)/i);
  if (slatsMatch) specs.number_of_slats = parseInt(slatsMatch[1]);

  // Box Spring Required
  if (/no\s*box\s*spring|box\s*spring\s*not\s*required|without\s*box\s*spring/i.test(combined)) {
    specs.box_spring_required = 'No';
    specs.slat_kit_included = 'Yes';
  }

  // Upholstery Material（沙发）
  const upholMatch = combined.match(/(velvet|polyester|linen|faux\s*leather|genuine\s*leather|microfiber|leather)/i);
  if (upholMatch) specs.upholstery_material = upholMatch[1];

  // Seat Depth / Seat Height（沙发）
  const seatDepthMatch = combined.match(/seat\s*depth[:\s]*(\d+(?:\.\d+)?)\s*(in|inch)/i);
  if (seatDepthMatch) specs.seat_depth = { value: parseFloat(seatDepthMatch[1]), unit: seatDepthMatch[2] };

  // ── Cookware specs ────────────────────────────────────────
  // Piece count: "21 pcs", "12-piece set", "7 pieces"
  const pieceMatch = combined.match(/(\d+)\s*(?:pc?s?|piece?s?|pcs?)\s*(?:set)?/i);
  if (pieceMatch) specs.piece_count = parseInt(pieceMatch[1]);

  // Oven safe temperature: "up to 400°F", "400 degrees f"
  const ovenMatch = combined.match(/(?:oven\s*(?:safe|up\s*to)|up\s*to)\s*(\d+)\s*°?\s*(?:f(?:ah?renheit)?|degrees?\s*f)/i);
  if (ovenMatch) specs.oven_safe_temperature = ovenMatch[1] + ' °F';

  // Stovetop type
  if (/induction\s*(?:ready|compatible|suitable)?/i.test(combined)) {
    specs.stovetop_type = specs.stovetop_type || [];
    if (!specs.stovetop_type.includes('Induction')) specs.stovetop_type.push('Induction');
  }
  if (/gas\s*(?:stovetop|range|burner)?/i.test(combined)) {
    specs.stovetop_type = specs.stovetop_type || [];
    if (!specs.stovetop_type.includes('Gas')) specs.stovetop_type.push('Gas');
  }
  if (/electric\s*(?:stovetop|range|cooktop)?/i.test(combined)) {
    specs.stovetop_type = specs.stovetop_type || [];
    if (!specs.stovetop_type.includes('Electric')) specs.stovetop_type.push('Electric');
  }
  if (/ceramic\s*(?:stovetop|cooktop)?/i.test(combined)) {
    specs.stovetop_type = specs.stovetop_type || [];
    if (!specs.stovetop_type.includes('Ceramic')) specs.stovetop_type.push('Ceramic');
  }

  // Dishwasher safe
  if (/dishwasher\s*safe/i.test(combined)) specs.dishwasher_safe = 'Yes';
  else if (/hand\s*wash|handwash/i.test(combined)) specs.dishwasher_safe = 'No';

  // Handle type: detachable, removable, fixed
  if (/detachable\s*handle|removable\s*handle|detach(?:able)?\s+handle/i.test(combined)) {
    specs.handle_type = 'Detachable';
  } else if (/ Ergonomic\s*handle/i.test(combined)) {
    specs.handle_type = specs.handle_type || 'Ergonomic';
  }

  return specs;
}

// ── Walmart 类目匹配 ────────────────────────────────────────────
function matchWalmartCategory(ctx, specs) {
  const title = (ctx.raw.product?.title || '').toLowerCase();
  const combined = title + ' ' + (ctx.raw.product?.bullets || []).join(' ').toLowerCase();

  let best = { id: null, name: 'Indoor Furniture', confidence: 0.5 };
  for (const cat of WALMART_CATEGORIES) {
    const hits = cat.keywords.filter(k => combined.includes(k)).length;
    if (hits > 0 && hits / cat.keywords.length > best.confidence) {
      best = { id: cat.id, name: cat.name, confidence: hits / cat.keywords.length };
    }
  }
  return best;
}

// ── Wayfair Class ID 匹配 ──────────────────────────────────────
function matchWayfairClass(ctx) {
  const title = (ctx.raw.product?.title || '').toLowerCase();
  const combined = title + ' ' + (ctx.raw.product?.bullets || []).join(' ').toLowerCase();

  let best = { classId: null, className: 'General Furniture', requiredSpecs: [], confidence: 0.5 };
  for (const cls of WAYFAIR_CLASSES) {
    const hits = cls.trigger.filter(k => combined.includes(k.toLowerCase())).length;
    const excludes = cls.exclude.filter(k => combined.includes(k.toLowerCase())).length;
    if (hits > 0 && excludes === 0 && hits / cls.trigger.length > best.confidence) {
      best = { classId: cls.classId, className: cls.className, requiredSpecs: cls.requiredSpecs, confidence: hits / cls.trigger.length, isBed: cls.isBed, isSofa: cls.isSofa, isCookware: cls.isCookware };
    }
  }
  return best;
}

// ── 主函数 ─────────────────────────────────────────────────────
async function matchCategory(ctx) {
  const product = ctx.product || {};
  const identity = product.identity || {};

  ctx.platform = ctx.platform || {};
  ctx.platform.categoryMatch = {
    walmart: { categoryId: null, categoryName: null, specTemplate: null, confidence: null },
    wayfair: { classId: null, className: null, requiredSpecs: [], confidence: null },
    manualReviewNeeded: false
  };

  // 提取规格
  const specs = extractSpecs(ctx);
  ctx.product.specs = specs;
  ctx.product.features = ctx.product.features || [];

  // Walmart 匹配
  const wmCat = matchWalmartCategory(ctx, specs);
  ctx.platform.categoryMatch.walmart = {
    categoryId: wmCat.id,
    categoryName: wmCat.name,
    specTemplate: { filled: Object.keys(specs).length, total: 6 },
    confidence: wmCat.confidence
  };

  // Wayfair 匹配
  const wfCat = matchWayfairClass(ctx);
  ctx.platform.categoryMatch.wayfair = {
    classId: wfCat.classId,
    className: wfCat.className,
    requiredSpecs: wfCat.requiredSpecs || [],
    confidence: wfCat.confidence
  };

  // 填充 specs 里缺少必填项的标记
  const missingWfSpecs = (wfCat.requiredSpecs || []).filter(s => !specs[s]);
  if (missingWfSpecs.length > 0) {
    ctx.platform.manualReviewNeeded = true;
  }

  console.error('[layer4] matchCategory: walmart=' + wmCat.name + ' | wayfair=' + wfCat.className + ' | specs found: ' + Object.keys(specs).join(', '));
  return ctx;
}

async function checkCompliance(ctx) {
  const title = (ctx.raw.product?.title || '').toLowerCase();
  const bullets = (ctx.raw.product?.bullets || []).join(' ').toLowerCase();
  const combined = title + ' ' + bullets;

  ctx.platform.compliance = {
    walmart: { violations: [], riskLevel: 'low' },
    wayfair: { violations: [], riskLevel: 'low' }
  };

  // Walmart 禁词
  const walmartBanned = ['amazon', 'prime', 'fba', 'free shipping', 'best seller', 'top rated', 'price match'];
  const wfViolations = [];
  walmartBanned.forEach(w => {
    if (combined.includes(w)) {
      ctx.platform.compliance.walmart.violations.push('FORBIDDEN_WORD:' + w);
    }
  });
  if (ctx.platform.compliance.walmart.violations.length > 0) {
    ctx.platform.compliance.walmart.riskLevel = 'high';
  }

  // Wayfair 禁词（人称互动）
  if (/you (will|can|should|would)/i.test(bullets)) {
    ctx.platform.compliance.wayfair.violations.push('SECOND_PERSON: found "you will/can/should" in bullets');
  }
  if (ctx.platform.compliance.wayfair.violations.length > 0) {
    ctx.platform.compliance.wayfair.riskLevel = 'medium';
  }

  return ctx;
}

async function buildDiagnosis(ctx) {
  const score = ctx.platform.categoryMatch?.walmart?.specTemplate?.filled || 0;
  ctx.diagnosis = {
    qualityScore: score,
    qualityGrade: score >= 5 ? 'A' : score >= 3 ? 'B' : 'C',
    actionPlan: [],
    pendingData: ctx.platform.manualReviewNeeded ? ['Wayfair class requires manual spec confirmation'] : []
  };
  return ctx;
}

module.exports = { matchCategory, checkCompliance, buildDiagnosis };
