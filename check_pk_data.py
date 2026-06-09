from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# Check prediction_logs PK data count
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"prediction-backtest","dateRange":"all","page":1,"pageSize":1}' 2>&1""")
data = json.loads(stdout.read().decode())
stats = data.get('data', {}).get('stats', {})
print("=== Backtest Stats ===")
print(f"Total: {stats.get('total')}")
print(f"GS: {stats.get('gs',{}).get('total')}")
print(f"PK: {stats.get('pk',{}).get('total')}")
print(f"AI: {stats.get('ai',{}).get('total')}")

# Check if pk_direction exists in prediction_logs for most records
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"backfill-status"}' 2>&1""")
print("\n=== Backfill Status ===")
print(stdout.read().decode()[:300])

# Run PK scorer compute for old dates
print("\n=== Running pk_scorer for all dates ===")
stdin,stdout,stderr = ssh.exec_command("cd /root/server && node -e \"const pk=require('./pk_scorer'); pk.computeAndSave().then(r=>console.log(JSON.stringify(r))).catch(e=>console.log('err',e.message))\" 2>&1 | tail -20")
# This might take a while, just check status

ssh.close()
