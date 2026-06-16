# data-pipeline · 数据管线

> ⚠️ 加载后必须先确认数据入口统一 + 回填脚本幂等

---

## 🔴 强制检查清单

```
□ 1. 数据入口统一？     → 所有抓取/同步走 server/core/data_sync.js
□ 2. 回填脚本幂等？     → 重复运行不产生脏数据（WHERE 条件保护）
□ 3. incrementalSyncToUnified？ → data_sync.js finalCheck() 已自动触发
□ 4. outcome-backfill？  → 增量同步后自动回填，无需手动
```

---

## 📥 数据入口（必须统一）

| 入口 | 文件 | 说明 |
|------|------|------|
| 主抓取 | `scripts/fetch_500_main.cjs` | 500.com 主数据源 |
| 赔率 | `scripts/scrape_odds_500.cjs` | odds 数据 |
| 同步 | `server/core/data_sync.js` | 统一同步入口（含自愈管道） |

---

## 🔄 回填脚本（必须幂等）

| 脚本 | 用途 |
|------|------|
| `server/backfill_full_models.js` | 全模型回填 |
| `server/backfill_outcomes.js` | 赛果回填 |
| `scripts/fix_consensus_name.py` | 共识名称修复（已归档） |

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
| 主数据源不可用（500.com） | 切换到备用源 sporttery → `scripts/fetch_sporttery.cjs` |
| 回填脚本报错 | 检查 SQLite 锁 → `fuser server/midou_data.db` → kill 僵尸进程后重试 |
| 同步管道阻塞 | 检查 `data_sync.js` 日志 → 确认 cron 状态 → 手动触发 `node server/core/data_sync.js` |
| 数据入口不统一 | 必须在 `server/core/data_sync.js` 注册新入口后再运行 |

> 所有 fallback 均失败 → 中止操作，向用户报告瓶颈。

---
深度文档：`.codebuddy/skills/data-pipeline/references/etl-specs.md`
