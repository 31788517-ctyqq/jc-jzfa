"""检查 Redis 缓存 keys"""
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

# 查看所有 Redis keys
print('\n=== Redis keys ===')
out, _ = run('redis-cli -a qcredismaster01 KEYS "*" 2>/dev/null | head -20')
print(out[:500])

# 查看 zjfa:resp keys
print('\n=== zjfa:resp keys ===')
out, _ = run('redis-cli -a qcredismaster01 KEYS "zjfa:*" 2>/dev/null')
print(out[:500])

# 查看 session keys
print('\n=== session keys ===')
out, _ = run('redis-cli -a qcredismaster01 KEYS "session:*" 2>/dev/null | wc -l')
print(f'  session keys: {out.strip()}')

SSH.close()
