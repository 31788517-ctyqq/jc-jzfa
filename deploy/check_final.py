import paramiko, time, re
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=15):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    out=o.read().decode(errors='replace')
    return rc,re.sub(r'[^\x00-\x7F]+','.',out)

# Restart
print("[1] Restart...")
rc,o=run("pm2 restart jc-zjfa --update-env 2>&1")
print(o[:100])

time.sleep(5)

# Status
rc,o=run("pm2 list 2>&1")
print("\n[2] PM2:"); print(o[:300])

# Health
rc,o=run("curl -s -m 5 http://localhost:3000/health 2>&1")
print("\n[3] Health:", o[:200])

# HTTP
rc,o=run("curl -s -m 5 -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>&1")
print("[4] HTTP:", o.strip())

# Error log
rc,o=run("tail -3 /root/.pm2/logs/jc-zjfa-error.log 2>&1")
print("[5] ERR:", o.strip()[:200] or "none")

ssh.close()
