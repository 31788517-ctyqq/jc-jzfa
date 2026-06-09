from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-06-09"}' 2>&1""")
data = json.loads(stdout.read().decode())
ms = data.get('data', [])
for m in ms:
    if '周二201' in (m.get('num','') or ''):
        print(f"{m['num']} status={m['matchStatus']} score={m['score']} dur={m.get('duration','')} half={m.get('halfScore','')}")
        break
else:
    print("周二201 not found")
print(f"\nTotal matches: {len(ms)}")
ssh.close()
