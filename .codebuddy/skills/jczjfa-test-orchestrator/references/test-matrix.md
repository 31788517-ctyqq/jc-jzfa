# JC-ZJFA 测试矩阵

> 完整测试套件：115 suites / 1927 tests（全量 `npx jest --forceExit`）  
> 源文件覆盖：92/183 (50%)  
> 更新时间：2026-06-20

## 总体架构

```
测试根目录 (jest.config.js → roots)
├── server/tests/          (17 suites)  ← 服务端单元测试
├── server/gongshoudao/tests/ (6 suites) ← 功法道领域测试
└── preview/tests/e2e/     (3 specs)    ← E2E 端到端测试
```

## 分层分类

### P0 — 核心层 (8 suites, ~200+ tests)

| 测试文件 | 预估用例数 | 覆盖模块 | 关键断言 |
|----------|:---:|---------|---------|
| `index_api.test.js` | ~20 | API 路由注册与分发 | 路由完整性、参数校验 |
| `data_sync.test.js` | ~25 | 数据同步逻辑 | 增量/全量同步、冲突处理 |
| `prediction_log.test.js` | ~15 | 预测日志记录 | 写入完整性、时间戳 |
| `database.test.js` | ~30 | SQLite 数据库层 | CRUD、事务、迁移 |
| `scheduler_v2.test.js` | ~35 | V2 定时调度器 | 调度精度、任务队列 |
| `cache.test.js` | ~15 | 缓存层 | 命中/失效、TTL |
| `pk_scorer.test.js` | ~25 | PK 评分引擎 | 评分公式、边界值 |
| `plan-generator.test.js` | ~50 | 方案生成器 | 生成逻辑、约束校验 |

### P1 — 集成层 (8 suites, ~150+ tests)

| 测试文件 | 预估用例数 | 覆盖模块 | 关键断言 |
|----------|:---:|---------|---------|
| `ai_daemon.test.js` | ~20 | AI 守护进程 | 状态机、消息处理 |
| `ai-timing.test.js` | ~6 | AI 时序控制 | 时序精度 |
| `main-fusion.test.js` | ~25 | 融合主逻辑 | 数据合并、权重 |
| `health.test.js` | ~8 | 健康检查端点 | HTTP 200、状态码 |
| `http-utils.test.js` | ~8 | HTTP 工具函数 | 请求封装、错误处理 |
| `websocket.test.js` | ~10 | WebSocket 协议 | 连接、消息解析 |
| `midou.test.js` | ~7 | Midou 逻辑 | 数据转换 |
| `cloudfunctions.test.js` | ~20 | 云函数逻辑 | 函数调用、参数 |

### P2 — 功法道领域 (6 suites, ~120+ tests)

| 测试文件 | 预估用例数 | 覆盖模块 | 关键断言 |
|----------|:---:|---------|---------|
| `score.test.js` | ~65 | 功法评分核心 | 多维度评分公式 |
| `fusion.test.js` | ~25 | 功法融合 | 融合规则、边界 |
| `parser.test.js` | ~25 | 数据解析 | 格式解析、异常 |
| `attack.test.js` | ~25 | 攻击逻辑 | 伤害计算 |
| `diff.test.js` | ~20 | 差异比较 | 版本 diff |
| `goal.test.js` | ~16 | 目标逻辑 | 目标判定 |

### E2E — 端到端 (3 specs)

| Spec 文件 | 覆盖页面 | 验证内容 |
|-----------|---------|---------|
| `main.spec.js` | 首页 | 页面加载、API status 200 |
| `gongshoudao.spec.js` | 功法道页 | 页面元素渲染 |
| `plans.spec.js` | 方案页 | 方案列表加载 |

### Smoke — 服务冒烟

| 测试文件 | 用例数 | 说明 |
|----------|:---:|------|
| `smoke_api.test.js` | 35 APIs | 需启动服务器，逐一验证端点 HTTP 200 |

## 运行方式矩阵

| 命令 | 覆盖范围 | 包含 suites |
|------|---------|-----------|
| `npm test` | 全部 | P0 + P1 + P2 (不含 E2E/Smoke) |
| `npm run test:p0` | P0 | 8 suites |
| `npm run test:p1` | P1 | 8 suites |
| `npm run test:p2` | P2 | 6 suites |
| `npm run test:smoke` | Smoke | 35 API endpoints |
| `npm run test:e2e` | E2E | 3 specs |
| `npm run test:coverage` | 全部 + 覆盖率 | P0+P1+P2 + coverage report |
| `npm run benchmark` | 性能基准 | 功法道 computeAll |

## 覆盖率目标

配置于 `jest.config.js` → `coverageThreshold`:

| 指标 | 最低阈值 |
|------|:---:|
| Statements | 30% |
| Branches | 25% |
| Functions | 30% |
| Lines | 30% |

覆盖率采集范围：
- `server/core/**/*.js`
- `server/gongshoudao/**/*.js`
- `server/prediction_log.js`
- `server/scheduler_v2.js`

## 排除项

- `smoke_api.test.js` — 需要运行中的服务器，从 `npm test` 排除
- `server/gongshoudao/tests/**` — 排除自身递归
- `server/gongshoudao/test*.js` — 排除命名冲突文件
- `server/gongshoudao/e2e_test.js` — 排除 E2E 文件
