#!/usr/bin/env python3
"""Run migrate_to_auth_db.js on server to sync users"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

_, stdout, stderr = SSH.exec_command('cd /root/server && node migrate_to_auth_db.js 2>&1', timeout=30)
stdout.channel.settimeout(30)
time.sleep(20)

result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'auth_migrate.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result + "\n---STDERR---\n" + err)

SSH.close()
