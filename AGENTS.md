# JC-ZJFA AGENTS Guide

本文件用于统一本项目仓库的 AI 代理执行口径。

## 1) 会话启动（推荐）

每次会话开始先了解项目状态：

- 读取 `package.json` 了解依赖和脚本
- 读取 `项目需求文档.md` 了解业务需求
- 确认 `.env` 环境配置未泄露密钥

## 2) MCP 基线

本项目常用 MCP：

1. `playwright`：浏览器自动化、E2E 主链路回放
2. `github`：代码版本管理、PR 操作

## 3) 开发规则（强制）

1. 页面必须"主链路可操作"，不能只做静态占位。
2. 无真实外部系统时，必须使用后端可追踪模拟数据；禁止纯前端硬编码业务数据作为主路径。
3. 验收以"功能闭环 + 测试闭环"为准，不以"页面是否已画完"为准。
4. JavaScript：统一 API 封装，禁止在页面层拼接裸 URL。
5. SQL：统一蛇形命名；关键查询列必须建索引。
6. 禁止提交明文密钥、Token、密码等敏感信息。

## 4) 测试与发布门禁

本仓库发布前至少执行：

```powershell
# P0 核心测试
npm run test:p0

# 全量发布预检
npm run preflight
```

要求：
1. 门禁失败时禁止宣称 Ready for Release。
2. 合并前必须通过后端冒烟、前端构建测试。
3. 重大改动需附测试结果与风险说明。

## 5) Git 与提交流程规则

1. 分支命名建议：`feature/{desc}`、`hotfix/{desc}`、`release/{version}`。
2. Commit 必须使用 Conventional Commits：`feat|fix|refactor|docs|test|chore|perf|ci`。
3. PR 必须包含：变更说明、测试覆盖/结果、关联任务、风险点（如有）。
4. 合并前必须完成代码审查并处理阻断问题。

## 6) 技能路由建议

按任务类型优先选用：

1. 规划：查阅 `项目需求文档.md`、`技术开发文档.md`
2. 排障：`systematic-debugging`、`investigate`
3. 测试：`jczjfa-test-orchestrator`
4. 回测：`backtesting-frameworks`
5. 数据：`data-pipeline`
6. 实验：`experiment-tracking`
7. 部署：`deploy-ops`
8. 安全与边界：`careful`、`guard`

## 7) 项目特定规则

### 7.1 数据抓取
- 所有数据抓取脚本统一放在 `scripts/` 目录
- 抓取成功率 < 90% 必须触发告警
- 米斗数据质量门禁：extract ≥ 90%, load ≥ 90%

### 7.2 AI 预测
- DeepSeek prompt 变更需记录在 `prediction_log` 的 `ai_content` 中
- 每次 prompt 变更后必须做回归回测
- 新 prompt 上线前必须通过 hit-rate 验证

### 7.3 功守道分析
- `gongshoudao/cache.json` 为功守道核心缓存
- `fusionConsensus` 为融合共识标记（strong/weak/meltdown）
- 熔断（meltdown）比赛不允许生成方案

### 7.4 方案生成
- 比分方案：基于 Dutch 组合生成
- 量化方案：基于冷门方向 + 赔率信号
- 所有方案必须通过预算上限和风险检查

### 7.5 影子账户
- 虚拟初始资金：1,000,000 分（10,000元）
- 单票最大投注额：可用余额的 5%
- 每日最大投注额：可用余额的 20%

### 7.6 数据库持久化规则（V8.0 新增）

- **禁止绕过 database.js 适配器直接操作 `raw` 实例**：`database.getDatabase()` 返回 raw 实例，写入操作不触发 `_saveToFile()`，数据在进程重启后丢失
- **统一使用适配器 API**：`database.getAdapter()` → `adp.execRun/execAll/execOne/execDDL`，每次写操作自动持久化到 `midou_data.db`
- **SQLite 表必须在 `database.js` 的管理范围之内**：新表不能仅由业务模块建表、插入，必须和适配器交互
- **教训：prediction_log.js 绕过适配器写数据，导致回测分析页面查不出数据（整个表在 PM2 重启后变空）**

## 8) 规则来源

- `项目需求文档.md`
- `技术开发文档.md`
- `需求文档_AI核心看点DeepSeek接入.md`
- `sucai/预测回测功能方案.md`
- `package.json`（scripts / tests）

## 9) 部署规则（V7.0 新增）

### 9.1 依赖追踪（强制）

- 新增或修改 `require()` 引用时，必须检查目标模块是否已在部署覆盖范围内
- `deploy_gs.bat` 默认只上传 `server/gongshoudao/*.js`，依赖 `server/core/` 的文件需额外上传
- 功守道 `market.js` 依赖 `core/odds-movement.js` + `core/market-overlay.js`，这些文件不在默认部署范围
- 部署前使用 `node -e "..."` 脚本扫描依赖链（详见 deploy-ops Skill）
- **教训：遗漏 core/ 依赖会导致 match-list API 全线 500，用户完全不可用**

### 9.2 npm 依赖同步（强制）🆕

- **新增 npm 依赖必须在服务器上同步安装**：`npm install <pkg> --save` 后，部署前必须在服务器 `/root/server/` 目录执行相同的 `npm install`
- **教训**：V8.0 引入 `winston-daily-rotate-file`，本地 `npm install` 后未在服务器安装 → PM2 崩溃循环 300+ 次 → 站点不可用 10 分钟
- **部署流程补充**：新增依赖时，`deploy.py` 应自动执行或提醒 `npm install`

### 9.3 静态资源（强制）

- 图标/图片等静态资源优先使用 emoji 内联字符（免部署、不 404）
- 若使用文件资源，必须确认 nginx 路径映射正确
- 已知 nginx 映射：`/assets/` → `miniprogram/images/`（不是 `preview/assets/`！）
- 资源放在哪里就按对应的 URL 引用，不要跨目录放置

### 9.3 部署清单

- 功守道迭代：`deploy_gs.bat`（⚠️ 记得更新文件列表和依赖）
- 全量部署：`python deploy.py` 或 `node deploy/deploy_sftp.js`
- 核心模块独立更新：手动 scp `server/core/*.js`
- **新增模块部署记得检查依赖**：部署 `server/core/odds-tracker.js` 时需同步上传（已在 `deploy_gs.bat` 范围内会自动处理）
- **betting.js 同步**：修改 `preview/js/pages/betting.js` 需上传到 `/var/www/zj.100qiu.com/preview/js/pages/`

### 9.5 match-odds API 设计规则（V7.1 新增）

- **禁止重复 `case 'match-odds'`**：JavaScript switch 中第一个匹配的 case 会先执行并 return，后面的同名 case 是死代码
- **allplays.json 与 odds_history 的 key 命名不一致**：
  - allplays.json：SPF 数据 key 为 `spf`/`rqspf`，但 BF 存为 `scores`（对象），JQS 存为 `totalGoals`，BQC 存为 `halfFull`
  - odds_history：key 为 `spf`/`rqspf`/`halfFull`/`totalGoals`，以竞彩编号（如 `周二201`）为 primary key
  - **match-odds handler 必须同时兼容两种 key 命名**（如 jqs 也查 totalGoals，bqc 也查 halfFull，bf 也查 scores）
- **allplays.json 的 `num` 字段可能为空**：匹配时优先用 key 直接匹配（`dayData[matchNum]`），其次用 `num_` 前缀，再用 `e.num` 字段匹配
- 部署后验证：健康检查 + PM2 状态 + 核心 API 冒烟 + 浏览器主链路（见 §10.4 部署后验证清单）

### 9.4 服务器信息

- IP：119.23.51.159
- SSH 密钥：`%USERPROFILE%\.ssh\id_rsa_jczjfa`
- PM2 进程：jc-sync, jc-zjfa（cluster: 2）
- 双路径：`/root/server/`（PM2）+ `/var/www/zj.100qiu.com/`（Nginx），功守道需同步

### 9.6 部署方式与认证规则（V8.1 新增）

- **推荐 `python deploy.py --fast`，禁止用 Windows 原生 `scp`/`ssh`**：Windows OpenSSH 与旧版 SSH 服务器 (ssh-rsa) 握手失败，表现长时间卡住
- 两种认证方式均可连接：密钥 `id_rsa_jczjfa` + 密码 `.env.deploy`，`deploy.py` 的 paramiko 自动回退
- 部署后必须运行 `python _verify_api.py` 一键验证（4 层：PM2 状态 → 内部健康 → Nginx 代理 → 业务 API）
- 502 Bad Gateway 排查必须带 `Host: zj.100qiu.com` 头，不带会被路由到默认 server block
- 外网按 IP 测试 API 时也需带 Host 头

### 9.7 数据同步日期与依赖规则（V9.2 新增）

- **线上同步脚本禁止用 `new Date().toISOString().slice(0,10)` 作为“今天”**：北京时间 00:00~07:59 会被算成 UTC 前一天，导致 `jc-sync` 抓前一天比分、AI/推荐/赛程停在旧日期。必须使用本地日期格式化（如 `fmtLocal(new Date())` / 前端 `formatDate(new Date())`）。
- **实时比分按竞彩编号回填必须带日期维度**：`周日009` 等编号会跨周/跨日期重复，`num` 回退匹配必须用 `date|num`，禁止全局 `num→match` 覆盖。
- **`sync_live_500.js` / `data_sync.js` 依赖 `server/core/ingestion-guard.js`**，部署清单必须包含该文件；遗漏会导致 500.com 实时比分抓取报 `Cannot find module './core/ingestion-guard'`。
- **`data_sync.js` 健康监控 setInterval 内使用时间变量必须在回调内定义**；曾因整点逻辑引用外层 `now` 导致 `jc-sync` 整点崩溃重启。

## 10) 上下文记忆策略（V7.0 新增）

本 IDE 插件的 AI 会话上下文有限（每次新会话白板启动）。通过以下分层机制增强跨会话记忆：

### 10.1 Skill = 知识胶囊（推荐）

每个 `.codebuddy/skills/<name>/SKILL.md` 是独立的知识胶囊，AI 在需要时按需加载：

| Skill | 触发词 | 携带知识 |
|-------|--------|---------|
| deploy-ops | 部署/deploy/nginx/404/500 | 服务器架构、依赖追踪、排查手册、认证方式 |
| jczjfa-test-orchestrator | 测试/test/preflight | 24 套件编排、门禁标准 |
| backtesting-frameworks | 回测/backtest | Walk-Forward、Monte Carlo |
| data-pipeline | 数据/抓取/ETL | 数据质量门禁 |
| experiment-tracking | 实验/prompt/命中率 | DeepSeek prompt 版本对比 |

**优势**：不占用会话基础上下文，触发时才加载。`references/` 子目录可存放深度文档。

### 10.2 AGENTS.md 会话引导（每次自动加载）

- 每次新会话启动时，AI 会自动读取 `AGENTS.md`
- 保持精简但覆盖所有关键规则
- **每踩一个坑，必须在 AGENTS.md 留下记录**——这是防止重复踩坑的底线

### 10.3 update_memory 持久化（跨会话持久）

关键项目事实使用 `update_memory` 工具持久化到 AI 记忆库：

```
示例记忆条目：
- "JC-ZJFA 服务器 119.23.51.159，SSH 密钥 id_rsa_jczjfa"
- "功守道 market.js 依赖 core/odds-movement + market-overlay，部署必须带上"
- "Nginx /assets/ 路径映射到 miniprogram/images/，不是 preview/assets/"
```

### 10.4 部署后验证清单（每次部署后强制）

```
部署完成
├── L1: PM2 状态 → 全部 online
├── L2: 内部健康 → curl :3000/api/health → 200
├── L3: Nginx 代理 → curl -H "Host: zj.100qiu.com" :80/api/health → 200
├── L4: 业务 API → match-list / prediction-backtest 返回 code=0
├── L+: PM2 日志 → 无 Error/Cannot find module
├── 静态资源验证 → 浏览器检查无 404 破图
└── 主链路回放 → E2E 或手动验证功守道/方案/PK 三个核心页面

一键执行: python _verify_api.py
```

### 10.5 关键文件索引速查

| 信息类型 | 查找位置 |
|----------|---------|
| 服务器架构/nginx 配置/部署流程 | deploy-ops Skill + `references/nginx.md` |
| 功守道 7 阶段管道 | `server/gongshoudao/index.js` → market.js |
| API 路由 | `server/index.js` |
| 测试编排与门禁 | jczjfa-test-orchestrator Skill |
| 数据同步策略 | `server/data_sync.js` |
| 回测框架 | backtesting-frameworks Skill |
