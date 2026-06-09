from deploy import HOST, USER, PASS
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# First do a dry run to see the scope
print("=== Phase 3 dry run ===")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node backfill_full_models.js --dry --phase=3 2>&1 | tail -5")
print(stdout.read().decode()[:500])

# Then run the actual backfill (without stopping PM2 to avoid DB conflicts)
# Actually we need to stop PM2 to avoid sql.js _saveToFile issues
print("\n=== Stopping PM2 ===")
ssh.exec_command("pm2 kill 2>&1; killall -9 node 2>/dev/null")
time.sleep(3)

print("=== Running Phase 3 PK backfill ===")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node backfill_full_models.js --phase=3 2>&1")
import select
out = b""
start = time.time()
while time.time() - start < 300:  # 5 min timeout
    if stdout.channel.recv_ready():
        c = stdout.channel.recv(4096)
        if not c: break
        out += c
        # Print progress lines
        text = c.decode(errors='replace')
        if 'Phase 3' in text or '完成' in text or '日期' in text or 'PK' in text:
            print(text.strip())
    if stdout.channel.exit_status_ready(): break
    time.sleep(0.5)
while stdout.channel.recv_ready():
    out += stdout.channel.recv(4096)
print("\n=== Final ===")
print(out.decode(errors='replace')[-300:])

# Check DB size
stdin,stdout,stderr = ssh.exec_command("ls -la /root/server/midou_data.db 2>&1")
print(f"\nDB: {stdout.read().decode().strip()}")

# Restart PM2
print("\n=== Restarting PM2 ===")
ssh.exec_command("cd /root/server && pm2 start ecosystem.config.json 2>&1")
time.sleep(5)

# Verify PK count
import json
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"prediction-backtest","dateRange":"all","page":1,"pageSize":1}' 2>&1""")
data = json.loads(stdout.read().decode())
stats = data.get('data', {}).get('stats', {})
print(f"\n=== After PK Backfill ===")
print(f"Total: {stats.get('total')}")
print(f"GS: {stats.get('gs',{}).get('total')}")
print(f"PK: {stats.get('pk',{}).get('total')}")
print(f"AI: {stats.get('ai',{}).get('total')}")

ssh.close()
