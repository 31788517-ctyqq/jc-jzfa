"""手动上传 ecosystem.config.json + pm2 kill + restart cluster:3"""
import sys, os, io
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

# 1. SFTP 上传 ecosystem.config.json
print('\n=== Step 1: SFTP 上传 ecosystem.config.json ===')
local_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'ecosystem.config.json')
remote_path = '/root/server/ecosystem.config.json'

sftp = SSH.open_sftp()
sftp.put(local_path, remote_path)
print(f'  [OK] {local_path} -> {remote_path}')
sftp.close()

# 验证上传内容
out, _ = run('grep -E "instances|exec_mode|REDIS_ENABLED" /root/server/ecosystem.config.json | head -10')
print(f'  验证: {out.strip()}')

# 2. pm2 kill
print('\n=== Step 2: pm2 kill ===')
out, _ = run('pm2 kill', timeout=15)
print(f'  {out.strip()[:200]}')

import time
time.sleep(3)

# 3. 确认无残留
print('\n=== Step 3: 确认无残留 ===')
out, _ = run('ps aux | grep "node.*index.js" | grep -v grep | wc -l', timeout=10)
print(f'  残留进程: {out.strip()}')

# 4. pm2 start with new ecosystem.config.json
print('\n=== Step 4: pm2 start ecosystem.config.json ===')
out, err = run('cd /root/server && pm2 start ecosystem.config.json', timeout=30)
print(f'  {out.strip()[:300]}')

time.sleep(5)

# 5. 验证 cluster:3
print('\n=== Step 5: 验证 cluster:3 ===')
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
except Exception as e:
    print(f'  解析失败: {e}')
    print(f'  {out.strip()[:200]}')

# 6. pm2 save
print('\n=== Step 6: pm2 save ===')
out, _ = run('pm2 save', timeout=10)
print(f'  {out.strip()[:100]}')

SSH.close()
print('\ncluster:3 切换完成')
