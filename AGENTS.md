# JC-ZJFA AGENTS Guide

> 集中管控：铁律 + Skill 路由 + 项目配置。每会话自动加载。

---

## 🔒 铁律（20 条）

### 代码与数据（#1–#6）

| # | 禁止 | 替代/说明 |
|---|------|----------|
| 1 | `new Date().toISOString().slice(0,10)` | `datetime.todayCN()` 或 `m.date` |
| 2 | 绕过 `getAdapter()` 写 raw SQL | `adp.execRun / execAll / execOne` |
| 3 | 新增 PNG/SVG 图标文件 | 用 emoji 内联替代 |
| 4 | 竞彩日期用 `startTime` | **必须用 `m.date`（期号），禁止用开赛时间** |
| 5 | CSS 变量替换碰数值属性 | **只替换颜色 hex，禁碰 px/em/rem** |
| 6 | 模糊 commit / 不跑 preflight | 一功能一 commit，全绿才能提交 |

### 部署与运维（#7–#16）

| # | 禁止 | 替代/说明 |
|---|------|----------|
| 7 | 生产 master 直改 | 新分支 → 本地测试 → 合并 |
| 8 | Windows 原生 scp/ssh | `python deploy.py --fast` |
| 9 | 临时脚本永久留存在根目录 | 用完归档到 `scripts/archive/` |
| 10 | sql.js 多进程并发写 | `instances:1`，单写入者 |
| 11 | PM2 变更不验证残留进程 | `ps aux \| grep node` 确认无 zombie |
| 12 | scheduler `max_memory` < 2048M | 最低 2048M |
| 13 | server/core/ 新模块不同步 DEPLOY_MAP | pre-deploy-check 自动阻断 |
| 14 | 新增页面不同步 main-fusion 路由 | 部署前检查 `_ensurePage` + `switchTab` |

### 前端与样式（#9–#10 独立，此处 #15–#17）

| # | 禁止 | 替代/说明 |
|---|------|----------|
| 15 | SW 缓存 HTML | SW 只缓存 JS/CSS |
| 16 | postbuild 覆盖源文件 | 产物与源码严格分离 |
| 17 | CSS 改动不截图验证 | Playwright 截图 → 确认 → 部署 |

### AI 行为规范（#18–#20）

| # | 禁止 | 替代/说明 |
|---|------|----------|
| 18 | 命名链 `fix → fix2 → final` | 一次修好，或带语义版本号 |
| 19 | AI 自行部署 | 展示变更清单 → 等用户确认 → 部署 → 截图验证 |
| 20 | 口头承诺 / 篡改测试 / 伪造执行 / 过度发挥 | TDD 闭环 + 4 段交付格式 |

---

## ⚡ Skill 路由

| Skill | 触发词 | MUST |
|-------|--------|:----:|
| deploy-ops | 部署 / Nginx / PM2 / 502 / 404 / Vite / Redis / 高并发 | ✅ |
| data-pipeline | 数据 / 抓取 / ETL / 回填 / 核查 / 半场比分 / 防漂移 | ✅ |
| jczjfa-test-orchestrator | 测试 / jest / playwright / preflight / 门禁 | ✅ |
| ai-experiments | 回测 / ROI / 调参 / AI 模型 / DeepSeek / 豆包 | ✅ |

> **排加载**：纯文档、纯样式、只读查询 → 跳过 Skill 加载，避免 Token 膨胀。

---

## 🏗 项目架构速览

```
jc-zjfa              ← PM2 cluster:1, 1800M, 主服务（API + 前端）
jc-sync              ← PM2 fork, 1800M, 数据同步（daemon）
jc-scheduler         ← PM2 fork, 2048M, 调度器（定时任务）
├── server/          ← Node.js 后端（~70 文件）
│   ├── index.js     ← 主入口（API 路由 + HTTP）
│   ├── core/        ← 核心模块（cache / database / odds / auth…）
│   ├── routes/      ← 已拆分的路由模块（auth / users / system）
│   └── gongshoudao/ ← 功守道领域模块
├── preview/         ← 前端源文件（Vite 构建 → dist/）
├── scripts/         ← 工具脚本（backtest / deploy / audit…）
└── .codebuddy/      ← AI 工作区（skills / teams / baselines）
```

---

## ⚙️ 配置速查

| 项目 | 值 |
|------|-----|
| 服务器 | `119.23.51.159`（CentOS 6.9 x86_64） |
| SSH 认证 | `id_rsa_jczjfa` 密钥 + `.env.deploy` 密码 |
| 部署方式 | `python deploy.py --fast`（paramiko，禁止原生 scp） |
| PM2 工作目录 | `/root/server/` |
| Web 根目录 | `/var/www/zj.100qiu.com/` |
| Nginx `/assets/` | → `miniprogram/images/`（非 preview/assets/） |
| Vite 产物 | `preview/dist/` → `/var/www/zj.100qiu.com/preview/dist/` |
| 主 DB | `server/midou_data.db`（~48MB，better-sqlite3） |
| 归档 DB | `sporttery_archive.db`（~676MB，懒加载） |
| Auth DB | `auth.db`（~233KB，独立文件） |
| Redis | 轻量 RESP，不可用自动降级内存 Map |
| 当前分支 | `local/auth-preview` |
| Python | 3.6.12（SCL rh-python36）|

---

## 📋 常用命令

```bash
npm run preflight                    # 提交前 7 步全绿
npm run lint:fix && npm run test:p0  # 开发后快速检查
npx vite build                       # 前端改动后重建 dist
python deploy.py --fast              # 全量部署（需用户确认）
python deploy.py --fast --files-only # 仅前端文件（需确认）

node -e "..."                        # 生产 data.json 修改（SSH 中）
pm2 restart jc-zjfa                  # 后端改动重启
ssh -i id_rsa_jczjfa root@119.23.51.159  # 手动 SSH
```

---

## 🔧 缓存排查

```
后端改          → pm2 restart jc-zjfa
前端改          → Ctrl+Shift+R 硬刷新（跳过 SW）
SW 改           → Unregister SW + Ctrl+Shift+R
Vite 构建改     → npx vite build + deploy --files-only
502 诊断        → curl -H "Host: zj.100qiu.com" http://119.23.51.159/api/health
全栈 404 诊断   → Playwright 扫描（npm run test:e2e）
```

---

## 🧠 自学习

| 优先级 | 动作 | 时机 |
|:------:|------|------|
| P0 | `pre-commit-check` 自动阻断新增遗漏 | commit 前 |
| P1 | 新教训写入对应 Skill 的 `references/lessons.md` | 复盘时 |
| P2 | 持久化关键项目事实到 `update_memory` | 新知识产生时 |

> 铁律更新：新增规则须对应删除或合并一条旧规则，保持总数 20 条。
