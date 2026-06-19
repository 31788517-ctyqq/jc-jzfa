# JC-ZJFA AGENTS Guide v18

> 精简版：核心禁手(13条) + Skill 强制路由 + AI 参数约束 + 关键配置。每会话自动加载。

---

## 🔒 核心禁手（触犯即阻断）

| # | 禁止 | 替代 |
|---|------|------|
| 1 | `new Date().toISOString().slice(0,10)` | `require('./server/core/datetime').todayCN()` |
| 2 | 绕过 `database.getAdapter()` 直接写 raw SQL | `adp.execRun/execAll/execOne` |
| 3 | 新增 PNG/SVG 图标文件 | 用 emoji 内联字符 |
| 4 | 模糊 commit（`chore: 同步` 等） | 一个功能一个 commit |
| 5 | 在生产 master 上试验新技术栈 | 新分支 → 本地验证 → 合并 |
| 6 | 不跑 `npm run preflight` 就提交 | preflight 全绿才能 commit |
| 7 | SW 缓存 HTML（PAGE_SHELL） | SW 只缓存 JS/CSS 静态资源 |
| 8 | `postbuild` 覆盖源文件 | 构建产物与源码严格分离 |
| 9 | Windows 原生 scp/ssh | `python deploy.py --fast`（paramiko） |
| 10 | 临时脚本永久留在仓库 | 用完即删，或归档 `scripts/perf/` |
| 11 | sql.js/SQLite 多进程并发写同一文件 | 单文件 DB 必须 `instances:1`，且同一文件中最多一个写入者 |
| 12 | PM2 变更后不验证残留进程 | `pm2 delete/restart` 后必须 `ps aux \| grep node` 确认无 zombie |
| 13 | jc-scheduler `max_memory_restart` 低于 512M | 最低 2048M（加载 300MB sql.js DB + 功守道计算） |

---

## ⚡ Skill 强制加载规则（MUST）

> **AI 必须在分析用户任务后立即判断是否需要加载 Skill，不得跳过。**

```
1. 涉及 部署/服务器/Nginx/PM2/502/缓存/404/资源路径？
   → MUST use_skill deploy-ops

2. 涉及 数据/抓取/ETL/同步/修复/回填/缺失？
   → MUST use_skill data-pipeline

3. 涉及 测试/质量门禁/覆盖率/E2E/lint？
   → MUST use_skill jczjfa-test-orchestrator

4. 涉及 回测/方案参数/AI模型/prompt/命中率/ROI/调参？
   → MUST use_skill backtesting-frameworks + experiment-tracking （双加载，缺一不可）

5. 涉及 CSS/颜色/样式/布局？
   → 先检查 preview/css/app.css 顶部 Design Tokens（--jczj-* 变量）
   → 改动后 MUST Playwright 截图验证

6. 涉及 新增模块/文件？
   → 检查 deploy.py DEPLOY_MAP 确保部署时不会丢失
```

---

## 🧠 每日自检（新会话自动执行）

> **每新会话开始，AI 在分析用户任务前必须先执行以下检查：**

```
□ 读取本文件（AGENTS.md）已自动完成
□ 检查是否有未归档的临时脚本（git status Untracked）
□ 检查是否有 pending 的修复未写入 Skill lessons
□ 确认当前分支（git branch）和目标环境
□ 检查生产环境 PM2 状态（pm2 list）— 3 进程必须全部 online
```

---

## ⚙️ 关键配置速查

| 项目 | 值 |
|------|-----|
| 服务器 IP | 119.23.51.159 |
| PM2 进程 | jc-zjfa (cluster:1, 1800M)，jc-sync (fork:1, 1800M)，jc-scheduler (fork:1, **2048M**) |
| 部署路径 | `/root/server/` + `/var/www/zj.100qiu.com/` |
| Nginx `/assets/` | → `miniprogram/images/`（不是 `preview/assets/`！）|
| 部署方式 | `python deploy.py --fast` |
| 部署验证 | `python _verify_api.py`（L1-L6）|
| preflight | `npm run preflight`（7 步） |
| SW 版本 | `jczjfa-static-v10` |
| Watchdog cron | `*/5 * * * *` → `scripts/watchdog.cjs` |
| Vite 构建 | `npx vite build` → `python deploy.py --fast --files-only` |
| 测试套件 | 115 suites, 1927 tests（全量 `npx jest --forceExit`） |
| 当前 stable tag | `v11.0-stable` (09d4bb09) |

---

## 🤖 AI 模型调用规范（防降智）

> **每次 AI 模型调用（DeepSeek/豆包/其他）必须遵守以下参数约束。**

| 参数 | 约束 | 原因 |
|------|------|------|
| **Temperature** | 代码生成 ≤0.3 / 创意生成 ≤0.7 | 低温度减少随机性，避免模型"跑偏" |
| **输出格式** | 优先结构化输出（JSON/代码块） | 减少自然语言闲聊，降低 Token 消耗 |
| **降级策略** | API 失败 → 降级模型 → 精简 Prompt | 禁止无限重试同一模型 |
| **Token 预算** | 单次任务 ≤16K context | 避免上下文膨胀导致指令遗忘 |
| **兜底机制** | 保留 `fallbackToLLM` 原始调用路径 | 缓存失效/规则不匹配时自动回退 |

**Temperature 场景速查**：

| 场景 | Temperature | 模型偏好 |
|------|:---:|------|
| 生成方案/预测 | 0.3 | DeepSeek + 豆包双模型 |
| 数据分析/ETL | 0.1 | 豆包（稳定优先） |
| 用户交互/NLP | 0.5 | DeepSeek |
| 降级兜底（16:30后） | 0.3 | 仅豆包 + 精简 Prompt |

---
## 📋 日常命令

```powershell
npm run lint:fix && npm run test:p0   # 开发完成后
npm run preflight                      # 提交前
npx jest --forceExit                   # 全量测试
npx vite build                         # Vite 构建
python deploy.py --fast                # 部署（需用户确认）
python deploy.py --fast --files-only   # 仅前端文件
python _verify_api.py                  # 部署后验证
```

---

## 🚨 风险操作协议

### 🔒 部署铁律

**AI 绝对禁止自行部署**，必须：
1. 展示变更清单 + dry-run 结果
2. 等用户明确回复"确认"/"执行"/"部署"
3. 部署后 Playwright 截图验证

### 🖥️ 前端改动

修改 CSS/HTML/前端 JS → 必须本地 Playwright 截图验证 → 才能请求部署

### 🐛 Bug 排查

报告问题 → Playwright MCP 模拟用户操作复现 → 定位根因 → 再改代码

---
## 🗺️ 知识地图

| 场景 | 文档 |
|------|------|
| 开发返工分析 | `sucai/开发返工问题全面诊断报告.md` |
| 本地-生产差异 | `sucai/本地生产环境落差导致返工分析.md` |
| 被回退的优化 | `sucai/被回退丢失的优化项分析.md` |
| 优化计划 | `sucai/本地优化与规范建设计划.md` |
| 部署经验 | `.codebuddy/skills/deploy-ops/references/lessons.md` |
| ETL 规范 | `.codebuddy/skills/data-pipeline/references/etl-specs.md` |
| 回测模式 | `.codebuddy/skills/backtesting-frameworks/references/patterns.md` |
| 实验追踪实现 | `.codebuddy/skills/experiment-tracking/references/tracker-code.md` |
| Skill 索引 | `.codebuddy/skills/SKILLS_INDEX.md` |
| **监控体系 (V17)** | `server/core/db-metrics.js`, `scripts/watchdog.cjs` |
| **测试覆盖 (V17)** | 115 suites / 1927 tests / 92/183 source files |

---

## 🧠 自学习协议（修复后立即执行）

修复/返工完成后，**同一轮回复中**：
- P0（阻断）→ 追加到 `scripts/pre-commit-check.cjs`
- P1（返工 ≥1 次）→ 追加到对应 Skill `references/lessons.md`
- P2（新认知）→ `update_memory` 记录

---

## 🔧 三层缓存排查（改动不生效时）

| 改了什么 | 需要重启Node | Ctrl+Shift+R | SW Unregister |
|---------|:---:|:---:|:---:|
| 前端 JS/CSS | — | ✅ | — |
| HTML | — | ✅ | — |
| 后端 JS | ✅ | — | — |
| sw.js | — | ✅ | ✅ |

清除：`F12 → Application → Service Workers → Unregister → Clear site data → Ctrl+Shift+R`
