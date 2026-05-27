/**
 * 功守道模块部署到生产服务器 119.23.51.159
 * 流程：上传文件 → 重启 PM2 → 预热缓存 → 验证
 */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';
const REMOTE = '/var/www/zj.100qiu.com';

const FILES = [
  // 功守道核心模块
  'server/gongshoudao/fetch.js',
  'server/gongshoudao/parser.js',
  'server/gongshoudao/attack.js',
  'server/gongshoudao/goal.js',
  'server/gongshoudao/diff.js',
  'server/gongshoudao/score.js',
  'server/gongshoudao/index.js',
  // 修改的文件
  'server/index.js',
  'preview/js/pages/gongshoudao.js',
  'preview/js/pages/match-list.js',
  'preview/index.html',
];

const conn = new Client();

function run(cmd, timeout = 60000) {
  return new Promise((resolve) => {
    console.log('>>> ' + cmd.substring(0, 100));
    conn.exec(cmd, (err, stream) => {
      if (err) return resolve('ERROR: ' + err.message);
      let out = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { out += d.toString('utf8'); });
      stream.on('close', () => {
        if (out.trim()) console.log(out.trim().substring(0, 1500));
        resolve(out);
      });
    });
  });
}

(async () => {
  console.log('[*] 连接服务器', HOST + '...');
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
  });
  console.log('[✓] 已连接\n');

  // 1. 上传文件
  console.log('=== [1] 上传文件 ===');
  const localBase = path.resolve(__dirname, '..');
  
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });

  for (const f of FILES) {
    const localPath = path.join(localBase, f);
    const remotePath = REMOTE + '/' + f;
    if (!fs.existsSync(localPath)) {
      console.log('  SKIP (不存在):', f);
      continue;
    }
    await new Promise((resolve, reject) => {
      console.log('  UPLOAD:', f, '(' + fs.statSync(localPath).size + 'B)');
      sftp.fastPut(localPath, remotePath, {}, (err) => {
        if (err) {
          console.log('  ERR:', err.message);
          resolve(); // 继续上传其他文件
        } else {
          resolve();
        }
      });
    });
  }
  sftp.end();
  
  // 确保新目录存在
  await run('mkdir -p ' + REMOTE + '/server/gongshoudao');
  console.log('[✓] 文件上传完成\n');

  // 2. 重启服务
  console.log('=== [2] 重启 PM2 ===');
  await run('cd ' + REMOTE + ' && pm2 restart ecosystem.config.json 2>&1');
  await new Promise(r => setTimeout(r, 3000));
  await run('pm2 status 2>&1');
  console.log('[✓] 服务已重启\n');

  // 3. 预热功守道缓存
  console.log('=== [3] 预热功守道缓存 ===');
  await run(`cd ${REMOTE} && node -e "
try {
  var gs = require('./server/gongshoudao/index');
  gs.writeCache({});
  gs.refreshCache().then(function(r) {
    var ids = Object.keys(r).filter(function(k) { return r[k]; });
    console.log('缓存已生成:', ids.length, '场');
    process.exit(0);
  }).catch(function(e) {
    console.log('ERR:', e.message);
    process.exit(1);
  });
} catch(e) {
  console.log('预热失败:', e.message);
  process.exit(1);
}
" 2>&1`, 120000);
  console.log();

  // 4. 验证 API
  console.log('=== [4] 验证 API ===');
  await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"match-list\",\"date\":\"2026-05-26\"}' 2>&1 | python3 -c \"import sys,json; d=json.load(sys.stdin); print('match-list:', len(d.get('data',[])),'场, hasGS:', sum(1 for m in d.get('data',[]) if m.get('hasGongshoudao')),'场')\" 2>/dev/null || echo '(API 验证需要稍等)'");
  
  await new Promise(r => setTimeout(r, 2000));
  await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"gongshoudao\",\"matchId\":\"2038854\"}' 2>&1 | python3 -c \"import sys,json; d=json.load(sys.stdin); r=d.get('data',{}); print('gongshoudao:', r.get('homeName','?'), 'vs', r.get('visitName','?'), '|', r.get('ladderLabel','?'))\" 2>/dev/null || echo '(单场API 验证稍后)'");
  console.log();

  console.log('[✓] 部署完成！');
  console.log('  访问: https://zj.100qiu.com');
  conn.end();
})().catch(e => { console.error('[✗]', e.message); process.exit(1); });
