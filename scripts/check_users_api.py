#!/usr/bin/env python3
import sys, io, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Use curl to query API directly on server
cmd = '''curl -s -X POST http://localhost:3210/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d '{"action":"user-list","page":1,"pageSize":20}' 2>&1 | head -200'''

_, out, _ = SSH.exec_command(cmd, timeout=15)
out.channel.settimeout(15)
raw = out.read().decode()
try:
    data = json.loads(raw)
    users = data.get('users', data.get('data', []))
    for u in users[:20]:
        print(f"username={u.get('username','?')} role={u.get('role','?')}")
except:
    print(raw[:500])
