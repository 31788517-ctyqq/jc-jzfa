import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=15):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    out=o.read().decode(errors='replace'); err=e.read().decode(errors='replace')
    return rc,out,err

print("Waiting for server to start...")
time.sleep(5)

# Nginx test
rc,o,e=run("nginx -t 2>&1")
print("[1] Nginx:", "OK" if rc==0 else o.strip()[:100])

# Health
rc,o,e=run("curl -s -m 5 http://localhost:3000/health 2>&1")
print("[2] Health:", o.strip()[:200] or "waiting...")

# Homepage via localhost
rc,o,e=run("curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>&1")
print("[3] HTTP code:", o.strip())

# PM2 log
rc,o,e=run("pm2 logs jc-zjfa --lines 5 --nostream 2>&1")
clean=re.sub(r'[^\x00-\x7F]+','.',o)
print("[4] PM2 log:", clean.strip()[:300])

# Node process
rc,o,e=run("ps aux | grep 'node.*index.js' | grep -v grep")
print("[5] Process:", o.strip()[:100] or "NOT FOUND")

ssh.close()
