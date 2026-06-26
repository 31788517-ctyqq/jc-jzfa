#!/usr/bin/env python3
"""测试 jc-zjfa API + Redis 缓存"""
import sys, io, time
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 1. 发送两次 home-bundle 请求（第一次冷启动，第二次缓存命中）
_, out, _ = SSH.exec_command('curl -s -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d \'{"action":"home-bundle","dateStr":"2026-06-23"}\' | python3 -c "import sys,json;d=json.load(sys.stdin);print(\'code=\'+str(d.get(\'code\'))+\' len=\'+str(len(json.dumps(d))))"', timeout=30)
out.channel.settimeout(30)
print('=== First home-bundle ===')
print(out.read().decode())

time.sleep(2)

_, out, _ = SSH.exec_command('curl -s -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -H "Host: zj.100qiu.com" -d \'{"action":"home-bundle","dateStr":"2026-06-23"}\' | python3 -c "import sys,json;d=json.load(sys.stdin);print(\'code=\'+str(d.get(\'code\'))+\' len=\'+str(len(json.dumps(d))))"', timeout=30)
out.channel.settimeout(30)
print('=== Second home-bundle ===')
print(out.read().decode())

time.sleep(1)

# 2. 查看 Redis keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis zjfa keys ===')
print(out.read().decode())

# 3. 查看 jc-zjfa 日志中的 Redis 信息
_, out, _ = SSH.exec_command('tail -20 /root/server/logs/out.log | grep -E "redis|cache"', timeout=10)
out.channel.settimeout(10)
print('=== Recent Redis/cache logs ===')
print(out.read().decode())

SSH.close()
