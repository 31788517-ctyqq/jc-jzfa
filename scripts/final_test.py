#!/usr/bin/env python3
"""最终验证：30次 match-list + 请求追踪"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from ssh_utils import get_ssh

ssh = get_ssh()

print('>>> Waiting 15s...')
stdin, stdout, stderr = ssh.exec_command('sleep 15', timeout=20)
stdout.read()

# 30次 match-list
print('>>> match-list 30次')
stdin, stdout, stderr = ssh.exec_command(
    'for i in $(seq 1 30); do t=$(curl -s -o /dev/null -w "%{time_total}" -X POST http://localhost:3000/api -H "Content-Type: application/json" -d \'{"action":"match-list"}\' --max-time 25 2>&1); echo "run$i:$t"; done',
    timeout=120
)
out = stdout.read().decode('utf-8', errors='replace')
print(out[:3000])

# PM2 状态
print('\n>>> PM2 status')
stdin, stdout, stderr = ssh.exec_command('pm2 list 2>&1', timeout=10)
out = stdout.read().decode('utf-8', errors='replace')
print(out[:500])

# 追踪日志
print('\n>>> req-trace logs (>100ms)')
stdin, stdout, stderr = ssh.exec_command(
    'pm2 logs jc-zjfa --lines 50 --nostream 2>&1 | grep "req-trace" | tail -10',
    timeout=10
)
out = stdout.read().decode('utf-8', errors='replace')
print(out[:1500])

ssh.close()
