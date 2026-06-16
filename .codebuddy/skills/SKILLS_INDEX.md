# Skills Index

| Skill | 触发词 | 强制？ |
|-------|--------|:---:|
| `deploy-ops` | 部署/deploy/服务器/Nginx/PM2/502/缓存/cache/404/静态资源 | MUST |
| `data-pipeline` | 数据/抓取/ETL/同步/修复/回填/缺失/backfill/fetch/爬虫 | MUST |
| `jczjfa-test-orchestrator` | 测试/test/单元/E2E/jest/playwright/冒烟/门禁/lint/回归 | MUST |
| `backtesting-frameworks` | 回测/backtest/命中率/ROI/参数调优/minExpertA/minOdds | MUST |
| `experiment-tracking` | 实验/prompt/AI模型/DeepSeek/豆包/temperature/模型切换 | MUST |

### 🔗 联动规则

- `backtesting-frameworks` 和 `experiment-tracking` **必须双加载**（缺一不可）
- `deploy-ops` 加载时，前端改动必须先 Playwright 截图
- `jczjfa-test-orchestrator` 加载时，必须跑完 preflight 7 步
- `data-pipeline` 加载时，必须确认数据入口统一 + 回填幂等

### 📂 目录结构

```
.codebuddy/skills/
├── SKILLS_INDEX.md            ← 本文件
├── deploy-ops/SKILL.md        ← 部署运维速查
├── data-pipeline/SKILL.md     ← 数据管线速查
├── backtesting-frameworks/SKILL.md ← 回测速查
├── experiment-tracking/SKILL.md    ← 实验追踪速查
└── jczjfa-test-orchestrator/SKILL.md ← 测试编排速查
```
