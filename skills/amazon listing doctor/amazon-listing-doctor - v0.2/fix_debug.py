path = r'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor\stepLLM.js'
with open(path, 'rb') as f:
    lines = f.readlines()

inserted = False
for i in range(240, 250):
    if b'var result = await callLLMWithRetry(userPrompt' in lines[i] and b'120000' in lines[i]:
        print(f'Found at line {i+1}: {lines[i].strip()[:80]}')
        log_line = b'  if (!result) { require("fs").appendFileSync("llm_debug.log", "[" + new Date().toISOString() + "] generateOptimizedTitles: LLM returned null\\n"); return null; }\n'
        lines.insert(i+1, log_line)
        print(f'Inserted logging at line {i+2}')
        inserted = True
        break

if not inserted:
    print('NOT FOUND - checking lines 280-290')
    for i in range(280, 295):
        if b'var result = await callLLMWithRetry(userPrompt' in lines[i] and b'120000' in lines[i]:
            print(f'Found at line {i+1}: {lines[i].strip()[:80]}')
            log_line = b'  if (!result) { require("fs").appendFileSync("llm_debug.log", "[" + new Date().toISOString() + "] generateOptimizedBullets: LLM returned null\\n"); return null; }\n'
            lines.insert(i+1, log_line)
            print(f'Inserted logging at line {i+2}')
            inserted = True
            break

with open(path, 'wb') as f:
    f.writelines(lines)
print('Done, inserted =', inserted)
