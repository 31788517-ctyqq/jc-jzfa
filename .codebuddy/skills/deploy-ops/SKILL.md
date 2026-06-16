# deploy-ops · 部署运维

> ⚠️ 加载后必须逐项执行检查清单（禁止跳过）

---

## 🔴 强制检查清单（逐项打勾）

```
□ 1. preflight 全绿？       → npm run preflight
□ 2. DB 备份？               → cp server/midou_data.db server/midou_data.db.bak
□ 3. dry-run 通过？         → python deploy.py --dry
□ 4. 用户已确认？            → 展示变更清单，等用户说"确认/执行/部署"
□ 5. 部署 + 验证？          → python deploy.py --fast && python _verify_api.py
□ 6. Playwright 截图验证？  → 导航 zj.100qiu.com → 登录 → 点"我的"+"排行" → 截图 → 无 401
```

---

## ⚡ 常用命令

```powershell
python deploy.py --fast          # 部署
python deploy.py --dry            # 试运行
python deploy.py --files-only    # 仅文件（热修复）
python _verify_api.py            # L1-L6 验证
```

---

## 🔑 关键规则

| 规则 | 说明 |
|------|------|
| **禁止 Windows scp/ssh** | 必须用 `deploy.py --fast`（paramiko） |
| **PROTECTED_FILES** | server/data.json 不会被上传，需 SSH 直改 |
| **Nginx /assets/** | → miniprogram/images/（不是 preview/assets/） |
| **SW v7** | 只缓存 JS/CSS，不缓存 HTML |
| **部署后重启** | PM2: `pm2 restart all`（修改 server/ 时） |
| **回滚** | `git checkout <tag> -- <file>` → 重新部署 |

---

## 🗺️ 关键路径

| 路径 | 用途 |
|------|------|
| `/root/server/` | Node.js 服务（PM2: jc-sync, jc-zjfa cluster:2） |
| `/var/www/zj.100qiu.com/` | Nginx Web 根目录 |
| `server/midou_data.db` | SQLite 主数据库 |

---

## 📋 新增文件需注册

修改 `deploy.py` 的 `DEPLOY_MAP` 添加新文件映射，否则部署时丢失。

---

深度文档：`.codebuddy/skills/deploy-ops/references/lessons.md`
