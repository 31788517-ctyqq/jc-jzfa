"""检查 PM2 jc-zjfa 进程的环境变量"""
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

# 通过 PM2 查看 jc-zjfa 的环境变量
print('\n=== PM2 jc-zjfa 环境变量 ===')
out, _ = run('pm2 show jc-zjfa 2>/dev/null | grep -i redis')
print(out[:500])

# 通过 jc-zjfa 内部检查 REDIS env
# 在 jc-zjfa 进程中添加临时日志：启动时打印 REDIS_PASSWORD
print('\n=== jc-zjfa 启动日志中的 Redis ===')
out, _ = run('grep "redis" /root/server/logs/out.log | tail -5')
print(out[:500])

# 检查 ecosystem.config.json 的 REDIS 配置
print('\n=== ecosystem.config.json REDIS 配置 ===')
out, _ = run('grep REDIS /root/server/ecosystem.config.json | head -5')
print(out[:500])

SSH.close()
