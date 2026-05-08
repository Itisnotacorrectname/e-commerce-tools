# Run Phase 1 for all versions of Amazon Listing Doctor
param(
  [string]$asin = "B0FY2H5DC1",
  [string]$url = "https://www.amazon.com/dp/B0FY2H5DC1?th=1"
)

$versions = @('v1.9', 'v1.9.1', 'v2.0', 'v2.1', 'v2.2', 'v2.3')
$skillBase = "C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon listing doctor"
$outputBase = "C:\Users\csbd\.openclaw\workspace\e-commerce-tools\version_comparison"

foreach ($ver in $versions) {
  $versionDir = "$skillBase\amazon-listing-doctor - $ver"
  $versionOutput = "$outputBase\$ver"
  $checkpointDir = "$versionOutput\amazon-listing-doctor\checkpoints\$asin"

  Write-Host "`n=== $ver ===" -ForegroundColor Cyan

  if (Test-Path "$checkpointDir\data_package.json") {
    Write-Host "  [SKIP] Already tested" -ForegroundColor Yellow
    continue
  }

  New-Item -ItemType Directory -Path $versionOutput -Force | Out-Null
  $env:OPENCLAW_WORKSPACE = $versionOutput

  $sw = [Diagnostics.Stopwatch]::StartNew()
  $result = node "$versionDir\diagnose.js" $url 2>&1
  $sw.Stop()

  Write-Host "  Time: $($sw.ElapsedMilliseconds) ms" -ForegroundColor Gray

  if (Test-Path "$checkpointDir\data_package.json") {
    $dp = Get-Content "$checkpointDir\data_package.json" -Raw | ConvertFrom-Json
    $title = if ($dp.title) { $dp.title.ToString().Substring(0, [Math]::Min(60, $dp.title.ToString().Length)) } else { "N/A" }
    $price = if ($dp.price) { "`$$($dp.price)" } else { "N/A" }
    $comps = if ($dp.competitorCount) { $dp.competitorCount } else { "?" }
    $step2Size = (Get-Item "$checkpointDir\step2.json").Length / 1KB
    Write-Host "  [OK] title=$title" -ForegroundColor Green
    Write-Host "       price=$price | comps=$comps | step2=$([Math]::Round($step2Size,1))KB" -ForegroundColor Green
  } else {
    Write-Host "  [FAIL]" -ForegroundColor Red
    $result -split "`n" | Select-Object -Last 8 | ForEach-Object { Write-Host "  $_" }
  }
}

Write-Host "`n=== PHASE 1 COMPLETE ===" -ForegroundColor Green
