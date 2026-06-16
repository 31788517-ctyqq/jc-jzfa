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
