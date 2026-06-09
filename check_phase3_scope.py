from deploy import HOST, USER, PASS
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

stdin,stdout,stderr = ssh.exec_command("cd /root/server && node backfill_full_models.js --dry --phase=3 2>&1")
import time, select
out = b""
start = time.time()
while time.time() - start < 30:
    if stdout.channel.recv_ready():
        c = stdout.channel.recv(4096)
        if not c: break
        out += c
    if stdout.channel.exit_status_ready(): break
    time.sleep(0.5)
while stdout.channel.recv_ready():
    out += stdout.channel.recv(4096)

# Show relevant lines
for line in out.decode(errors='replace').split('\n'):
    if any(x in line for x in ['日期', 'Phase', 'DRY', '覆盖', '完成', 'PK']):
        print(line.strip())

ssh.close()
