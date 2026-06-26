#!/usr/bin/env python3
"""Configure Redis with auth password"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh

ssh = get_ssh()
AUTH = '-a qcredismaster01'

def run(cmd, timeout=30):
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    return out, err

# Redis config with auth
print("=== Redis CONFIG (with auth) ===")
out, err = run(f'redis-cli {AUTH} CONFIG SET maxmemory 256mb')
print('maxmemory:', out.strip())
out, err = run(f'redis-cli {AUTH} CONFIG SET maxmemory-policy allkeys-lru')
print('LRU:', out.strip())
out, err = run(f'redis-cli {AUTH} CONFIG SET save "60 1000"')
print('save:', out.strip())

# Verify
print("\n=== Verify ===")
out, err = run(f'redis-cli {AUTH} INFO memory | grep used_memory_human')
print('Memory:', out.strip())
out, err = run(f'redis-cli {AUTH} DBSIZE')
print('Keys:', out.strip())

# Verify Node.js redis-client also has password in .env
out, err = run('grep REDIS_PASSWORD /root/server/.env')
print('Password in .env:', out.strip())

# Update ecosystem.config.json to include REDIS env vars
print("\n=== Check ecosystem env ===")
out, err = run('grep REDIS /root/server/ecosystem.config.json 2>/dev/null || echo "NO REDIS IN ECOSYSTEM"')
print('Ecosystem REDIS:', out.strip()[:200])

ssh.close()
print("[OK] Redis configured")
