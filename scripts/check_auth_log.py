"""检查 Redis AUTH 日志"""
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

# 查看日志
print('\n=== Redis AUTH 日志 ===')
out, _ = run('grep "redis" /root/server/logs/out.log | tail -20')
for line in out.split('\n'):
    if line.strip():
        print(f'  {line.strip()[:120]}')

# 测试 redis-client
print('\n=== Node.js redis-client 测试 ===')
out, err = run('''cd /root/server && node -e "
const r = require('./core/redis-client');
(async () => {
  await r.init();
  console.log('connected:'+r.isConnected()+' degraded:'+r.isDegraded());
  const v = await r.set('test_p3_v3', 'hello_v3', 30000);
  console.log('SET:'+v);
  const g = await r.get('test_p3_v3');
  console.log('GET:'+g);
  await r.del('test_p3_v3');
  process.exit(0);
})().catch(e=>{console.log('ERR:'+e.message);process.exit(1)})"''', timeout=15)
print(out[:500])
if err.strip():
    print(f'err: {err.strip()[:200]}')

SSH.close()
