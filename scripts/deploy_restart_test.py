#!/usr/bin/env python3
"""部署 + 重启 + 等15秒 + 看Redis日志 + 测试API"""
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 1. 上传
sftp = SSH.open_sftp()
sftp.put('server/core/redis-client.js', '/root/server/core/redis-client.js')
sftp.put('server/ai_daemon.js', '/root/server/ai_daemon.js')
print('Uploaded files')

# 2. pm2 delete + start
_, out, _ = SSH.exec_command('pm2 delete jc-zjfa 2>/dev/null; sleep 2; pm2 start /root/server/ecosystem.config.json --only jc-zjfa 2>&1', timeout=30)
out.channel.settimeout(30)
print('pm2 restart: OK')

# 3. 等 15 秒
time.sleep(15)

# 4. 查日志
_, out, _ = SSH.exec_command('tail -80 /root/server/logs/out.log | grep redis', timeout=10)
out.channel.settimeout(10)
print('=== Redis logs ===')
print(out.read().decode())

_, out, _ = SSH.exec_command('tail -5 /root/server/logs/error.log', timeout=10)
out.channel.settimeout(10)
print('=== Error logs ===')
print(out.read().decode())

# 5. 测试 API
_, out, _ = SSH.exec_command('curl -s -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d "{\\"action\\":\\"home-bundle\\",\\"dateStr\\":\\"2026-06-23\\"}" | head -c 200', timeout=30)
out.channel.settimeout(30)
print('=== home-bundle API ===')
print(out.read().decode()[:200])

# 6. Redis keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis zjfa keys ===')
print(out.read().decode())

sftp.close()
SSH.close()
