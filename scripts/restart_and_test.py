#!/usr/bin/env python3
"""Restart jc-zjfa and test login"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Restart jc-zjfa
_, stdout, _ = SSH.exec_command('pm2 restart jc-zjfa 2>&1', timeout=15)
stdout.channel.settimeout(15)
time.sleep(3)
restart_result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'restart_result.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write("RESTART:\n" + restart_result)

SSH.close()
