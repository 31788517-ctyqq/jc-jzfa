"""上传并运行 check_redis_env.cjs"""
import sys, os, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

sys.path.insert(0, os.path.dirname(__file__))
from ssh_utils import get_ssh
import paramiko

SSH = get_ssh()

def run(cmd, timeout=15):
    _, stdout, stderr = SSH.exec_command(cmd, timeout=timeout)
    stdout.channel.settimeout(timeout)
    stderr.channel.settimeout(timeout)
    return stdout.read().decode('utf-8', errors='replace'), stderr.read().decode('utf-8', errors='replace')

# 上传脚本
local_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'scripts', 'check_redis_env.cjs')
sftp = SSH.open_sftp()
sftp.put(local_path, '/root/server/check_redis_env.cjs')
sftp.close()
print('[OK] upload check_redis_env.cjs')

# 运行脚本（PM2 环境下有 REDIS env）
print('\n=== 运行 check_redis_env.cjs (PM2 env) ===')
out, err = run('cd /root/server && REDIS_ENABLED=true REDIS_HOST=127.0.0.1 REDIS_PORT=6379 REDIS_PASSWORD=qcredismaster01 node check_redis_env.cjs', timeout=15)
print(out[:1000])
if err.strip():
    print(f'err: {err.strip()[:200]}')

SSH.close()
