/**
 * listing-engine/index.js — Main Entry Point
 *
 * 使用方式：
 *   const engine = require('./listing-engine');
 *
 *   // 诊断模式（兼容现有 Amazon Listing Doctor）
 *   const result = await engine.diagnose('B0GJZSK34K');
 *
 *   // 生成模式
 *   const result = await engine.generate('B0GJZSK34K', ['amazon', 'walmart']);
 *
 *   // 转写模式
 *   const result = await engine.transform('B0GJZSK34K', 'amazon', ['walmart', 'wayfair']);
 *
 * CLI:
 *   node listing-engine diagnose B0GJZSK34K
 *   node listing-engine generate B0GJZSK34K --platforms=amazon,walmart
 *   node listing-engine transform B0GJZSK34K --from=amazon --to=walmart,wayfair
 */

'use strict';

const pipeline = require('./core/pipeline.js');
const registry = require('./core/registry.js');
const context  = require('./core/context.js');
const path     = require('path');
const fs       = require('fs');

// ── 初始化注册表 ──────────────────────────────────────────────
registry.registerDefaults(path.join(__dirname));

// ── 公共 API ──────────────────────────────────────────────────
async function diagnose(asinOrUrl, options) {
  return pipeline.diagnose(asinOrUrl, options);
}

async function generate(asinOrUrl, targetPlatforms, options) {
  return pipeline.generate(asinOrUrl, targetPlatforms, options);
}

async function transform(asinOrUrl, sourcePlatform, targetPlatforms, options) {
  return pipeline.transform(asinOrUrl, sourcePlatform, targetPlatforms, options);
}

// ── 结果序列化 ────────────────────────────────────────────────
function saveResult(ctx, outputPath) {
  var dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, context.serialize(ctx), 'utf8');
  console.error('[engine] Saved to: ' + outputPath);
}

// ── CLI 入口 ──────────────────────────────────────────────────
if (require.main === module) {
  var args    = process.argv.slice(2);
  var mode    = args[0] || 'diagnose';
  var target  = args[1];

  if (!target) {
    console.error('Usage:');
    console.error('  node index.js diagnose  <ASIN>');
    console.error('  node index.js generate  <ASIN> [--platforms=amazon,walmart,wayfair]');
    console.error('  node index.js transform <ASIN> --from=amazon --to=walmart,wayfair');
    console.error('  node index.js test');
    process.exit(1);
  }

  // 解析 --key=value 参数
  var flags = {};
  args.slice(2).forEach(function(arg) {
    var m = arg.match(/^--(\w+)=(.+)$/);
    if (m) flags[m[1]] = m[2];
  });

  var run;
  if (mode === 'diagnose') {
    run = diagnose(target);
  } else if (mode === 'generate') {
    var platforms = (flags.platforms || 'amazon').split(',');
    run = generate(target, platforms);
  } else if (mode === 'transform') {
    var from = flags.from || 'amazon';
    var to   = (flags.to || 'walmart').split(',');
    run = transform(target, from, to);
  } else if (mode === 'test') {
    run = require('./test/smoke_test.js').run();
  } else {
    console.error('Unknown mode: ' + mode);
    process.exit(1);
  }

  if (run) {
    run.then(function(ctx) {
      if (mode !== 'test') {
        // 输出关键结果摘要
        console.log('\n════ RESULT SUMMARY ════');
        console.log('ASIN:         ', ctx.input.asin || 'N/A');
        console.log('Core Product: ', ctx.product.identity.coreProduct || 'N/A');
        console.log('Archetype:    ', (ctx.product.archetype && ctx.product.archetype.primary) || 'N/A');
        console.log('Keywords:     ', (ctx.market.keywords.primary || []).slice(0, 3).map(function(k) { return typeof k === 'string' ? k : k.keyword; }).join(', '));
        console.log('Quality Score:', ctx.diagnosis.qualityScore || 'N/A');
        console.log('Quality Grade:', ctx.diagnosis.qualityGrade || 'N/A');

        if (ctx.composed.amazon && ctx.composed.amazon.title) {
          console.log('\nAmazon Title: ', ctx.composed.amazon.title);
        }
        if (ctx.composed.walmart && ctx.composed.walmart.title) {
          console.log('Walmart Title:', ctx.composed.walmart.title);
        }
        if (ctx.composed.wayfair && ctx.composed.wayfair.title) {
          console.log('Wayfair Title:', ctx.composed.wayfair.title);
        }
        if (ctx.reliability.warnings.length > 0) {
          console.log('\nWarnings:', ctx.reliability.warnings.length);
        }
        if (ctx.reliability.manualReview) {
          console.log('⚠ Manual review required');
        }
      }
    }).catch(function(e) {
      console.error('FATAL:', e.message);
      process.exit(1);
    });
  }
}

module.exports = { diagnose, generate, transform, saveResult };
