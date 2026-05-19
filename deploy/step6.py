# -*- coding: utf-8 -*-
import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=30):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    out=o.read().decode(errors='replace'); err=e.read().decode(errors='replace')
    clean=re.sub(r'[^\x00-\x7F]+','.',out)
    return rc,clean,err

# Start PM2
rc,o,e=run("cd /var/www/zj.100qiu.com && pm2 delete jc-zjfa 2>/dev/null; pm2 start server/index.js --name jc-zjfa 2>&1; pm2 save 2>&1")
print("PM2:",o[:300])

# Wait and check
time.sleep(3)

# PM2 list
rc,o,e=run("pm2 list 2>&1")
print("List:",o[:300])

# Health
rc,o,e=run("curl -s http://localhost:3000/health 2>&1")
print("Health:",o[:200])

# Page  
rc,o,e=run("curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/")
print("HTTP:",o[:50])

print("\n--- DONE: http://zj.100qiu.com ---")
ssh.close()
