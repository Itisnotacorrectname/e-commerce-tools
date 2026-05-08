# Batch test multiple versions of amazon-listing-doctor
param(
  [string]$asin = "B0FY2H5DC1",
  [string]$th = "1"
)

$url = "https://www.amazon.com/dp/$asin`?th=$th"
$versions = @('v1.9', 'v1.9.1', 'v2.0', 'v2.1', 'v2.2', 'v2.3')
$baseDir = "C:\Users\csbd\.openclaw\workspace\e-commerce-tools\skills\amazon listing doctor"
$outputDir = "C:\Users\csbd\.openclaw\workspace\e-commerce-tools\version_comparison"
$startTime = Get-Date

# Create output dir
if (-not (Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir | Out-Null
}

foreach ($ver in $versions) {
  $versionDir = "$baseDir\amazon-listing-doctor - $ver"
  $reportPath = "$outputDir\${asin}_${ver}_report.html"
  $logPath = "$outputDir\${asin}_${ver}_log.txt"

  Write-Host "=== Testing $ver ===" -ForegroundColor Cyan
  $sw = [Diagnostics.Stopwatch]::StartNew()

  try {
    node "$versionDir\diagnose.js" $url --format html 2> $logPath

    # Find the generated report
    $reportsDir = "$versionDir\reports"
    if (Test-Path $reportsDir) {
      $latest = Get-ChildItem $reportsDir -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latest) {
        Copy-Item $latest.FullName $reportPath
        Write-Host "  Report: $reportPath" -ForegroundColor Green
        Write-Host "  Size: $([Math]::Round($latest.Length / 1KB, 1)) KB"
      }
    }

    # Also check for any HTML in root
    $rootHtml = Get-ChildItem $versionDir -Filter "*.html" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($rootHtml) {
      Write-Host "  Root HTML: $($rootHtml.Name)" -ForegroundColor Yellow
    }

  } catch {
    Write-Host "  ERROR: $_" -ForegroundColor Red
  }

  $sw.Stop()
  Write-Host "  Time: $($sw.ElapsedMilliseconds) ms`n"
}

Write-Host "`n=== All tests complete ===" -ForegroundColor Green
Write-Host "Total time: $(([DateTime]::Now - $startTime).TotalSeconds) seconds"
