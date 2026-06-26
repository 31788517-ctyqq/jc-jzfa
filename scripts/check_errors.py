#!/usr/bin/env python3
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'scripts')
from ssh_utils import get_ssh

SSH = get_ssh()

# error log
_, out, _ = SSH.exec_command('tail -30 /root/server/logs/error.log', timeout=10)
out.channel.settimeout(10)
print('=== Error log ===')
print(out.read().decode())

# jc-zjfa out.log 最近10行
_, out, _ = SSH.exec_command('tail -10 /root/server/logs/out.log', timeout=10)
out.channel.settimeout(10)
print('=== Out.log last 10 ===')
print(out.read().decode())

SSH.close()
