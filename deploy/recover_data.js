/** Recover overwritten data on production server */
const { Client } = require('ssh2');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';

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
        console.log(out.substring(0, 1500));
        resolve(out);
      });
    });
  });
}

(async () => {
  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 15000 });
  });

  // 1. Check old deployment directories for data.json
  console.log('\n=== [1] Old deployment dirs ===');
  await run('ls -d /var/www/zj.100qiu.com_old_* 2>/dev/null; ls -d /var/www/zj.100qiu.com_backup_* 2>/dev/null');

  // 2. Check old dir for data.json
  const oldDirs = await run('ls -d /var/www/zj.100qiu.com_old_* 2>/dev/null');
  if (oldDirs && oldDirs.trim()) {
    const dirs = oldDirs.trim().split('\n');
    for (const dir of dirs.slice(0, 1)) {
      console.log('\n--- Checking ' + dir + ' ---');
      await run('ls -la ' + dir + '/server/data.json 2>/dev/null && wc -c ' + dir + '/server/data.json');
      await run('ls ' + dir + '/server/odds_history/ 2>/dev/null | wc -l');
    }
  }

  const backupDirs = await run('ls -d /var/www/zj.100qiu.com_backup_* 2>/dev/null');
  if (backupDirs && backupDirs.trim()) {
    const dirs = backupDirs.trim().split('\n');
    for (const dir of dirs.slice(0, 1)) {
      console.log('\n--- Checking ' + dir + ' ---');
      await run('ls -la ' + dir + '/server/data.json 2>/dev/null && wc -c ' + dir + '/server/data.json');
    }
  }

  // 3. Restore trends.json from backup
  console.log('\n=== [2] Restore trends.json ===');
  await run('cp /var/www/zj.100qiu.com/server/trends.json.bak /var/www/zj.100qiu.com/server/trends.json && echo "trends.json restored" && wc -c /var/www/zj.100qiu.com/server/trends.json');

  // 4. Check data.json details
  console.log('\n=== [3] Current data.json details ===');
  await run('cd /var/www/zj.100qiu.com/server && node -e "var d=JSON.parse(require(\'fs\').readFileSync(\'data.json\',\'utf8\'));var rKeys=Object.keys(d.r||{});var rTotal=0;rKeys.forEach(function(k){rTotal+=d.r[k].length});console.log(\'matches:\',Object.keys(d.m||{}).length,\' recGroups:\',rKeys.length,\' recTotal:\',rTotal)"');

  // 5. Check old data.json sizes for comparison
  console.log('\n=== [4] Compare backup data.json ===');
  const backupData = await run('ls -la /var/www/zj.100qiu.com_backup_*/server/data.json /var/www/zj.100qiu.com_old_*/server/data.json 2>/dev/null');

  // 6. Restart PM2 to pick up restored trends
  console.log('\n=== [5] Restart services ===');
  await run('cd /var/www/zj.100qiu.com && pm2 restart ecosystem.config.json 2>&1');

  await new Promise(r => setTimeout(r, 3000));
  await run('pm2 status');

  console.log('\n[Done]');
  conn.end();
})().catch(e => { console.error(e.message); process.exit(1); });
