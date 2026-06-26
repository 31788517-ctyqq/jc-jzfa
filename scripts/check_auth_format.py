#!/usr/bin/env python3
"""Check auth.db file format"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

_, stdout, _ = SSH.exec_command('file /root/server/auth.db; echo ---; ls -la /root/server/auth.db; echo ---; head -c 16 /root/server/auth.db | od -A x -t x1z; echo ---; wc -c /root/server/auth.db', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'auth_db_format.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()
