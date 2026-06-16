import time; time.sleep(3)
from deploy import HOST, USER, PASS
import paramiko, json

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# Backtest stats
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"prediction-backtest","dateRange":"all","page":1,"pageSize":1}' 2>&1""")
data = json.loads(stdout.read().decode())
s = data.get('data', {}).get('stats', {})
print("=== 回测分析页面 ===")
print(f"总预测: {s.get('total')}")
print(f"GS功守道: {s.get('gs',{}).get('total')}")
print(f"PK融合分析: {s.get('pk',{}).get('total')}")
print(f"AI深度分析: {s.get('ai',{}).get('total')}")

# Model dashboard
stdin,stdout,stderr = ssh.exec_command("""curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{"action":"model-dashboard","days":365}' 2>&1""")
data2 = json.loads(stdout.read().decode())
print("\n=== 模型表现仪表板 ===")
for r in data2.get('data', {}).get('rankings', []):
    print(f"  {r['modelName']:15s} total={r['total']:5d}")

ssh.close()
