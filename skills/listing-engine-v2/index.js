/**
 * index.js — Listing Engine v2.0
 *
 * 入口：node index.js <command> [options]
 *
 * Commands:
 *   node index.js diagnose  <asin>          — 诊断 Amazon 链接
 *   node index.js rewrite  <source> <target> — 将 source 平台 listing 改写到 target 平台
 *
 * Examples:
 *   node index.js diagnose B0F9P8MP39
 *   node index.js rewrite amazon walmart --asin B0F9P8MP39
 *   node index.js rewrite amazon wayfair --url https://www.amazon.com/...
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ── 解析命令行 ────────────────────────────────────────────────
var args    = process.argv.slice(2);
var command = args[0] || 'help';
var opts    = parseArgs(args.slice(1));

function parseArgs(raw) {
  var opts = { asin: null, url: null, platform: null, marketplace: 'US', force: false };
  for (var i = 0; i < raw.length; i++) {
    if (raw[i] === '--asin')       opts.asin       = raw[++i];
    else if (raw[i] === '--url')   opts.url        = raw[++i];
    else if (raw[i] === '--platform') opts.platform = raw[++i];
    else if (raw[i] === '--marketplace') opts.marketplace = raw[++i];
    else if (raw[i] === '--force') opts.force      = true;
    else if (!raw[i].startsWith('--')) opts.source  = raw[i];
  }
  return opts;
}

// ── 加载 pipeline ─────────────────────────────────────────────
var pipeline;
try {
  pipeline = require('./core/pipeline.js');
} catch(e) {
  console.error('[index] Cannot load pipeline:', e.message);
  process.exit(1);
}

// ── 命令处理 ──────────────────────────────────────────────────
async function main() {
  switch (command) {
    case 'diagnose': {
      if (!opts.asin && !opts.url) {
        console.error('Usage: node index.js diagnose <asin|url> [--force]');
        process.exit(1);
      }
      var input = {
        asin:        opts.asin || null,
        url:         opts.url  || null,
        platform:    'amazon',
        marketplace: opts.marketplace,
        mode:        'diagnose',
        options:     { force: opts.force },
      };
      var result = await pipeline.run(input);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'rewrite': {
      var source = opts.source || args[1];
      var target = args[2] || opts.platform;
      if (!source || !target) {
        console.error('Usage: node index.js rewrite <sourcePlatform> <targetPlatform> [--asin <asin>] [--url <url>]');
        process.exit(1);
      }
      var input = {
        asin:        opts.asin || null,
        url:         opts.url  || null,
        platform:    target,
        marketplace: opts.marketplace,
        mode:        'transform',
        sourcePlatform: source,
        targetPlatform: target,
        options:     { force: opts.force },
      };
      var result = await pipeline.run(input);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'help':
    default:
      console.log('Listing Engine v2.0');
      console.log('');
      console.log('Commands:');
      console.log('  node index.js diagnose  <asin|url> [--force]');
      console.log('  node index.js rewrite  <sourcePlatform> <targetPlatform> [--asin <asin>] [--url <url>]');
      console.log('');
      console.log('Examples:');
      console.log('  node index.js diagnose B0F9P8MP39');
      console.log('  node index.js rewrite amazon walmart --asin B0F9P8MP39');
      console.log('  node index.js rewrite amazon wayfair --url https://www.amazon.com/...');
  }
}

main().catch(function(e) {
  console.error('[index] Fatal:', e.message);
  process.exit(1);
});