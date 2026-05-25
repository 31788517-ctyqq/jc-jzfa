/** Deploy to production server via SSH */
const { Client } = require('ssh2');
const { execSync } = require('child_process');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';

const conn = new Client();

function runCmd(cmd, timeout = 120000) {
  return new Promise((resolve, reject) => {
    console.log('\n>>> ' + cmd);
    conn.exec(cmd, { timeout }, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { errOut += d.toString('utf8'); });
      stream.on('close', () => {
        if (out) console.log(out);
        if (errOut) console.log('[STDERR]', errOut);
        resolve({ out, err: errOut });
      });
    });
  });
}

(async () => {
  console.log('[*] Connecting to', HOST + '...');

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: HOST, port: 22, username: USER, password: PASS,
      algorithms: { kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group1-sha1'],
        serverHostKey: ['ssh-rsa', 'ssh-dss'] },
      readyTimeout: 15000
    });
  });

  console.log('[✓] Connected to 119.23.51.159');

  // 1. Check state
  await runCmd('cd /var/www/zj.100qiu.com && git log --oneline -3 2>/dev/null || echo "NOT_GIT_REPO"');
  await runCmd('pm2 status');

  // 2. Pull latest code (try git, fallback to zip)
  const { out: pullOut } = await runCmd(
    'cd /var/www/zj.100qiu.com && (git pull origin master 2>&1 || ' +
    '(curl -sL -o /tmp/jc-zjfa.zip https://codeload.github.com/31788517-ctyqq/jc-jzfa/zip/refs/heads/master && ' +
    'cd /tmp && unzip -qo jc-zjfa.zip && rsync -a /tmp/jc-zjfa-master/ /var/www/zj.100qiu.com/ && ' +
    'rm -rf /tmp/jc-zjfa-master /tmp/jc-zjfa.zip && echo "DEPLOYED_VIA_ZIP"))'
  );

  // 3. Install deps
  await runCmd('cd /var/www/zj.100qiu.com/server && npm install --production --no-optional 2>&1 | tail -5', 180000);

  // 4. Restart PM2
  await runCmd('cd /var/www/zj.100qiu.com && pm2 restart ecosystem.config.json 2>&1');

  // 5. Verify
  await new Promise(r => setTimeout(r, 3000));
  await runCmd('pm2 status');
  await runCmd('curl -s -X POST http://127.0.0.1:3000/api -H \'Content-Type: application/json\' -d \'{"action":"plan-list","date":"2026-05-25"}\' 2>&1 | head -5');

  console.log('\n[✓] Deployment complete!');
  console.log('    Visit: https://zj.100qiu.com');

  conn.end();
})().catch(e => { console.error('[✗]', e.message); process.exit(1); });
