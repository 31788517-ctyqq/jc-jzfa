import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=30):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    return rc,o.read().decode(errors='replace'),e.read().decode(errors='replace')

# Check error log
rc,o,e=run("tail -20 /root/.pm2/logs/jc-zjfa-error.log 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o)
print("[1] Error log:"); print(clean[:600])

# Check if better-sqlite3 installed
rc,o,e=run("ls /var/www/zj.100qiu.com/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node 2>&1 && echo 'INSTALLED' || echo 'NOT_FOUND'")
print("\n[2] SQLite3:", o.strip())

# Check Node 10 compatible alternative
rc,o,e=run("node -e \"try{require('better-sqlite3');console.log('OK')}catch(e){console.log(e.message.slice(0,80))}\" 2>&1")
print("[3] Test load:", o.strip())

# If better-sqlite3 fails, try sqlite3 package
if "NOT_FOUND" in o or "Cannot find" in o:
    print("\n[4] Trying sqlite3 fallback...")
    rc,o,e=run("cd /var/www/zj.100qiu.com/server && npm install sqlite3@5.0.2 --build-from-source 2>&1")
    clean=re.sub(r'[^\x00-\x7F]+','.',o)
    print(clean[:300])

ssh.close()
