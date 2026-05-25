/** Fix database.js on production server */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';

const PATCHED_DB = fs.readFileSync(path.join(__dirname, '..', 'server', 'database_fallback.js'), 'utf8');

const conn = new Client();

function execCmd(cmd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    console.log('\n>>> ' + cmd.substring(0, 100));
    conn.exec(cmd, { timeout }, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { errOut += d.toString('utf8'); });
      stream.on('close', () => {
        if (out) console.log(out.substring(0, 2000));
        if (errOut) console.log('[STDERR]', errOut.substring(0, 500));
        resolve({ out, err: errOut });
      });
    });
  });
}

(async () => {
  console.log('[*] Connecting to ' + HOST + '...');

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: HOST, port: 22, username: USER, password: PASS,
      readyTimeout: 15000
    });
  });

  console.log('[✓] Connected');

  // Backup original
  await execCmd('cp /var/www/zj.100qiu.com/server/database.js /var/www/zj.100qiu.com/server/database.js.bak 2>/dev/null; echo ok');

  // Upload patched database.js
  console.log('\n[Uploading patched database.js...]');
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });

  await new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream('/var/www/zj.100qiu.com/server/database.js', { mode: 0o644 });
    ws.on('close', resolve);
    ws.on('error', reject);
    ws.end(PATCHED_DB);
  });
  console.log('  uploaded');

  sftp.end();
  await new Promise(r => setTimeout(r, 1000));

  // Restart PM2
  await execCmd('cd /var/www/zj.100qiu.com && pm2 restart ecosystem.config.json 2>&1');

  // Verify
  await new Promise(r => setTimeout(r, 5000));
  await execCmd('pm2 status');
  await execCmd("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"plan-list\",\"date\":\"2026-05-25\"}' 2>&1");

  console.log('\n[✓] Fix complete!');
  conn.end();
})().catch(e => { console.error('[x]', e.message); process.exit(1); });
