#!/usr/bin/env python3
"""部署 redis-client.js + 完全重启 jc-zjfa"""
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh
import paramiko

SSH = get_ssh()

# 1. 上传 redis-client.js
sftp = SSH.open_sftp()
sftp.put('server/core/redis-client.js', '/root/server/core/redis-client.js')
print('Uploaded redis-client.js')
sftp.close()

# 2. pm2 delete jc-zjfa + start fresh
_, out, _ = SSH.exec_command('pm2 delete jc-zjfa 2>/dev/null; sleep 2; pm2 start /root/server/ecosystem.config.json --only jc-zjfa 2>&1', timeout=30)
out.channel.settimeout(30)
r = out.read().decode()
print('pm2 restart: ' + r[:200])

# 3. 等 10 秒
time.sleep(10)

# 4. 查日志
_, out, _ = SSH.exec_command('tail -50 /root/server/logs/out.log | grep redis', timeout=10)
out.channel.settimeout(10)
print('=== Redis logs ===')
print(out.read().decode())

_, out, _ = SSH.exec_command('tail -10 /root/server/logs/error.log', timeout=10)
out.channel.settimeout(10)
print('=== Error logs ===')
print(out.read().decode())

# 5. pm2 list
_, out, _ = SSH.exec_command('pm2 list', timeout=10)
out.channel.settimeout(10)
pm2out = out.read().decode()
# 只取 jc-zjfa 行
for line in pm2out.split('\n'):
    if 'jc-zjfa' in line or 'status' in line.lower():
        print(line)

SSH.close()
