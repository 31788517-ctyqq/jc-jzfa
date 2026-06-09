# ============================================================
# release-preflight.ps1 — JC-ZJFA 发布前质量检查
# 用法: ./scripts/release-preflight.ps1
#       npm run preflight
# ============================================================

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\.."
Set-Location $ProjectRoot

$totalSteps = 7
$currentStep = 0
$failedSteps = @()

function Write-Step($message) {
    $script:currentStep++
    Write-Host ""
    Write-Host "[$currentStep/$totalSteps] $message" -ForegroundColor Cyan
    Write-Host ("=" * 60)
}

function Pass {
    Write-Host "    PASSED" -ForegroundColor Green
}

function Fail($reason) {
    Write-Host "    FAILED: $reason" -ForegroundColor Red
    $script:failedSteps += @("Step $currentStep $reason")
}

# ════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta
Write-Host "   JC-ZJFA Release Preflight (QC Gate)" -ForegroundColor Magenta
Write-Host "============================================================" -ForegroundColor Magenta

# ── Step 1: ESLint ──
Write-Step "ESLint"
$output = npx eslint "server/**/*.js" "preview/js/**/*.js" "preview/*.js" "scripts/*.js" --quiet 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Pass } else { Fail "ESLint errors found. Run: npm run lint:fix" }

# ── Step 2: Prettier ──
Write-Step "Prettier format check"
$output = npx prettier --check "server/**/*.js" "preview/js/**/*.js" "preview/*.js" "scripts/*.js" --log-level error 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Pass } else { Fail "Format mismatch. Run: npm run format" }

# ── Step 3: P0 Core Tests ──
Write-Step "P0 Core Unit Tests"
$output = npx jest --testPathPattern="server/tests/(index_api|data_sync|prediction_log|database|scheduler_v2|cache|pk_scorer|plan-generator)" --forceExit --no-coverage 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Pass } else { Fail "P0 tests failed" }

# ── Step 4: P1 Integration Tests ──
Write-Step "P1 Integration Tests"
$output = npx jest --testPathPattern="server/tests/(ai_daemon|ai-timing|main-fusion|health|http-utils|websocket|midou|cloudfunctions)" --forceExit --no-coverage 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Pass } else { Fail "P1 tests failed" }

# ── Step 5: P2 Gongshoudao Tests ──
Write-Step "P2 Gongshoudao Tests"
$output = npx jest --testPathPattern="gongshoudao/tests" --forceExit --no-coverage 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Pass } else { Fail "P2 tests failed" }

# ── Step 6: Coverage Gate ──
Write-Step "Coverage Gate"
$output = npx jest --coverage --forceExit 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Pass } else { Fail "Coverage threshold not met" }

# ── Step 7: npm audit ──
Write-Step "npm audit"
$output = npm audit --audit-level=high 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
    Pass
} else {
    Write-Host "    WARNING: high-severity vulnerabilities exist (non-blocking)" -ForegroundColor Yellow
}

# ════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "============================================================" -ForegroundColor Magenta

if ($failedSteps.Count -eq 0) {
    Write-Host "  ALL CHECKS PASSED - Ready to deploy!" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host ""
    exit 0
} else {
    Write-Host "  $($failedSteps.Count) CHECK(S) FAILED:" -ForegroundColor Red
    foreach ($step in $failedSteps) {
        Write-Host "    - $step" -ForegroundColor Red
    }
    Write-Host "============================================================" -ForegroundColor Magenta
    Write-Host ""
    exit 1
}
