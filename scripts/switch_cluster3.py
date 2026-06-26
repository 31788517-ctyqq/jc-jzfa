"""切换 PM2 到 cluster:3 模式"""
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

# ★ cluster:3 切换必须 pm2 kill (不能用 pm2 restart/reload)
# pm2 dump 会覆盖 ecosystem.config.json，所以必须 pm2 kill

print('\n=== Step 1: pm2 kill (清除旧进程) ===')
out, _ = run('pm2 kill', timeout=15)
print(f'  {out.strip()[:200]}')

print('\n=== Step 2: 确认无残留 ===')
out, _ = run('ps aux | grep "node.*index.js" | grep -v grep | wc -l', timeout=10)
print(f'  残留进程: {out.strip()}')

print('\n=== Step 3: pm2 start ecosystem.config.json ===')
out, err = run('cd /root/server && pm2 start ecosystem.config.json', timeout=30)
print(f'  {out.strip()[:300]}')
if err.strip():
    print(f'  err: {err.strip()[:200]}')

print('\n=== Step 4: 等待启动 + pm2 list ===')
import time
time.sleep(5)
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
    print(f'  {out.strip()[:200]}')

print('\n=== Step 5: pm2 save (持久化新配置) ===')
out, _ = run('pm2 save', timeout=10)
print(f'  {out.strip()[:100]}')

SSH.close()
print('\ncluster:3 切换完成')
