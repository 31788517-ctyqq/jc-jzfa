#!/usr/bin/env python3
"""完全重启 jc-zjfa (pm2 delete + start)"""
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 1. pm2 delete jc-zjfa + start fresh
_, out, _ = SSH.exec_command('pm2 delete jc-zjfa 2>/dev/null; sleep 1; pm2 start /root/server/ecosystem.config.json --only jc-zjfa 2>&1; sleep 3; pm2 list', timeout=30)
out.channel.settimeout(30)
print('=== pm2 delete+start ===')
print(out.read().decode()[:800])

# 2. 等几秒后看日志
_, out, _ = SSH.exec_command('sleep 5; tail -30 /root/server/logs/out.log | grep -E "redis|AUTH|SELECT"', timeout=20)
out.channel.settimeout(20)
print('=== Redis/AUTH logs ===')
print(out.read().decode())

SSH.close()
