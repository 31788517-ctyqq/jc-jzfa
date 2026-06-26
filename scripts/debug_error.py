"""查看 jc-zjfa 错误日志"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh

SSH = get_ssh()

def run(cmd, timeout=30):
    _, stdout, stderr = SSH.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    stderr.channel.settimeout(timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 查看错误日志
print('\n=== jc-zjfa 错误日志 (最近 50 行) ===')
out, _ = run('tail -50 /root/server/logs/error.log')
print(out)

# 查看输出日志
print('\n=== jc-zjfa 输出日志 (最近 30 行) ===')
out, _ = run('tail -30 /root/server/logs/out.log')
print(out)

# PM2 show jc-zjfa
print('\n=== pm2 show jc-zjfa ===')
out, _ = run('pm2 show jc-zjfa', timeout=10)
for line in out.split('\n'):
    line = line.strip()
    if any(k in line.lower() for k in ['error', 'err', 'restart', 'status', 'exec', 'instances', 'exit', 'message', 'script', 'node']):
        print(f'  {line[:120]}')

SSH.close()
