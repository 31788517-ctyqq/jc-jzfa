#!/usr/bin/env python3
"""Check jc-zjfa error log for auth failures"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

_, stdout, _ = SSH.exec_command('tail -50 /root/server/logs/error.log 2>&1', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'auth_errors.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()
