const { Client } = require('ssh2');
const https = require('https');
const fs = require('fs');

/** 
 * 拉取 26058 数据 → 注入服务器 stats_bank → 重建功守道缓存
 */
(async () => {
  // 1. 本地拉取 26058 数据
  const apiData = await new Promise((resolve, reject) => {
    let d = '';
    https.get('https://m.100qiu.com/api/dcListBasic?dateTime=26058', { rejectUnauthorized: false }, res => {
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).data || []); } catch(e) { reject(e); }
      });
    }).on('error', reject).setTimeout(15000);
  });
  console.log('拉取 26058:', apiData.length, '场');

  // 2. 连接服务器
  const conn = new Client();
  await new Promise((r, j) => {
    conn.on('ready', r); conn.on('error', j);
    conn.connect({ host: '119.23.51.159', port: 22, username: 'root', password: 'znm19811225@', readyTimeout: 10000 });
  });
  console.log('Connected');

  // 3. 上传 stats_bank
  const sftp = await new Promise((r, j) => conn.sftp((e, s) => e ? j(e) : r(s)));
  const bankData = JSON.stringify({
    '_last_batch': '26058',
    '_raw_26058': apiData
  }, null, 2);
  await new Promise((r, j) => {
    sftp.writeFile('/tmp/gs_bank.json', bankData, 'utf8', (e) => e ? j(e) : r());
  });
  sftp.end();

  // 4. 服务器端：合并 bank + 重建缓存
  await new Promise((resolve) => {
    conn.exec(`cd /var/www/zj.100qiu.com && node -e "
var fs=require('fs');
var bank={};
var newBank=JSON.parse(fs.readFileSync('/tmp/gs_bank.json','utf8'));
if(fs.existsSync('server/stats_bank.json')){
  try{bank=JSON.parse(fs.readFileSync('server/stats_bank.json','utf8'))}catch(e){}
}
Object.keys(newBank).forEach(function(k){bank[k]=newBank[k]});
fs.writeFileSync('server/stats_bank.json',JSON.stringify(bank,null,2),'utf8');
console.log('stats_bank updated, _last_batch:',bank['_last_batch']);

// 重建缓存
var gs=require('/var/www/zj.100qiu.com/server/gongshoudao/index');
gs.writeCache({});
gs.refreshCache().then(function(r){
  var n=Object.keys(r).filter(function(k){return r[k]}).length;
  console.log('cache rebuilt:',n,'fields');
  process.exit(0);
}).catch(function(e){console.log('ERR:',e.message);process.exit(1)});
" 2>&1`, { timeout: 120000 }, (err, stream) => {
      if (err) { console.log('EXEC ERR:', err); return resolve(); }
      let o = '';
      stream.on('data', d => { o += d; process.stdout.write(d.toString()); });
      stream.stderr.on('data', d => { o += d; process.stderr.write(d.toString()); });
      stream.on('close', () => resolve());
    });
  });

  console.log('\n[Done]');
  conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
