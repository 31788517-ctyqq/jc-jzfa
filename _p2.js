const { Client } = require('ssh2');
const c = new Client();
const B = 'https://raw.githubusercontent.com/31788517-ctyqq/jc-jzfa/master';
c.on('ready', () => {
  c.exec(`cd /var/www/zj.100qiu.com && echo '{}' > server/ai_cache.json && curl -sL -o preview/app.js ${B}/preview/app.js && curl -sL -o preview/js/pages/match-detail.js ${B}/preview/js/pages/match-detail.js && echo OK && pm2 restart ecosystem.config.json && sleep 3 && curl -s -m 3 http://127.0.0.1:3000/health`, (e,s) => {
    let o=''; s.on('data',d=>{o+=d}); s.stderr.on('data',d=>{o+=d});
    s.on('close',()=>{ console.log(o); c.end(); });
  });
});
c.connect({ host:'119.23.51.159', port:22, username:'root', password:'znm19811225@', algorithms:{ kex:['diffie-hellman-group14-sha1'], serverHostKey:['ssh-rsa'] }, readyTimeout:10000 });
