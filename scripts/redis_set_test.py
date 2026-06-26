"""直接测试 Redis setJSON"""
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

# 测试 Redis RESP 协议 setJSON
print('\n=== 直接测试 redis-client setJSON ===')
out, err = run('''cd /root/server && node -e "
const r = require('./core/redis-client');
r.init().then(async () => {
  console.log('connected:'+r.isConnected());
  // 小值测试
  const v1 = await r.set('test_p3_small', JSON.stringify({a:1}), 30000);
  console.log('set_small:'+v1);
  // 大值测试 (模拟 API 响应)
  const bigObj = {code:1, matches: Array(100).fill({num:'001',home:'xxx',visit:'yyy',score:'2-1'})};
  const bigJson = JSON.stringify(bigObj);
  console.log('big_size:'+bigJson.length+' bytes');
  const v2 = await r.setJSON('zjfa:resp:test:2026-06-23', bigObj, 30000);
  console.log('set_big:'+v2);
  // 读取验证
  const v3 = await r.getJSON('zjfa:resp:test:2026-06-23');
  console.log('get_big:'+ (v3 ? 'OK length='+JSON.stringify(v3).length : 'NULL'));
  const v4 = await r.get('test_p3_small');
  console.log('get_small:'+v4);
  // 清理
  await r.del('test_p3_small');
  await r.del('zjfa:resp:test:2026-06-23');
  console.log('DONE');
  process.exit(0);
}).catch(e => { console.log('ERR:'+e.message); process.exit(1); })
"''', timeout=15)
print(out[:1000])
if err.strip():
    print(f'err: {err.strip()[:500]}')

SSH.close()
