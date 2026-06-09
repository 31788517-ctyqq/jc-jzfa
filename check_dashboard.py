import time; time.sleep(3)
from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

for label, days in [("365天(全部)", 365), ("50天", 50), ("全部模式(all)", 0)]:
    cmd = "curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"model-dashboard\",\"days\":" + str(days) + "}' 2>&1"
    stdin,stdout,stderr = ssh.exec_command(cmd)
    data = json.loads(stdout.read().decode())
    print(f"=== {label} (days={days}) ===")
    for r in data.get('data', {}).get('rankings', []):
        print(f"  {r['modelName']:15s} total={r['total']:5d} rate={r['directionRate']}%")
    print()

# Also show backtest for comparison
cmd = "curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"prediction-backtest\",\"dateRange\":\"all\",\"page\":1,\"pageSize\":1}' 2>&1"
stdin,stdout,stderr = ssh.exec_command(cmd)
data = json.loads(stdout.read().decode())
s = data.get('data', {}).get('stats', {})
print("=== 回测分析(全部时间) ===")
print(f"  GS功守道: {s.get('gs',{}).get('total')}")
print(f"  PK融合分析: {s.get('pk',{}).get('total')}")
print(f"  AI深度分析: {s.get('ai',{}).get('total')}")

ssh.close()
