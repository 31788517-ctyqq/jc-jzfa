# deploy-ops

## ⚠️ MUST 检查清单
1. preflight全绿 → `npm run preflight`
2. 前端改→Vite重建 → `npx vite build`
3. DB备份 → `cp server/midou_data.db server/midou_data.db.bak`
4. 用户确认 → 展示变更清单，等确认
5. 部署 → `python deploy.py --fast`
6. 截图验证 → zj.100qiu.com 无502/404/白屏
7. 无zombie → `pm2 list` 3进程online

## 关键规则
- deploy.py PROTECTED_FILES含data.json，不自动上传
- sql.js单文件DB严禁多进程并发写（铁律#13）
- Nginx `/assets/` → `miniprogram/images/`
- 新文件→DEPLOY_MAP注册（铁律#16）
- 修改前端JS→必须vite build重建dist（铁律隐含）

## 路径
`/root/server/` PM2 | `/var/www/zj.100qiu.com/` Nginx | `preview/dist/` Vite | `server/midou_data.db` 主库~300MB

## Fallback
| 失败 | 降级 |
|------|------|
| preflight不过 | 修复→重跑 |
| 健康检查失败 | SSH→pm2 status+nginx error.log |
| 截图超时 | `curl -H "Host: zj.100qiu.com" http://119.23.51.159/` |
| Scheduler频重启 | max_memory≥2048M+DB完整性 |
| Redis不可用 | 自动降级内存Map |
