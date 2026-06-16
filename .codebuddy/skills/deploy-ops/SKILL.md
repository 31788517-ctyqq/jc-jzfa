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

## 🔒 部署必须经过确认（最高优先级）

**部署是高风险操作，绝对禁止 AI 自行执行。**

- 部署前必须向用户展示：变更清单 + dry-run 结果 + 回退 tag
- 必须等到用户明确回复"确认"/"执行"/"部署"后才能执行
- 即使所有检查通过，也不能跳过确认

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

## 🚨 风险操作协议（⚠️ 必须逐项执行）

### 风险等级定义

| 等级 | 示例 | 协议 |
|:---:|------|------|
| 🔴 高 | 部署、DB迁移、删除文件、PM2重启 | 备份→执行→验证→确认，禁止跳过任何步骤 |
| 🟡 中 | deploy.py改动、回填操作、新增npm包 | 先 `--dry` 试运行，确认后再执行 |
| 🟢 低 | CSS颜色替换、新增文件 | 正常流程，但保持 git 可回退 |

### 🔴 高风险操作强制流程

```
1. 备份（执行前）
   ├── DB备份: cp midou_data.db midou_data.db.$(date +%Y%m%d_%H%M).bak
   ├── 代码备份: git tag 当前commit → git push
   └── 关键文件: deploy.py 保留上一版本副本

2. 试运行
   ├── python deploy.py --dry  或  node xxx.js --dry
   └── 检查输出无明显错误

3. 执行
   └── 确认备份完成 → 执行

4. 验证（执行后）— 5层验证
   ├── L1: PM2 online
   ├── L2: curl :3000/api/health → 200
   ├── L3: curl -H "Host:zj.100qiu.com" :80/api/health → 200
   ├── L4: 业务 API (match-list) → code=0
   └── L5: 浏览器 → SW未拦截 + 无404

5. 确认
   ├── 全部通过 → 宣布成功
   └── 任一层失败 → 进入回滚流程
```

### 🔙 回滚流程

```
L1-L3 失败（服务未启动）:
  → pm2 restart all
  → 等待 10s
  → 重新验证
  → 仍失败 → git checkout 上一tag → python deploy.py --fast

L4 失败（业务API错误）:
  → pm2 logs --lines 30 查错误
  → 评估影响范围 → 决定回滚 or 快速修复

L5 失败（缓存/静态资源）:
  → SW Unregister + Nginx reload + Ctrl+Shift+R
  → 仍失败 → 检查新文件是否在 deploy.py 范围

回滚方法:
  git checkout <上一stable tag> -- <失败的文件>
  python deploy.py --fast -- <仅失败的文件>
```

### 📋 部署前检查清单（完整版）

- [ ] 代码已提交: `git status` 干净
- [ ] 测试通过: `npm run preflight` 全绿
- [ ] 备份完成: DB + 关键文件已备份
- [ ] dry-run 通过: `python deploy.py --dry` 无异常
- [ ] 依赖追踪: 新增模块在 deploy.py 范围内
- [ ] npm 依赖: 服务器已 `npm install`
- [ ] 本地验证 4 项: node -c + index.html + sw.js + 关键字符串
- [ ] 回退 tag 已打: `git tag deploy-backup-$(date +%Y%m%d%H%M)`

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
