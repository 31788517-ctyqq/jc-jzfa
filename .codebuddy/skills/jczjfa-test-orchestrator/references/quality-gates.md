# JC-ZJFA 质量门禁标准

> 定义各 SDLC 阶段的准入门槛与判定标准

## 1. Pre-Commit 门禁

**触发时机**：`git commit` 前自动执行（通过 `.githooks/pre-commit`）

**执行步骤**：

| 步骤 | 检查项 | 命令 | 阻塞 |
|:---:|--------|------|:---:|
| 1 | ESLint 代码规范 | `npx eslint "server/**/*.js" "preview/js/**/*.js" "preview/*.js" "scripts/*.js" --quiet` | ✅ 阻塞 |
| 2 | P0 核心测试 | `npx jest --testPathPattern="server/tests/(index_api\|data_sync\|prediction_log\|database\|scheduler_v2\|cache\|pk_scorer\|plan-generator)" --forceExit --no-coverage` | ✅ 阻塞 |
| 3 | Prettier 格式检查 | `npx prettier --check "server/**/*.js" "preview/js/**/*.js" "preview/*.js" "scripts/*.js" --loglevel error` | ✅ 阻塞 |

**判定标准**：
- 全部 3 步通过 → 允许提交
- 任意一步失败 → 拒绝提交，输出修复指引
- Step 2 失败时提示运行 `npm run test:p0` 排查

**配置 hook**：`npm run setup:githooks`

**跳过 hook（仅紧急情况）**：`git commit --no-verify`

---

## 2. Preflight 发布前质量门禁

**触发时机**：执行 `npm run preflight` 或 `./scripts/release-preflight.ps1`

**7 步流水线**：

| 步骤 | 检查项 | 阻塞 | 超时 |
|:---:|--------|:---:|:---:|
| 1 | ESLint | ✅ 阻塞 | — |
| 2 | Prettier | ✅ 阻塞 | — |
| 3 | P0 核心测试 (8 suites) | ✅ 阻塞 | 120s |
| 4 | P1 集成测试 (8 suites) | ✅ 阻塞 | 120s |
| 5 | P2 功法道测试 (6 suites) | ✅ 阻塞 | 180s |
| 6 | 覆盖率门槛检查 | ✅ 阻塞 | 300s |
| 7 | npm audit (high+) | ⚠️ 非阻塞 | — |

**P0 测试匹配**（Step 3）：
```
server/tests/(index_api|data_sync|prediction_log|database|scheduler_v2|cache|pk_scorer|plan-generator)
```

**P1 测试匹配**（Step 4）：
```
server/tests/(ai_daemon|ai-timing|main-fusion|health|http-utils|websocket|midou|cloudfunctions)
```

**P2 测试匹配**（Step 5）：
```
gongshoudao/tests
```

**覆盖率门槛**（Step 6）：
| 指标 | 阈值 |
|------|:---:|
| Statements | ≥ 30% |
| Branches | ≥ 25% |
| Functions | ≥ 30% |
| Lines | ≥ 30% |

**判定标准**：
- 0 failed → ✅ Ready to deploy!
- ≥1 failed → ❌ 列出所有失败步骤，阻止发布

---

## 3. 部署验证门禁

**触发时机**：`python deploy.py` 执行完毕后

**验证步骤**（deploy.py Phase 4.5-5）：

| 阶段 | 检查项 | 方法 |
|------|--------|------|
| Phase 4.5 | MD5 文件完整性 | 远程服务器文件 MD5 与本地文件复验 |
| Phase 5 | HTTP 端点验证 | 逐个验证部署的 API 端点 |
| 手动 | 健康检查 | `GET /health/deep` |
| 手动 | 冒烟验证 | `npm run test:smoke` |

**判定标准**：
- MD5 全部一致 → 文件部署完整
- HTTP 验证全部 200 → 服务正常启动
- 健康检查 → 深度指标正常

---

## 4. 性能基准门禁

**触发时机**：发布前或性能变更后

**执行**：`npm run benchmark`

**基准数据**：功法道 `computeAll` 全量计算耗时

**判定标准**：
- 与上一次基准对比，耗时增幅 < 20% → 通过
- 耗时增幅 ≥ 20% → 需排查性能退化原因

---

## 5. 快速参考卡

### 开发日常

```bash
# 修改代码后快速检查
npm run lint:fix && npm run test:p0
```

### 准备提交

```bash
# 完整本地检查
npm run lint:fix && npm test && npm run format
git add -A && git commit -m "..."
```

### 发布前最终确认

```bash
# 完整质量流水线
npm run lint && npm run test:coverage && npm run preflight
# 通过后
python deploy.py
```

### 紧急修复（跳过门禁，不推荐）

```bash
git commit --no-verify -m "hotfix"
```
