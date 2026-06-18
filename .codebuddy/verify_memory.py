# -*- coding: utf-8 -*-
import paramiko, json, os, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PASS = os.environ.get('DEPLOY_SSH_PASS')
if not PASS:
    with open('.env.deploy', 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line.startswith('DEPLOY_SSH_PASS='):
                PASS = line.split('=', 1)[1].strip().strip('"').strip("'")
                break

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('119.23.51.159', username='root', password=PASS, timeout=10)

# --- Check health first ---
s, o, e = ssh.exec_command('curl -s http://localhost:3000/health 2>/dev/null', timeout=10)
health = o.read().decode('utf-8', errors='replace').strip()
print('Health:', health)

# --- PM2 status ---
s, o, e = ssh.exec_command('pm2 jlist 2>/dev/null', timeout=10)
raw = o.read().decode('utf-8', errors='replace').strip()
if not raw or raw == '[]':
    print('PM2: No apps running! Trying to start...')
    s, o, e = ssh.exec_command('cd /root/server && pm2 start ecosystem.config.json 2>&1', timeout=30)
    print(o.read().decode('utf-8', errors='replace').strip())
    import time
    time.sleep(5)
    s, o, e = ssh.exec_command('pm2 jlist 2>/dev/null', timeout=10)
    raw = o.read().decode('utf-8', errors='replace').strip()

data = json.loads(raw) if raw else []
print('PM2 apps:', len(data))

for p in data:
    name = p.get('name', '?')
    status = (p.get('pm2_env') or {}).get('status', '?')
    mem_mb = round((p.get('monit') or {}).get('memory', 0) / 1048576)
    limit_bytes = (p.get('pm2_env') or {}).get('max_memory_restart', 0)
    limit_mb = round(limit_bytes / 1048576)
    pid = p.get('pid', '?')

    expected = 768 if name in ('jc-zjfa', 'jc-sync') else 128
    ok = abs(limit_mb - expected) <= 10
    flag = '[OK]' if ok else '[EXPECTED {}MB]'.format(expected)

    print('{}: pid={} status={} mem={}MB limit={}MB {}'.format(name, pid, status, mem_mb, limit_mb, flag))

ssh.close()
