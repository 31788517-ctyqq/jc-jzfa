"""验证 P2+P3 部署状态"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh

SSH = get_ssh()

def run(cmd, timeout=30):
    _, stdout, stderr = SSH.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    stderr.channel.settimeout(timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. PM2 状态
print('\n=== PM2 状态 ===')
out, _ = run('pm2 jlist', timeout=10)
try:
    import json
    procs = json.loads(out)
    for p in procs:
        name = p.get('name', '?')
        inst = len(p.get('instances', [1])) if p.get('instances') else 1
        mem = round(p.get('monit', {}).get('memory', 0) / 1024 / 1024)
        status = p.get('pm2_env', {}).get('status', '?')
        exec_mode = p.get('pm2_env', {}).get('exec_mode', '?')
        print(f'  {name}: instances={inst}, mode={exec_mode}, status={status}, mem={mem}MB')
except:
    for line in out.split('\n')[:5]:
        print(f'  {line.strip()[:120]}')

# 2. Redis 连接
print('\n=== Redis 连接 ===')
out, err = run('cd /root/server && node -e "const r=require(\'./core/redis-client\');r.init().then(()=>{console.log(\'redis:\'+r.isConnected()+\' degraded:\'+r.isDegraded());process.exit(0)}).catch(e=>{console.log(\'ERR:\'+e.message);process.exit(1)})"')
print(f'  {out.strip()}')

# 3. API 首次请求
print('\n=== API 首次请求 ===')
for action in ['home-bundle', 'match-list', 'ranking-list', 'plan-list']:
    cmd = 'curl -s -w "\\ntime_total:%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{"action":"' + action + '"}\''
    out, _ = run(cmd, timeout=30)
    # 取 time_total 行
    for line in out.split('\n'):
        if 'time_total' in line:
            print(f'  {action}: {line.strip()}')

# 4. API 二次请求
print('\n=== API 二次请求 (应命中缓存) ===')
for action in ['home-bundle', 'match-list', 'ranking-list', 'plan-list']:
    cmd = 'curl -s -w "\\ntime_total:%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{"action":"' + action + '"}\''
    out, _ = run(cmd, timeout=30)
    for line in out.split('\n'):
        if 'time_total' in line:
            print(f'  {action}: {line.strip()}')

SSH.close()
print('\n验证完成')
