#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# 1. PM2 状态
_, out, _ = SSH.exec_command('pm2 jlist 2>/dev/null | node -e "process.stdin.on(\'data\',d=>{const j=JSON.parse(d);j.forEach(p=>console.log(p.name+\' pid=\'+p.pm_pid+\' status=\'+p.pm2_status+\' restarts=\'+p.pm2_restart_time+\' mem=\'+Math.round(p.monit.memory/1024/1024)+\'MB\'))})"', timeout=15)
out.channel.settimeout(15)
print('=== PM2 Status ===')
print(out.read().decode())

# 2. Redis AUTH 日志
_, out, _ = SSH.exec_command('grep -E "redis" /root/server/logs/out.log | tail -20', timeout=10)
out.channel.settimeout(10)
print('=== Redis Logs ===')
print(out.read().decode())

# 3. Redis keys
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 keys "zjfa:*" 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis zjfa keys ===')
print(out.read().decode())

# 4. Redis INFO
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 info memory 2>/dev/null | grep used_memory_human', timeout=10)
out.channel.settimeout(10)
print('=== Redis Memory ===')
print(out.read().decode())

SSH.close()
