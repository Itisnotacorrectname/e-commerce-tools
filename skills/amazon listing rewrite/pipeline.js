/**
 * core/pipeline.js — Listing Engine v2
 *
 * 职责：执行调度器。控制各 layer 的执行顺序、依赖管理、错误处理和断点续跑。
 *
 * 三种模式：
 *   diagnose  — 诊断已有 listing（向后兼容 Amazon Listing Doctor）
 *   generate  — 从产品数据生成 listing
 *   transform — 跨平台转写（如 Amazon → Walmart）
 */

'use strict';

const ctx = require('./context.js');
const reg = require('./registry.js');

// ── Layer 执行包装器 ──────────────────────────────────────────
// 统一处理：计时、错误捕获、日志、断点
async function runLayer(context, layerName, moduleName, fn, options) {
  options = options || {};

  // 断点续跑：如果该层已完成且非强制重跑，跳过
  if (!options.force && ctx.hasCheckpoint(context, layerName + '.' + moduleName)) {
    ctx.logExecution(context, layerName, moduleName, 'skipped', 0);
    return context;
  }

  var start = Date.now();
  try {
    context = await fn(context);
    var duration = Date.now() - start;
    ctx.logExecution(context, layerName, moduleName, 'success', duration);
    ctx.setCheckpoint(context, layerName + '.' + moduleName);
    console.error('[pipeline] ✅ ' + layerName + '.' + moduleName + ' (' + duration + 'ms)');
  } catch(e) {
    var duration2 = Date.now() - start;
    ctx.logExecution(context, layerName, moduleName, 'failed', duration2, e.message);
    console.error('[pipeline] ❌ ' + layerName + '.' + moduleName + ': ' + e.message);

    // 非关键层失败：记录警告，继续执行
    if (!options.critical) {
      context.reliability.warnings.push('[' + layerName + '.' + moduleName + '] ' + e.message);
    } else {
      // 关键层失败：终止流程
      throw new Error('[pipeline] Critical layer failed: ' + layerName + '.' + moduleName + ' — ' + e.message);
    }
  }
  return context;
}

// ── 主流程 ────────────────────────────────────────────────────
async function run(input, options) {
  options = options || {};

  console.error('[pipeline] ════════════════════════════════════');
  console.error('[pipeline] Listing Engine v2 — mode: ' + (input.mode || 'diagnose'));
  console.error('[pipeline] ════════════════════════════════════');

  var context = ctx.createContext(input);
  var mode    = input.mode || 'diagnose';
  var force   = options.force || false;

  // ────────────────────────────────────────────────────────────
  //  LAYER 0: 可靠性层初始化（贯穿全流程，先初始化）
  // ────────────────────────────────────────────────────────────
  // layer0 在各层执行时动态更新，不需要独立运行步骤

  // ────────────────────────────────────────────────────────────
  //  LAYER 1: 数据层
  // ────────────────────────────────────────────────────────────
  var l1 = reg.get('layer1_data');

  // 1a. 抓取目标产品（关键层，失败则终止）
  context = await runLayer(context, 'layer1', 'scrape_product', async function(ctx_) {
    return l1.scrapeProduct(ctx_);
  }, { critical: true, force: force });

  // 1b. 清洗数据
  context = await runLayer(context, 'layer1', 'clean', async function(ctx_) {
    return l1.clean(ctx_);
  }, { force: force });

  // 1c. 评论导入（有数据才跑，失败不阻断）
  if (input.reviewsPath || input.reviews) {
    context = await runLayer(context, 'layer1', 'import_reviews', async function(ctx_) {
      return l1.importReviews(ctx_, input.reviewsPath || input.reviews);
    });
  }

  // ────────────────────────────────────────────────────────────
  //  LAYER 2: 产品智能
  // ────────────────────────────────────────────────────────────
  var l2 = reg.get('layer2_product');

  context = await runLayer(context, 'layer2', 'archetype_detect', async function(ctx_) {
    return l2.detectArchetype(ctx_);
  }, { force: force });

  context = await runLayer(context, 'layer2', 'attribute_extract', async function(ctx_) {
    return l2.extractAttributes(ctx_);
  }, { force: force });

  context = await runLayer(context, 'layer2', 'image_analyze', async function(ctx_) {
    return l2.analyzeImages(ctx_);
  }, { force: force });

  // ────────────────────────────────────────────────────────────
  //  LAYER 3: 市场智能
  // ────────────────────────────────────────────────────────────
  var l3 = reg.get('layer3_market');

  // 竞品抓取（关键层）
  context = await runLayer(context, 'layer3', 'scrape_competitors', async function(ctx_) {
    return l3.scrapeCompetitors(ctx_);
  }, { critical: true, force: force });

  context = await runLayer(context, 'layer3', 'analyze_competitors', async function(ctx_) {
    return l3.analyzeCompetitors(ctx_);
  }, { force: force });

  context = await runLayer(context, 'layer3', 'collect_keywords', async function(ctx_) {
    return l3.collectKeywords(ctx_);
  }, { force: force });

  context = await runLayer(context, 'layer3', 'map_keyword_intent', async function(ctx_) {
    return l3.mapKeywordIntent(ctx_);
  }, { force: force });

  context = await runLayer(context, 'layer3', 'analyze_pricing', async function(ctx_) {
    return l3.analyzePricing(ctx_);
  }, { force: force });

  // ────────────────────────────────────────────────────────────
  //  LAYER 4: 平台智能
  // ────────────────────────────────────────────────────────────
  var l4 = reg.get('layer4_platform');

  // 类目匹配（四阶段算法）
  context = await runLayer(context, 'layer4', 'match_category', async function(ctx_) {
    return l4.matchCategory(ctx_);
  }, { force: force });

  // 平台合规检查
  context = await runLayer(context, 'layer4', 'check_compliance', async function(ctx_) {
    return l4.checkCompliance(ctx_);
  }, { force: force });

  // diagnose 模式在这里输出中间报告
  if (mode === 'diagnose') {
    context = await runLayer(context, 'layer4', 'build_diagnosis', async function(ctx_) {
      return l4.buildDiagnosis(ctx_);
    }, { force: force });
  }

  // ────────────────────────────────────────────────────────────
  //  LAYER 5: 转化引擎（generate / transform 模式才跑完整流程）
  // ────────────────────────────────────────────────────────────
  var l5 = reg.get('layer5_conversion');

  // intent 分析在所有模式下都跑（diagnose 也需要 Rufus/Cosmo）
  context = await runLayer(context, 'layer5', 'extract_intent', async function(ctx_) {
    return l5.extractIntent(ctx_);
  }, { force: force });

  context = await runLayer(context, 'layer5', 'score_cosmo', async function(ctx_) {
    return l5.scoreCosmo(ctx_);
  }, { force: force });

  if (mode === 'generate' || mode === 'transform') {
    context = await runLayer(context, 'layer5', 'map_pain', async function(ctx_) {
      return l5.mapPain(ctx_);
    }, { force: force });

    context = await runLayer(context, 'layer5', 'generate_hooks', async function(ctx_) {
      return l5.generateHooks(ctx_);
    }, { force: force });

    context = await runLayer(context, 'layer5', 'build_proof', async function(ctx_) {
      return l5.buildProof(ctx_);
    }, { force: force });

    context = await runLayer(context, 'layer5', 'build_messaging', async function(ctx_) {
      return l5.buildMessaging(ctx_);
    }, { force: force });

    context = await runLayer(context, 'layer5', 'differentiate', async function(ctx_) {
      return l5.differentiate(ctx_);
    }, { force: force });

    context = await runLayer(context, 'layer5', 'select_strategy', async function(ctx_) {
      return l5.selectStrategy(ctx_);
    }, { force: force });
  }

  // ────────────────────────────────────────────────────────────
  //  LAYER 6: Composer（generate / transform 模式）
  // ────────────────────────────────────────────────────────────
  if (mode === 'generate' || mode === 'transform') {
    var l6       = reg.get('layer6_composer');
    var targets  = input.targetPlatforms || [input.platform || 'amazon'];

    for (var i = 0; i < targets.length; i++) {
      var platform = targets[i];
      context = await runLayer(context, 'layer6', 'compose_' + platform, async function(ctx_) {
        return l6.compose(ctx_, platform);
      }, { force: force });
    }
  }

  // ────────────────────────────────────────────────────────────
  //  LAYER 7: Constraint Solver（generate / transform 模式）
  // ────────────────────────────────────────────────────────────
  if (mode === 'generate' || mode === 'transform') {
    var l7 = reg.get('layer7_solver');
    context = await runLayer(context, 'layer7', 'solve_constraints', async function(ctx_) {
      return l7.solve(ctx_);
    }, { force: force });
  }

  // ── 执行完成 ─────────────────────────────────────────────────
  var totalMs = context._meta.executionLog.reduce(function(s, e) { return s + (e.duration || 0); }, 0);
  var failed  = context._meta.executionLog.filter(function(e) { return e.status === 'failed'; }).length;

  console.error('[pipeline] ════════════════════════════════════');
  console.error('[pipeline] ✅ Done — ' + totalMs + 'ms, ' + failed + ' failed module(s)');
  if (context.reliability.warnings.length > 0) {
    console.error('[pipeline] ⚠ Warnings: ' + context.reliability.warnings.length);
    context.reliability.warnings.forEach(function(w) { console.error('  ' + w); });
  }
  if (context.reliability.manualReview) {
    console.error('[pipeline] 🔍 Manual review required');
  }
  console.error('[pipeline] ════════════════════════════════════');

  return context;
}

// ── 便捷入口 ─────────────────────────────────────────────────
function diagnose(urlOrAsin, options) {
  var input = typeof urlOrAsin === 'string' && urlOrAsin.startsWith('http')
    ? { url: urlOrAsin, mode: 'diagnose' }
    : { asin: urlOrAsin, mode: 'diagnose' };
  return run(Object.assign(input, options || {}));
}

function generate(productData, targetPlatforms, options) {
  return run(Object.assign({
    mode:            'generate',
    productData:     productData,
    targetPlatforms: targetPlatforms || ['amazon'],
  }, options || {}));
}

function transform(urlOrAsin, sourcePlatform, targetPlatforms, options) {
  var input = typeof urlOrAsin === 'string' && urlOrAsin.startsWith('http')
    ? { url: urlOrAsin }
    : { asin: urlOrAsin };
  return run(Object.assign(input, {
    mode:            'transform',
    sourcePlatform:  sourcePlatform,
    targetPlatforms: targetPlatforms,
  }, options || {}));
}

module.exports = { run, diagnose, generate, transform };
