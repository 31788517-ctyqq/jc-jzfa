#!/usr/bin/env python3
"""最终 API 基准测试"""
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 先清除 Redis 缓存（测试干净的首次请求）
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 --scan --pattern "zjfa:*" | xargs -r redis-cli -a qcredismaster01 del 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('清除旧缓存: ' + out.read().decode())

actions = [
    ('home-bundle', '2026-06-23'),
    ('match-list', '2026-06-23'),
    ('ranking-list', '2026-06-23|2026-06-23'),
    ('plan-list', '2026-06-23|all'),
]

for action, key in actions:
    d = '{"action":"' + action + '","dateStr":"' + key.split('|')[0] + '"}'
    if action == 'plan-list':
        d = '{"action":"plan-list","dateStr":"2026-06-23","qualityMode":"all"}'
    if action == 'ranking-list':
        d = '{"action":"ranking-list","date":"2026-06-23"}'
    
    cmd = 'curl -s -o /dev/null -w "%{time_total}" -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d \'' + d + '\''
    
    # 首次
    _, out, _ = SSH.exec_command(cmd, timeout=60)
    out.channel.settimeout(60)
    t1 = out.read().decode().strip()
    print(f'  {action} cold: {t1}s')
    
    time.sleep(2)
    
    # 二次
    _, out, _ = SSH.exec_command(cmd, timeout=60)
    out.channel.settimeout(60)
    t2 = out.read().decode().strip()
    print(f'  {action} cached: {t2}s')

# Redis keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis keys ===')
print(out.read().decode())

SSH.close()
