/** Deploy to production server via SFTP + SSH */
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';
const REMOTE_DIR = '/var/www/zj.100qiu.com';

const FILES = [
  'server/index.js',
  'server/simple.js',
  'server/data_sync.js',
  'server/token_manager.js',
  'server/oneshot_sync.js',
  'server/http-utils.js',
  'server/fetch_real_odds.js',
  'ecosystem.config.json',
  '.gitignore',
  'preview/app.js',
  'preview/index.html',
  'preview/js/pages/quant-rank.js',
  'preview/js/pages/match-pk.js',
];

const conn = new Client();

function execCmd(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    console.log('\n>>> ' + cmd);
    conn.exec(cmd, { timeout }, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { errOut += d.toString('utf8'); });
      stream.on('close', (code) => {
        if (out) console.log(out);
        if (errOut) console.log('[STDERR]', errOut);
        resolve({ out, err: errOut, code });
      });
    });
  });
}

function uploadAllFiles(sftp, fileList, baseDir, remoteBase) {
  return new Promise((resolve, reject) => {
    let i = 0;
    let pending = 0;
    const concurrency = 4; // limit concurrent transfers

    function next() {
      while (pending < concurrency && i < fileList.length) {
        const f = fileList[i++];
        const localPath = path.join(baseDir, f);
        const remotePath = remoteBase + '/' + f.replace(/\\/g, '/');

        if (!fs.existsSync(localPath)) {
          console.log('  SKIP (not found): ' + localPath);
          continue;
        }

        pending++;
        ensureDir(sftp, path.dirname(remotePath), () => {
          console.log('  UPLOAD: ' + f);
          const rs = fs.createReadStream(localPath);
          const ws = sftp.createWriteStream(remotePath, { mode: 0o644 });
          ws.on('close', () => { pending--; next(); });
          ws.on('error', (e) => {
            console.log('  FAILED: ' + f + ' - ' + e.message);
            pending--;
            next();
          });
          rs.pipe(ws);
        });
      }
      if (pending === 0 && i >= fileList.length) resolve();
    }
    next();
  });
}

function ensureDir(sftp, dirPath, cb) {
  const parts = dirPath.split('/').filter(Boolean);
  let current = '';
  let idx = 0;

  function step() {
    if (idx >= parts.length) return cb();
    current += '/' + parts[idx++];
    sftp.mkdir(current, { mode: 0o755 }, (e) => {
      // ignore "File exists" errors
      step();
    });
  }
  step();
}

(async () => {
  console.log('[*] Connecting to', HOST + '...');

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: HOST, port: 22, username: USER, password: PASS,
      readyTimeout: 15000
    });
  });

  console.log('[✓] Connected');

  // Get SFTP session once
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });
  console.log('[✓] SFTP session ready');

  // ─── Upload all files ───
  console.log('\n[Uploading ' + FILES.length + ' files...]');
  await uploadAllFiles(sftp, FILES, path.join(__dirname, '..'), REMOTE_DIR);

  // ─── Upload odds_history ───
  console.log('\n[Uploading odds_history...]');
  const oddsDir = path.join(__dirname, '..', 'server', 'odds_history');
  if (fs.existsSync(oddsDir)) {
    const oddsFiles = fs.readdirSync(oddsDir).filter(f => f.endsWith('.json')).map(f => 'server/odds_history/' + f);
    if (oddsFiles.length > 0) {
      await uploadAllFiles(sftp, oddsFiles, path.join(__dirname, '..'), REMOTE_DIR);
    }
  }

  // Close SFTP before running commands
  sftp.end();
  await new Promise(r => setTimeout(r, 1000));

  // ─── Install deps ───
  await execCmd('cd ' + REMOTE_DIR + '/server && npm install --production --no-optional 2>&1 | tail -5', 180000);

  // ─── Restart PM2 ───
  console.log('\n[Restarting PM2...]');
  await execCmd('cd ' + REMOTE_DIR + ' && pm2 delete jc-zjfa 2>/dev/null; pm2 start ecosystem.config.json 2>&1');
  await execCmd('cd ' + REMOTE_DIR + ' && pm2 save 2>&1');

  // ─── Verify ───
  await new Promise(r => setTimeout(r, 4000));
  await execCmd('pm2 status');
  console.log('\n[API Verification]');
  await execCmd("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"plan-list\",\"date\":\"2026-05-25\"}' 2>&1 | python -m json.tool 2>/dev/null | head -30");

  console.log('\n[✓] Deployment complete!');
  console.log('    Visit: https://zj.100qiu.com');

  conn.end();
})().catch(e => { console.error('[✗]', e.message); process.exit(1); });
