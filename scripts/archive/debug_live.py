from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# Check live_scores.json raw
stdin,stdout,stderr = ssh.exec_command("cat /root/server/live_scores.json 2>&1 | head -c 2000")
print("=== live_scores.json ===")
print(stdout.read().decode()[:1000])

# Check API match-list raw
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"match-list","date":"2026-06-09"}' 2>&1 | head -c 2000""")
print("\n=== API match-list ===")
print(stdout.read().decode()[:1000])

ssh.close()
