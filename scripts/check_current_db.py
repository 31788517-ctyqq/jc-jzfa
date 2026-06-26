#!/usr/bin/env python3
"""Check current jc-zjfa instance DB mode"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Get the most recent startup lines (grep for db initialization)
_, stdout, _ = SSH.exec_command('grep -E "better-sqlite3|sql.js|初始化成功" /root/server/logs/out.log | tail -5 2>&1', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'current_db.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

# Also check pm2 restarts
_, stdout2, _ = SSH.exec_command('pm2 list 2>&1 | head -15', timeout=10)
stdout2.channel.settimeout(10)
time.sleep(3)
result2 = stdout2.read().decode('utf-8', errors='replace')

with open(output_file, 'a', encoding='utf-8') as f:
    f.write('\n---PM2---\n' + result2)

SSH.close()
