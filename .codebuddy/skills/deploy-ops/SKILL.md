---
name: deploy-ops
description: >
  JC-ZJFA 部署运维。触发词：部署/deploy/上传/服务器/nginx/PM2/重启/502/缓存/cache/版本戳/SW/404/静态资源/图标路径/改完不生效/资源文件/CDN/MD5。加载后必须执行检查清单。
---

# 部署运维 · 速查卡

## 服务器

- IP: `119.23.51.159` | PM2: `jc-sync` + `jc-zjfa`(cluster:2)
- 双路径: `/root/server/`(PM2) + `/var/www/zj.100qiu.com/`(Nginx)
- 部署: `python deploy.py --fast`（**禁止** Windows 原生 scp/ssh）
- 验证: `python _verify_api.py`

## Nginx 路径映射

| URL | 目录 |
|-----|------|
| `/assets/` | `miniprogram/images/` ⚠️ 不是 preview/assets/ |
| `/preview/` | `preview/` |
| `/api` | proxy_pass → `:3000` |

详情: `references/nginx.md`

## 强制检查清单（⚠️ 加载本 Skill 后必须逐项执行）

### 部署前
- [ ] 依赖追踪: 新增 `require()` 的模块是否在 `deploy.py` 范围？
- [ ] npm 依赖: 新增的包是否已在服务器 `npm install`？
- [ ] 本地验证 4 项: `node -c` + index.html 无 dist + sw.js 无 PAGE_SHELL + 关键字符串

### 部署后
- [ ] L1: PM2 两个进程都是 online？
- [ ] L2: `curl :3000/api/health` → 200？
- [ ] L3: `curl -H "Host:zj.100qiu.com" :80/api/health` → 200？
- [ ] L4: 业务 API(match-list) → code=0 + 数据非空？
- [ ] L5: 浏览器验证：SW 未拦截、无 404 破图

## 故障速查

| 症状 | 排查 |
|------|------|
| match-list 全线 500 | 模块依赖遗漏 → `pm2 logs --lines 30 --nostream` 查 Cannot find module |
| 部署后不生效 | 多层缓存 → Nginx reload + SW 版本 + `?v=` 参数 |
| 502 Bad Gateway | 必须带 `Host: zj.100qiu.com` 头 |
| 功守道 404 | 双路径未同步 → `/root/server/gongshoudao/` cp → `/var/www/.../` |
| 图标 404 | `/assets/` → `miniprogram/images/`，优先用 emoji |

## 深度文档

- `references/nginx.md` — Nginx 配置详解 + 目录结构
- `references/lessons.md` — 20+ 条经验教训
- `references/sqlite-import.md` — SQLite 大数据导入避坑指南
