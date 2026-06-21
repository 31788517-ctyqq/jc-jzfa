# deploy-ops v19

## 检查清单（逐项打勾）
```
□ 1. preflight 全绿？         → npm run preflight
□ 2. Vite 构建？              → npx vite build（前端改动必须，否则dist不更新）
□ 3. DB 备份？                → cp server/midou_data.db server/midou_data.db.bak
□ 4. dry-run 通过？           → python deploy.py --dry
□ 5. 用户已确认？             → 展示变更清单，等用户说"确认/执行/部署"
□ 6. 部署验证？               → python deploy.py --fast（内置健康检查）
□ 7. Playwright 截图？        → 导航 zj.100qiu.com → 无 502/404/白屏
□ 8. 无 zombie？              → pm2 list → 3 进程全部 online
□ 9. Redis 正常？             → node -e "require('./server/core/redis-client').ping()"
```

## 关键规则
- 禁止 Windows scp/ssh → 必须 `deploy.py --fast`
- `PROTECTED_FILES` 含 `server/data.json`，不自动上传
- Nginx `/assets/` → `miniprogram/images/`
- sql.js 单文件 DB 严禁多进程并发写
- Scheduler `max_memory_restart: 2048M`
- 新增文件 → `deploy.py` DEPLOY_MAP 注册
- 修改前端 JS → `npx vite build` 重建 dist/

## 关键路径
`/root/server/` PM2工作目录 | `/var/www/zj.100qiu.com/` Nginx根目录 | `preview/dist/` Vite产物 | `server/midou_data.db` 主库~300MB

## Fallback
| 失败 | 降级 |
|------|------|
| preflight 不通过 | 修复→重新 preflight |
| dry-run 失败 | 检查 deploy.py 语法+DEPLOY_MAP |
| 健康检查失败 | SSH→pm2 status + nginx error.log |
| 截图超时 | `curl -H "Host: zj.100qiu.com" http://119.23.51.159/` |
| Scheduler 频繁重启 | max_memory_restart≥2048M、DB完整性 |
| Vite dist 缺失 | `npx vite build`→重新 `--files-only` |
| Redis 不可用 | 自动降级内存 Map，`systemctl status redis` |
