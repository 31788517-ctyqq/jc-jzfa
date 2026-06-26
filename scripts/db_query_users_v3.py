#!/usr/bin/env python3
"""Query users from server DB using database module correctly"""
import sys, io, json, time, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Write a JS script using the correct database API
script_content = r'''const database = require('/root/server/database.js');
async function main() {
  try {
    await database.initDatabase();
    const adp = database.getAdapter();
    if (!adp) { console.log('ERROR: getAdapter returned null'); return; }
    const users = adp.execAll('SELECT username, role, status FROM users');
    console.log(JSON.stringify(users));
    database.closeDatabase();
  } catch(e) {
    console.error('ERROR: ' + e.message);
  }
}
main();'''

# Write script to remote file using a different method (echo + base64)
_, out, _ = SSH.exec_command("cat > /tmp/query_users.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END", timeout=10)
out.channel.settimeout(10)
time.sleep(2)

# Execute the script
_, stdout, stderr = SSH.exec_command('cd /root/server && node /tmp/query_users.js 2>&1', timeout=30)
stdout.channel.settimeout(30)
time.sleep(15)

# Read and save result
result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

# Save to local file
output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'db_users.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write("STDOUT:\n" + result + "\n\nSTDERR:\n" + err)

SSH.close()
