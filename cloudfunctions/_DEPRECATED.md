# cloudfunctions/ — 已废弃

> **迁移日期**: 2026-05-28  
> **原因**: 项目架构已从「微信云开发 CloudBase」迁移至「自建 Express + PM2」服务器

## 迁移对照

| 云函数 (废弃) | 新位置 |
|---------------|--------|
| `login-midou` | `server/core/midou.js` → `login()` |
| `fetch-match-list` | `server/core/midou.js` → `fetchMatches()` |
| `fetch-recommend` | `server/core/midou.js` → `fetchRecommends()` |
| `scheduled-crawl` | `server/data_sync.js` (PM2: jc-sync) |
| `calc-daily-hit-rate` | `server/database.js` → `getHitRateStats()` |
| `get-match-data` | `server/index.js` → POST `/api` |
| `init-database` | `server/database.js` → `initDatabase()` |

## 当前服务器架构

```
Nginx :80/:443 → proxy → Express :3000
  ├─ /             → preview/  (静态 SPA)
  ├─ /api          → server/index.js (REST API)
  └─ /health       → 健康检查

PM2:
  ├─ jc-zjfa       → node index.js (Express)
  └─ jc-sync       → node data_sync.js (数据同步守护进程)
```

## 保留用途

此目录保留作为：
1. **开发文档参考** — 各云函数的 API 接口设计
2. **应急回退** — 如需切回 CloudBase 可参考原始实现
3. **新成员学习** — 理解项目最初的设计思路

如需恢复 CloudBase 模式，参考 `技术开发文档.md` 第 8-12 章。
