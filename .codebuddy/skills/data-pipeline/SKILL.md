# data-pipeline

## ⚠️ MUST 检查清单
1. 数据入口统一 → 所有抓取走 data_sync.js
2. 回填幂等 → WHERE条件保护，重复不脏数据
3. DB写入竞态 → sql.js instances=1（铁律#13）
4. 核查正常 → data-auditor每日3:00（6类18项）
5. 告警闭环 → alert-monitor→auto_heal自动修复

## 自愈管道
```
data_sync.finalCheck → incrementalSyncToUnified → outcome-backfill
alert-monitor → auto_heal.checkAndHeal
data-auditor(3:00) → 基础项自修 + 严重项告警
```

## 数据入口
fetch_500all.js 全量 | fetch_500odds.js 赔率 | data_sync.js 统一同步 | scraper.js 米斗API

## 回填脚本
backfill/backfill_full_models.js | backfill_outcomes.js | backfill_unified_predictions.js

## Fallback
| 失败 | 降级 |
|------|------|
| 500.com不可用 | 米斗API→scraper.js |
| 回填报错 | SQLite锁→单进程→kill zombie |
| 同步阻塞 | 看data_sync日志→手动node执行 |
| 核查异常 | 查看 `data-audit-reports/` |
