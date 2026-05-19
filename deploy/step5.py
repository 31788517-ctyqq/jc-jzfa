import paramiko
HOST="119.23.51.159"; USER="root"; PASS="znm19811225@"
ssh=paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST,22,USER,PASS,timeout=10,look_for_keys=False,allow_agent=False)

def run(cmd, t=30):
    _,o,e=ssh.exec_command(cmd,timeout=t)
    rc=o.channel.recv_exit_status()
    return rc,o.read().decode(errors='replace'),e.read().decode(errors='replace')

# Ensure PM2 is running
print("[1] Start PM2...")
rc,o,e=run("cd /var/www/zj.100qiu.com && pm2 delete jc-zjfa 2>/dev/null; pm2 start server/index.js --name jc-zjfa --node-args='--max-old-space-size=256' 2>&1; pm2 save 2>&1")
print(o.replace('\u2713','OK').replace('\u2717','FAIL')[:500])

# Check status
print("\n[2] PM2 Status...")
rc,o,e=run("pm2 jlist 2>/dev/null | head -20")
print(o[:500])

# Test health endpoint
print("\n[3] Health check...")
import time; time.sleep(3)
rc,o,e=run("curl -s http://localhost:3000/health 2>&1")
print(o)

# Test homepage
print("\n[4] Home page...")
rc,o,e=run("curl -s http://localhost:3000/ 2>&1 | head -5")
print(o[:300])

print("\n[DONE] Visit: http://zj.100qiu.com")
ssh.close()
