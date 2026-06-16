@echo off
cd /d e:\JC-ZJFA\server
set DOUBAO_API_KEY=ark-002bfac0-24c5-4b65-a57f-b52a8fd8d267-53f32

echo ========================================
echo  AI 豆包回填后台运行
echo  956 场 ~4小时 ~$1-2
echo  日志输出到 ai_backfill_log.txt
echo ========================================

node backfill\backfill_full_models.js --phase=2 > ai_backfill_log.txt 2>&1
echo 完成时间: %date% %time% >> ai_backfill_log.txt
