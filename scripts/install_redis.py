#!/usr/bin/env python3
"""Install Redis on server and verify connection"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh

ssh = get_ssh()

def run(cmd, timeout=30):
    print(f'\n>>> {cmd[:80]}')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# 1. Check Redis
print("=== Step 1: Check Redis ===")
out, err = run('which redis-server && redis-cli ping 2>/dev/null')
if out and 'PONG' in out:
    print('Redis installed and running [OK]')
elif out and 'redis-server' in out:
    print('Redis installed, starting...')
    run('redis-server --daemonize yes && sleep 1 && redis-cli ping')
else:
    print('Installing Redis...')
    out, err = run('apt-get update -qq && apt-get install -y redis-server', timeout=120)
    if err and ('Unable' in err or 'E:' in err):
        print('apt failed, trying yum...')
        run('yum install -y redis', timeout=120)
    run('redis-server --daemonize yes && sleep 2 && redis-cli ping')

# 2. Verify Redis ping
print("\n=== Step 2: Redis ping ===")
out, err = run('redis-cli ping')
print('Result:', out.strip() if out else err.strip()[:200])

# 3. Config Redis
print("\n=== Step 3: Redis config (256MB + LRU) ===")
out, err = run('redis-cli CONFIG SET maxmemory 256mb && redis-cli CONFIG SET maxmemory-policy allkeys-lru && redis-cli CONFIG SET save "60 1000"')
print('Config:', out.strip() if out else (err[:200] if err else 'OK'))

# 4. Node.js Redis test
print("\n=== Step 4: Node.js redis-client test ===")
out, err = run("""cd /root/server && node -e "const r=require('./core/redis-client');r.init().then(()=>{console.log('connected:'+r.isConnected()+' degraded:'+r.isDegraded());r.set('test_p2','hello',5000).then(()=>r.get('test_p2')).then(v=>{console.log('GET='+v);r.del('test_p2').then(()=>console.log('DEL=OK'))})}).catch(e=>console.log('ERR:'+e.message))" """, timeout=15)
print('Result:', out.strip() if out else (err[:300] if err else ''))

# 5. .env REDIS_ENABLED
print("\n=== Step 5: .env REDIS_ENABLED ===")
out, err = run('grep REDIS /root/server/.env 2>/dev/null')
if out and 'REDIS_ENABLED' in out:
    print('Already configured:', out.strip())
else:
    print('Adding...')
    run("""cat >> /root/server/.env << 'EOF'

# Redis (P2: cluster:3 prerequisite)
REDIS_ENABLED=true
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
EOF""")
    out, err = run('grep REDIS /root/server/.env')
    print('Config:', out.strip())

ssh.close()
print("\n[OK] Redis install+config done")
