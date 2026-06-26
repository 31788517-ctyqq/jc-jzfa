#!/usr/bin/env python3
"""Check jc-zjfa startup logs"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Get full startup log (first 100 lines)
_, stdout, _ = SSH.exec_command('head -100 /root/server/logs/out.log 2>&1', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'jczjfa_startup.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()
