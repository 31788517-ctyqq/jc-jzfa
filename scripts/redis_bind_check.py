#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# Redis 配置
_, out, _ = SSH.exec_command('redis-cli -a qcredismaster01 CONFIG GET bind 2>/dev/null', timeout=10)
out.channel.settimeout(10)
print('=== Redis bind ===')
print(out.read().decode())

# Redis 监听端口
_, out, _ = SSH.exec_command('ss -tlnp | grep 6379', timeout=10)
out.channel.settimeout(10)
print('=== Redis listening ===')
print(out.read().decode())

# Node.js TCP 连接测试
_, out, _ = SSH.exec_command('cd /root/server && node -e "const net=require(\'net\');const s=net.createConnection(6379,\'127.0.0.1\');s.on(\'connect\',()=>{console.log(\'CONNECTED\');s.end()});s.on(\'error\',(e)=>{console.log(\'ERROR:\'+e.message)});setTimeout(()=>{console.log(\'TIMEOUT_NO_CONNECT\');s.destroy();process.exit(0)},3000)"', timeout=10)
out.channel.settimeout(10)
print('=== Node.js TCP test ===')
print(out.read().decode())

SSH.close()
