/**
 * 生产服务器数据备份（部署前）
 * 连接 119.23.51.159 备份所有关键数据文件
 */
const { Client } = require('ssh2');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';
const PROJECT_PATH = '/var/www/zj.100qiu.com';
const BACKUP_DIR = '/root/backups/jc-zjfa';

const conn = new Client();

function run(cmd) {
  return new Promise((resolve) => {
    console.log('\n>>> ' + cmd.substring(0, 120));
    conn.exec(cmd, (err, stream) => {
      if (err) return resolve('ERROR: ' + err.message);
      let out = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { out += d.toString('utf8'); });
      stream.on('close', () => {
        if (out.trim()) console.log(out.trim().substring(0, 2000));
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

  // 1. 当前数据情况
  console.log('=== [1] 当前数据状态 ===');
  await run(`ls -lh ${PROJECT_PATH}/server/data.json ${PROJECT_PATH}/server/trends.json ${PROJECT_PATH}/server/ai_cache.json 2>/dev/null`);
  await run(`ls -lh ${PROJECT_PATH}/server/midou_data.db 2>/dev/null`);
  await run(`ls -lh ${PROJECT_PATH}/server/gongshoudao/cache.json ${PROJECT_PATH}/server/gongshoudao/cache.json 2>/dev/null || echo "(功守道缓存不存在)"`);
  await run(`ls -lh ${PROJECT_PATH}/server/stats_bank.json 2>/dev/null || echo "(stats_bank不存在)"`);

  // 2. data.json 数据统计
  console.log('\n=== [2] data.json 统计 ===');
  await run(`cd ${PROJECT_PATH}/server && node -e "var d=JSON.parse(require('fs').readFileSync('data.json','utf8'));var dates={};var total=0;Object.keys(d.m||{}).forEach(function(k){var dt=(d.m[k].date||'').slice(0,10);if(dt){dates[dt]=(dates[dt]||0)+1;total++}});var keys=Object.keys(dates).sort();console.log('比赛总数:',total,'日期范围:',keys[0]+'~'+keys[keys.length-1],'天数:',keys.length)"`);
  await run(`cd ${PROJECT_PATH}/server && node -e "var d=JSON.parse(require('fs').readFileSync('data.json','utf8'));var dates={};Object.keys(d.m||{}).forEach(function(k){var dt=d.m[k].date;if(!dt)return;var d0=dt.slice(0,10);dates[d0]=(dates[d0]||0)+1});var ks=Object.keys(dates).sort();ks.slice(-5).forEach(function(k){console.log(k,dates[k]+'场')})"`);

  // 3. 创建备份目录
  console.log('\n=== [3] 创建备份 ===');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = BACKUP_DIR + '_' + timestamp;
  
  await run(`mkdir -p ${backupPath}/server/gongshoudao`);
  await run(`mkdir -p ${backupPath}/server/odds_history`);

  // 4. 备份核心数据文件
  console.log('\n=== [4] tar 打包 ===');
  await run(`cd ${PROJECT_PATH} && tar czf ${backupPath}/server_data.tar.gz \
    server/data.json \
    server/data.json.latest \
    server/data_all.json \
    server/trends.json \
    server/ai_cache.json \
    server/gongshoudao/cache.json \
    server/stats_bank.json \
    server/odds_history/ \
    2>/dev/null && echo "OK" || echo "部分文件不存在"`);

  // 5. 备份数据库文件
  await run(`cp ${PROJECT_PATH}/server/midou_data.db ${backupPath}/server/midou_data.db 2>/dev/null && echo "DB copied" || echo "(DB不存在)"`);
  await run(`cp ${PROJECT_PATH}/server/midou_data.db-wal ${backupPath}/server/midou_data.db-wal 2>/dev/null; cp ${PROJECT_PATH}/server/midou_data.db-shm ${backupPath}/server/midou_data.db-shm 2>/dev/null; echo "WAL files copied"`);

  // 6. 备份 PM2 配置
  await run(`cp ${PROJECT_PATH}/ecosystem.config.json ${backupPath}/ecosystem.config.json 2>/dev/null && echo "PM2 config"`);

  // 7. 验证
  console.log('\n=== [5] 备份验证 ===');
  await run(`ls -lhR ${backupPath}/`);
  await run(`tar tzf ${backupPath}/server_data.tar.gz 2>/dev/null | head -30`);

  // 8. 清理30天前的旧备份
  console.log('\n=== [6] 清理旧备份 ===');
  await run(`find /root/backups/ -maxdepth 1 -type d -name "jc-zjfa_*" -mtime +30 -exec rm -rf {} \\; 2>/dev/null; echo "Done"`);
  await run(`ls -d /root/backups/jc-zjfa_* 2>/dev/null | tail -5`);

  console.log('\n[✓] 备份完成:', backupPath);
  conn.end();
})().catch(e => { console.error('[✗]', e.message); process.exit(1); });
