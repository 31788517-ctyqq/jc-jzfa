"""回退 cluster:1 (安全模式) + 修复 ai_daemon 问题"""
import sys, os, io, time, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh
import paramiko

SSH = get_ssh()

def run(cmd, timeout=30):
    _, stdout, stderr = SSH.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    stderr.channel.settimeout(timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 1. 修改服务器上的 ecosystem.config.json 回到 instances:1
print('\n=== Step 1: 回退 ecosystem.config.json (instances:1, fork) ===')
out, _ = run('cd /root/server && sed -i "0,/\\\"instances\\\": 3/s/\\\"instances\\\": 3/\\\"instances\\\": 1/" ecosystem.config.json && sed -i "0,/\\\"exec_mode\\\": \\\"cluster\\\"/s/\\\"exec_mode\\\": \\\"cluster\\\"/\\\"exec_mode\\\": \\\"fork\\\"/" ecosystem.config.json')
out2, _ = run('grep -E "instances|exec_mode" /root/server/ecosystem.config.json | head -4')
print(f'  验证: {out2.strip()}')

# 2. pm2 kill + restart
print('\n=== Step 2: pm2 kill + restart ===')
run('pm2 kill', timeout=15)
time.sleep(3)
out, _ = run('cd /root/server && pm2 start ecosystem.config.json', timeout=30)
print(f'  {out.strip()[:300]}')

time.sleep(5)

# 3. 验证
print('\n=== Step 3: 验证 ===')
out, _ = run('pm2 jlist', timeout=10)
try:
    procs = json.loads(out)
    for p in procs:
        name = p.get('name', '?')
        inst = len(p.get('instances', [1])) if p.get('instances') else 1
        mem = round(p.get('monit', {}).get('memory', 0) / 1024 / 1024)
        status = p.get('pm2_env', {}).get('status', '?')
        exec_mode = p.get('pm2_env', {}).get('exec_mode', '?')
        print(f'  {name}: instances={inst}, mode={exec_mode}, status={status}, mem={mem}MB')
except:
    print(f'  {out.strip()[:200]}')

# 4. pm2 save
run('pm2 save', timeout=10)

# 5. API 测试
print('\n=== Step 4: API 测试 ===')
for action in ['home-bundle', 'match-list', 'ranking-list', 'plan-list']:
    cmd = 'curl -o /dev/null -s -w "%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{"action":"' + action + '"}\''
    out, _ = run(cmd, timeout=30)
    ms = float(out.strip()) * 1000 if out.strip() else -1
    print(f'  {action}: {ms:.1f}ms')

SSH.close()
print('\n回退完成 - instances:1 fork 模式')
