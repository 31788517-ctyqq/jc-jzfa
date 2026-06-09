from deploy import HOST, USER, PASS
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# 1. Upload modified backfill script
print("=== Uploading backfill_prediction_logs.js ===")
sftp = ssh.open_sftp()
sftp.put('server/backfill_prediction_logs.js', '/root/server/backfill_prediction_logs.js')
sftp.close()
print("Uploaded OK")

# 2. Stop PM2
print("\n=== Stopping PM2 ===")
for p in ['jc-zjfa', 'jc-sync', 'jc-scheduler']:
    stdin,stdout,stderr = ssh.exec_command(f"pm2 stop {p} 2>&1")
    print(f"  {p}: {stdout.read().decode()[:100]}")
time.sleep(2)

# 3. Clean stale tmp files
ssh.exec_command("rm -f /root/server/midou_data.db.tmp 2>&1")

# 4. Run backfill
print("\n=== Running backfill_prediction_logs.js (with transaction) ===")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node backfill_prediction_logs.js 2>&1")

# Read all output
import select, sys
out_data = b""
start = time.time()
while time.time() - start < 120:
    if stdout.channel.recv_ready():
        chunk = stdout.channel.recv(4096)
        if not chunk: break
        out_data += chunk
        sys.stdout.write(chunk.decode(errors='replace'))
        sys.stdout.flush()
    if stdout.channel.exit_status_ready():
        break
    time.sleep(0.1)
while stdout.channel.recv_ready():
    out_data += stdout.channel.recv(4096)

print("\n\n=== Done. Restarting PM2 ===")
for p in ['jc-sync', 'jc-zjfa', 'jc-scheduler']:
    stdin,stdout,stderr = ssh.exec_command(f"pm2 start {p} 2>&1")
    print(f"  {p}: {stdout.read().decode()[:100]}")
time.sleep(3)

# Verify
stdin,stdout,stderr = ssh.exec_command("pm2 status")
print("\n" + stdout.read().decode()[:400])

ssh.close()
