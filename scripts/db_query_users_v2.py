#!/usr/bin/env python3
"""Query users from server DB using ssh_utils"""
import sys, io, json, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Write a JS script to the server and execute it
script_content = r'''const Database = require('/root/server/database.js');
async function main() {
  try {
    const db = new Database({dbPath: '/root/server/midou_data.db', lazy: true});
    await db.initDatabase();
    const users = db.execAll('SELECT username, role, status FROM users');
    console.log(JSON.stringify(users));
    db.close();
  } catch(e) {
    console.error('ERROR: ' + e.message);
  }
}
main();'''

# Write script to remote file
write_cmd = "cat > /tmp/query_users.js << 'SCRIPT_END'\n" + script_content + "\nSCRIPT_END"
_, out, _ = SSH.exec_command(write_cmd, timeout=10)
out.channel.settimeout(10)
time.sleep(2)

# Execute the script
_, stdout, stderr = SSH.exec_command('cd /root/server && node /tmp/query_users.js 2>&1', timeout=20)
stdout.channel.settimeout(20)
time.sleep(10)

# Read and save result
result_bytes = stdout.read()
err_bytes = stderr.read()
result = result_bytes.decode('utf-8', errors='replace')
err = err_bytes.decode('utf-8', errors='replace')

# Save to local file  
import os
output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'db_users.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write("STDOUT:\n" + result + "\n\nSTDERR:\n" + err)

SSH.close()
