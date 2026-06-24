# JC-ZJFA AGENTS Guide v20

> 铁律20条 + Skill路由 + 配置。每会话自动加载。

## 🔒 铁律

| # | 禁止 | 替代/说明 |
|---|------|------|
| 1 | `new Date().toISOString().slice(0,10)` | `datetime.todayCN()` |
| 2 | 绕过 `getAdapter()` 写raw SQL | `adp.execRun/execAll/execOne` |
| 3 | 新增PNG/SVG图标 | emoji内联 |
| 4 | 竞彩日期用 startTime | **必须用 `m.date`（期号），禁用开赛时间** |
| 5 | CSS变量替换碰数值属性 | **只替换颜色hex，禁碰px/em/rem数值** |
| 6 | 模糊commit | 一功能一commit |
| 7 | 生产master试验 | 新分支→本地→合并 |
| 8 | 不跑preflight就提交 | 全绿才能commit |
| 9 | SW缓存HTML | SW只缓存JS/CSS |
| 10 | postbuild覆盖源文件 | 产物与源码分离 |
| 11 | Windows scp/ssh | `python deploy.py --fast` |
| 12 | 临时脚本永久留 | 用完归档 `scripts/archive/` |
| 13 | sql.js多进程并发写 | instances:1，单写入者 |
| 14 | PM2变更不验证残留 | `ps aux \| grep node` |
| 15 | scheduler max_memory < 2048M | 最低2048M |
| 16 | server/core/新模块不同步DEPLOY_MAP | pre-deploy-check自动阻断 |
| 17 | 新增页面不同步main-fusion路由 | 部署前检查_ensurePage+switchTab |
| 18 | 命名链 fix→fix2→final | 一次修好或带版本号 |
| 19 | AI自行部署 | 展示清单→等确认→部署→截图验证 |
| 20 | 口头承诺/篡改测试/伪造执行/过度发挥 | TDD闭环+4段交付格式 |

## ⚡ Skill路由

| Skill | 触发词 | MUST |
|-------|--------|:---:|
| deploy-ops | 部署/Nginx/PM2/502/404/Vite/Redis/高并发 | ✅ |
| data-pipeline | 数据/抓取/ETL/回填/核查/半场比分 | ✅ |
| jczjfa-test-orchestrator | 测试/jest/playwright/preflight | ✅ |
| ai-experiments | 回测/ROI/调参/AI模型/DeepSeek/豆包 | ✅ |

排除：纯文档/纯样式/只读查询 → 跳过加载。

## ⚙️ 配置

| 项目 | 值 |
|------|-----|
| 服务器 | 119.23.51.159 |
| PM2 | jc-zjfa(c:1,1800M) / jc-sync(f,1800M) / jc-scheduler(f,2048M) |
| 部署路径 | `/root/server/` + `/var/www/zj.100qiu.com/` |
| 部署 | `python deploy.py --fast` |
| Nginx `/assets/` | → `miniprogram/images/`（非preview/assets/） |
| Redis | 轻量RESP，不可用降级内存Map |
| 分支 | `local/auth-preview` |

## 📋 命令

```
npm run preflight          # 提交前全绿
npx vite build             # 前端改动必须重建dist
python deploy.py --fast    # 需用户确认
python deploy.py --fast --files-only  # 前端文件仅部署
```

## 🔧 缓存排查

后端改→重启Node | 前端改→Ctrl+Shift+R | SW改→Unregister+Ctrl+Shift+R

## 🧠 自学习

P0→pre-commit-check | P1→Skill lessons.md | P2→update_memory
