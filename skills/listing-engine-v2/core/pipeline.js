/**
 * core/pipeline.js — Listing Engine v2.0
 *
 * 执行调度器：按顺序执行 L0-L7 八层 pipeline。
 * 依赖 registry 动态加载各层模块。
 * 支持断点续跑（hasCheckpoint）和 force 模式。
 */

'use strict';

var path   = require('path');
var config = require('./config.js');
var ctxBus = require('./context.js');
var registry = require('./registry.js');

// ── 注册所有 layer ────────────────────────────────────────────
var BASE = path.join(__dirname, '..');
registry.registerDefaults(BASE);

// ── Pipeline 阶段定义 ──────────────────────────────────────────
var STAGES = [
  { name: 'layer0_reliability', deps: [],        key: 'layer0_reliability' },
  { name: 'layer1_data',        deps: ['layer0_reliability'], key: 'layer1_data' },
  { name: 'layer2_product',     deps: ['layer0_reliability'], key: 'layer2_product' },
  { name: 'layer3_market',      deps: ['layer1_data', 'layer2_product'], key: 'layer3_market' },
  { name: 'layer4_platform',    deps: ['layer2_product', 'layer3_market'], key: 'layer4_platform' },
  { name: 'layer5_conversion',  deps: ['layer3_market', 'layer4_platform'], key: 'layer5_conversion' },
  { name: 'layer6_composer',    deps: ['layer4_platform', 'layer5_conversion'], key: 'layer6_composer' },
  { name: 'layer7_solver',      deps: ['layer6_composer'], key: 'layer7_solver' },
];

// ── 主运行函数 ────────────────────────────────────────────────
async function run(input) {
  var force = input.options && input.options.force;

  // 初始化 context
  var ctx = ctxBus.createContext(input);

  console.log('[pipeline] Starting — mode=' + input.mode + ', platform=' + input.platform +
    (input.asin ? ', asin=' + input.asin : '') + (input.url ? ', url=' + input.url : ''));

  // 依次执行每个 stage
  for (var i = 0; i < STAGES.length; i++) {
    var stage = STAGES[i];

    // 检查断点
    if (!force && ctxBus.hasCheckpoint(ctx, stage.name)) {
      console.log('[pipeline] Skip (checkpoint): ' + stage.name);
      continue;
    }

    // 检查依赖
    var depsOk = stage.deps.every(function(d) {
      return ctxBus.hasCheckpoint(ctx, d);
    });
    if (!depsOk) {
      console.log('[pipeline] Skip (deps not met): ' + stage.name);
      continue;
    }

    var t0 = Date.now();
    try {
      var layer = registry.get(stage.key);
      if (typeof layer.run === 'function') {
        await layer.run(ctx, input);
      } else if (typeof layer.execute === 'function') {
        await layer.execute(ctx, input);
      } else if (typeof layer.transform === 'function') {
        await layer.transform(ctx, input);
      } else {
        throw new Error('Layer has no run/execute/transform method');
      }
      ctxBus.setCheckpoint(ctx, stage.name);
      ctxBus.logExecution(ctx, stage.name, stage.key, 'success', Date.now() - t0);
      console.log('[pipeline] Done (' + (Date.now() - t0) + 'ms): ' + stage.name);
    } catch(e) {
      ctxBus.logExecution(ctx, stage.name, stage.key, 'failed', Date.now() - t0, e.message);
      console.error('[pipeline] Error [' + stage.name + ']: ' + e.message);
      if (stage.deps.length === 0) throw e;  // L0/L1 出错直接抛
      // 后续 stage 标记跳过
      ctxBus.flagManualReview(ctx, stage.name + ' failed: ' + e.message);
    }
  }

  return ctx;
}

// ── 单独运行某个 layer（调试用）────────────────────────────
async function runLayer(layerKey, ctx, input) {
  registry.registerDefaults(path.join(__dirname, '..'));
  var layer = registry.get(layerKey);
  var t0 = Date.now();
  if (typeof layer.run === 'function') {
    await layer.run(ctx, input);
  } else if (typeof layer.execute === 'function') {
    await layer.execute(ctx, input);
  } else {
    await layer.transform(ctx, input);
  }
  console.log('[' + layerKey + '] done in ' + (Date.now() - t0) + 'ms');
  return ctx;
}

// ── 健康检查 ────────────────────────────────────────────────
function healthCheck() {
  return registry.healthCheck();
}

module.exports = {
  run:       run,
  runLayer:  runLayer,
  healthCheck: healthCheck,
  STAGES:    STAGES,
};