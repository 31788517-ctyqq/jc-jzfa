# 部署经验教训库

> 来源: deploy-ops SKILL.md + AGENTS.md 铁律。铁律编号引用 AGENTS.md v20(#1-#20)。

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

## V18 数据链防漂移瘫痪（2026-06-21）

### 故障链

| 环节 | 根因 |
|------|------|
| ① result-verifier.js 缺失 | deploy.py DEPLOY_MAP 遗漏 `server/core/result-verifier.js` → 服务器文件不存在 |
| ② require 崩溃 | jc-sync 每日 2:00 触发 verifyYesterdayResults → Cannot find module → 进程崩溃 |
| ③ L1/L2/L3 全失效 | postMatchAudit / correctDate / correctPostMatchScores 3 层防漂移 7 天未执行 |
| ④ 半场比分污染 | 6/14-6/20 期间 500.com 返回半场比分无法自动修正 |

### 修复

| 操作 | 结果 |
|------|------|
| 补传 result-verifier.js | 恢复 L3 层 |
| pre-deploy-check 新增 DEPLOY_MAP 完整性扫描 | 自动阻断遗漏 |
| 新增 3 个遗漏模块到 DEPLOY_MAP | pk_scorer.js / token_manager.js / backfill_results.js |

### 铁律

```
1. 新增 server/core/ 模块后必须同步更新 deploy.py DEPLOY_MAP
2. pre-deploy-check.cjs 已自动扫描阻断（fatal 级别）
3. 数据链 L1→L2→L3 三层必须全部可用，任一失效即告警
```

## V19 5000 并发架构改造（2026-06-21）

| 改造项 | 内容 |
|--------|------|
| Redis 客户端 | 轻量 RESP 协议实现，不可用时自动降级内存 Map，10s 重连 |
| user_plans SQLite 化 | DB 优先读 + 文件降级写，消除 5000 用户文件 I/O 瓶颈 |
| Session 三级缓存 | 内存 → Redis → DB，支持 cluster:3 共享 session |
| Nginx 高并发模板 | upstream 3 实例 + keepalive 64 + HTTP/2 + proxy_cache + limit_req |
| cluster:3 | 就绪但未切换，需先在服务器安装 Redis + 验证 |

## V19 其他关键教训（2026-06-21~22）

| 日期 | 教训 |
|------|------|
| 6/21 | **Vite dist 必须重建**：修改前端 JS（如 login.js）后只部署源文件 → 生产页面不更新。根因：Vite 构建后的 dist/ 才是实际加载的文件。铁律：`npx vite build` → `--files-only` 重新部署 dist/ |
| 6/21 | **Redis AUTH 初始化竞态**：`client.connect()` 后立即 `client.auth()` 失败 → 统计 `\r\n` 数量等待握手完成。轻量 RESP 实现需处理异步握手 |
| 6/21 | **flushCriticalWrites 残留调用**：之前改为 no-op 但调用处未同步 → 改用 `adp.markDirty()`。重构函数签名后必须搜索所有调用点 |
| 6/21 | **data-auditor 全局核查**：6 大类 18 项核查覆盖方案/比分/开奖/同步/完整性/一致性。基础项自动修复 + 严重项告警。接入 data_sync 每日 3:00 |
| 6/21 | **alert-monitor → auto_heal 闭环**：告警不再只报不治——checkRecSyncStagnant / checkEmptyPlans 检测异常后自动触发 auto_heal.checkAndHeal |
| 6/22 | **记住我 15 天 TTL**：SESSION_TTL_REMEMBER_DAYS=15，checkbox 放在密码框和协议框之间，勾选后 session 有效期从浏览器会话变为 15 天 |
| 6/22 | **首页 liveCount 正则 Bug**：`String(1).match(/进行/)` 不匹配中文 "进行中" → 改为 `Number(m.matchStatus)===1`。数字状态码不应与字符串正则混用 |
