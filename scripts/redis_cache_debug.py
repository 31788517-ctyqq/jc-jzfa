"""检查 Redis 缓存写入日志"""
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

# 查看日志中的 redis-cache 相关信息
print('\n=== redis-cache 日志 ===')
out, _ = run('grep -i "redis-cache\\|redis.*set\\|redis.*get\\|zjfa:resp" /root/server/logs/out.log | tail -30')
print(out[:1000])

# 查看日志中的 redis-cache error
print('\n=== redis-cache error ===')
out, _ = run('grep -i "redis-cache.*error\\|redis.*error" /root/server/logs/error.log | tail -10')
print(out[:500])

# 再次测试 API + 查看日志
print('\n=== 触发 API + 查看日志 ===')
run('curl -s -X POST http://127.0.0.1:3000/api -H "Content-Type: application/json" -d \'{"action":"match-list"}\' > /dev/null', timeout=30)
import time; time.sleep(2)
out, _ = run('grep -i "redis-cache" /root/server/logs/out.log | tail -10')
print(out[:500])

# 查看 Redis keys
print('\n=== Redis zjfa:resp keys ===')
out, _ = run('redis-cli -a qcredismaster01 KEYS "zjfa:resp:*" 2>/dev/null')
print(out[:500])

# 查看 Redis info memory
print('\n=== Redis memory ===')
out, _ = run('redis-cli -a qcredismaster01 INFO memory 2>/dev/null | grep -E "used_memory_human|maxmemory_human|keys"')
print(out[:200])

SSH.close()
