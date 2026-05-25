/** Check server data state */
const { Client } = require('ssh2');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';

const conn = new Client();

function run(cmd) {
  return new Promise((resolve) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return resolve('ERROR: ' + err.message);
      let out = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { out += d.toString('utf8'); });
      stream.on('close', () => resolve(out));
    });
  });
}

(async () => {
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
  });

  console.log('[1] data.json dates:');
  const r1 = await run('cd /var/www/zj.100qiu.com/server && node -e "var d=JSON.parse(require(\'fs\').readFileSync(\'data.json\',\'utf8\'));var dates={};Object.keys(d.m||{}).forEach(function(k){var dt=(d.m[k].date||\'\').slice(0,10);if(dt)dates[dt]=(dates[dt]||0)+1});var keys=Object.keys(dates).sort();console.log(\'First:\',keys[0],\'Last:\',keys[keys.length-1],\'Total:\',Object.keys(d.m||{}).length)"');
  console.log(r1);

  console.log('[2] odds_history files:');
  const r2 = await run('ls /var/www/zj.100qiu.com/server/odds_history/ 2>/dev/null | wc -l && ls /var/www/zj.100qiu.com/server/odds_history/ 2>/dev/null | tail -5');
  console.log(r2);

  console.log('[3] Backup files:');
  const r3 = await run('ls -la /var/www/zj.100qiu.com/server/*.bak 2>/dev/null; ls -la /var/www/zj.100qiu.com_old_* 2>/dev/null | head -10; ls -la /var/www/zj.100qiu.com_backup_* 2>/dev/null | head -10');
  console.log(r3);

  console.log('[4] DB file size:');
  const r4 = await run('ls -la /var/www/zj.100qiu.com/server/midou_data.db* 2>/dev/null');
  console.log(r4);

  console.log('[5] trends.json lines:');
  const r5 = await run('wc -l /var/www/zj.100qiu.com/server/trends.json 2>/dev/null; wc -c /var/www/zj.100qiu.com/server/trends.json 2>/dev/null');
  console.log(r5);

  conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
