import time
time.sleep(3)

from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# Delete old English-name records
cmds = [
    "curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"delete-expert-consensus\"}' 2>&1 | python -c \"import sys,json; d=json.load(sys.stdin); print('Delete:', d)\"",
]

# Actually, let's do it via direct DB cleanup
print("=== Cleaning up old 'expert_consensus' records ===")

# Delete from prediction_outcomes
stdin,stdout,stderr = ssh.exec_command(
    """curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"prediction-backtest","model":"expert_consensus","dateRange":"all","page":1,"pageSize":1}' 2>&1"""
)
print("Check API:", stdout.read().decode()[:200])

# Use PM2 log to see if we can clean via inline command
# Or better - just delete via the prediction_outcomes API
# Actually we can use the model-dashboard API that already filters

# Check if the old records exist and delete via SQL
stdin,stdout,stderr = ssh.exec_command(
    """curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"backfill-clean-expert-consensus"}' 2>&1"""
)
res = stdout.read().decode()
print("Clean response:", res[:200])

# Check rankings again
stdin,stdout,stderr = ssh.exec_command(
    """curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"model-dashboard","days":365}' 2>&1"""
)
data = json.loads(stdout.read().decode())
print("\n=== Updated Model Rankings ===")
for r in data.get('data', {}).get('rankings', []):
    print(f"  {r['modelName']:25s} total={r['total']:5d} rate={r['directionRate']}%")

ssh.close()
