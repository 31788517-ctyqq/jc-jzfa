var c=require('fs').readFileSync('server/index.js','utf8');
var lines=c.split('\n');
lines.forEach(function(l,i){
  if(l.indexOf('sync-match-date')>=0||l.indexOf('backfill-results')>=0||l.indexOf('UNAUTHORIZED')>=0||l.indexOf('ADMIN_TOKEN')>=0||l.indexOf('adminToken')>=0)
    console.log((i+1)+': '+l.trim().slice(0,150));
});
