#!/usr/bin/env python3
data = open(r'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor\diagnose.js','rb').read()
print('diagnose.js size:', len(data))

# Count stepLLM require occurrences
stepllm_count = data.count(b"var stepLLM = require")
print('stepLLM require count:', stepllm_count)

# Check if generateOptimizedTitles is present
print('generateOptimizedTitles present:', b'generateOptimizedTitles' in data)
print('generateOptimizedBullets present:', b'generateOptimizedBullets' in data)

# Find the stepLLM require that is NOT in step9 context
idx = data.find(b"var stepLLM = require")
print('first stepLLM require at byte', idx)
print('context:', repr(data[idx:idx+80]))
