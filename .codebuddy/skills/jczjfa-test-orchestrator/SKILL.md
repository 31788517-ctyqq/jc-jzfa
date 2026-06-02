---
name: jczjfa-test-orchestrator
description: >
  JC-ZJFA 项目全生命周期测试编排器。该 Skill 应被用于以下场景：
  开发编码完成后执行 pre-commit 检查、本地测试调试、发布前 preflight 质量门禁、
  部署验证、性能回归测试。覆盖 24 个测试套件 / 469+ tests 在 SDLC 各环节的编排，
  包含 P0(核心/8 suites)/P1(集成/8 suites)/P2(功法道/6 suites)+ E2E + Smoke + Benchmark。
---

# JC-ZJFA 测试编排器

## 概述

本 Skill 为 JC-ZJFA 项目提供全生命周期（SDLC）的测试编排能力，覆盖开发、调试、发布部署、运维监控四个阶段。
测试体系包含 17 个服务端单元测试套件 + 6 个功法道领域测试套件 + 3 个 E2E spec + 1 个 Smoke API 测试 + 性能基准脚本。

## 触发条件

当用户提到以下关键词时加载本 Skill：
- 测试、test、单元测试、冒烟测试、E2E、回归测试
- pre-commit、提交前检查
- preflight、发布前检查、质量门禁
- benchmark、性能测试、性能基准
- 部署、deploy、发布、release
- 覆盖率、coverage、lint

## 快速命令参考

### 开发阶段

```bash
# 全量单元测试 (469+ tests)
npm test

# Watch 模式 — 开发时实时反馈
npm run test:watch

# 仅 P0 核心测试 (8 suites, 快速)
npm run test:p0

# 代码检查 + 修复
npm run lint:fix
npm run format
```

### 调试/验证阶段

```bash
# P1 集成层测试 (8 suites)
npm run test:p1

# P2 功法道领域测试 (6 suites)
npm run test:p2

# 服务冒烟测试 (需要先启动服务器)
npm run test:smoke

# E2E 端到端测试 (自动启动服务器)
npm run test:e2e

# 覆盖率报告
npm run test:coverage

# 性能基准
npm run benchmark
```

### 部署阶段

```bash
# Preflight 发布前质量门禁 (7 步)
npm run preflight

# 部署执行
python deploy.py
```

### CI/一次性

```bash
# 完整质量流水线 (可串联执行)
npm run lint && npm run test:coverage && npm run test:smoke && npm run preflight
```

## 命令详解

### `npm run test:p0` — P0 核心层

覆盖数据存储、调度、评分、计划生成的核心链路：

| 测试文件 | 覆盖内容 |
|----------|---------|
| `server/tests/index_api.test.js` | API 路由索引 |
| `server/tests/data_sync.test.js` | 数据同步逻辑 |
| `server/tests/prediction_log.test.js` | 预测日志记录 |
| `server/tests/database.test.js` | 数据库层 |
| `server/tests/scheduler_v2.test.js` | V2 调度器 |
| `server/tests/cache.test.js` | 缓存层 |
| `server/tests/pk_scorer.test.js` | PK 评分引擎 |
| `server/tests/plan-generator.test.js` | 方案生成器 |

### `npm run test:p1` — P1 集成层

覆盖 AI、WebSocket、HTTP、融合等集成能力：

| 测试文件 | 覆盖内容 |
|----------|---------|
| `server/tests/ai_daemon.test.js` | AI 守护进程 |
| `server/tests/ai-timing.test.js` | AI 时序 |
| `server/tests/main-fusion.test.js` | 融合主逻辑 |
| `server/tests/health.test.js` | 健康检查 |
| `server/tests/http-utils.test.js` | HTTP 工具 |
| `server/tests/websocket.test.js` | WebSocket |
| `server/tests/midou.test.js` | Midou 逻辑 |
| `server/tests/cloudfunctions.test.js` | 云函数逻辑 |

### `npm run test:p2` — P2 功法道领域

| 测试文件 | 覆盖内容 |
|----------|---------|
| `server/gongshoudao/tests/score.test.js` | 评分逻辑 |
| `server/gongshoudao/tests/fusion.test.js` | 融合逻辑 |
| `server/gongshoudao/tests/parser.test.js` | 数据解析 |
| `server/gongshoudao/tests/attack.test.js` | 攻击逻辑 |
| `server/gongshoudao/tests/diff.test.js` | 差异比较 |
| `server/gongshoudao/tests/goal.test.js` | 目标逻辑 |

### `npm run test:smoke` — 服务冒烟

需要先启动服务器 `node server/index.js`，验证 35 个 API 端点。

### `npm run test:e2e` — E2E 端到端

Playwright 自动启动开发服务器，执行 3 个 spec：
- `main.spec.js` — 主页面加载与基础交互
- `gongshoudao.spec.js` — 功法道页面
- `plans.spec.js` — 方案页面

### `npm run preflight` — 发布前质量门禁

7 步检查流水线：
1. ESLint 代码规范
2. Prettier 格式检查
3. P0 核心测试
4. P1 集成测试
5. P2 功法道测试
6. 覆盖率门槛 (statements≥30%, branches≥25%, functions≥30%, lines≥30%)
7. npm audit (high 级别告警非阻塞)

### `npm run benchmark` — 性能基准

运行功法道计算性能基准测试，用于回归检测。

## SDLC 编排决策树

```
用户操作请求
├── 编码完成 → 执行 `npm run lint:fix && npm run test:p0`
│   (快速反馈，验证核心链路)
│
├── 准备提交 (git commit)
│   ├── pre-commit hook 自动执行: lint + P0 + prettier
│   └── 若未配置 hooks → `npm run setup:githooks`
│
├── 本地调试
│   ├── 全量单元 → `npm test`
│   ├── 只测某层 → `npm run test:p0|p1|p2`
│   ├── 服务级验证 → 启动服务器 + `npm run test:smoke`
│   └── UI 手动验证 → `npm run test:e2e:ui`
│
├── 准备发布
│   ├── 质量门禁 → `npm run preflight`
│   ├── E2E 验证 → `npm run test:e2e`
│   ├── 性能回归 → `npm run benchmark`
│   └── 门禁通过 → `python deploy.py` 执行部署
│
├── 部署后验证（V7.0 增强 — 强制逐项执行）
│   ├── HTTP 健康检查 → `curl :3000/api/health` 确认 200
│   ├── PM2 状态 → `pm2 status` 全部 online
│   ├── PM2 日志 → `pm2 logs --lines 10` 无 Error/Cannot find module
│   ├── 核心 API 冒烟 → `curl POST /api match-list` 正常返回比赛数据
│   ├── 静态资源验证 → 浏览器 F12 Network 检查无 404
│   ├── Smoke 自动化 → `npm run test:smoke`（需要服务器可公网访问）
│   └── 主链路回放 → E2E 或手动验证功守道/方案/PK 三个核心页面
│
└── 性能问题排查
    ├── 基准回归 → `npm run benchmark` 对比历史
    └── 性能脚本 → `node scripts/perf_test.js`
```

## 测试矩阵

完整的 24 个测试套件 / 469+ 测试用例的详细说明参见 `references/test-matrix.md`。

## 质量门禁标准

Pre-commit / Preflight / 部署验证的准入判定标准参见 `references/quality-gates.md`。

## 部署后验证流水线（V7.0 新增）

部署完成后必须按以下顺序逐项验证，全部通过才算部署成功：

```bash
# Step 1: HTTP 健康检查（30s 内响应 200 即通过）
ssh root@119.23.51.159 "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health"
# 期望：200

# Step 2: PM2 进程状态（全部 online）
ssh root@119.23.51.159 "pm2 status"
# 期望：jc-sync=online, jc-zjfa=online×2

# Step 3: 错误日志检查（最近 10 行无 Error/Cannot find module）
ssh root@119.23.51.159 "pm2 logs jc-zjfa --lines 10 --nostream 2>&1 | grep -i 'error\|cannot find\|uncaught' || echo 'NO ERRORS'"
# 期望：NO ERRORS

# Step 4: 核心 API 冒烟（match-list 正常返回比赛数据）
ssh root@119.23.51.159 "curl -s -X POST http://localhost:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"match-list\"}' | python3 -c 'import sys,json; d=json.load(sys.stdin); print(\"matches:\",len(str(d)))'"
# 期望：返回数据长度 > 0

# Step 5: 静态资源检查（浏览器 F12 → Network → 刷新 → 无红色 404）

# Step 6: 主链路手动回放
#   6a. 打开 https://zj.100qiu.com → 页面正常加载
#   6b. 进入功守道页面 → 弹窗数据正常展示
#   6c. 进入方案页面 → 方案列表正常
#   6d. 进入 PK 页面 → PK 数据正常
```

### 验证不过的处置

| 失败步骤 | 常见原因 | 处置 |
|---------|---------|------|
| Step 1 非 200 | PM2 进程未启动 | `pm2 restart all` |
| Step 2 非 online | 进程崩溃 | `pm2 logs` 查崩溃原因 |
| Step 3 有 Error | 模块缺失/语法错误 | 补充上传缺失文件 |
| Step 4 返回空 | cache.json 损坏/数据过期 | 清除缓存重启 |
| Step 5 有 404 | 静态资源未部署或路径错误 | 检查 nginx 映射 |
| Step 6 功能异常 | JS/CSS 缓存未刷新 | Ctrl+Shift+R 强制刷新 |
