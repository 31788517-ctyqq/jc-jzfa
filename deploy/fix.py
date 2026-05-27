import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=60):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    return rc,o.read().decode(errors='replace'),e.read().decode(errors='replace')

# Fix index.js
print("[1] Fix index.js...")
rc,o,e=run("cd /var/www/zj.100qiu.com && curl -sL -o server/index.js https://raw.githubusercontent.com/31788517-ctyqq/jc-jzfa/master/server/index.js && echo FIXED")
print(o)

# Install better-sqlite3 with build
print("[2] Install better-sqlite3...")
rc,o,e=run("cd /var/www/zj.100qiu.com/server && npm install better-sqlite3@7.4.0 --build-from-source 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o)
print(clean[:400])

# Restart PM2
print("[3] Restart PM2...")
rc,o,e=run("cd /var/www/zj.100qiu.com && pm2 restart jc-zjfa 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o)
print(clean[:200])

# Wait and check
time.sleep(5)

rc,o,e=run("pm2 list 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o)
print("\n[4] Status:"); print(clean[:300])

rc,o,e=run("curl -s -m 5 http://localhost:3000/health 2>&1")
print("\n[5] Health:", o.strip()[:200] or "waiting...")

rc,o,e=run("curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>&1")
print("[6] HTTP:", o.strip())

ssh.close()
print("\nDone!")
