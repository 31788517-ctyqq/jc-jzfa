---
name: deploy-ops
description: >
  JC-ZJFA 部署运维 Skill。涵盖服务器架构、部署流程、依赖追踪、
  静态资源管理、Nginx 路径映射、部署后验证、故障排查。
  当用户提到以下关键词时触发：部署、deploy、上传、服务器、nginx、PM2、
  重启、线上问题、404、500、缓存、静态资源、资源文件、图标、SVG。
---

# JC-ZJFA 部署运维

## 服务器架构

| 组件 | 服务器 | 路径 | 说明 |
|------|--------|------|------|
| Node.js 服务 | 119.23.51.159 | /root/server/ | PM2 管理的 Node 进程 |
| Nginx Web 根 | 119.23.51.159 | /var/www/zj.100qiu.com/ | 静态资源 + 反向代理 |
| PM2 进程 | 119.23.51.159 | jc-sync, jc-zjfa (cluster: 2) | ecosystem.config.json |
| 功守道模块 | 119.23.51.159 | /root/server/gongshoudao/ → sync → /var/www/.../server/gongshoudao/ | **双路径**：PM2 路径 + Nginx 路径 |
| SSH 密钥 | 本地 | %USERPROFILE%\.ssh\id_rsa_jczjfa | 部署脚本认证方式 |

## 部署前强制检查清单

### 1. 依赖追踪（防止模块缺失导致全线崩溃）⚠️ 最高优先级

**核心规则**：每次涉及 `require()` 变更时，必须确认被引用的模块已在部署覆盖范围内。

功守道模块当前依赖链：

```
gongshoudao/index.js
├── gongshoudao/parser.js       ✅ 在 deploy_gs.bat 上传范围
├── gongshoudao/attack.js        ✅
├── gongshoudao/goal.js          ✅
├── gongshoudao/diff.js          ✅
├── gongshoudao/score.js         ✅
├── gongshoudao/market.js        ✅
│   ├── ../core/odds-movement.js  ❌ 不在 deploy_gs.bat 默认范围！
│   └── ../core/market-overlay.js ❌ 不在 deploy_gs.bat 默认范围！
├── gongshoudao/fusion.js        ✅
└── gongshoudao/fetch.js         ✅
```

**执行检查**：

```powershell
# 1) 列出功守道模块所有外部依赖
node -e "
const fs=require('fs'),path=require('path');
function deps(f,visited=new Set()){
  if(visited.has(f) || !fs.existsSync(f+'.js') || f.includes('node_modules')) return;
  visited.add(f);
  const src=fs.readFileSync(f+'.js','utf8');
  const re = /require\('([^']+)'\)/g;
  let m;
  while((m=re.exec(src))!==null){
    if(!m[1].startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(f),m[1]);
    if(!resolved.includes('gongshoudao')) console.log('外部依赖:',resolved);
    deps(resolved,visited);
  }
}
deps(path.join('server','gongshoudao','index'));
"
```

**结论**：如果 `market.js` 新增了 `core/` 的依赖（如 odds-movement、market-overlay），必须在 `deploy_gs.bat` 中增加对应的 scp 上传命令，或使用全量部署。

### 2. 静态资源检查

- 新增图片/图标/字体等静态资源时，确认 nginx 路径映射
- **优先级**：emoji 内联字符 > CSS icon font > SVG inline > 外部文件
- 若必须使用外部文件，需额外 scp 上传到正确 nginx 目录

### 3. 部署前验证

```powershell
# 本地启动验证（推荐）
node server/index.js
# 另开终端
curl -s -X POST http://localhost:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-05-31"}' | head -20

# 无 Error/Cannot find module 即通过
```

## 部署方式与场景

### 场景 A：功守道快速迭代 → `deploy_gs.bat`

```batch
deploy_gs.bat
```

**上传文件范围**（硬编码列表，需手动维护！）：
- `server/gongshoudao/` → 8 个 js 文件 → /root/server/gongshoudao/
- `preview/js/pages/gongshoudao.js` → /var/www/zj.100qiu.com/preview/js/pages/
- `preview/js/main.js` → /var/www/zj.100qiu.com/preview/js/
- 自动 sync：/root/server/gongshoudao/ → /var/www/.../server/gongshoudao/
- 自动清除 cache.json + 重载 nginx + 重启 PM2

**何时需要手动修改 deploy_gs.bat**：
- 新增 gongshoudao/*.js 文件
- market.js 级别的外部依赖变更（core/ 文件）
- 新增前端页面

### 场景 B：全量部署 → `deploy_sftp.js`

```bash
node deploy/deploy_sftp.js   # 或 npm run deploy
```

**上传文件范围**：`deploy/deploy_sftp.js` 中 `FILES` 数组。

### 场景 C：核心模块独立上传

当 `core/` 下的模块独立变更时（不涉及功守道），需要手动 scp：

```powershell
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no ^
  server\core\odds-movement.js server\core\market-overlay.js ^
  root@119.23.51.159:/root/server/core/
```

## 部署后验证（强制）

部署完成后必须逐项验证：

```powershell
# 1) HTTP 健康检查
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" root@119.23.51.159 "curl -s http://localhost:3000/api/health"

# 2) PM2 状态（全部 online）
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" root@119.23.51.159 "pm2 status"

# 3) PM2 日志检查（无 Error/Cannot find module）
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" root@119.23.51.159 "pm2 logs --lines 15 --nostream"

# 4) 核心 API 冒烟（match-list 成功返回）
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" root@119.23.51.159 "curl -s -X POST http://localhost:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"match-list\",\"date\":\"$(date +%%Y-%%m-%%d)\"}' | head -100"

# 5) PM2 进程数确认
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" root@119.23.51.159 "pm2 list"

# 6) 浏览器刷新验证（Ctrl+Shift+R 强制刷新）
```

**验证不过的处理**：

| 症状 | 可能原因 | 排查方向 |
|------|---------|---------|
| match-list 全部 500 | 模块缺失 (Cannot find module) | `pm2 logs` 查看具体缺失模块，补充上传 |
| 功守道弹窗无数据 | market.js 依赖缺失 | 补充上传 core/odds-movement.js + market-overlay.js |
| 图标 404 | 静态资源未部署到 nginx 目录 | 补充上传到 /var/www/.../ |
| PM2 反复重启 | 语法错误或端口占用 | `pm2 logs` 查具体错误 |
| API 超时 | 数据库锁或死循环 | 检查 cache.json 是否为空/损坏 |

## Nginx 路径映射速查

详见 `references/nginx.md`。

核心映射：
| URL 前缀 | Nginx 映射目录 | 本地源目录 |
|----------|---------------|-----------|
| /assets/ | /var/www/zj.100qiu.com/miniprogram/images/ | miniprogram/images/ |
| /preview/ | /var/www/zj.100qiu.com/preview/ | preview/ |
| /api | proxy_pass → http://localhost:3000 | server/ |
| /server/ | /var/www/zj.100qiu.com/server/ | server/ |

## SSH 连接参考

```powershell
# 连接服务器
ssh -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa root@119.23.51.159

# SCP 上传文件
scp -i "%USERPROFILE%\.ssh\id_rsa_jczjfa" -o StrictHostKeyChecking=no -o HostKeyAlgorithms=ssh-rsa,ssh-dss -o PubkeyAcceptedKeyTypes=ssh-rsa ^
  <local_file> root@119.23.51.159:<remote_path>
```

## 常见故障排查

### match-list 全线 500

最常见原因：新增模块 `require()` 了不在部署范围的文件。排查：

```bash
ssh root@119.23.51.159 "pm2 logs jc-zjfa --lines 20 --nostream" | findstr "Error\|Cannot find"
```

找到缺失文件后，补充 scp 上传。

### 功守道弹窗图标 404

功守道弹窗中使用的图标文件（如 gs-*.png）需要放在 nginx 能访问的目录。已知映射：
- `/assets/` → `/var/www/zj.100qiu.com/miniprogram/images/`
- 如果文件放在 `preview/assets/`，nginx `/assets/` 路径无法访问

**解决方案**：优先使用 emoji 内联字符替代文件图标。

### cache.json 数据过期

功守道 cache.json 过期会导致弹窗无数据：
```bash
ssh root@119.23.51.159 "rm -f /root/server/gongshoudao/cache.json /var/www/zj.100qiu.com/server/gongshoudao/cache.json"
pm2 restart all   # 重启后会自动重建缓存
```
