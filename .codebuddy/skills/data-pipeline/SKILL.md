# data-pipeline

> 数据 / 抓取 / ETL / 回填 / 半场比分 / 防漂移

## ⚠️ MUST 检查清单

1. 数据入口统一 → 所有抓取走 `data_sync.js`
2. 回填幂等 → WHERE 条件保护，重复不脏数据
3. DB 写入竞态 → `instances:1`，单写入者（铁律 #10）
4. 每日核查 → `data-auditor` 每日 3:00（6 类 18 项）
5. 告警闭环 → `alert-monitor → auto_heal` 自动修复

## 数据链防漂移（L1–L3）

| 层 | 组件 | 作用 |
|:--:|------|------|
| L1 | `ingestion-guard.js` postMatchAudit | 入库拦截，检测半场误判 |
| L2 | `score-corrector.js` correctDate | 500.com detail.php 终场比分修正 |
| L3 | `result-verifier.js` verifyResults | 终场比分交叉验证 |

> 任一失效即告警（铁律 #13 保障文件完整性）

## 自愈管道

```
data_sync.finalCheck → incrementalSyncToUnified → outcome-backfill
alert-monitor → auto_heal.checkAndHeal
data-auditor(3:00) → 基础项自修 + 严重项告警
```

## 数据入口

| 来源 | 文件 | 说明 |
|------|------|------|
| 500.com | `fetch_500all.js` / `fetch_500odds.js` | 全量抓取 / 赔率 |
| 米斗 API | `scraper.js` | 方案 + 比分 API |
| Sporttery | 竞彩官方文件 | 权威赛果（3067 文件）|
| 统一同步 | `data_sync.js` | 调度入口 |

## 回填脚本（`server/backfill/`）

`backfill_full_models.js` / `backfill_outcomes.js` / `backfill_unified_predictions.js`

## 参考文档（`references/`）

- `etl-specs.md` — ETL 工作流 YAML 定义

## Fallback

| 失败 | 降级 |
|------|------|
| 500.com 不可用 | 米斗 API → scraper.js |
| 回填报错 | SQLite 锁 → 单进程 → kill zombie |
| 同步阻塞 | 看 `data_sync.log` → 手动 node 执行 |
| 核查异常 | 查看 `data-audit-reports/` |
| 防假跑验证不通过 | 按 AGENTS.md 4 段格式强制交付 |
