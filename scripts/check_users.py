#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Check users in the database
cmd = '''
cd /root/server && node -e "
const Database = require('./database.js');
const db = new Database({dbPath: './midou_data.db', lazy: true});
db.initDatabase().then(() => {
  const users = db.execAll('SELECT username, role FROM users LIMIT 20');
  console.log(JSON.stringify(users));
  db.close();
}).catch(e => console.error(e));
"
'''

_, out, _ = SSH.exec_command(cmd, timeout=15)
out.channel.settimeout(15)
print(out.read().decode())
