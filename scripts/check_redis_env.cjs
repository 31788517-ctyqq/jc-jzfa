// 检查 REDIS 环境变量 + 测试 AUTH
const pw = process.env.REDIS_PASSWORD || '';
console.log('REDIS_PASSWORD=' + pw);
console.log('REDIS_PASSWORD_length=' + pw.length);
console.log('REDIS_ENABLED=' + process.env.REDIS_ENABLED);
console.log('REDIS_HOST=' + process.env.REDIS_HOST);
console.log('REDIS_PORT=' + process.env.REDIS_PORT);

// 测试 redis-client
const r = require('./core/redis-client');
(async () => {
  try {
    await r.init();
    console.log('after_init: connected=' + r.isConnected() + ' degraded=' + r.isDegraded());
    
    // 测试 SET
    const v1 = await r.set('test_p3_env', 'hello_env', 30000);
    console.log('SET_result: ' + v1);
    
    // 测试 GET
    const v2 = await r.get('test_p3_env');
    console.log('GET_result: ' + v2);
    
    await r.del('test_p3_env');
    process.exit(0);
  } catch (e) {
    console.log('ERR: ' + e.message);
    process.exit(1);
  }
})();
