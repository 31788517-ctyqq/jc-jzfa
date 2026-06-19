# deploy-ops · 部署运维 v18

> ⚠️ 加载后必须逐项执行检查清单（禁止跳过）

---

## 🔴 强制检查清单（逐项打勾）

```
□ 1. preflight 全绿？       → npm run preflight
□ 2. Vite 构建？            → npx vite build（前端改动时）
□ 3. DB 备份？              → cp server/midou_data.db server/midou_data.db.bak
□ 4. dry-run 通过？         → python deploy.py --dry
□ 5. 用户已确认？           → 展示变更清单，等用户说"确认/执行/部署"
□ 6. 部署 + 验证？          → python deploy.py --fast && python _verify_api.py
□ 7. Playwright 截图验证？  → 导航 zj.100qiu.com → 截图 → 无 502/404
□ 8. 无 zombie 进程？       → pm2 list → 3 进程全部 online
□ 9. Watchdog 存活？        → crontab -l | grep watchdog
```

---

## ⚡ 常用命令

```powershell
python deploy.py --fast              # 全量部署
python deploy.py --fast --files-only  # 仅前端（热修复）
python deploy.py --dry                # 试运行
python _verify_api.py                 # L1-L6 验证
npx vite build                        # Vite 构建
npx jest --forceExit                  # 全量测试
```

---

## 🔑 关键规则

| 规则 | 说明 |
|------|------|
| **禁止 Windows scp/ssh** | 必须用 `deploy.py --fast`（paramiko） |
| **PROTECTED_FILES** | server/data.json 不会被上传，需 SSH 直改 |
| **Nginx /assets/** | → miniprogram/images/（不是 preview/assets/） |
| **SW 版本** | 当前 v10 — 改 sw.js 时 bump CACHE_NAME |
| **部署后重启** | 修改 server/ 时需 `pm2 restart all` |
| **PM2 变更后验证** | `pm2 list` 确认 3 进程 online，scheduler 无频繁重启 |
| **回滚** | `git checkout <tag> -- <file>` → 重新部署 |
| **sql.js 单文件 DB** | 严禁多进程并发写入，jc-zjfa instances 必须 = 1 |
| **Scheduler 内存** | `max_memory_restart: 2048M`（≤128M 会反复 OOM） |

---

## 🗺️ 关键路径

| 路径 | 用途 |
|------|------|
| `/root/server/` | Node.js 服务（PM2: jc-zjfa cluster:1, jc-sync fork:1, jc-scheduler fork:1） |
| `/var/www/zj.100qiu.com/` | Nginx Web 根目录 |
| `server/midou_data.db` | SQLite 主数据库 (300MB) |
| `preview/dist/` | Vite 构建产物 |
| `scripts/watchdog.cjs` | 进程存活监控（cron 每 5 分钟） |
| `server/core/db-metrics.js` | DB 写入成功率监控 |

---

## 📋 新增文件需注册

修改 `deploy.py` 的 `DEPLOY_MAP` 添加新文件映射，否则部署时丢失。

---

## 🆘 Fallback（检查清单某项不通过时）

| 失败项 | 降级路径 |
|--------|---------|
| preflight 不通过 | 修复 lint/test 问题 → 重新 preflight |
| dry-run 不通过 | 检查 deploy.py 语法 + DEPLOY_MAP 映射 |
| 部署后 _verify_api 失败 | SSH 直连 → `pm2 status` + `tail /var/log/nginx/error.log` |
| Playwright 截图超时 | 检查服务器连通性 → `curl -H "Host: zj.100qiu.com" http://119.23.51.159/` |
| Scheduler 频繁重启 (>5次) | 检查 `max_memory_restart` ≥ 2048M，检查 DB 完整性 |

> 所有 fallback 均失败 → 中止部署，向用户报告瓶颈。

---

深度文档：`.codebuddy/skills/deploy-ops/references/lessons.md`
