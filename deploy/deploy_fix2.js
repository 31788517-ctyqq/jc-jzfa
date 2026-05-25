/** Upload fix: database_fallback.js + index.js with income-stats */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';
const REMOTE = '/var/www/zj.100qiu.com';

const conn = new Client();

function run(cmd) {
  return new Promise((resolve) => {
    console.log('\n>>> ' + cmd.substring(0, 120));
    conn.exec(cmd, (err, stream) => {
      if (err) return resolve('ERROR: ' + err.message);
      let out = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { out += d.toString('utf8'); });
      stream.on('close', () => { console.log(out.substring(0, 2000)); resolve(out); });
    });
  });
}

function upload(sftp, localFile, remotePath) {
  return new Promise((resolve, reject) => {
    console.log('  UPLOAD: ' + localFile + ' -> ' + remotePath);
    const rs = fs.createReadStream(localFile);
    const ws = sftp.createWriteStream(remotePath, { mode: 0o644 });
    ws.on('close', resolve);
    ws.on('error', reject);
    rs.pipe(ws);
  });
}

(async () => {
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
  });

  console.log('[✓] Connected');

  // Upload both files
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });

  const baseDir = path.join(__dirname, '..');

  await upload(sftp,
    path.join(baseDir, 'server', 'database_fallback.js'),
    REMOTE + '/server/database.js');
  console.log('  database.js ✓');

  await upload(sftp,
    path.join(baseDir, 'server', 'index.js'),
    REMOTE + '/server/index.js');
  console.log('  index.js ✓');

  sftp.end();
  await new Promise(r => setTimeout(r, 1000));

  // Restart PM2
  await run('cd ' + REMOTE + ' && pm2 restart all 2>&1');

  // Wait and verify
  await new Promise(r => setTimeout(r, 5000));
  await run('pm2 status');

  // Test all APIs
  console.log('\n=== API Tests ===');
  await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"income-stats\",\"days\":7}' 2>&1 | head -5");
  await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"hit-rate-stats\",\"days\":30}' 2>&1 | head -5");
  await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"plan-list\",\"date\":\"2026-05-25\"}' 2>&1 | head -5");
  await run("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"week-dates\"}' 2>&1");

  console.log('\n[✓] Fix deployed!');
  conn.end();
})().catch(e => { console.error('[x]', e.message); process.exit(1); });
