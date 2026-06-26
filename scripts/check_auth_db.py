#!/usr/bin/env python3
"""Check auth.db users"""
import sys, io, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

script_content = r'''const Database = require('/root/server/database.js');
async function main() {
  try {
    // Use auth.db directly
    const BetterSqlite3 = require('better-sqlite3');
    const authDb = new BetterSqlite3('/root/server/auth.db');
    
    // Get table info
    const cols = authDb.prepare("PRAGMA table_info(users)").all();
    console.log("auth.db COLUMNS: " + JSON.stringify(cols.map(c => c.name)));
    
    // Count users
    const cnt = authDb.prepare('SELECT COUNT(*) as cnt FROM users').get();
    console.log('auth.db user count: ' + cnt.cnt);
    
    // Check ctyqq
    const ctyqq = authDb.prepare('SELECT username, status FROM users WHERE username = ?').get('ctyqq');
    console.log('ctyqq in auth.db: ' + JSON.stringify(ctyqq));
    
    // List first 5 users
    const users = authDb.prepare('SELECT username, status FROM users LIMIT 5').all();
    console.log('auth.db Users: ' + JSON.stringify(users));
    
    authDb.close();
  } catch(e) {
    console.error('ERROR: ' + e.message);
  }
}
main();'''

_, out, _ = SSH.exec_command("cat > /tmp/check_auth.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END", timeout=10)
out.channel.settimeout(10)
time.sleep(2)

_, stdout, stderr = SSH.exec_command('cd /root/server && node /tmp/check_auth.js 2>&1', timeout=15)
stdout.channel.settimeout(15)
time.sleep(8)

result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'auth_db.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result + "\n---STDERR---\n" + err)

SSH.close()
