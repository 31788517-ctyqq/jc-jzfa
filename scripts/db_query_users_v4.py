#!/usr/bin/env python3
"""Query users table schema and all users"""
import sys, io, json, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

script_content = r'''const database = require('/root/server/database.js');
async function main() {
  try {
    await database.initDatabase();
    const adp = database.getAdapter();
    if (!adp) { console.log('ERROR: getAdapter returned null'); return; }
    
    // Get table info
    const cols = adp.execAll("PRAGMA table_info(users)");
    console.log("COLUMNS: " + JSON.stringify(cols.map(c => c.name)));
    
    // Get all users (only existing columns)
    const users = adp.execAll('SELECT * FROM users');
    console.log(JSON.stringify(users));
    database.closeDatabase();
  } catch(e) {
    console.error('ERROR: ' + e.message);
  }
}
main();'''

_, out, _ = SSH.exec_command("cat > /tmp/query_users.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END", timeout=10)
out.channel.settimeout(10)
time.sleep(2)

_, stdout, stderr = SSH.exec_command('cd /root/server && node /tmp/query_users.js 2>&1', timeout=30)
stdout.channel.settimeout(30)
time.sleep(15)

result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'db_users.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result + "\n---STDERR---\n" + err)

SSH.close()
