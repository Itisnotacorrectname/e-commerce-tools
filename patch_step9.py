#!/usr/bin/env python3
import sys

path = r'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor\diagnose.js'
with open(path, 'rb') as f:
    data = f.read()

CRLF = b'\r\n'

search = (
    CRLF + b'  var violations = s11 ? (s11.violations || []) : [];' + CRLF +
    b'  var missingEgeo = s12 ? (s12.egeoFeatures || []).filter(function(f) { return f.missing; }) : [];' + CRLF +
    CRLF + CRLF +
    b'  var violatedBullets = {};' + CRLF +
    b'  violations.forEach(function(v) {' + CRLF +
    b'    if (v.bullet) violatedBullets[v.bullet - 1] = v;' + CRLF +
    b'  });' + CRLF +
    CRLF + CRLF +
    b'  var optimized = bullets.map(function(bulletText, i) {' + CRLF +
    b'    var violationActions = [];' + CRLF +
    b'    var enhanceActions = [];' + CRLF +
    b'    var text = bulletText;'
)

replace = (
    CRLF + b"  var violations = (s11 ? (s11.violations || []) : []).filter(function(v) { return v.severity && v.severity !== 'none'; });" + CRLF +
    b"  var missingEgeo = s12 ? (s12.egeoFeatures || []).filter(function(f) { return f.missing; }) : [];" + CRLF +
    CRLF +
    b"  // LLM-driven bullet generation (step9)" + CRLF +
    b"  var stepLLM = require('./stepLLM');" + CRLF +
    b"  log('  [step9] generating optimized bullets via LLM...');" + CRLF +
    b"  var llmBullets = null;" + CRLF +
    b"  try {" + CRLF +
    b"    llmBullets = await stepLLM.generateOptimizedBullets({" + CRLF +
    b"      bullets: bullets," + CRLF +
    b"      violations: violations," + CRLF +
    b"      implicitViolations: s11 ? (s11.implicitViolations || []) : []," + CRLF +
    b"      missingEgeo: missingEgeo" + CRLF +
    b"    });" + CRLF +
    b"  } catch(e) {" + CRLF +
    b"    log('  [step9] LLM bullet gen failed: ' + e.message + ' falling back to template');" + CRLF +
    b"  }" + CRLF +
    b"  if (llmBullets && llmBullets.bullets && llmBullets.bullets.length > 0) {" + CRLF +
    b"    var bulletMap = {};" + CRLF +
    b"    llmBullets.bullets.forEach(function(b) {" + CRLF +
    b"      if (b.index !== undefined) bulletMap[b.index - 1] = b;" + CRLF +
    b"    });" + CRLF +
    b"    var optimized = bullets.map(function(bulletText, i) {" + CRLF +
    b"      if (bulletMap[i]) {" + CRLF +
    b"        var b = bulletMap[i];" + CRLF +
    b"        var parts = [b.rewritten || bulletText];" + CRLF +
    b"        if (b.actions && b.actions.length > 0) {" + CRLF +
    b"          b.actions.forEach(function(a) { parts.push('  -> ' + a); });" + CRLF +
    b"        }" + CRLF +
    b"        return parts.join('\\n');" + CRLF +
    b"      }" + CRLF +
    b"      return bulletText;" + CRLF +
    b"    });" + CRLF +
    b"    return { optimized: optimized, missingEgeo: missingEgeo.map(function(f) { return f.label; }), method: 'llm' };" + CRLF +
    b"  }" + CRLF +
    b"  // Fallback: Template-based bullet optimization" + CRLF +
    b"  var violatedBullets = {};" + CRLF +
    b"  violations.forEach(function(v) {" + CRLF +
    b"    if (v.bullet) violatedBullets[v.bullet - 1] = v;" + CRLF +
    b"  });" + CRLF +
    CRLF +
    b"  var optimized = bullets.map(function(bulletText, i) {" + CRLF +
    b"    var violationActions = [];" + CRLF +
    b"    var enhanceActions = [];" + CRLF +
    b"    var text = bulletText;"
)

idx = data.find(search)
if idx < 0:
    print('NOT FOUND')
    sys.exit(1)

print('Found at byte', idx)
new_data = data[:idx] + replace + data[idx+len(search):]
with open(path, 'wb') as f:
    f.write(new_data)
print('Patched OK, new len:', len(new_data))
