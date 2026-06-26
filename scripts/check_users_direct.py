#!/usr/bin/env python3
import subprocess, sys, io, json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Use paramiko directly, bypassing PowerShell
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

cmd = 'curl -s -X POST http://localhost:3210/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d \'{"action":"user-list","page":1,"pageSize":20}\''
_, stdout, stderr = SSH.exec_command(cmd, timeout=15)
stdout.channel.settimeout(15)

# Read raw bytes and decode
raw_bytes = stdout.read()
text = raw_bytes.decode('utf-8', errors='replace')

# Try to parse as JSON
try:
    data = json.loads(text)
    users = data.get('users', data.get('data', []))
    if isinstance(users, list):
        for u in users[:20]:
            print(f"username={u.get('username','?')} role={u.get('role','?')} status={u.get('status','?')}")
    else:
        print(json.dumps(data, indent=2, ensure_ascii=False)[:500])
except json.JSONDecodeError:
    # Print raw text, filtering PowerShell noise
    for line in text.split('\n'):
        if not line.strip().startswith('#<') and not line.strip().startswith('<Objs'):
            print(line)
