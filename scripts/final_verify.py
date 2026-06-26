#!/usr/bin/env python3
"""最终验证: Redis 连接 + API 缓存效果"""
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 等20秒让 jc-zjfa 完成启动和 Redis 连接
time.sleep(20)

# 1. Redis 连接日志
_, out, _ = SSH.exec_command('tail -5 /root/server/logs/out.log | grep redis', timeout=10)
out.channel.settimeout(10)
print('=== Redis connection logs ===')
print(out.read().decode())

# 2. Redis keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis zjfa keys ===')
keys = out.read().decode().strip()
print(keys)
print('Keys count: ' + str(len(keys.split('\n')) if keys else 0))

# 3. API 测试
for action in ['home-bundle', 'match-list', 'plan-list']:
    cmd = 'curl -s -o /dev/null -w "%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d \'{"action":"' + action + '","dateStr":"2026-06-23"}\''
    _, out, _ = SSH.exec_command(cmd, timeout=30)
    out.channel.settimeout(30)
    t1 = out.read().decode().strip()
    print(f'  {action} 1st: {t1}s')
    
    time.sleep(1)
    _, out, _ = SSH.exec_command(cmd, timeout=30)
    out.channel.settimeout(30)
    t2 = out.read().decode().strip()
    print(f'  {action} 2nd: {t2}s')

# 4. 再次检查 keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Final Redis keys ===')
print(out.read().decode())

# 5. pm2 状态
_, out, _ = SSH.exec_command('pm2 describe jc-zjfa 2>&1 | grep -E "status|restarts|uptime"', timeout=10)
out.channel.settimeout(10)
print('=== jc-zjfa PM2 ===')
print(out.read().decode())

SSH.close()
