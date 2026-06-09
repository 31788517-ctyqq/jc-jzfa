import time; time.sleep(3)
from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-06-09"}' 2>&1""")
data = json.loads(stdout.read().decode())
matches = data if isinstance(data, list) else (data.get('data', []) if isinstance(data, dict) else [])

print(f"Total matches: {len(matches)}")
for m in matches[:5]:
    status = {0:'未开始',1:'进行中',2:'已结束',3:'取消'}.get(m.get('matchStatus'),'?')
    score = m.get('score','') or '-'
    dur = m.get('duration','') or ''
    half = m.get('halfScore','') or ''
    print(f"  {m.get('num','?'):10s} {m.get('homeName','?'):10s} vs {m.get('visitName','?'):10s} [{status}] score={score} half={half} dur={dur}")

# Check if live score data is merged
live_matches = [m for m in matches if m.get('matchStatus') == 1]
print(f"\nLive matches: {len(live_matches)}")
for m in live_matches:
    print(f"  {m.get('num','?')} {m.get('homeName')} vs {m.get('visitName')} {m.get('score')} {m.get('duration')}")

ssh.close()
