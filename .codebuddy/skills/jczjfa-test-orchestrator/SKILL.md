# jczjfa-test-orchestrator

> 测试 / jest / playwright / preflight / 门禁

## ⚠️ MUST 检查清单

1. 语法检查 → `node -c <changed-files>`
2. Lint 修复 → `npm run lint:fix`
3. P0 核心测试 → `npm run test:p0`
4. Preflight 全绿 → `npm run preflight`（铁律 #6）
5. Playwright 截图 → 导航 → 截图 → 对比基线（铁律 #17）

## 命令速查

```bash
npm run lint:fix && npm run test:p0    # 开发后快速验证
npm run preflight                      # 提交前 7 步全绿
npx jest --testPathPattern=<file>      # 单文件调试
npm run test:e2e                       # Playwright E2E
npm run test:coverage                  # 全量+覆盖率
```

## Preflight 7 步流水线

ESLint → Prettier → P0(8套) → P1(8套) → P2(6套) → 覆盖率(≥30%) → npm audit(high+)

## 测试分层

| 层 | 套数 | 覆盖范围 |
|:--:|:----:|----------|
| P0 | 8 | 核心：API 路由 / data_sync / database / cache / scheduler / pk_scorer / plan-generator |
| P1 | 8 | 集成：ai_daemon / health / websocket / http-utils / fusion / midou |
| P2 | 6 | 功守道领域：score / fusion / parser / attack / diff / goal |
| E2E | 3 | 首页 / 功法道 / 方案页 |

## 参考文档（`references/`）

- `quality-gates.md` — 质量门禁标准（pre-commit / preflight / 部署验证）
- `test-matrix.md` — 测试矩阵完整清单

## Fallback

| 失败 | 降级 |
|------|------|
| preflight 不过 | 定位 → 修复 → 重跑 |
| P0 失败 | 单文件 `npx jest --testPathPattern` 定位 |
| 截图超时 | 确认服务器可达（`curl -H "Host: zj.100qiu.com" ...`）|
| 防假跑验证不通过 | 按 AGENTS.md 4 段格式强制交付 |
