# data-pipeline v19

## 检查清单
```
□ 1. 数据入口统一？      → 所有抓取走 server/data_sync.js
□ 2. 回填幂等？          → WHERE 条件保护，重复运行不产生脏数据
□ 3. DB 写入竞态？       → sql.js instances=1，单进程写入
□ 4. 数据核查正常？      → data-auditor.js 每日 3:00（6类18项）
□ 5. 告警闭环正常？      → alert-monitor→auto_heal 自动修复
```

## 自愈管道
```
data_sync.finalCheck → incrementalSyncToUnified → outcome-backfill
alert-monitor → auto_heal.checkAndHeal（自动修复）
data-auditor（每日 3:00） → 基础项自动修复 + 严重项告警
```

## 数据入口
`fetch_500all.js` 全量 | `fetch_500odds.js` 赔率 | `data_sync.js` 统一同步 | `scraper.js` 米斗API

## 回填脚本
`backfill/backfill_full_models.js` | `backfill_outcomes.js` | `backfill_unified_predictions.js` | `backfill/index.js` 调度

## Fallback
| 失败 | 降级 |
|------|------|
| 500.com 不可用 | 米斗 API → `scraper.js` |
| 回填报错 | SQLite 锁检查→单进程→kill zombie |
| 同步阻塞 | 查看 data_sync 日志→手动 `node server/data_sync.js` |
| 核查发现问题 | 查看 `data-audit-reports/` → 手动修复 |
| 告警闭环失效 | 检查 alert-monitor→auto_heal 链路 |
