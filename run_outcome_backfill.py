from deploy import HOST, USER, PASS
import paramiko, time, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

print("Stopping PM2...")
ssh.exec_command("pm2 kill 2>&1; killall -9 node 2>/dev/null")
time.sleep(3)

print("Uploading bulk_outcome.js...")
sftp = ssh.open_sftp()
sftp.put("bulk_outcome.js", "/root/server/bulk_outcome.js")
sftp.close()

print("Running bulk outcome backfill...")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node bulk_outcome.js 2>&1")
out = b""
import select
while True:
    if stdout.channel.recv_ready():
        c = stdout.channel.recv(4096)
        if not c: break
        out += c
        print(c.decode(errors="replace"), end="")
    if stdout.channel.exit_status_ready(): break
    time.sleep(0.5)
while stdout.channel.recv_ready():
    out += stdout.channel.recv(4096)

print("\nRestarting PM2...")
ssh.exec_command("cd /root/server && pm2 start ecosystem.config.json 2>&1")
time.sleep(5)

print("\nVerifying model dashboard...")
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"model-dashboard","days":365}' 2>&1""")
data = json.loads(stdout.read().decode())
for r in data.get("data", {}).get("rankings", []):
    print(f"  {r['modelName']:15s} total={r['total']:5d} rate={r['directionRate']}%")

ssh.close()
