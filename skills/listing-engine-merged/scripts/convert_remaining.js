/**
 * scripts/convert_remaining.js
 * Convert remaining ESM files to CJS
 */
'use strict';
const fs = require('fs');

function convertFile(fp) {
  let content = fs.readFileSync(fp, 'utf8');
  const original = content;

  content = content.replace(/^export\s+function\s+(\w+)/gm, 'function $1');
  content = content.replace(/^export\s+async\s+function\s+(\w+)/gm, 'async function $1');
  content = content.replace(/^export\s+const\s+(\w+)\s*=/gm, 'const $1 =');
  content = content.replace(/^export\s+\{[^}]+\}\s+from\s+['"][^'"]+['"]\s*;/gm, '');
  content = content.replace(/^export\s+default\s+/gm, '// default export ');
  content = content.replace(/^import\s+\w+\s+from\s+['"][^'"]+['"]\s*;$/gm, '');
  content = content.replace(/^import\s+\{[^}]+\}\s+from\s+['"][^'"]+['"]\s*;$/gm, '');
  content = content.replace(/^import\s+\*\s+as\s+\w+\s+from\s+['"][^'"]+['"]\s*;$/gm, '');

  if (content !== original) {
    fs.writeFileSync(fp, content, 'utf8');
    console.log('Converted: ' + fp.replace('C:/Users/csbd/.openclaw/workspace/skills/listing-engine-merged/', ''));
  }
}

const dst = 'C:/Users/csbd/.openclaw/workspace/skills/listing-engine-merged';
const files = [
  dst + '/attribute_normalizer.js',
  dst + '/layer4_platform/amazon_to_walmart.js',
  dst + '/layer5_conversion/hook_generator.js',
  dst + '/layer5_conversion/intent_extractor.js',
  dst + '/layer5_conversion/messaging_engine.js',
  dst + '/layer5_conversion/pain_mapper.js',
  dst + '/layer5_conversion/proof_builder.js',
  dst + '/layer5_conversion/scoring/metrics/clarity.js',
  dst + '/layer5_conversion/scoring/metrics/differentiation.js',
  dst + '/layer5_conversion/scoring/metrics/emotion.js',
  dst + '/layer5_conversion/scoring/metrics/platform_fit.js',
  dst + '/layer5_conversion/scoring/metrics/specificity.js',
  dst + '/layer5_conversion/scoring/weights/platform_weights.js',
  dst + '/layer7_solver/constraints/keyword_repeat.js',
  dst + '/layer7_solver/constraints/platform_rules.js',
  dst + '/layer7_solver/rewrite/templates.js',
  dst + '/layer7_solver/utils/similarity.js',
  dst + '/rule_executor.js',
  dst + '/schema_validator.js'
];

files.forEach(function(fp) {
  try { convertFile(fp); } catch(e) { console.log('ERROR ' + fp.split('/').pop() + ': ' + e.message); }
});
console.log('Done');