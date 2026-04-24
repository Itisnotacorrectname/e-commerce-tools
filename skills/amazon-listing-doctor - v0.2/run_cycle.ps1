$env:OPENCLAW_GATEWAY_TOKEN = '22d8696422d2e5bd4cd688452dd363c6dd7900cb974ca4b3'
Set-Location 'C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon-listing-doctor'

# Clear steps 5-15 and log
$checkpointDir = 'C:\Users\csbd\.openclaw\workspace\amazon-listing-doctor\checkpoints\B0CZPF85JY'
for ($n=5; $n -le 15; $n++) {
    $p = Join-Path $checkpointDir "step$n.json"
    if (Test-Path $p) { Remove-Item $p }
}
$logPath = 'llm_debug.log'
if (Test-Path $logPath) { Remove-Item $logPath }

Write-Host "[clear] done"
node diagnose.js B0CZPF85JY
Write-Host "[exit] $LASTEXITCODE"