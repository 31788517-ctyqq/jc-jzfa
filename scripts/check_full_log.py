#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 看最新30行日志
_, out, _ = SSH.exec_command('tail -30 /root/server/logs/out.log', timeout=10)
out.channel.settimeout(10)
print('=== Last 30 lines ===')
print(out.read().decode())

# 看 jc-zjfa error log
_, out, _ = SSH.exec_command('tail -20 /root/server/logs/error.log', timeout=10)
out.channel.settimeout(10)
print('=== Error log ===')
print(out.read().decode())

# Redis keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null; echo ---; redis-cli -a qcredismaster01 DBSIZE 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis keys & DBSIZE ===')
print(out.read().decode())

SSH.close()
