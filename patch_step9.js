#!/usr/bin/env node
// Patch diagnose.js step9 to add LLM bullet generation
var fs = require('fs');
var path = 'skills/amazon-listing-doctor/diagnose.js';
var f = fs.readFileSync(path, 'utf8');

// Find the step9 block to replace
var searchStr = 'async function step9(ctx) {'
  + '\n  var s2 = ctx.deps[2].data;'
  + '\n  var s11 = ctx.deps[11] ? ctx.deps[11].data : null;'
  + '\n  var s12 = ctx.deps[12] ? ctx.deps[12].data : null;'
  + '\n  var bullets = s2.bullets || [];'
  + '\n  var violations = s11 ? (s11.violations || []) : [];'
  + '\n  var missingEgeo = s12 ? (s12.egeoFeatures || []).filter(function(f) { return f.missing; }) : [];'
  + '\n\n  var violatedBullets = {};'
  + '\n  violations.forEach(function(v) {'
  + '\n    if (v.bullet) violatedBullets[v.bullet - 1] = v;'
  + '\n  });'
  + '\n\n  var optimized = bullets.map(function(bulletText, i) {'
  + '\n    var violationActions = [];'
  + '\n    var enhanceActions = [];'
  + '\n    var text = bulletText;';

var replaceStr = 'async function step9(ctx) {'
  + '\n  var s2 = ctx.deps[2].data;'
  + '\n  var s11 = ctx.deps[11] ? ctx.deps[11].data : null;'
  + '\n  var s12 = ctx.deps[12] ? ctx.deps[12].data : null;'
  + '\n  var bullets = s2.bullets || [];'
  + '\n  var violations = (s11 ? (s11.violations || []) : []).filter(function(v) { return v.severity && v.severity !== \'none\'; });'
  + '\n  var missingEgeo = s12 ? (s12.egeoFeatures || []).filter(function(f) { return f.missing; }) : [];'
  + '\n\n  // ── LLM-driven bullet generation (step9) ──'
  + '\n  var stepLLM = require(\'./stepLLM\');'
  + '\n  log(\'  [step9] generating optimized bullets via LLM...\');'
  + '\n  var llmBullets = null;'
  + '\n  try {'
  + '\n    llmBullets = await stepLLM.generateOptimizedBullets({'
  + '\n      bullets: bullets,'
  + '\n      violations: violations,'
  + '\n      implicitViolations: s11 ? (s11.implicitViolations || []) : [],'
  + '\n      missingEgeo: missingEgeo'
  + '\n    });'
  + '\n  } catch(e) {'
  + '\n    log(\'  [step9] LLM bullet gen failed: \' + e.message + \' — falling back to template\');'
  + '\n  }'
  + '\n  if (llmBullets && llmBullets.bullets && llmBullets.bullets.length > 0) {'
  + '\n    var bulletMap = {};'
  + '\n    llmBullets.bullets.forEach(function(b) {'
  + '\n      if (b.index !== undefined) bulletMap[b.index - 1] = b;'
  + '\n    });'
  + '\n    var optimized = bullets.map(function(bulletText, i) {'
  + '\n      if (bulletMap[i]) {'
  + '\n        var b = bulletMap[i];'
  + '\n        var parts = [b.rewritten || bulletText];'
  + '\n        if (b.actions && b.actions.length > 0) {'
  + '\n          b.actions.forEach(function(a) { parts.push(\'  \\u2192 \' + a); });'
  + '\n        }'
  + '\n        return parts.join(\'\\n\');'
  + '\n      }'
  + '\n      return bulletText;'
  + '\n    });'
  + '\n    return { optimized: optimized, missingEgeo: missingEgeo.map(function(f) { return f.label; }), method: \'llm\' };'
  + '\n  }'
  + '\n  // ── Fallback: Template-based bullet optimization ──'
  + '\n  var violatedBullets = {};'
  + '\n  violations.forEach(function(v) {'
  + '\n    if (v.bullet) violatedBullets[v.bullet - 1] = v;'
  + '\n  });'
  + '\n  var optimized = bullets.map(function(bulletText, i) {'
  + '\n    var violationActions = [];'
  + '\n    var enhanceActions = [];'
  + '\n    var text = bulletText;';

var idx = f.indexOf(searchStr);
if (idx < 0) {
  console.log('Could not find step9 search string');
  process.exit(1);
}
console.log('Found step9 at char', idx);
var newF = f.slice(0, idx) + replaceStr + f.slice(idx + searchStr.length);
fs.writeFileSync(path, newF, 'utf8');
console.log('Patched successfully');
