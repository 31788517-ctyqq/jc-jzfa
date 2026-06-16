import time
from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=30)

# Trigger 500.com fetch
print("=== Triggering fetchLive500 ===")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node -e \"const{fetchLive500}=require('./sync_live_500'); fetchLive500().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log('err',e.message))\" 2>&1")
time.sleep(0.5)
import select
out = b""
while stdout.channel.recv_ready() or time.time() < 20:
    if stdout.channel.recv_ready():
        c = stdout.channel.recv(4096)
        if not c: break
        out += c
    if stdout.channel.exit_status_ready(): break
    time.sleep(0.3)
while stdout.channel.recv_ready(): out += stdout.channel.recv(4096)
print(out.decode(errors='replace')[-600:])

# Check live_scores.json for duration
stdin,stdout,stderr = ssh.exec_command("python -c \"import sys,json; d=json.load(open('/root/server/live_scores.json')); [print(f'{m[\\\"num\\\"]} status={m[\\\"matchStatus\\\"]} score={m[\\\"score\\\"]} dur={m.get(\\\"duration\\\",\\\"\\\")} half={m.get(\\\"halfScore\\\",\\\"\\\")}') for m in d.get('matches',[]) if m.get('duration') or m.get('score'')]\" 2>&1")
print("\n=== Live matches with scores ===")
print(stdout.read().decode()[:500])

# Check match-list API
time.sleep(2)
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-06-09"}' 2>&1 | python -c "import sys,json; d=json.load(sys.stdin); ms=d.get('data',[]); [print(f'{m.get(\\\"num\\\",\\\"?\\\")} status={m.get(\\\"matchStatus\\\")} score={m.get(\\\"score\\\",\\\"-\\\")} dur={m.get(\\\"duration\\\",\\\"-\\\")}') for m in ms[:5]]" 2>&1""")
print("\n=== API match-list ===")
print(stdout.read().decode()[:500])

ssh.close()
