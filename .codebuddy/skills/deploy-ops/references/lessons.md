# 部署经验教训库

> 来源: deploy-ops SKILL.md 历史记录 + AGENTS.md 教训库

## 依赖追踪

| 日期 | 教训 |
|------|------|
| V7.0 | `market.js` 依赖 `core/odds-movement.js` + `core/market-overlay.js`，部署遗漏 → match-list 全线 500 |
| V9.2 | `sync_live_500.js` / `data_sync.js` 依赖 `core/ingestion-guard.js`，遗漏 → 500.com 实时比分 Cannot find module |

## 数据库

| 日期 | 教训 |
|------|------|
| V8.0 | `prediction_log.js` 绕过 database.js 适配器直接写 raw 实例 → PM2 重启后数据丢失 |
| V8.2 | SQL dump 导入 4 连坑: 字面量 `\n`、表未建、无事务、shell 引号冲突 → 76 秒变秒级 |

## 部署方式

| 日期 | 教训 |
|------|------|
| V8.1 | Windows 原生 `scp`/`ssh` 与旧版 SSH (ssh-rsa) 握手失败，表现为卡住 → 用 `deploy.py` paramiko |
| V8.1 | 502 排查必须带 `Host: zj.100qiu.com` 头 |
| V8.1 | Health check 200 ≠ 功能正常，必须验证业务 API 返回值结构 |
| V8.1 | PM2 online ≠ 服务就绪，重启后需等待 3-8 秒 |

## 缓存

| 日期 | 教训 |
|------|------|
| V10.0 | SW 页面壳缓存拦截 → Nginx 文件正确但浏览器加载旧版 |
| V10.0 | Nginx open_file_cache + expires + SW + 浏览器 → 共 5 层缓存需逐层失效 |

## V10.0 Phase2 Vite 灾难

- 36 个独立问题，2 个根因: SW 缓存 + postbuild 覆盖源文件
- 字符串补丁脚本修改代码 → 绝对不可靠
- Vite 不适合 32 页面存量项目 (import.meta.glob / tree-shake / chunk 分割)
- 构建产物和源码必须严格分离

## 页面路由

| 日期 | 教训 |
|------|------|
| V8.1 | 新增页面必须同步检查 `main-fusion.js` 的 `_ensurePage` 和 `switchTab` |
| V8.1 | confirm-scheme 页面由 3 文件组成，缺一不可 |

## npm 依赖

| 日期 | 教训 |
|------|------|
| V8.0 | `winston-daily-rotate-file` 本地安装未在服务器同步 → PM2 崩溃 300+ 次 → 站点不可用 10 分钟 |

## 时区

| 日期 | 教训 |
|------|------|
| V9.2 | `new Date().toISOString()` UTC 时区导致 00:00~07:59 算成前一天 |
| V9.2 | `周日009` 等竞彩编号跨周重复，回填必须带 date 维度 |

## V12 CSS 变量替换污染

| 日期 | 教训 |
|------|------|
| V12 | `6px;` `10px;` 被盲目替换为 `var(--jczj-radius-*)` → 污染了 `font-size`/`gap`/`padding`/`margin` → 全站按钮挤压变形 |
| V12 | CSS Token 替换必须**只替换颜色值的 hex**，禁止替换数值属性 |
| V12 | 前端改动必须先 Playwright 截图验证，不能直接部署 |

## V12 文件编码

| 日期 | 教训 |
|------|------|
| V12 | `deploy.py` 为 UTF-16 LE 编码 → Python 无法解析 → 部署卡住 |
| V12 | Windows 创建的 `.py` 文件默认为 UTF-16 LE (BOM)，需转换 UTF-8 |
| V12 | 部署前必须检查 deploy.py 编码（已加入 pre-deploy-check.cjs） |

## V12 data.json 保护

| 日期 | 教训 |
|------|------|
| V12 | `data.json` 在 `PROTECTED_FILES` 列表中，**从不部署**（防止本地覆盖生产数据） |
| V12 | 修复生产 data.json 必须 SSH 直接操作 + PM2 restart（60s 缓存 TTL） |
| V12 | `live.500.com` 对历史日期仅返回**半场比分**，不能作为赛果验证来源 |
| V12 | `trade.500.com/jczq/` 是 SPA，无法服务端 HTML 解析 |

## V12 部署确认协议违规

| 日期 | 教训 |
|------|------|
| V12 | CSS 热修复 (`--files-only`) 未询问确认就执行 → 违反部署协议 |
| V12 | 协议明确：`--files-only` 也是部署，没有例外 |

## Pre-commit 首次实战

| 日期 | 教训 |
|------|------|
| V12 | `pre-commit-check.cjs` 首次拦截 16 个临时脚本 → 证明自动化门禁有效 |
| V12 | 自学习协议需执行 (L1 memory + L2 lessons.md + L3 pre-commit)，AI 必须主动执行 |

## V17 sql.js 多进程竞态 + zombie 进程事故（2026-06-20）

### 故障链

| 环节 | 根因 |
|------|------|
| ① instances:4 cluster | 4 个 worker + jc-sync + jc-scheduler 共 **6 进程同时写** midou_data.db |
| ② DB 损坏 | sql.js 序列化时竞态 → 写入字节数不匹配 → DB 文件无法被系统 sqlite3 打开 |
| ③ `pm2 delete` 杀不干净 | worker 在执行 `fs.writeFileSync(284MB)` 阻塞 → PM2 kill 超时 → 标记已停但 OS 进程残存 |
| ④ zombie 进程持续写入 | PID 18285 运行 3 天，1.9GB 内存 → 与新 worker 继续竞态 → DB 反复损坏 → 全站 502 |

### 修复

| 操作 | 结果 |
|------|------|
| instances: 4 → 1 | ecosystem.config.json 单 worker |
| kill -9 zombie PID | 物理清除残留 |
| sql.js 恢复 DB | export → 验证 30 表 1118 比赛完整 → 替换 |

### 铁律

```
1. sql.js/SQLite 单文件 DB 严禁多进程并发写入
2. pm2 delete/restart 后必须 ps aux 验证无残留
3. 修复 DB 完整性必须用 sql.js（系统 sqlite3 3.6.20 不兼容新格式）
4. DB 修复后立即 cp backup，保留 corrupted 副本
```
