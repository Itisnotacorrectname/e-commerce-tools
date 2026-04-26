#!/usr/bin/env node
var Diagnose = require('./skills/amazon-listing-doctor/diagnose.js');
var asin = process.argv[2] || 'B08SBRRMQF';
var force = process.argv.includes('--force');
console.log('Testing diagnose.js - ASIN:', asin, 'force:', force);
console.log('Steps exported:', Object.keys(Diagnose).filter(function(k){return k.match(/^step/);}).join(', '));
process.exit(0);
