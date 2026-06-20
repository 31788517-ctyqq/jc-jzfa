# data-pipeline · 数据管线

> ⚠️ 加载后必须先确认数据入口统一 + 回填脚本幂等

---

## 🔴 强制检查清单

```
□ 1. 数据入口统一？     → 所有抓取/同步走 server/data_sync.js
□ 2. 回填脚本幂等？     → 重复运行不产生脏数据（WHERE 条件保护）
□ 3. incrementalSyncToUnified？ → data_sync.js finalCheck() 已自动触发
□ 4. outcome-backfill？  → 增量同步后自动回填，无需手动
□ 5. DB 写入竞态？      → sql.js 单文件 DB 严禁多进程并发写入（instances 必须=1）
```

---

## 📥 数据入口（必须统一）

| 入口 | 文件 | 说明 |
|------|------|------|
| 主抓取 | `server/fetch_500all.js` | 500.com 全量抓取 |
| 赔率 | `server/fetch_500odds.js` | odds 赔率数据 |
| 实时同步 | `server/data_sync.js` | 统一同步入口（含自愈管道） |
| 米斗 API | `server/scraper.js` → midou API | 米斗方案/赛果 |

> ⚠️ **sql.js 铁律**：midou_data.db 是单文件内存数据库，**任何时刻只能有一个进程写入**。jc-zjfa cluster instances 必须 = 1。jc-sync/jc-scheduler 如需写入，必须先确认 jc-zjfa 未并行写。

---

## 🔄 回填脚本（必须幂等）

| 脚本 | 用途 |
|------|------|
| `server/backfill/backfill_full_models.js` | 全模型回填 |
| `server/backfill/backfill_outcomes.js` | 赛果回填 |
| `server/backfill/backfill_unified_predictions.js` | 统一预测回填 |
| `server/backfill/index.js` | 回填调度入口 |

---

## 🚨 自愈管道

```
data_sync.js finalCheck()
  → incrementalSyncToUnified()
    → outcome-backfill (自动)
```

新增回填逻辑 → 接入此管道，不要单独调用。

---

## 🆘 Fallback（检查清单某项不通过时）

| 失败项 | 降级路径 |
|--------|---------|
| 主数据源不可用（500.com） | 切换到米斗 API → `server/scraper.js` midou endpoints |
| 回填脚本报错 | 检查 SQLite 锁 → 确认单进程写入 → kill 僵尸进程后重试 |
| 同步管道阻塞 | 检查 `server/data_sync.js` 日志 → 确认 cron 状态 → 手动触发 `node server/data_sync.js` |
| 数据入口不统一 | 必须在 `server/data_sync.js` 注册新入口后再运行 |

> 所有 fallback 均失败 → 中止操作，向用户报告瓶颈。

---
深度文档：`.codebuddy/skills/data-pipeline/references/etl-specs.md`
