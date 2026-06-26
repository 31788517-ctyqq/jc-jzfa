"""检查服务器上的 ecosystem.config.json"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh

SSH = get_ssh()

def run(cmd, timeout=15):
    _, stdout, stderr = SSH.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    stderr.channel.settimeout(timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 检查 ecosystem.config.json 内容
print('\n=== ecosystem.config.json 内容 ===')
out, _ = run('cat /root/server/ecosystem.config.json | head -15')
print(out)

# 检查 instances 和 exec_mode
print('\n=== instances/exec_mode ===')
out, _ = run('grep -E "instances|exec_mode|REDIS" /root/server/ecosystem.config.json')
print(out)

SSH.close()
