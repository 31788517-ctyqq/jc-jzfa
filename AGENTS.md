# JC-ZJFA AGENTS Guide

> 每会话自动加载。精简核心规则 + Skill 路由，深度文档见 `.codebuddy/skills/SKILLS_INDEX.md`。

---

## 🔒 核心禁手（触犯即阻断）

| # | 禁止操作 | 替代方案 |
|---|---------|---------|
| 1 | `new Date().toISOString().slice(0,10)` | `require('./server/core/datetime').todayCN()` |
| 2 | 绕过 `database.getAdapter()` 直接写 raw | `adp.execRun/execAll/execOne` |
| 3 | 新增 PNG/SVG 图标文件 | 用 emoji 内联字符 |
| 4 | `chore: 同步所有变更` 等模糊 commit | 一个功能一个 commit |
| 5 | 在生产 master 上试验新技术栈 | 新分支 + 本地验证全通过 → 合并 |
| 6 | 不跑 `npm run preflight` 就提交 | preflight 全绿才能 commit |
| 7 | SW 缓存 HTML 页面壳 (`PAGE_SHELL`) | SW 只缓存 JS/CSS 静态资源 |
| 8 | `postbuild` 覆盖源文件 | 构建产物与源码严格分离 |
| 9 | Windows 原生 `scp`/`ssh` | `python deploy.py --fast` |
| 10 | 临时脚本永久留在仓库 | 用完即删，或归档到 `scripts/perf/` |

---

## 📡 Skill 路由（强制判定）

每次会话中分析用户任务，**按以下顺序判定**是否需加载 Skill：

```
1. 涉及服务器/部署/Nginx/PM2/缓存/404/资源路径？
   → use_skill deploy-ops

2. 涉及数据抓取/修复/回填/同步/ETL？
   → use_skill data-pipeline

3. 涉及测试/质量门禁/覆盖率/E2E？
   → use_skill jczjfa-test-orchestrator

4. 涉及方案参数调优/AI模型切换/prompt变更？
   → use_skill backtesting-frameworks + experiment-tracking （必须双加载）
   → 两个 Skill 的 description 已互相引用，任一个触发时都会提示加载另一个

5. 涉及 CSS/颜色/样式/布局？
   → 先检查 preview/css/app.css 顶部 Design Tokens（--jczj-* 变量）

6. 涉及 require/import/新增模块？
   → 执行依赖追踪（检查 deploy.py DEPLOY_MAP）

7. 涉及一般开发规范（禁手/datetime/预提交）？
   → 本文件 §10 禁手 已包含, 无需额外加载 Skill
```

## 🤖 Agent 使用指引

| 场景 | 方式 |
|------|------|
| 跨多文件搜索/全仓库扫描 | 使用 `Task` 工具调用 `code-explorer` 子代理 |
| 大型重构（需并行分析） | 使用 `team_create` 创建多 Agent 协作 |
| 日常开发/单文件修改 | 直接处理，无需 Agent |
| E2E 自动化测试 | 使用 `playwright` MCP（浏览器自动化） |
```

完整索引：`.codebuddy/skills/SKILLS_INDEX.md`

---

## ⚙️ 关键配置速查

| 项目 | 值 |
|------|-----|
| 服务器 IP | 119.23.51.159 |
| PM2 进程 | jc-sync, jc-zjfa (cluster:2) |
| 部署路径 | `/root/server/` + `/var/www/zj.100qiu.com/` |
| Nginx `/assets/` | → `miniprogram/images/`（不是 `preview/assets/`！） |
| 部署方式 | `python deploy.py --fast`（禁止 Windows 原生 scp） |
| 部署验证 | `python _verify_api.py`（4 层一键验证） |
| preflight | `npm run preflight`（7 步质量门禁） |
| 当前 stable tag | `v11.0-stable` (09d4bb09) |

---

## 📋 日常命令

```powershell
# 开发完成后
npm run lint:fix && npm run test:p0

# 提交前
npm run preflight

# 部署
python deploy.py --fast
python _verify_api.py
```

---

## 🧠 新问题自学习协议（Session 结束前执行）

当本次会话中发生任何修复/返工/故障时，AI 必须在会话结束前：

1. **判断严重度并写入对应层级**：
   - P0（阻断核心功能/部署失败）→ 追加到 `scripts/pre-commit-check.cjs` 新检查项（征得用户同意后）
   - P1（导致返工 ≥3 次）→ 追加到对应 Skill 的 `references/lessons.md`
   - P2（偶发问题）→ 调用 `update_memory` 记录

2. **更新问题追踪**：发现问题模式 → 追加到 `sucai/开发返工问题全面诊断报告.md`

3. **通知用户**：总结新学到什么 + 建议是否需要加入不可动区域或 pre-commit 检查

---

## 🗺️ 知识地图（破解 AI 上下文记忆问题）

> 每次新会话 AI 白板启动，但通过本索引可以快速定位到所有分析文档。
> **遇到以下场景时，AI 必须先 `read_file` 对应的文档获取上下文。**

### 场景 → 文档速查

| 场景 | 文档 | 内容 |
|------|------|------|
| **开发优化/规范制定** | `sucai/本地优化与规范建设计划.md` | 5 个 Phase 执行计划 + ⛔不可动区域 + 执行状态 |
| **分析为什么总返工** | `sucai/开发返工问题全面诊断报告.md` | 22 个问题的诊断 + 隐藏问题 + 根因收敛 |
| **部署上线后出问题** | `sucai/本地生产环境落差导致返工分析.md` | 12 类本地-生产差异 + feat 后 fix 链数据 |
| **发现线上功能缺失** | `sucai/被回退丢失的优化项分析.md` | 4 次 revert + 50+ 个 master 缺失的 commit |
| **想让 AI 更聪明** | `sucai/Skill与Agent自进化机制设计.md` | 三层自进化 + 自学习协议 |
| **写代码前找规范** | 本文件 §10 禁手 + §Skill 路由 | 禁止操作 + 必须加载的 Skill |
| **部署/运维** | `use_skill deploy-ops` → `references/lessons.md` | 20+ 条经验教训 |
| **测试/质量门禁** | `use_skill jczjfa-test-orchestrator` | 24 套件编排 |
| **调方案参数** | `use_skill backtesting-frameworks` + `use_skill experiment-tracking` | 回测 + 实验追踪（必须双加载） |
| **数据修复/同步** | `use_skill data-pipeline` | ETL + 回填入口统一 |

### 文档树

```
sucai/
  ├── 本地优化与规范建设计划.md          ← 🔴 主计划（先读这个）
  ├── 开发返工问题全面诊断报告.md          ← 🔴 22+6+12 问题全谱
  ├── 本地生产环境落差导致返工分析.md      ← 🟡 本地≠生产 12 类差异
  ├── 被回退丢失的优化项分析.md           ← 🟡 4 次 revert + 缺失清单
  └── Skill与Agent自进化机制设计.md      ← 🟢 三层自进化

.codebuddy/skills/
  ├── SKILLS_INDEX.md                     ← Skill 快速匹配表
  ├── deploy-ops/SKILL.md                 ← 部署速查 + references/lessons.md
  ├── jczjfa-test-orchestrator/SKILL.md    ← 测试速查
  ├── backtesting-frameworks/SKILL.md      ← 回测速查 + references/patterns.md
  ├── data-pipeline/SKILL.md              ← ETL 速查
  └── experiment-tracking/SKILL.md        ← 实验追踪速查
```

### AI 使用规则

1. **每会话启动时**：AI 已自动读取本文件（AGENTS.md），即获知全部文档索引
2. **遇到具体任务时**：根据上表 `read_file` 对应文档，获取完整上下文
3. **不确定时**：先读 `本地优化与规范建设计划.md`（主计划涵盖最全）

---

## 🚨 风险操作强制协议

### 🔒 部署必须经过确认（铁律）

部署是最高风险操作，**AI 绝对禁止自行部署（包括 --files-only 热修复）**：
1. 先展示变更清单 + dry-run 结果 + 回退 tag
2. 等待用户明确回复"确认"/"执行"/"部署"后才能执行
3. 即使全部门禁通过，也不能跳过用户确认

以下操作必须先执行备份/试运行，禁止直接执行：

| 风险等级 | 操作 | 必须 |
|:---:|------|------|
| 🔴 | 部署上线、删除文件、DB变更、PM2重启 | 备份 → dry-run → 执行 → 5层验证 |
| 🟡 | deploy.py修改、回填操作、大文件清理 | dry-run → 确认 → 执行 |
| 🟢 | 新增文件、CSS替换 | 正常提交即可 |

### 🔴 部署执行顺序

```
1. npm run preflight              # 测试全绿
2. git tag deploy-backup-YYYYMMDDHHMM  # 打回退标记
3. cp midou_data.db midou_data.db.bak  # DB备份
4. python deploy.py --dry          # 试运行
5. python deploy.py --fast         # 正式部署
6. python _verify_api.py           # 6层验证
7. 全部通过 → 宣布成功，否则 → 回滚
8. 回滚: git checkout <上tag> -- <失败文件> → python deploy.py --fast
```

详见：`use_skill deploy-ops` → 🚨 风险操作协议

---

## 🔧 本地开发时改动不生效？三层缓存排查

| 改了什么 | 需要重启Node | 需要 Ctrl+Shift+R | 需要 SW Unregister |
|---------|:---:|:---:|:---:|
| 前端 JS/CSS | — | ✅ 首次 | —（v7 dev模式跳过） |
| HTML | — | ✅ | — |
| 后端 JS | ✅ 重启 | — | — |
| sw.js | — | ✅ | ✅ F12→Application→Unregister |

### 快速清除

```
1. F12 → Application → Service Workers → Unregister
2. F12 → Application → Clear storage → Clear site data
3. Ctrl+Shift+R 强制刷新
```

### SW v7 改进

- `localhost` / `127.0.0.1` → 开发模式完全跳过 SW 缓存
- 生产模式 → 仅缓存 JS/CSS（带 `?v=` 版本戳自动刷新）
