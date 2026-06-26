"""直接测试 Redis AUTH"""
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

# 测试 redis-cli AUTH
print('\n=== redis-cli AUTH ===')
out, err = run('redis-cli -a qcredismaster01 AUTH qcredismaster01 2>/dev/null')
print(f'  AUTH result: {out.strip()}')

# 直接用 redis-cli SET
print('\n=== redis-cli SET ===')
out, err = run('redis-cli -a qcredismaster01 SET test_p3_key hello 2>/dev/null')
print(f'  SET result: {out.strip()}')

# 直接用 redis-cli GET
out, err = run('redis-cli -a qcredismaster01 GET test_p3_key 2>/dev/null')
print(f'  GET result: {out.strip()}')

# 清理
run('redis-cli -a qcredismaster01 DEL test_p3_key 2>/dev/null')

# 测试 Node.js redis-client 更详细
print('\n=== Node.js redis-client 详细测试 ===')
out, err = run('''cd /root/server && node -e "
const r = require('./core/redis-client');
(async () => {
  try {
    await r.init();
    console.log('after_init: connected='+r.isConnected()+' degraded='+r.isDegraded());
    
    // 测试 set (小值)
    try {
      const v1 = await r.set('test_p3_a', 'hello_world', 30000);
      console.log('set_result: '+v1);
    } catch(e) {
      console.log('set_error: '+e.message);
    }
    
    // 测试 get
    try {
      const v2 = await r.get('test_p3_a');
      console.log('get_result: '+v2);
    } catch(e) {
      console.log('get_error: '+e.message);
    }
    
    // 测试 setJSON
    try {
      const v3 = await r.setJSON('test_p3_json', {a:1, b:'test'}, 30000);
      console.log('setJSON_result: '+v3);
    } catch(e) {
      console.log('setJSON_error: '+e.message);
    }
    
    // 清理
    await r.del('test_p3_a');
    await r.del('test_p3_json');
    console.log('DONE');
    process.exit(0);
  } catch(e) {
    console.log('INIT_ERR: '+e.message);
    process.exit(1);
  }
})()"''', timeout=15)
print(out[:1000])

SSH.close()
