# Claude Code + DeepSeek 环境变量配置
$env:ANTHROPIC_BASE_URL = "https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN = "sk-a4a33977f39547fc89cbdb443539a7c3"
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
