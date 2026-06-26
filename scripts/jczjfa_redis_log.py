#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# grep 所有 redis 相关日志
_, out, _ = SSH.exec_command('cat /root/server/logs/out.log | grep redis | tail -10', timeout=10)
out.channel.settimeout(10)
print('=== jc-zjfa Redis logs ===')
print(out.read().decode())

# 检查 jc-zjfa 进程内 Redis 是否正常
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null | wc -l', timeout=10)
out.channel.settimeout(10)
print('=== Redis zjfa keys count ===')
print(out.read().decode())

# pm2 jc-zjfa 状态
_, out, _ = SSH.exec_command('pm2 describe jc-zjfa 2>&1 | grep -E "status|pid|memory|uptime|restart"', timeout=10)
out.channel.settimeout(10)
print('=== jc-zjfa PM2 ===')
print(out.read().decode())

SSH.close()
