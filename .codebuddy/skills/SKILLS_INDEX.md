# Skills Index v18

| Skill | 触发词 | 强制？ |
|-------|--------|:---:|
| `deploy-ops` | 部署/deploy/服务器/Nginx/PM2/502/缓存/cache/404/静态资源/zombie/僵尸进程/实例数/instances/watchdog/Vite构建/性能优化/页面加速/FCP/LCP/Brotli/CDN/资源压缩/CSS拆分 | MUST |
| `data-pipeline` | 数据/抓取/ETL/同步/修复/回填/缺失/backfill/fetch/爬虫/crawl/DB污染/DB损坏/数据库写入/scheduler | MUST |
| `jczjfa-test-orchestrator` | 测试/test/单元/E2E/jest/playwright/冒烟/门禁/lint/回归/preflight/覆盖率/coverage | MUST |
| `backtesting-frameworks` | 回测/backtest/命中率/ROI/参数调优/minExpertA/minOdds/Walk-Forward | MUST |
| `experiment-tracking` | 实验/prompt/AI模型/DeepSeek/豆包/temperature/模型切换/基线对比 | MUST |

### 🔗 联动规则

- `backtesting-frameworks` 和 `experiment-tracking` **必须双加载**（缺一不可）
- `deploy-ops` 加载时，前端改动必须先 Playwright 截图
- `deploy-ops` 加载时，必须验证 PM2 3 进程全部 online
- `deploy-ops` 加载且涉及 PM2 变更时，必须验证无残留 zombie 进程
- `jczjfa-test-orchestrator` 加载时，必须跑完 preflight 7 步
- `data-pipeline` 加载时，必须确认数据入口统一 + 回填幂等
- `data-pipeline` + `deploy-ops` 同时加载时，必须检查 sqlite 写入竞态（多进程）
- `deploy-ops` 加载且涉及前端部署时，必须 `npx vite build` 后再部署

### 🚫 Skill 加载排除条件（避免 Token 膨胀）

> **以下场景明确不需要加载对应 Skill，减少上下文消耗：**

| 用户任务 | 不需要加载的 Skill |
|---------|-------------------|
| 纯前端 UI 改动（CSS/HTML）、样式微调 | data-pipeline, backtesting-frameworks, experiment-tracking |
| 纯部署操作、502 排查 | data-pipeline, backtesting-frameworks, experiment-tracking |
| 纯数据分析、只读查询（不改代码） | deploy-ops, jczjfa-test-orchestrator |
| 纯文档编写、README 更新 | 所有 Skill 均不需要（直接执行） |
| 纯测试编写、lint 修复（不改业务逻辑） | backtesting-frameworks, experiment-tracking |

> **触发词是必要条件，但还需判断任务是否真正需要 Skill 知识。只读查询/纯文档/纯样式 → 跳过 Skill 加载。**

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

### 📊 当前状态 (2026-06-20)

| 指标 | 值 |
|------|-----|
| PM2 进程 | jc-zjfa (cluster:1, 1800M) / jc-sync (fork:1, 1800M) / jc-scheduler (fork:1, 2048M) |
| 测试套件 | 115 suites / 1927 tests / 92/183 源文件 |
| SW 版本 | jczjfa-static-v12 |
| Watchdog | `*/5 * * * *` → `scripts/watchdog.cjs` |
| 部署方式 | `python deploy.py --fast` (paramiko) |
| Vite 构建 | `npx vite build` → `python deploy.py --fast --files-only` |
| 当前分支 | `local/auth-preview` |
| 性能优化基线 | `AGENTS.md § 性能预算` + `deploy-ops/references/perf-baseline.md` | V19 新增 |
| 仓库清理 | 2026-06-20 完成 P0-P3 噪声大扫除（25827d54: -200 文件/-282K 行） |
