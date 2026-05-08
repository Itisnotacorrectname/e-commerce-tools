/**
 * core/registry.js — Listing Engine v2.0
 *
 * 模块注册表，懒加载各层实现。
 * pipeline.js 通过 registry.get(key) 调用，不直接 require。
 */

'use strict';

var path = require('path');

// ── 默认模块路径映射 ──────────────────────────────────────────
var DEFAULT_MODULES = {
  'layer0_reliability': '../layer0_reliability/index.js',
  'layer1_data':        '../layer1_data/index.js',
  'layer2_product':     '../layer2_product/index.js',
  'layer3_market':      '../layer3_market/index.js',
  'layer4_platform':    '../layer4_platform/index.js',
  'layer5_conversion':  '../layer5_conversion/index.js',
  'layer6_composer':    '../layer6_composer/index.js',
  'layer7_solver':      '../layer7_solver/index.js',
};

var _registry  = {};
var _overrides = {};

function register(key, modulePath, version) {
  _registry[key] = {
    modulePath: modulePath,
    instance:   null,
    version:    version || '1.0.0',
  };
}

function registerDefaults(baseDir) {
  baseDir = baseDir || path.join(__dirname, '..');
  Object.keys(DEFAULT_MODULES).forEach(function(key) {
    register(key, path.join(baseDir, DEFAULT_MODULES[key]));
  });
}

function get(key) {
  if (_overrides[key]) return _overrides[key];
  var entry = _registry[key];
  if (!entry) {
    throw new Error('[registry] Module not registered: "' + key + '". Call registerDefaults() first.');
  }
  if (!entry.instance) {
    try {
      entry.instance = require(entry.modulePath);
    } catch(e) {
      throw new Error('[registry] Failed to load "' + key + '" from ' + entry.modulePath + ': ' + e.message);
    }
  }
  return entry.instance;
}

function override(key, moduleImpl) {
  _overrides[key] = moduleImpl;
}

function clearOverrides() {
  _overrides = {};
}

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

function list() {
  return Object.keys(_registry).map(function(key) {
    return { key: key, version: _registry[key].version, loaded: !!_registry[key].instance };
  });
}

module.exports = {
  register:        register,
  registerDefaults: registerDefaults,
  get:              get,
  override:         override,
  clearOverrides:   clearOverrides,
  healthCheck:      healthCheck,
  list:             list,
};