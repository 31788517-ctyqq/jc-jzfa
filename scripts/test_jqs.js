var h = require('https');
var iconv = require('iconv-lite');
var jqs = require('/var/www/zj.100qiu.com/server/fetch_500odds');

jqs.fetchOdds('2026-05-24').then(function(data) {
  var tg = 0, spf = 0;
  Object.keys(data).sort().forEach(function(k) {
    var m = data[k];
    if (m.spf && m.spf.home) spf++;
    if (m.totalGoals) {
      tg++;
      console.log(k + ' totalGoals: 3=' + m.totalGoals['3'] + ' 4=' + m.totalGoals['4']);
    }
  });
  console.log(spf + ' SPF, ' + tg + ' totalGoals out of ' + Object.keys(data).length);
}).catch(function(e) { console.log('ERROR: ' + e.stack); });
