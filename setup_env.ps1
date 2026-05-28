# 持久化设置 DeepSeek + Claude Code 环境变量（用户级）
# 安全提示: API Key 请从环境变量或 .env 文件读取，切勿硬编码
$API_KEY = $env:ANTHROPIC_AUTH_TOKEN
if (-not $API_KEY) {
    # 尝试从 .env 文件读取
    $envFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^ANTHROPIC_AUTH_TOKEN=(.+)$') {
                $API_KEY = $matches[1].Trim()
            }
        }
    }
}
if (-not $API_KEY) {
    Write-Host "错误: 未找到 ANTHROPIC_AUTH_TOKEN" -ForegroundColor Red
    Write-Host "请设置环境变量: `$env:ANTHROPIC_AUTH_TOKEN='sk-xxx'" -ForegroundColor Yellow
    Write-Host "或在 .env 文件中添加: ANTHROPIC_AUTH_TOKEN=sk-xxx" -ForegroundColor Yellow
    exit 1
}

[System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://api.deepseek.com/anthropic", "User")
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", $API_KEY, "User")
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_MODEL", "deepseek-v4-pro[1m]", "User")
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_DEFAULT_OPUS_MODEL", "deepseek-v4-pro[1m]", "User")
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_DEFAULT_SONNET_MODEL", "deepseek-v4-pro[1m]", "User")
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_DEFAULT_HAIKU_MODEL", "deepseek-v4-flash", "User")
[System.Environment]::SetEnvironmentVariable("CLAUDE_CODE_SUBAGENT_MODEL", "deepseek-v4-flash", "User")
[System.Environment]::SetEnvironmentVariable("CLAUDE_CODE_EFFORT_LEVEL", "max", "User")

Write-Host "========================================" -ForegroundColor Green
Write-Host "  持久化环境变量设置完成！" -ForegroundColor Green
Write-Host "  请重启终端后运行: claude" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Green
