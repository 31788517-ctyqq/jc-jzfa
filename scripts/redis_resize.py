"""增大 Redis maxmemory 到 512MB + 清除旧 GitLab keys"""
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

# 1. 增大 maxmemory
print('\n=== Step 1: 增大 Redis maxmemory 256MB->512MB ===')
out, _ = run('redis-cli -a qcredismaster01 CONFIG SET maxmemory 536870912 2>/dev/null')
print(f'  CONFIG SET: {out.strip()}')

# 查看当前 maxmemory
out, _ = run('redis-cli -a qcredismaster01 CONFIG GET maxmemory 2>/dev/null')
print(f'  maxmemory: {out.strip()}')

# 2. 查看 keys 数量
print('\n=== Step 2: Redis keys 数量 ===')
out, _ = run('redis-cli -a qcredismaster01 DBSIZE 2>/dev/null')
print(f'  DBSIZE: {out.strip()}')

# 3. 清除 GitLab resque 旧 keys (2025年的)
print('\n=== Step 3: 清除 2025 年的 GitLab resque keys ===')
out, _ = run('redis-cli -a qcredismaster01 --scan --pattern "resque:*" 2>/dev/null | wc -l')
print(f'  resque keys: {out.strip()}')

out, _ = run('redis-cli -a qcredismaster01 --scan --pattern "list:*" 2>/dev/null | wc -l')
print(f'  list keys: {out.strip()}')

# 删除 resque keys (安全: 这些是 GitLab 的统计数据，不是关键数据)
out, _ = run('redis-cli -a qcredismaster01 --scan --pattern "resque:gitlab:stat:failed:*" 2>/dev/null | xargs -r redis-cli -a qcredismaster01 DEL 2>/dev/null')
print(f'  清除 failed keys: {out.strip()[:200]}')

out, _ = run('redis-cli -a qcredismaster01 --scan --pattern "resque:gitlab:stat:processed:*" 2>/dev/null | xargs -r redis-cli -a qcredismaster01 DEL 2>/dev/null')
print(f'  清除 processed keys: {out.strip()[:200]}')

# 4. 查看 freed memory
print('\n=== Step 4: 释放后的内存 ===')
out, _ = run('redis-cli -a qcredismaster01 INFO memory 2>/dev/null | grep -E "used_memory_human|maxmemory_human|db0:keys"')
print(out)

out, _ = run('redis-cli -a qcredismaster01 DBSIZE 2>/dev/null')
print(f'  DBSIZE: {out.strip()}')

SSH.close()
print('\nRedis 清理完成')
