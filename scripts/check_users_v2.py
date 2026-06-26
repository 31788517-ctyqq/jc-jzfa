#!/usr/bin/env python3
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Write a script to the server that queries users
cmd = r'''cat > /tmp/check_users.js << 'EOFJS'
const Database = require('/root/server/database.js');
const db = new Database({dbPath: '/root/server/midou_data.db', lazy: true});
db.initDatabase().then(() => {
  try {
    const users = db.execAll('SELECT username, role FROM users LIMIT 20');
    console.log(JSON.stringify(users, null, 2));
  } catch(e) {
    console.error('Query error:', e.message);
  }
  db.close();
}).catch(e => console.error('Init error:', e.message));
EOFJS
node /tmp/check_users.js'''

_, out, _ = SSH.exec_command(cmd, timeout=20)
out.channel.settimeout(20)
time.sleep(10)
result = out.read().decode()
# Filter out PowerShell CLIXML noise
lines = result.split('\n')
for line in lines:
    if not line.startswith('#<') and not line.startswith('<') and line.strip():
        print(line)
