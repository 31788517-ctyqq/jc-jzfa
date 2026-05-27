const { Client } = require('ssh2');

const conn = new Client();
function run(c) { return new Promise(r => { conn.exec(c, (e, s) => { let o = ''; s.on('data', d => o += d); s.on('close', () => r(o)); }); }); }

(async () => {
  await new Promise((r, j) => { conn.on('ready', r); conn.on('error', j); conn.connect({ host: '119.23.51.159', port: 22, username: 'root', password: 'znm19811225@' }); });
  const o = await run('cd /var/www/zj.100qiu.com && node verify_gs.js');
  console.log(o);
  conn.end();
})().catch(e => console.error(e));
