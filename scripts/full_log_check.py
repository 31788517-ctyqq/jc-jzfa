#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# pm2 状态
_, out, _ = SSH.exec_command('pm2 jlist | node -e "process.stdin.on(\'data\',d=>{try{const j=JSON.parse(d);j.forEach(p=>console.log(p.name+\' status=\'+p.pm2_status+\' pid=\'+p.pm_pid+\' mem=\'+Math.round(p.monit.memory/1024/1024)+\'MB\'))}catch(e){console.log(e.message)}})" 2>&1', timeout=10)
out.channel.settimeout(10)
print('=== PM2 Status ===')
print(out.read().decode())

# 完整日志（最近50行）
_, out, _ = SSH.exec_command('tail -50 /root/server/logs/out.log', timeout=10)
out.channel.settimeout(10)
print('=== Last 50 lines of out.log ===')
print(out.read().decode())

# error log
_, out, _ = SSH.exec_command('tail -20 /root/server/logs/error.log', timeout=10)
out.channel.settimeout(10)
print('=== Error log ===')
print(out.read().decode())

# Node.js redis init 测试（独立进程）
_, out, _ = SSH.exec_command('cd /root/server && REDIS_ENABLED=true REDIS_PASSWORD=qcredismaster01 REDIS_HOST=127.0.0.1 REDIS_PORT=6379 node -e "const r=require(\'./core/redis-client\');r.init().then(()=>{console.log(\'isConnected:\'+r.isConnected()+\' isDegraded:\'+r.isDegraded());process.exit(0)})"', timeout=15)
out.channel.settimeout(15)
print('=== Standalone Redis init test ===')
print(out.read().decode())

SSH.close()
