#!/usr/bin/env python3
import re

path = r'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor\stepLLM.js'

with open(path, 'rb') as f:
    content = f.read()

# Decode for display only
text = content.decode('utf-8', errors='replace')
lines = text.split('\n')

# Find the key lines
for i, line in enumerate(lines):
    if '55000' in line or '60000' in line or 'max_tokens' in line or 'callLLMWithRetry' in line:
        print(f"{i+1}: {line[:100]}")

print("\n--- Making changes ---\n")

# 1. Change default timeout in callLLMWithRetry (line ~14)
# 2. Change max_tokens 300->500 (line ~40)
# 3. Change analyzeListing call 55000->120000 (line ~107)
# 4. Change generateOptimizedTitles call 60000->120000 (line ~243)
# 5. Change generateOptimizedBullets call 60000->120000 (line ~280)

changes = []

for i, line in enumerate(lines):
    ln = i + 1
    # Line 14: default timeout
    if ln == 14 and '55000' in line:
        changes.append(f"  Line {ln}: default timeout 55000 -> 120000")
        lines[i] = line.replace('55000', '120000')
    # Line 40: max_tokens
    elif ln == 40 and 'max_tokens: 300' in line:
        changes.append(f"  Line {ln}: max_tokens 300 -> 500")
        lines[i] = line.replace('max_tokens: 300', 'max_tokens: 500')
    # Line ~107: analyzeListing
    elif ln == 117 and '55000' in line:
        changes.append(f"  Line {ln}: analyzeListing 55000 -> 120000")
        lines[i] = line.replace('55000', '120000')
    # Line ~243: generateOptimizedTitles
    elif ln == 253 and '60000' in line:
        changes.append(f"  Line {ln}: generateOptimizedTitles 60000 -> 120000")
        lines[i] = line.replace('60000', '120000')
    # Line ~280: generateOptimizedBullets
    elif ln == 290 and '60000' in line:
        changes.append(f"  Line {ln}: generateOptimizedBullets 60000 -> 120000")
        lines[i] = line.replace('60000', '120000')

for c in changes:
    print(c)

new_text = '\n'.join(lines)
with open(path, 'w', encoding='utf-8') as f:
    f.write(new_text)

print("\nDone.")
