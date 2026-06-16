---
name: jczjfa-test-orchestrator
description: >
  JC-ZJFA 测试编排。触发词：测试/test/单元/E2E/jest/playwright/冒烟/门禁/preflight/覆盖率/lint/回归。加载后必须对照检查清单。
---

# 测试编排 · 速查卡

## 快速命令

```bash
npm run test:p0      # 核心 8 suites（最快）
npm run test:p1      # 集成 8 suites
npm run test:p2      # 功法道 6 suites
npm test             # 全量 469+ tests
npm run preflight    # 发布前 7 步门禁
npm run test:smoke   # 35 API 冒烟（需先启动服务器）
npm run test:e2e     # Playwright E2E（自动启动服务器）
npm run benchmark    # 性能基准
```

## 发布前检查清单

- [ ] `npm run lint` → 0 errors
- [ ] `npm run format:check` → 通过
- [ ] `npm run test:p0` → 全绿
- [ ] `npm run test:p1` → 全绿
- [ ] `npm run test:p2` → 全绿
- [ ] 覆盖率: statements≥30%, branches≥25%, functions≥30%, lines≥30%
- [ ] `npm audit --audit-level=high` 无阻断

## 门禁标准

| 阶段 | 阻塞性 | 超时 |
|------|:---:|:---:|
| ESLint | ✅ | — |
| P0 8 suites | ✅ | 120s |
| P1 8 suites | ✅ | 120s |
| P2 6 suites | ✅ | 180s |
| 覆盖率 | ✅ | 300s |
| npm audit | ⚠️ 非阻塞 | — |

## P0 测试覆盖

`index_api` `data_sync` `prediction_log` `database` `scheduler_v2` `cache` `pk_scorer` `plan-generator`

## 深度文档

- `references/test-matrix.md` — 24 套件 / 469+ tests 详表
- `references/quality-gates.md` — 各级门禁标准详解
