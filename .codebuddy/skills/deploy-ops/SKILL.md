# deploy-ops

> 部署 / Nginx / PM2 / 502 / Vite / Redis / 高并发

## ⚠️ MUST 检查清单

1. `npm run preflight` 全绿（铁律 #6）
2. 展示变更清单 → 等用户确认（铁律 #19）
3. DB 备份 → `copy server/midou_data.db server/midou_data.db.bak`
4. `python deploy.py --fast` 部署（★ Phase 0 自动执行 `npm run build` 重建 dist/，无需手动）
5. Playwright 截图验证前端（铁律 #17）
6. `pm2 list` 确认 3 进程 online，无 zombie（铁律 #11）

## 关键规则

- 部署前运行 pre-deploy-check（自动检查 DEPLOY_MAP / 编码 / Vite 产物）
- 新增 `server/core/` 模块必须同步更新 `deploy.py` DEPLOY_MAP（铁律 #13）
- 新增前端页面必须检查 `main-fusion.js` 的 `_ensurePage` + `switchTab`（铁律 #14）
- `deploy.py` 中 PROTECTED_FILES 含 data.json，不上传
- Nginx `/assets/` → `miniprogram/images/`，非 preview/assets/
- 502 排查必须带 `Host: zj.100qiu.com` 头

## 参考文档（`references/`）

- `lessons.md` — 部署经验教训库
- `nginx.md` — Nginx 路径映射与配置参考
- `perf-baseline.md` — 性能优化基线
- `sqlite-import.md` — SQLite 大数据导入避坑

## Fallback

| 失败 | 降级 |
|------|------|
| preflight 不过 | 定位 → 修复 → 重跑 |
| 健康检查失败 | SSH → `pm2 status` + `cat /var/log/nginx/error.log` |
| 截图超时 | `curl -H "Host: zj.100qiu.com" http://119.23.51.159/` |
| Scheduler 频重启 | 确认 `max_memory ≥ 2048M` + DB 完整性 |
| Redis 不可用 | 自动降级内存 Map |
| 防假跑验证不通过 | 按 AGENTS.md 4 段格式强制交付 |
