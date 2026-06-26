"""API 性能基准测试（cluster:3 + Redis 缓存）"""
import sys, os, io, time, json
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

# 等 worker 完全启动
time.sleep(5)

# PM2 状态
print('\n=== PM2 状态 ===')
out, _ = run('pm2 list', timeout=10)
for line in out.split('\n'):
    line = line.strip()
    if any(k in line for k in ['jc-zjfa', 'jc-sync', 'jc-scheduler', 'id', 'name', 'mode', 'status']):
        print(f'  {line}')

# Redis 连接
print('\n=== Redis 连接 ===')
out, _ = run('cd /root/server && node -e "const r=require(\'./core/redis-client\');r.init().then(()=>{console.log(\'redis:\'+r.isConnected()+\' degraded:\'+r.isDegraded());process.exit(0)}).catch(e=>{console.log(\'ERR:\'+e.message);process.exit(1)})"')
print(f'  {out.strip()}')

# API 性能测试
print('\n=== API 性能测试 (curl -o /dev/null) ===')
actions = ['home-bundle', 'match-list', 'ranking-list', 'plan-list']

for run_num in [1, 2]:
    label = '首次(冷启动)' if run_num == 1 else '二次(缓存)'
    print(f'\n--- {label} ---')
    for action in actions:
        cmd = 'curl -o /dev/null -s -w "%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{"action":"' + action + '"}\''
        out, _ = run(cmd, timeout=30)
        ms = float(out.strip()) * 1000 if out.strip() else -1
        print(f'  {action}: {ms:.1f}ms')

# Redis 缓存 keys
print('\n=== Redis 缓存 keys ===')
out, _ = run('redis-cli -a qcredismaster01 KEYS "zjfa:resp:*" 2>/dev/null | wc -l')
print(f'  缓存 keys 数量: {out.strip()}')

out, _ = run('redis-cli -a qcredismaster01 KEYS "zjfa:resp:*" 2>/dev/null')
print(f'  缓存 keys: {out.strip()[:200]}')

SSH.close()
print('\n基准测试完成')
