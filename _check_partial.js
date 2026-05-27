const { Client } = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `cd /var/www/zj.100qiu.com/server && node -e "
    var fs = require('fs');
    var cache = JSON.parse(fs.readFileSync('ai_cache.json','utf8'));
    var keys = Object.keys(cache);
    console.log('Total entries: ' + keys.length);
    keys.slice(0,5).forEach(function(k) {
      var e = cache[k];
      console.log(k + ': partial=' + (e.partial||false) + ' pendingMerge=' + (e.pendingMerge||false) + 
        ' hasDS=' + !!(e.sources&&e.sources.deepseek) + ' hasDB=' + !!(e.sources&&e.sources.doubao) + 
        ' readySource=' + (e.readySource||'none'));
    });
  "`;
  c.exec(cmd, (e,s) => {
    let o=''; s.on('data',d=>{o+=d}); s.stderr.on('data',d=>{o+=d});
    s.on('close',()=>{ console.log(o); c.end(); });
  });
});
c.connect({ host:'119.23.51.159', port:22, username:'root', password:'znm19811225@', algorithms:{ kex:['diffie-hellman-group14-sha1'], serverHostKey:['ssh-rsa'] }, readyTimeout:10000 });
