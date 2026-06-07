// 快速验证方案五部署
const { execSync } = require('child_process');
const cmd = `python -c "
from deploy import HOST, USER, PASS
import paramiko, json
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, timeout=15)

# L3: Nginx proxy with Host header
stdin,stdout,stderr = ssh.exec_command('curl -s -H \\\"Host: zj.100qiu.com\\\" http://127.0.0.1/api/health')
print('L3 Nginx:', stdout.read().decode().strip())

# L4: plan-list API (the key API for 方案五)
from datetime import date
today = date.today().isoformat()
stdin,stdout,stderr = ssh.exec_command(f'curl -s -X POST :3000/api -H \\\"Content-Type: application/json\\\" -d \\'{{\\\"action\\\":\\\"plan-list\\\",\\\"date\\\":\\\"{today}\\\"}}\\'')
result = stdout.read().decode()[:800]
print('L4 plan-list:', result)

ssh.close()
"`;
try {
  console.log(execSync(cmd, { encoding: 'utf8', maxBuffer: 10*1024*1024 }));
} catch(e) {
  console.log(e.stdout || '');
  console.log(e.stderr || '');
  console.log('exit:', e.status);
}
