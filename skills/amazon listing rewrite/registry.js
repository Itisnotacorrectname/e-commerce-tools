/**
 * core/registry.js — Listing Engine v2
 *
 * 职责：模块注册表。所有 layer 模块通过 registry 注册，pipeline 通过 registry 调用。
 *
 * 设计原则：
 *   - 解耦：pipeline.js 不直接 require 任何 layer 模块
 *   - 可替换：同一接口可注册不同实现（A/B 测试、版本切换）
 *   - 懒加载：模块在第一次 get 时才 require，避免启动时全量加载
 */

'use strict';

const path = require('path');

// ── 默认模块路径映射 ──────────────────────────────────────────
// 每个 key 对应 pipeline.js 里 reg.get(key) 的调用
var DEFAULT_MODULES = {
  'layer1_data':       '../layer1_data/index.js',
  'layer2_product':    '../layer2_product/index.js',
  'layer3_market':     '../layer3_market/index.js',
  'layer4_platform':   '../layer4_platform/index.js',
  'layer5_conversion': '../layer5_conversion/index.js',
  'layer6_composer':   '../layer6_composer/index.js',
  'layer7_solver':     '../layer7_solver/index.js',
};

// ── 注册表状态 ────────────────────────────────────────────────
var _registry = {};     // { key: { modulePath, instance, version } }
var _overrides = {};    // 测试或 A/B 时注入的替代模块

// ── 注册模块 ──────────────────────────────────────────────────
function register(key, modulePath, version) {
  _registry[key] = {
    modulePath: modulePath,
    instance:   null,   // 懒加载，首次 get 时初始化
    version:    version || '1.0.0',
  };
}

// ── 注册所有默认模块 ──────────────────────────────────────────
function registerDefaults(baseDir) {
  baseDir = baseDir || path.join(__dirname, '..');
  Object.keys(DEFAULT_MODULES).forEach(function(key) {
    register(key, path.join(baseDir, DEFAULT_MODULES[key]));
  });
}

// ── 获取模块实例（懒加载）────────────────────────────────────
function get(key) {
  // 优先使用 override（用于测试 / A/B）
  if (_overrides[key]) return _overrides[key];

  var entry = _registry[key];
  if (!entry) {
    throw new Error('[registry] Module not registered: "' + key + '". Call registerDefaults() first.');
  }

  // 懒加载
  if (!entry.instance) {
    try {
      entry.instance = require(entry.modulePath);
    } catch(e) {
      throw new Error('[registry] Failed to load module "' + key + '" from ' + entry.modulePath + ': ' + e.message);
    }
  }

  return entry.instance;
}

// ── 临时覆盖（测试用）────────────────────────────────────────
function override(key, moduleImpl) {
  _overrides[key] = moduleImpl;
}

function clearOverrides() {
  _overrides = {};
}

// ── 检查所有模块是否可加载 ────────────────────────────────────
function healthCheck() {
  var results = {};
  Object.keys(_registry).forEach(function(key) {
    try {
      get(key);
      results[key] = 'ok';
    } catch(e) {
      results[key] = 'error: ' + e.message;
    }
  });
  return results;
}

// ── 列出所有已注册模块 ────────────────────────────────────────
function list() {
  return Object.keys(_registry).map(function(key) {
    return { key: key, version: _registry[key].version, loaded: !!_registry[key].instance };
  });
}

module.exports = {
  register,
  registerDefaults,
  get,
  override,
  clearOverrides,
  healthCheck,
  list,
};
