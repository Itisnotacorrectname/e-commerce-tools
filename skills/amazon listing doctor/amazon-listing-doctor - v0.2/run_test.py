import subprocess, json, sys

result = subprocess.run(
    ['node', 'test_llm_direct.js'],
    capture_output=True, text=True, timeout=120,
    cwd=r'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor'
)
print('STDOUT:', result.stdout)
print('STDERR:', result.stderr)
print('RC:', result.returncode)