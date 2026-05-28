# Claude Code + DeepSeek 环境变量配置
# 安全提示: API Key 请从环境变量或 .env 文件读取，切勿硬编码
$API_KEY = $env:ANTHROPIC_AUTH_TOKEN
if (-not $API_KEY) {
    $envFile = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envFile) {
        Get-Content $envFile | ForEach-Object {
            if ($_ -match '^ANTHROPIC_AUTH_TOKEN=(.+)$') { $API_KEY = $matches[1].Trim() }
        }
    }
}
if (-not $API_KEY) {
    Write-Host "错误: 未找到 ANTHROPIC_AUTH_TOKEN" -ForegroundColor Red
    Write-Host "请设置: `$env:ANTHROPIC_AUTH_TOKEN='sk-xxx'" -ForegroundColor Yellow
    exit 1
}

$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = $API_KEY
$env:ANTHROPIC_MODEL = "deepseek-v4-pro[1m]"
$env:ANTHROPIC_DEFAULT_OPUS_MODEL = "deepseek-v4-pro[1m]"
$env:ANTHROPIC_DEFAULT_SONNET_MODEL = "deepseek-v4-pro[1m]"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "deepseek-v4-flash"
$env:CLAUDE_CODE_SUBAGENT_MODEL = "deepseek-v4-flash"
$env:CLAUDE_CODE_EFFORT_LEVEL = "max"

Write-Host "========================================" -ForegroundColor Green
Write-Host "  Claude Code + DeepSeek 环境已就绪" -ForegroundColor Green
Write-Host "  Model: deepseek-v4-pro[1m]" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# 启动 Claude Code
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

claude --version
Write-Host ""
Write-Host "正在启动 Claude Code..." -ForegroundColor Cyan
claude
