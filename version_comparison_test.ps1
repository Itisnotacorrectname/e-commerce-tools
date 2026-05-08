# Compare all versions of Amazon Listing Doctor
# ASIN: B0FY2H5DC1 (L Shaped Sectional Sofa)
param(
  [string]$asin = "B0FY2H5DC1",
  [string]$url = "https://www.amazon.com/dp/B0FY2H5DC1?th=1"
)

$versions = @('v1.9', 'v1.9.1', 'v2.0', 'v2.1', 'v2.2', 'v2.3')
$skillBase = "C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon listing doctor"
$outputBase = "C:\Users\csbd\.openclaw\workspace\e-commerce-tools\version_comparison"

# Set unique workspace for each version to avoid checkpoint collision
$env:OPENCLAW_WORKSPACE = $outputBase

foreach ($ver in $versions) {
  $versionDir = "$skillBase\amazon-listing-doctor - $ver"
  $versionOutput = "$outputBase\$ver"
  $checkpointDir = "$versionOutput\amazon-listing-doctor\checkpoints\$asin"

  Write-Host "`n=== $ver ===" -ForegroundColor Cyan

  if (Test-Path $checkpointDir) {
    Write-Host "  [SKIP] Already tested" -ForegroundColor Yellow
    continue
  }

  # Create unique workspace for this version
  New-Item -ItemType Directory -Path $versionOutput -Force | Out-Null
  $env:OPENCLAW_WORKSPACE = $versionOutput

  $sw = [Diagnostics.Stopwatch]::StartNew()
  node "$versionDir\diagnose.js" $url 2>&1 | Tee-Object -Variable log
  $sw.Stop()

  Write-Host "  Time: $($sw.ElapsedMilliseconds) ms" -ForegroundColor Gray

  if (Test-Path $checkpointDir) {
    $files = Get-ChildItem $checkpointDir -File | Select-Object Name, Length
    Write-Host "  Checkpoints: $($files.Count)" -ForegroundColor Green
    $files | ForEach-Object { Write-Host "    $($_.Name) ($([Math]::Round($_.Length/1KB,1))KB)" }
  } else {
    Write-Host "  [ERROR] No checkpoints generated" -ForegroundColor Red
    Write-Host "  Log (last 10 lines):" -ForegroundColor Red
    $log -split "`n" | Select-Object -Last 10 | ForEach-Object { Write-Host "    $_" }
  }
}

# Summary
Write-Host "`n`n=== SUMMARY ===" -ForegroundColor Green
foreach ($ver in $versions) {
  $versionOutput = "$outputBase\$ver"
  $checkpointDir = "$versionOutput\amazon-listing-doctor\checkpoints\$asin"
  $dataPkg = "$checkpointDir\data_package.json"

  if (Test-Path $dataPkg) {
    $dp = Get-Content $dataPkg -Raw | ConvertFrom-Json
    $title = if ($dp.title) { $dp.title.ToString().Substring(0, [Math]::Min(50, $dp.title.ToString().Length)) } else { "N/A" }
    $price = if ($dp.price) { "$($dp.price)" } else { "N/A" }
    $comps = if ($dp.competitorCount) { $dp.competitorCount } else { "?" }
    Write-Host "$ver : $title | `$price | $comps competitors" -ForegroundColor White
  } else {
    Write-Host "$ver : FAILED" -ForegroundColor Red
  }
}
