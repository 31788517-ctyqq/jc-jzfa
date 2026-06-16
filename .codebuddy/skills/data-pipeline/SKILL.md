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

- `fetch_odds.js` — 500.com 赔率
- `fetch_shuju.js` — 比赛数据
- `scrape_ttyingqiu.py` — ttyingqiu 爬虫
- `midou API` — 米斗指数
- `sporttery rawDB` — 竞彩赔率兜底

## 深度文档

- `references/etl-specs.md` — ETL 工作流 YAML 配置 + 调度 + 监控详情
