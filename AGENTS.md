# JC-ZJFA AGENTS Guide v19

> 核心禁手(14) + 代码卫生(8) + Skill 路由 + 关键配置。每会话自动加载。

## 🔒 核心禁手

| # | 禁止 | 替代 |
|---|------|------|
| 1 | `new Date().toISOString().slice(0,10)` | `require('./server/core/datetime').todayCN()` |
| 2 | 绕过 `database.getAdapter()` 直接写 raw SQL | `adp.execRun/execAll/execOne` |
| 3 | 新增 PNG/SVG 图标 | emoji 内联 |
| 4 | 模糊 commit | 一个功能一个 commit |
| 5 | 生产 master 试验新技术 | 新分支→本地→合并 |
| 6 | 不跑 `npm run preflight` 就提交 | preflight 全绿才能 commit |
| 7 | SW 缓存 HTML | SW 只缓存 JS/CSS |
| 8 | `postbuild` 覆盖源文件 | 产物与源码分离 |
| 9 | Windows scp/ssh | `python deploy.py --fast` |
| 10 | 临时脚本永久留仓库 | 用完归档 `scripts/archive/` |
| 11 | sql.js 多进程并发写 | instances:1，单写入者 |
| 12 | PM2 变更后不验证残留 | `ps aux | grep node` |
| 13 | jc-scheduler `max_memory_restart` < 2048M | 最低 2048M |
| 14 | 新增 `server/core/` 模块不同步 DEPLOY_MAP | pre-deploy-check 自动阻断 |

## 🧹 代码卫生

| # | 规则 |
|---|------|
| H1 | 临时脚本 `_tmp_*` 前缀，放 `scripts/` |
| H2 | 修复后 1h 内归档/删除 |
| H3 | 根目录 ≤30 核心文件 |
| H4 | 备份带时间戳：`*.bak.YYYYMMDD_HHmmss` |
| H5 | 禁止 API dump JSON 散落 |
| H6 | 空数据文件不入库 |
| H7 | 日志统一到 `logs/` |
| H8 | 禁止命名链 `fix→fix2→final` |

## ⚡ Skill 路由 + 触发词

| Skill | 触发词 | 强制 |
|-------|--------|:---:|
| `deploy-ops` | 部署/Nginx/PM2/502/404/cache/Vite/zombie/Redis/高并发/cluster/记住我 | MUST |
| `data-pipeline` | 数据/抓取/ETL/回填/核查/audit/半场比分/scheduler/alerts | MUST |
| `jczjfa-test-orchestrator` | 测试/jest/playwright/lint/preflight/覆盖率 | MUST |
| `backtesting-frameworks` + `experiment-tracking` | 回测/ROI/调参/prompt/AI模型/DeepSeek/豆包/temperature | 双加载 |

**排除**：纯文档/纯样式/只读查询 → 跳过 Skill 加载。

## ⚙️ 关键配置

| 项目 | 值 |
|------|-----|
| 服务器 | 119.23.51.159 |
| PM2 | jc-zjfa(cluster:1,1800M) / jc-sync(fork,1800M) / jc-scheduler(fork,**2048M**) [Redis就绪可切cluster:3] |
| 部署路径 | `/root/server/` + `/var/www/zj.100qiu.com/` |
| Nginx `/assets/` | → `miniprogram/images/`（非 preview/assets/） |
| 部署 | `python deploy.py --fast` / `--files-only` |
| Vite | `npx vite build` → `--files-only` 部署（修改前端 JS 后必须重建dist） |
| Redis | 轻量 RESP，不可用自动降级内存 Map |
| 数据核查 | `data-auditor.js` 每日 3:00（6类18项） |
| SW | `jczjfa-static-v12` |
| 分支 | `local/auth-preview` |

## 📋 常用命令

```
npm run lint:fix && npm run test:p0
npm run preflight
npx jest --forceExit
npx vite build
python deploy.py --fast                # 需用户确认
python deploy.py --fast --files-only
```

## 🚨 部署铁律

**AI 绝对禁止自行部署**：展示变更清单 → 等用户确认 → 部署 → Playwright 截图验证。修改 CSS/前端 JS → 本地截图后才能请求部署。

## 🗺️ 知识地图

| 场景 | 文档 |
|------|------|
| 部署/运维 | `deploy-ops/SKILL.md` + `references/` |
| 数据/ETL | `data-pipeline/SKILL.md` |
| 测试/门禁 | `jczjfa-test-orchestrator/SKILL.md` |
| 回测/调参 | `backtesting-frameworks/SKILL.md` |
| AI模型 | `experiment-tracking/SKILL.md` |
| Nginx | `deploy-ops/references/nginx.md` |
| 监控 | `db-metrics.js` `alert-monitor.js` `watchdog.cjs` |
| 性能 | `deploy-ops/references/perf-baseline.md` |

## 🔧 缓存排查（改动不生效时）

| 改了什么 | 重启Node | Ctrl+Shift+R | SW Unregister |
|---------|:---:|:---:|:---:|
| 前端 JS/CSS | — | ✅ | — |
| HTML | — | ✅ | — |
| 后端 JS | ✅ | — | — |
| sw.js | — | ✅ | ✅ |

## 🧠 自学习

修复后同一轮回复：P0→pre-commit-check / P1→Skill lessons.md / P2→update_memory
