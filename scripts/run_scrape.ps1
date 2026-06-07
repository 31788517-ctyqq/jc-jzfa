# 后台批量抓取 200 位专家 2026 年推荐数据
# 输出日志到 server/scrape_log.txt

$logFile = Join-Path $PSScriptRoot "..\server\scrape_log.txt"
$script = Join-Path $PSScriptRoot "scrape_experts_batch.js"

# 清空旧日志
"" | Out-File $logFile -Encoding UTF8

Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  后台抓取已启动！" -ForegroundColor Green
Write-Host "  PID: $PID" -ForegroundColor Yellow
Write-Host "  日志: $logFile" -ForegroundColor Yellow
Write-Host ""
Write-Host "  监控命令: Get-Content $logFile -Wait" -ForegroundColor White
Write-Host "  停止命令: Stop-Process -Id $PID" -ForegroundColor DarkYellow
Write-Host "═══════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# 重定向 stdout + stderr 到日志文件
try {
    node $script --scrape *>&1 | Out-File $logFile -Encoding UTF8 -Append
    Write-Host "" -ForegroundColor Green
    Write-Host "✅ 抓取完成！结果: server/experts_batch_2026.json" -ForegroundColor Green
} catch {
    Write-Host "❌ 抓取出错: $_" -ForegroundColor Red
}
