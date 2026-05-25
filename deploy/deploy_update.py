"""Deploy to production server via SSH"""
import paramiko
import sys
import time

HOST = "119.23.51.159"
USER = "root"
PASS = "znm19811125@"
PORT = 22

def ssh_cmd(ssh, cmd, timeout=120):
    """Run command and print output in real-time"""
    print(f"\n>>> {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    if out:
        print(out)
    if err:
        print("[STDERR]", err)
    return out, err

print("[*] Connecting to production server...")

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

try:
    ssh.connect(HOST, PORT, USER, PASS, timeout=15, allow_agent=False, look_for_keys=False)
    print("[✓] Connected to 119.23.51.159")

    # ─── 1. Check current state ───
    ssh_cmd(ssh, "cd /var/www/zj.100qiu.com && git log --oneline -3 2>/dev/null || echo 'NOT_A_GIT_REPO'")
    ssh_cmd(ssh, "pm2 status")

    # ─── 2. Pull latest code ───
    ssh_cmd(ssh, "cd /var/www/zj.100qiu.com && git stash 2>/dev/null; git pull origin master 2>&1 || (curl -sL -o /tmp/jc-zjfa.zip https://codeload.github.com/31788517-ctyqq/jc-jzfa/zip/refs/heads/master && cd /tmp && unzip -qo jc-zjfa.zip && rsync -a /tmp/jc-zjfa-master/ /var/www/zj.100qiu.com/ && rm -rf /tmp/jc-zjfa-master /tmp/jc-zjfa.zip && echo 'Deployed via zip download')")

    # ─── 3. Install dependencies ───
    ssh_cmd(ssh, "cd /var/www/zj.100qiu.com/server && npm install --production --no-optional 2>&1 | tail -5")

    # ─── 4. Restart PM2 services ───
    ssh_cmd(ssh, "cd /var/www/zj.100qiu.com && pm2 restart ecosystem.config.json 2>&1 || pm2 start ecosystem.config.json 2>&1")

    # ─── 5. Verify deployment ───
    time.sleep(3)
    ssh_cmd(ssh, "pm2 status")
    ssh_cmd(ssh, "curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"plan-list\",\"date\":\"2026-05-25\"}' | python3 -m json.tool 2>/dev/null | head -30 || echo 'API check failed'")

    print("\n[✓] Deployment complete!")
    print("    Visit: https://zj.100qiu.com")

except Exception as e:
    print(f"[✗] Error: {e}")
    sys.exit(1)
finally:
    ssh.close()
