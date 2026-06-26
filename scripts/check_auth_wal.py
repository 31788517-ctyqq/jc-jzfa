#!/usr/bin/env python3
"""Check auth.db WAL files and try to read with sqlite3"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

_, stdout, _ = SSH.exec_command('ls -la /root/server/auth.db*; echo ---; sqlite3 /root/server/auth.db "PRAGMA journal_mode; SELECT COUNT(*) FROM users; SELECT username FROM users LIMIT 5;" 2>&1', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'auth_wal.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()
