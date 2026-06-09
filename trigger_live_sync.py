from deploy import HOST, USER, PASS
import paramiko, time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

# Sync live scores
print("=== Fetching live scores from 500.com ===")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node -e \"const{syncLiveScores}=require('./data_sync'); syncLiveScores().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log('err',e.message))\" 2>&1")
import select
out = b""
start = time.time()
while time.time() - start < 30:
    if stdout.channel.recv_ready():
        c = stdout.channel.recv(4096)
        if not c: break
        out += c
    if stdout.channel.exit_status_ready(): break
    time.sleep(0.3)
while stdout.channel.recv_ready():
    out += stdout.channel.recv(4096)
print(out.decode(errors='replace')[-500:])

# Check live_scores.json
stdin,stdout,stderr = ssh.exec_command("ls -la /root/server/live_scores.json 2>&1; head -c 500 /root/server/live_scores.json 2>&1")
res = stdout.read().decode()
print("\n=== live_scores.json ===")
print(res[:500])

ssh.close()
