#!/usr/bin/env python3
import time, subprocess, os, json

SKILL_DIR = r'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor'
WORKSPACE  = r'C:\Users\csbd\.openclaw\workspace'
CHECKPOINT = os.path.join(WORKSPACE, 'amazon-listing-doctor', 'checkpoints', 'B0CZPF85JY')
REPORT_DIR = os.path.join(WORKSPACE, 'amazon-listing-doctor', 'reports', 'B0CZPF85JY')
TOKEN = '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3'

def clear_steps():
    for n in range(5, 16):
        p = os.path.join(CHECKPOINT, f'step{n}.json')
        if os.path.exists(p):
            os.remove(p)
    log_path = os.path.join(SKILL_DIR, 'llm_debug.log')
    if os.path.exists(log_path):
        os.remove(log_path)
    print('[clear] steps 5-15 cleared')

def run_diagnose():
    env = os.environ.copy()
    env['OPENCLAW_GATEWAY_TOKEN'] = TOKEN
    cmd = ['node', 'diagnose.js', 'B0CZPF85JY']
    print(f'[run] {" ".join(cmd)}')
    r = subprocess.run(cmd, cwd=SKILL_DIR, env=env, capture_output=True, text=True, timeout=900)
    print('[run] stdout:', r.stdout[:500] if r.stdout else '')
    print('[run] stderr:', r.stderr[:300] if r.stderr else '')
    return r.returncode

def check_llm_log():
    log = os.path.join(SKILL_DIR, 'llm_debug.log')
    if not os.path.exists(log):
        return '(no log yet)'
    with open(log) as f:
        return f.read().strip()

def check_step7():
    p = os.path.join(CHECKPOINT, 'step7.json')
    if not os.path.exists(p):
        return None
    with open(p) as f:
        d = json.load(f)
    return d

def check_step10():
    p = os.path.join(CHECKPOINT, 'step10.json')
    if not os.path.exists(p):
        return None
    with open(p) as f:
        return json.load(f)

def check_report():
    html = os.path.join(REPORT_DIR, 'B0CZPF85JY.html')
    if not os.path.exists(html):
        return None
    with open(html) as f:
        return f.read()

def grade(html, s7, s10):
    issues = []
    # Section 5 check
    if s7:
        va = s7.get('versionA', '')
        if ',' in va and 'toaster' in va.lower() and va.count(',') >= 5 and 'slice slim toaster' in va:
            issues.append('Section5=KEYWORD_LIST')
        elif 'Slice Slim Toaster' in va and 'Fits-anywhere' in va:
            pass  # natural, ok
    else:
        issues.append('Section5=MISSING')
    # Section 8 check
    if s10:
        if s10.get('method') in ('llm_failed_char_check_only', 'llm_unparseable'):
            issues.append('Section8=LLM_FAILED')
        elif s10.get('rufusAvg') is None or s10.get('rufusAvg') == 'undefined':
            issues.append('Section8=RUFUS_MISSING')
    else:
        issues.append('Section10=MISSING')
    if not issues:
        return 'A'
    return 'C-' + '; '.join(issues)

def review():
    print('\n=== SENIOR OPS DIRECTOR REVIEW ===')
    html = check_report()
    s7 = check_step7()
    s10 = check_step10()
    log = check_llm_log()

    print(f'llm_debug.log ({len(log)} chars):')
    for line in log.split('\n'):
        if line.strip():
            print(' ', line)

    print('\n--- Section 5 (Optimized Titles) ---')
    if s7:
        print('VERSION A:', s7.get('versionA', '')[:100])
        print('VERSION B:', s7.get('versionB', '')[:100])
    else:
        print('MISSING')

    print('\n--- Section 8 (Rufus) ---')
    if s10:
        print('method:', s10.get('method'))
        print('rufusAvg:', s10.get('rufusAvg'))
        print('egeoScores count:', len(s10.get('egeoScores', [])))
    else:
        print('MISSING')

    print('\n--- Grade ---')
    g = grade(html, s7, s10)
    print('Grade:', g)
    return g

# === MAIN LOOP ===
print('=== B0CZPF85JY Diagnostic Loop ===')
max_cycles = 6
for cycle in range(1, max_cycles + 1):
    print(f'\n=== CYCLE {cycle}/{max_cycles} ===')
    clear_steps()
    rc = run_diagnose()
    print(f'Diagnose exit code: {rc}')
    time.sleep(5)  # let checkpoints settle
    g = review()
    if g == 'A':
        print('\n✅ SUCCESS — Grade A achieved. Stopping.')
        break
    else:
        print(f'\n⚠️  Grade {g} — will retry after 60s')
        time.sleep(60)