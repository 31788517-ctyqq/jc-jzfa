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

## ⭐ 认证方式（V8.1 更新）

**两种认证方式均可连接服务器**，按可靠性排序：

| 方式 | 认证凭据 | 优势 | 劣势 |
|------|---------|------|------|
| **Python `deploy.py`**（推荐） | 密钥 → 密码自动回退 | 逐文件 MD5 验证、自动重试、Python paramiko 无兼容问题 | 需要 Python 环境 |
| SSH 密钥 | `%USERPROFILE%\.ssh\id_rsa_jczjfa` | 免密码 | Windows 原生 `ssh`/`scp` 存在兼容问题（见下文） |
| 密码认证 | `.env.deploy` 文件 | 简单可靠 | 需维护密码文件 |

### ⚠️ Windows 原生 SSH/SCP 兼容性故障（重大经验教训）

**问题表象**：
- `scp` / `ssh` 卡住不动，长时间无输出
- `ping` 通（10ms），端口 22 开放
- 看似"网络超时"，**实际是 Windows OpenSSH 与旧版 SSH 服务器 (ssh-rsa) 的加密握手协商失败**

**根因**：
- 服务器运行较老版本的 SSH（仅支持 `ssh-rsa` 算法）
- Windows 10/11 内置 OpenSSH 默认禁用 `ssh-rsa`（认为不安全）
- 即使添加 `-o HostKeyAlgorithms=+ssh-rsa` 参数，某些版本仍握手失败

**解决方案**：
```
❌ 不要用：scp -i key file root@119.23.51.159:/path
❌ 不要用：ssh -i key root@119.23.51.159 "command"
✅ 要用：python deploy.py --fast          （全量部署）
✅ 要用：python deploy.py --files-only    （仅前端文件）
```

`deploy.py` 使用 Python `paramiko` 库，自带 SSH 协议实现，不受 Windows OpenSSH 版本影响。

---

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
- 若必须使用外部文件，需额外上传到正确 nginx 目录

### 3. 部署前验证

```powershell
# 本地启动验证（推荐）
node server/index.js
# 另开终端
curl -s -X POST http://localhost:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-06-03"}' | head -20

# 无 Error/Cannot find module 即通过
```

---

## 部署方式与场景

### ⭐ 推荐方式：全量部署 → `python deploy.py --fast`

```powershell
cd e:\JC-ZJFA
python deploy.py --fast
```

**特点**：
- `--fast` 跳过环境检查和备份（提速 50%），但保留逐文件 MD5 验证
- 自动处理密钥 / 密码双通道认证
- 上传完成 → Nginx reload → PM2 重启 → 健康检查 → 自动验证
- 155+ 文件，逐文件独立 MD5 校验，失败自动重试

**其他选项**：

| 命令 | 说明 |
|------|------|
| `python deploy.py --fast` | 快速全量部署（推荐日常） |
| `python deploy.py` | 完整部署（含备份 + 环境检查） |
| `python deploy.py --files-only` | 仅部署前端静态文件，不重启 PM2 |
| `python deploy.py --clear-gs-cache` | 强制清除功守道缓存 |
| `python deploy.py --dry` | 试运行，列出待部署文件不实际上传 |

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

### 场景 B：单文件紧急修复

```powershell
# 使用 Python 一行命令（绕过 Windows scp 兼容问题）
python -c "
from deploy import HOST, USER, PASS
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=10)
sftp = ssh.open_sftp()
sftp.put('preview/js/pages/backtest.js', '/var/www/zj.100qiu.com/preview/js/pages/backtest.js')
sftp.put('preview/js/pages/backtest.js', '/root/server/preview/js/pages/backtest.js')
sftp.close()
ssh.close()
print('Done')
"
```

---

## 部署后验证（V8.1 重写）⭐

### 验证原则

部署验证不是"有没有 200"那么简单。验证分 4 层，必须全部通过：

```
┌────────────────────────────────────────┐
│ Layer 4: 业务 API 验证                  │
│  → prediction-backtest 等核心 API 冒烟  │
│  → 确认返回值结构正确，非空             │
├────────────────────────────────────────┤
│ Layer 3: HTTP 代理链路验证              │
│  → 外网带 Host 头访问 API               │
│  → 确认 Nginx proxy_pass 正常          │
├────────────────────────────────────────┤
│ Layer 2: Node 进程存活验证              │
│  → 内部 curl localhost:3000             │
│  → PM2 status 确认 online               │
├────────────────────────────────────────┤
│ Layer 1: 文件部署验证                   │
│  → deploy.py 内置 MD5 复验（已完成）     │
│  → PM2 日志检查无 Cannot find module    │
└────────────────────────────────────────┘
```

### 一键验证脚本（推荐）

使用项目根目录下的 `_verify_api.py` 进行快速验证：

```powershell
cd e:\JC-ZJFA
python _verify_api.py
```

### 验证失败对照表

| 症状 | 可能原因 | 排查方向 |
|------|---------|---------|
| L1 PM2 状态非 online | 进程崩溃/语法错误 | `pm2 logs jc-zjfa --lines 30` |
| L2 内部健康检查失败 | Node 未监听 3000 / 启动卡住 | 检查端口 `ss -tlnp \| grep 3000` |
| L2 OK 但 L3 失败（502） | Nginx 代理未指向正确的 server_name | 检查 nginx conf，确认 `server_name` 匹配 |
| L3 返回 404（非 502） | Express 路由不匹配，但代理通了 | 404 表示链路正常但路径写错 |
| L4 API code≠0 | 业务逻辑错误/数据库问题 | `pm2 logs` 查具体错误栈 |
| PM2 日志有 `Cannot find module` | 模块遗漏未部署 | 补充上传对应 `server/core/xxx.js` |
| API 超时 | 数据库锁/死循环/外部 API 无响应 | 检查 `midou_data.db` 是否损坏 |

### ⚠️ 502 Bad Gateway 专查流程

502 是最常见的部署后症状之一，排查思路：

```
502 Bad Gateway 出现
│
├─ 第一步：确认 Node 是否在跑
│   ssh → pm2 status → online? 
│   ├─ 否 → pm2 restart jc-zjfa
│   └─ 是 → 下一步
│
├─ 第二步：内部直连测试
│   ssh → curl :3000/api/health  
│   ├─ 有响应 → Node 正常，问题在 Nginx
│   └─ 无响应/超时 → Node 进程假死，需要 pm2 restart
│
├─ 第三步：Nginx 代理测试（⚠️ 必须带 Host 头！）
│   ssh → curl -H "Host: zj.100qiu.com" http://127.0.0.1/api/health
│   ├─ 200 → Nginx 代理也正常，问题在外层网络
│   └─ 502/404 → Nginx proxy_pass 配置有问题
│
└─ 第四步：从外部验证（必须带 Host 头）
    python -c "import requests; print(requests.get('http://119.23.51.159/api/health', headers={'Host':'zj.100qiu.com'}, timeout=10).text)"
```

**关键经验**：从外网按 IP 访问时，Nginx 需要 `Host: zj.100qiu.com` 头才能匹配到正确的 server block。不带 Host 头会被路由到默认 server block（返回 502）。

---

## Nginx 路径映射速查

详见 `references/nginx.md`。

核心映射：
| URL 前缀 | Nginx 映射目录 | 本地源目录 |
|----------|---------------|-----------|
| /assets/ | /var/www/zj.100qiu.com/miniprogram/images/ | miniprogram/images/ |
| /preview/ | /var/www/zj.100qiu.com/preview/ | preview/ |
| /api | proxy_pass → http://localhost:3000 | server/ |
| /server/ | /var/www/zj.100qiu.com/server/ | server/ |

---

## 常见故障排查

### match-list 全线 500

最常见原因：新增模块 `require()` 了不在部署范围的文件。排查：

```powershell
# 从服务器查错误日志（通过 Python paramiko 而非 Windows SSH）
python -c "
from deploy import HOST, USER, PASS
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)
stdin, stdout, stderr = ssh.exec_command('pm2 logs jc-zjfa --lines 20 --nostream 2>&1')
print(stdout.read().decode(errors='replace'))
ssh.close()
"
```

找到缺失文件后，使用 `deploy.py --fast` 全量部署（自动覆盖所有文件）。

### 功守道弹窗图标 404

功守道弹窗中使用的图标文件（如 gs-*.png）需要放在 nginx 能访问的目录。已知映射：
- `/assets/` → `/var/www/zj.100qiu.com/miniprogram/images/`
- 如果文件放在 `preview/assets/`，nginx `/assets/` 路径无法访问

**解决方案**：优先使用 emoji 内联字符替代文件图标。

### cache.json 数据过期

功守道 cache.json 过期会导致弹窗无数据：

```powershell
python deploy.py --clear-gs-cache
```

### SQLite 大数据导入陷阱（V8.2 重大教训）⚠️

**场景**：需要将 7MB gzip 压缩的 SQL dump（52K 条 INSERT、45K 行）导入服务器 SQLite，过程中踩了 4 个连环坑，每个都导致"无报错但 0 行"或"极慢"。

#### 坑 1: SQL 中换行符是字面量 `\n`

**表象**：按常规方式 `gzip -dc dump | sqlite3 db` 运行 2 秒完成，但表里 0 行。

**根因**：dump 文件中换行是字面量反斜杠-n（两个字符 `\` + `n`），不是真换行符（0x0A）。SQLite 将 `DELETE FROM t;\nINSERT INTO t VALUES...` 整体当作一条无效语句跳过，无任何报错。

**排查方法**：
```python
import gzip
data = gzip.open('dump.sql.gz', 'rt').read()
# 先看20行确认格式
lines = data.split('\n')
print(f'总行数: {len(lines)}, 前3行: {lines[:3]}')
# 如果总行数远小于预期（如 1 行），说明换行符是字面量
```

**修复**：
```python
# 本地解压 → 修复 → 重压缩（不要改压缩后的二进制！）
fixed = data.replace('\\n', '\n')
with gzip.open('fixed.sql.gz', 'wt') as f:
    f.write(fixed)
```

#### 坑 2: 表未创建就导入

**表象**：`sqlite3 db < dump` 报 5 万行 `no such table`。

**根因**：dump 只含 `DELETE` + `INSERT` 语句，不含 `CREATE TABLE`。导入前必须手动建表。

**修复规律**：先获取本地 DB 的 DDL，再到服务器建表：
```python
# 本地获取 CREATE TABLE
import sqlite3
db = sqlite3.connect('local.db')
for t in ['table1', 'table2']:
    ddl = db.execute(f"SELECT sql FROM sqlite_master WHERE name='{t}'").fetchone()
    print(ddl[0] + ';')
```

#### 坑 3: 无事务包裹 → 极慢

**表象**：52K 条 INSERT 单条提交，每条触发一次 fsync，预计 14 小时才能完成。

**根因**：`gzip -dc | sqlite3 db` 的每条 INSERT 是独立事务，SQLite 默认每次写盘都 fsync。

**修复**：
```sql
PRAGMA journal_mode=OFF;     -- 关闭 WAL journal
PRAGMA synchronous=OFF;      -- 关闭 fsync
BEGIN;
...导入数据...
COMMIT;
```

在管道中实现事务包裹的正确方式（**不是**两次 sqlite3 调用，事务只在同一连接有效）：
```bash
# ✅ 管道中事务包裹
(echo "BEGIN;"; gzip -dc dump.gz; echo "COMMIT;") | sqlite3 db

# ❌ 两次调用事务失效！
sqlite3 db "BEGIN;"
gzip -dc dump | sqlite3 db  # 这是另一个连接，看不到 BEGIN
sqlite3 db "COMMIT;"
```

#### 坑 4: Shell 嵌套引号冲突

**表象**：`sh -c` 中嵌套单引号导致命令解析失败，报 `No such file or directory`。

**根因**：命令 `sh -c '(echo 'BEGIN;'; gzip -dc dump; echo 'COMMIT;') | sqlite3 db'` 中，外层 `sh -c '...'` 和内层 `echo '...'` 的单引号互相干扰。

**修复**：放弃管道写命令，改为 **写脚本文件到服务器再执行**：
```python
# Python paramiko: 写 shell 脚本到服务器，避免引号地狱
script = """#!/bin/sh
sqlite3 /root/server/midou_data.db "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;"
echo "BEGIN;" > /tmp/_import.sql
gzip -dc /tmp/dump.sql.gz >> /tmp/_import.sql
echo "COMMIT;" >> /tmp/_import.sql
sqlite3 /root/server/midou_data.db < /tmp/_import.sql
rm -f /tmp/_import.sql
"""
# 用 heredoc 写入（避免引号问题）
ssh.exec_command("cat > /tmp/_import.sh << 'HEREDOC_END'\n" + script + "HEREDOC_END")
ssh.exec_command("chmod +x /tmp/_import.sh")
ssh.exec_command("nohup /tmp/_import.sh > /tmp/_log 2>&1 &")
```

#### 坑 5: 无进度监控 → 干等无法发现问题

**表象**：长命令执行 76 秒，无任何输出，不知道是卡死、报错、还是正常进行中。

**修复**：后台异步执行 + 轮询进度：
```python
# 后台执行
ssh.exec_command("nohup /tmp/_import.sh > /tmp/_log 2>&1; echo $? > /tmp/_exitcode &")

# 每 2 秒轮询 DB 大小 + 行数
for i in range(300):
    time.sleep(2)
    size = cmd("stat -c%s /root/server/midou_data.db")
    rows = cmd("sqlite3 /root/server/midou_data.db 'SELECT COUNT(*) FROM table'")
    print(f'\r  DB: {size} bytes, rows: {rows}', end='')
    
    # 检查进程是否结束
    if cmd("ps aux | grep _import.sh | grep -v grep | wc -l") == '0':
        break
```

#### 完整正确流程总结

```
1. 本地验证 dump 格式（换行符是否正确）
2. 本地修复 → 修复后重压缩
3. 上传到服务器
4. 先建表（CREATE TABLE IF NOT EXISTS）
5. 写 shell 脚本到服务器（事务包裹 + PRAGMA 加速）
6. nohup 后台执行 + 轮询进度
7. 验证行数 → 确认后清理临时文件 → PM2 重启
```

**效果对比**：52K 条 INSERT → 从事务包裹前 14 小时 → 事务包裹后 **秒级完成**，DB 从 3MB → 30MB。

---

## SSH 连接参考（Python 方式）

```powershell
# Python 执行远程命令（推荐，无兼容问题）
python -c "
from deploy import HOST, USER, PASS
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)
stdin, stdout, stderr = ssh.exec_command('pm2 status')
print(stdout.read().decode())
ssh.close()
"
```

### 内部自检命令速查

| 操作 | 内部命令 |
|------|---------|
| 检查 Node 是否在跑 | `curl -s :3000/api/health` |
| 检查 Nginx 代理链路 | `curl -s -H "Host: zj.100qiu.com" http://127.0.0.1/api/health` |
| 检查端口监听 | `ss -tlnp \| grep 3000` |
| 检查 PM2 状态 | `pm2 status` |
| 查看 PM2 错误日志 | `pm2 logs jc-zjfa --lines 30 --nostream 2>&1 \| grep -i "error\|cannot find"` |
| 检查 nginx 配置 | `nginx -t` |
| 重启 PM2 | `pm2 restart jc-zjfa && sleep 3` |

---

## 经验教训索引（跨会话知识积累）

| 日期 | 教训 | 知识锚点 |
|------|------|---------|
| V7.0 | 功守道 `market.js` 依赖 `core/odds-movement.js` + `core/market-overlay.js`，部署遗漏导致 match-list 全线 500 | 依赖追踪必须执行 |
| V7.0 | Nginx `/assets/` 映射到 `miniprogram/images/`，不是 `preview/assets/` | Nginx 路径映射表 |
| V8.0 | `prediction_log.js` 绕过 database.js 适配器直接写 raw 实例，PM2 重启后数据丢失 | 数据库持久化规则 |
| **V8.1** | **Windows 原生 `scp`/`ssh` 与旧版 SSH 服务器 (ssh-rsa) 握手失败，表现为长时间卡住** | **登录方式章节** |
| **V8.1** | **`deploy.py` 使用 Python paramiko 绕过所有 Windows SSH 兼容问题，是目前最可靠的部署方式** | **推荐部署方式** |
| **V8.1** | **两种认证方式都可连接服务器：密钥 (`id_rsa_jczjfa`) + 密码 (`.env.deploy`)** | **认证方式章节** |
| **V8.1** | **502 Bad Gateway 排查：从 4 层验证递进排查，外网访问必须带 `Host: zj.100qiu.com` 头** | **502 Bad Gateway 专查流程** |
| **V8.1** | **Health check 200 不代表功能正常：需要验证业务 API 的返回值结构（code=0 + 数据非空）** | **验证分为 4 层** |
| **V8.1** | **PM2 `online` 不等于服务就绪：重启后服务可能需要 3-8 秒才完全启动，需等待后验证** | **PM2 重启后验证** |
| V8.1 | 新增页面必须同步检查 `main-fusion.js` 的 `_ensurePage` 和 `switchTab` 是否包含新页面路由 | AGENTS.md §7 |
| **V8.2** | **SQL dump 导入 4 连坑：字面量 `\n`、表未建、无事务、shell 引号冲突，76 秒导入变秒级的技术细节** | **SQLite 大数据导入陷阱** |
