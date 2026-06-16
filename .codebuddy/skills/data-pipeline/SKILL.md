---
name: data-pipeline
description: >
  数据管线与ETL。触发词：数据/抓取/ETL/同步/修复/回填/backfill/缺失/数据丢失/data_sync/fetch/爬虫/清洗。加载后必须确认数据入口统一 + 回填脚本幂等。ETL 配置详情见 references/etl-specs.md。
---

# 数据管线 · 速查卡

## ETL 流程

```
EXTRACT                      TRANSFORM                LOAD
500.com / 米斗 / sporttery → 队名映射 / 赔率归一化 → SQLite + data.json + cache.json
```

## 数据质量门禁

| 检查项 | 阈值 |
|--------|:---:|
| extract 成功率 | ≥ 90% |
| load 成功率 | ≥ 90% |
| null_rate | < 5% |
| duplicate_rate | < 1% |

低于阈值 → 阻断同步 + 告警

## 回填入口（★ 统一）

```
server/backfill/
  ├── index.js      ← 统一入口
  ├── outcomes.js   ← 赛果回填
  ├── consensus.js  ← 共识回填
  └── models.js     ← 模型回填
```

所有回填操作必须 **幂等**（INSERT OR IGNORE / UPSERT）。

## 数据源

| 源 | 用途 | 表/文件 |
|----|------|--------|
| **sporttery (sp)** ⭐ | 主数据源，最全 | `jczq_basic_cache`（竞彩缓存）, `sporttery_preview`（预览）, `_sporttery_sync.sql.gz`（备份） |
| 500.com | 实时比分 | `live_scores.json`, `sync_live_500.js` |
| 米斗 | 推荐指数 | `midou API` |
| ttyingqiu | 赔率补充 | `scrape_ttyingqiu.py` |

## 🔍 数据恢复流程（赛果缺失时的标准动作）

```
发现数据缺失
  │
  ├── Step 1: 查生产 DB
  │     SSH → cd /root/server → node -e "adp.execAll('SELECT...FROM jczq_basic_cache WHERE date=?...')"
  │     若 jczq_basic_cache 有但 matches 没有 → 执行回填
  │
  ├── Step 2: 查备份 DB
  │     ls /root/server/_sporttery_*.sql.gz
  │     ls /root/server/midou_data.db.bak_*
  │     若有备份且含数据 → 导入恢复
  │
  └── Step 3: 补抓（前两步都无数据时）
        触发 500.com 实时比分抓取 → sync_live_500.js
        或 竞彩 API 补抓 → jczq_basic 爬虫
```

**铁律**：先查 DB → 再查备份 → 最后才补抓。避免无效网络请求。

## 深度文档

- `references/etl-specs.md` — ETL 工作流 YAML 配置 + 调度 + 监控详情
