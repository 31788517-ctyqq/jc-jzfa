from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# Check live_scores.json
stdin,stdout,stderr = ssh.exec_command("cat /root/server/live_scores.json 2>&1 | head -c 3000")
print("=== live_scores.json ===")
print(stdout.read().decode()[:2000])

# Check API response for 周二201
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-06-09"}' 2>&1""")
raw = stdout.read().decode()
try:
    data = json.loads(raw)
    ms = data.get('data', [])
    for m in ms:
        if '周二201' in (m.get('num','') or ''):
            print(f"\n=== 周二201 API data ===")
            for k,v in sorted(m.items()):
                print(f"  {k}: {v}")
except Exception as e:
    print(f"Parse error: {e}")
    print(raw[:500])

ssh.close()
