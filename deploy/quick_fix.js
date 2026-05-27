const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

(async () => {
  const conn = new Client();
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: '119.23.51.159', port: 22, username: 'root', password: 'znm19811225@' }); });
  
  // Upload fixed index.js  
  const sftp = await new Promise((r, j) => conn.sftp((e, s) => e ? j(e) : r(s)));
  const local = path.resolve(__dirname, '..', 'server', 'gongshoudao', 'index.js');
  await new Promise((r, j) => {
    sftp.fastPut(local, '/var/www/zj.100qiu.com/server/gongshoudao/index.js', {}, e => e ? j(e) : r());
  });
  sftp.end();
  console.log('index.js uploaded');

  // Restart PM2
  await new Promise(r => {
    conn.exec('cd /var/www/zj.100qiu.com && pm2 restart ecosystem.config.json 2>&1', (_, s) => {
      let o = ''; s.on('data', d => { o += d; process.stdout.write(d.toString()); }); s.on('close', r);
    });
  });
  await new Promise(r => setTimeout(r, 4000));
  console.log('\nPM2 restarted\n');

  // Verify
  console.log('Test gongshoudao API...');
  const https = require('https');
  const result = await new Promise(resolve => {
    let d = '';
    const body = JSON.stringify({ action: 'gongshoudao', matchId: '2039986' });
    const req = https.request('https://zj.100qiu.com/api', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
    });
    req.write(body); req.end();
  });
  
  const m = result.data || {};
  console.log('Result:', m.homeName, 'vs', m.visitName);
  console.log('  fallback:', result.fallback || false);
  console.log('  attack:', m.attackAdvantage);
  console.log('  ladder:', m.ladderLabel);
  console.log('  scores:', (m.scores || []).length);
  if (m.scores && m.scores.length > 0) {
    m.scores.slice(0, 3).forEach((s, i) => console.log('   ' + (i+1) + '.', s.score, s.percent));
  }

  conn.end();
})().catch(e => console.error(e));
