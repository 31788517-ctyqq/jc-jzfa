# JC-ZJFA Skill 总索引

> **轻量路由表**：AI 遇到任务时先查此表，命中则加载对应 Skill。
> 每个 Skill 的 SKILL.md 已精简为核心规则+检查清单，深度文档在 `references/`。

## 快速匹配表

| 关键词 | 加载 Skill | 核心作用 |
|--------|-----------|---------|
| 部署/deploy/上传/服务器/nginx/PM2/重启/502/cache/缓存/版本戳/404/静态资源/图标路径 | `deploy-ops` | 部署全流程 + 缓存失效 + 故障排查 |
| 测试/test/单元/E2E/jest/playwright/冒烟/门禁/覆盖率/lint | `jczjfa-test-orchestrator` | 24 套件编排 + 质量门禁 |
| 回测/backtest/命中率/ROI/方案参数/调参/minExpertA/minOdds | `backtesting-frameworks` | Walk-Forward + Monte Carlo + 指标计算 |
| 数据/抓取/ETL/同步/修复/回填/backfill/缺失/数据丢失/data_sync | `data-pipeline` | ETL 流程 + 数据质量门禁 |
| 实验/prompt/AI模型/DeepSeek/豆包/temperature/费用优化/命中率对比 | `experiment-tracking` | 实验注册 + A/B 对比 + 决策指南 |

## 强制规则

- 涉及**方案参数调优**或**AI 模型切换** → 必须同时加载 `backtesting-frameworks` + `experiment-tracking`
- 涉及**部署** → 加载 `deploy-ops` 后必须执行其检查清单
- 涉及**数据修复** → 加载 `data-pipeline` 后确认回填入口统一

## 目录结构

```
.codebuddy/skills/
├── SKILLS_INDEX.md          ← 你在这里
├── deploy-ops/
│   ├── SKILL.md             ← 精简核心 (~80行)
│   └── references/
│       ├── nginx.md         ← Nginx 配置详解
│       ├── lessons.md       ← 经验教训库 (20+条)
│       └── sqlite-import.md ← SQLite 大数据导入
├── jczjfa-test-orchestrator/
│   ├── SKILL.md             ← 精简核心 (~60行)
│   └── references/
│       ├── test-matrix.md   ← 24 套件详表
│       └── quality-gates.md ← 门禁标准
├── backtesting-frameworks/
│   ├── SKILL.md             ← 精简核心 (~60行)
│   └── references/
│       └── patterns.md      ← 回测模式代码示例
├── data-pipeline/
│   ├── SKILL.md             ← 精简核心 (~60行)
│   └── references/
│       └── etl-specs.md     ← ETL 配置详情
└── experiment-tracking/
    ├── SKILL.md             ← 精简核心 (~60行)
    └── references/
        └── tracker-code.md  ← ExperimentTracker 实现代码
```
