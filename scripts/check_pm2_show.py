#!/usr/bin/env python3
"""Check jc-zjfa PM2 env via pm2 show"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

_, stdout, _ = SSH.exec_command('pm2 show jc-zjfa 2>&1 | head -40', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'pm2_show.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()
