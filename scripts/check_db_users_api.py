#!/usr/bin/env python3
"""Check jc-zjfa DB adapter type and users in memory"""
import sys, io, time, os
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
    console.log('Backend: ' + adp.backend);
    console.log('DB type: ' + (adp.raw ? adp.raw.constructor.name : 'unknown'));
    
    // Count users
    const userCount = adp.execOne('SELECT COUNT(*) as cnt FROM users');
    console.log('User count: ' + (userCount ? userCount.cnt : 'error'));
    
    // Check ctyqq
    const ctyqq = adp.execOne('SELECT username, status FROM users WHERE username = ?', 'ctyqq');
    console.log('ctyqq user: ' + JSON.stringify(ctyqq));
    
    // List first 5 users
    const users = adp.execAll('SELECT username, status FROM users LIMIT 5');
    console.log('Users: ' + JSON.stringify(users));
    
    database.closeDatabase();
  } catch(e) {
    console.error('ERROR: ' + e.message);
  }
}
main();'''

_, out, _ = SSH.exec_command("cat > /tmp/check_db.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END", timeout=10)
out.channel.settimeout(10)
time.sleep(2)

_, stdout, stderr = SSH.exec_command('cd /root/server && node /tmp/check_db.js 2>&1', timeout=30)
stdout.channel.settimeout(30)
time.sleep(15)

result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'check_db.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result + "\n---STDERR---\n" + err)

SSH.close()
