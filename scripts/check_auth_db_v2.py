#!/usr/bin/env python3
"""Check auth.db via curl API"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Use sqlite3 command line tool to check auth.db
_, stdout, _ = SSH.exec_command('sqlite3 /root/server/auth.db ".tables" 2>&1; echo ---; sqlite3 /root/server/auth.db "SELECT COUNT(*) FROM users" 2>&1; echo ---; sqlite3 /root/server/auth.db "SELECT username, status FROM users LIMIT 10" 2>&1', timeout=10)
stdout.channel.settimeout(10)
time.sleep(3)
result = stdout.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'auth_db_sqlite3.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result)

SSH.close()
