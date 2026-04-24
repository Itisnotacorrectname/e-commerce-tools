#!/usr/bin/env node
// step10_external.js - 独立进程运行 step10 LLM 分析
// 解决 OpenClaw agent exec 期间 gateway HTTP 请求被阻塞的问题
var stepLLM = require('./stepLLM.js');
var fs = require('fs');
var path = require('path');
var os = require('os');

var asin = process.argv[2];
if (!asin) { console.error('Usage: node step10_external.js <ASIN>'); process.exit(1); }

// Derive CHECKPOINT_DIR same as diagnose.js
var workspace = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
var CHECKPOINT_DIR = path.join(workspace, 'amazon-listing-doctor', 'checkpoints');
var checkpointDir = path.join(CHECKPOINT_DIR, asin);
var s2File = path.join(checkpointDir, 'step2.json');
var step10File = path.join(checkpointDir, 'step10.json');

if (!fs.existsSync(s2File)) {
  console.error('step2.json not found for', asin, 'at', s2File);
  process.exit(1);
}

var s2 = JSON.parse(fs.readFileSync(s2File, 'utf8'));
// Pass raw data — stepLLM.analyzeListing handles truncation internally
var title = s2.title || '';
var bullets = (s2.bullets || []).slice(0, 5);

var start = Date.now();
console.log('[step10_external] Starting LLM analysis for', asin);

stepLLM.analyzeListing({ title: title, bullets: bullets, category: s2.category || '' })
  .then(function(result) {
    var elapsed = Date.now() - start;
    console.log('[step10_external] Done in', elapsed, 'ms | method:', result.method);
    fs.writeFileSync(step10File, JSON.stringify(result, null, 2), 'utf8');
    console.log('[step10_external] Saved to', step10File);
    process.exit(0);
  })
  .catch(function(e) {
    console.error('[step10_external] ERROR:', e.message);
    console.error('[step10_external] Stack:', e.stack);
    process.exit(1);
  });
