#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 检查 redis-client.js 版本
_, out, _ = SSH.exec_command('grep -n setTimeout /root/server/core/redis-client.js | head -5', timeout=10)
out.channel.settimeout(10)
print('=== setTimeout lines ===')
print(out.read().decode())

_, out, _ = SSH.exec_command('grep -n createConnection /root/server/core/redis-client.js', timeout=10)
out.channel.settimeout(10)
print('=== createConnection ===')
print(out.read().decode())

_, out, _ = SSH.exec_command('sed -n "140,150p" /root/server/core/redis-client.js', timeout=10)
out.channel.settimeout(10)
print('=== lines 140-150 ===')
print(out.read().decode())

SSH.close()
