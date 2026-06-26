#!/usr/bin/env python3
"""Query users from server DB and write result to local file"""
import paramiko, os, json, time

HOST = '119.23.51.159'
USER = 'root'
env_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env.deploy')
PASS = ''
if os.path.exists(env_file):
    for line in open(env_file, encoding='utf-8'):
        if line.startswith('DEPLOY_SSH_PASS='):
            PASS = line.strip().split('=', 1)[1]

key_path = os.path.expanduser('~/.ssh/id_rsa_jczjfa')
KEY_FILE = key_path if os.path.exists(key_path) else None

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
if KEY_FILE:
    ssh.connect(HOST, username=USER, key_filename=KEY_FILE, timeout=10, port=22,
                look_for_keys=False, allow_agent=False)
elif PASS:
    ssh.connect(HOST, username=USER, password=PASS, timeout=10, port=22)

# Write a JS script to the server and execute it
script = '''
const Database = require('/root/server/database.js');
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
main();
'''

# Write script to server
_, stdout, _ = ssh.exec_command("cat > /tmp/query_users.js << 'SCRIPT'\n" + script + "\nSCRIPT", timeout=10)
stdout.channel.settimeout(10)
time.sleep(1)

# Execute the script
_, stdout, stderr = ssh.exec_command('cd /root/server && node /tmp/query_users.js 2>&1', timeout=15)
stdout.channel.settimeout(15)
time.sleep(8)
result = stdout.read().decode('utf-8', errors='replace')
err = stderr.read().decode('utf-8', errors='replace')

# Write to local file
output_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '_screenshots', 'db_users.txt')
with open(output_file, 'w', encoding='utf-8') as f:
    f.write(result + '\n---STDERR---\n' + err)

ssh.close()
print("QUERY_DONE")
