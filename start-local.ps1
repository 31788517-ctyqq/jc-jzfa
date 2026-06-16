#requires -Version 5.1
$ErrorActionPreference = 'Stop'

$Port = 3000
$ServerScript = "$PSScriptRoot/server/index.js"

function Test-Port {
    param([int]$Port)
    try { $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction Stop | Where-Object { $_.State -eq 'Listen' }; return $conn }
    catch { return $null }
}

# ★ V12: 开发模式提示
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  JC-ZJFA 本地开发服务器" -ForegroundColor Cyan
Write-Host "  SW v7: localhost 自动跳过缓存" -ForegroundColor Green
Write-Host "  改前端→刷新 | 改后端→重启 | 改SW→F12 Unregister" -ForegroundColor DarkGray
Write-Host "============================================" -ForegroundColor Cyan

# 检查 Node
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] node 未找到" -ForegroundColor Red
    exit 1
}

# 检查脚本
if (!(Test-Path $ServerScript)) {
    Write-Host "[ERROR] 脚本不存在: $ServerScript" -ForegroundColor Red
    exit 1
}

# 释放端口
$conn = Test-Port -Port $Port
if ($conn) {
    try {
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction Stop
        Write-Host "[WARN] 端口 $Port 被占用 (PID $($proc.Id)), 释放中..." -ForegroundColor Yellow
        Stop-Process -Id $proc.Id -Force -ErrorAction Stop
        Start-Sleep -Seconds 2
    } catch {
        Write-Host "[INFO] 无法自动释放端口, 尝试启动..." -ForegroundColor DarkGray
    }
}

Write-Host "[INFO] 启动中: http://localhost:$Port/" -ForegroundColor Cyan
Write-Host ""

# ★ 使用 ShellExecute 方式启动，日志直接输出到控制台
Push-Location $PSScriptRoot
try {
    node $ServerScript
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "服务已停止。重新启动请运行 start-local.bat" -ForegroundColor DarkGray
