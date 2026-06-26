#!/usr/bin/env python3
"""修复 home-bundle 冷启动 — TTL + warmup POST"""
import paramiko, os

HOST = "119.23.51.159"
KEY = os.path.expanduser("~/.ssh/id_rsa_jczjfa")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username="root", key_filename=KEY, timeout=10, port=22,
            look_for_keys=False, allow_agent=False,
            disabled_algorithms={'pubkeys': ['rsa-sha2-256', 'rsa-sha2-512']})

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    return stdout.read().decode('utf-8', errors='replace').strip()

# 1. 备份
print("=== 备份 ===")
run("cp /root/server/index.js /root/server/index.js.bak_coldstart_20260624")
print("  已备份 index.js")

# 2. 获取 TTL 行号
print("\n=== 当前 TTL ===")
out = run("grep -n 'HOME_BUNDLE_CACHE_TTL' /root/server/index.js")
print(out)

# 3. 直接 Python 修改文件
sftp = ssh.open_sftp()
with sftp.file('/root/server/index.js', 'r') as f:
    content = f.read().decode()

# Fix 1: TTL 10min → 30min
old_ttl = 'const HOME_BUNDLE_CACHE_TTL = 10 * 60 * 1000'
new_ttl = 'const HOME_BUNDLE_CACHE_TTL = 30 * 60 * 1000'
content = content.replace(old_ttl, new_ttl)

# Fix 2: 确保 warm_api_cache 预热 home-bundle
# 找 warm_api_cache 中的 warm 列表
old_warm = "const warmEndpoint = async (action) => {"
new_warm = """const warmEndpoint = async (action, bodyData) => {
          // 使用 POST 确保命中正确的 API handler
          const postData = JSON.stringify(bodyData || { action, date });
          const options = {
            hostname: '127.0.0.1', port: 3000,
            path: '/api', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 30000
          };
          return new Promise((resolve) => {
            const req = http.request(options, (res) => {
              let body = '';
              res.on('data', (chunk) => { body += chunk; });
              res.on('end', () => {
                resolve(true);
              });
            });
            req.on('error', (e) => { resolve(false); });
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write(postData);
            req.end();
          });"""
content = content.replace(old_warm, new_warm)

# Fix 3: 找 warm 调用列表，确保 home-bundle 在其中
# 找 warmEndpoint 的调用
out = run("grep -n 'warmEndpoint' /root/server/scheduler_v2.js")
print(f"\n  warmEndpoint 调用: {out[:300]}")

# scheduler_v2 中的 warm
sftp2 = ssh.open_sftp()
with sftp2.file('/root/server/scheduler_v2.js', 'r') as f:
    sc_content = f.read().decode()

# 备份
run("cp /root/server/scheduler_v2.js /root/server/scheduler_v2.js.bak_coldstart_20260624")

# Fix scheduler_v2 warmup to use POST
old_scheduler_warm = """const warmEndpoint = async (action) => {
          return new Promise((resolve) => {
            const url = '/api?action=' + action + '&date=' + date;
            const req = http.get({ hostname: '127.0.0.1', port: 3000, path: url, timeout: 30000 }, (res) => {
              let body = '';
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () => {
                const brief = body.slice(0, 200).replace(/\\s+/g, ' ');
                logger.info('[warm] ' + action + ' --> ' + res.statusCode + ' (' + brief.length + 'B)');
                resolve(true);
              });"""

new_scheduler_warm = """const warmEndpoint = async (action) => {
          const postData = JSON.stringify({ action, date });
          const options = {
            hostname: '127.0.0.1', port: 3000,
            path: '/api', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
            timeout: 30000
          };
          return new Promise((resolve) => {
            const req = http.request(options, (res) => {
              let body = '';
              res.on('data', (chunk) => { body += chunk; });
              res.on('end', () => {
                resolve(true);
              });"""

if old_scheduler_warm in sc_content:
    sc_content = sc_content.replace(old_scheduler_warm, new_scheduler_warm)
    
    # 同时移除 GETheader 中后续的 .on error + .on timeout + req.write + req.end
    # 这些需要通过替换完整的函数块
    # 找到 req.write/req.end 的旧代码并替换
    sc_content = sc_content.replace(
        "            req.on('error', () => {});\n            req.end();",
        "            req.on('error', () => { resolve(false); });\n            req.on('timeout', () => { req.destroy(); resolve(false); });\n            req.write(postData);\n            req.end();"
    )
    print("  scheduler_v2 warmup 已改为 POST")

# 确保 home-bundle 在预热列表中
# 找 warm 调用
import re
warm_calls = re.findall(r'warmEndpoint\([\'"]([^\'"]+)[\'"]', sc_content)
print(f"  预热列表: {warm_calls}")

if 'home-bundle' not in str(warm_calls):
    # 在第一个 warmEndpoint 调用后插入
    sc_content = sc_content.replace(
        "await Promise.all([",
        "await Promise.all([\n          warmEndpoint('home-bundle'),"
    )
    print("  已添加 home-bundle 到预热列表")

# 写回
with sftp.file('/root/server/index.js', 'w') as f:
    f.write(content.encode())
with sftp2.file('/root/server/scheduler_v2.js', 'w') as f:
    f.write(sc_content.encode())
sftp.close()
sftp2.close()

# 语法检查
print("\n=== 语法检查 ===")
out = run("cd /root/server && node -c index.js 2>&1")
print(f"  index.js: {out if out else 'OK'}")
out = run("cd /root/server && node -c scheduler_v2.js 2>&1")
print(f"  scheduler_v2.js: {out if out else 'OK'}")

# 重启 scheduler
print("\n=== 重启 scheduler ===")
out = run("pm2 restart jc-scheduler 2>&1")
print(f"  {str(out[:200]).encode('ascii','replace').decode()[:200]}")

print("\n=== 手动预热测试 ===")
import time
time.sleep(3)
out = run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"warm_api_cache\"}' 2>&1 | head -5")
print(out[:500])

ssh.close()
print("\n修复完成!")
