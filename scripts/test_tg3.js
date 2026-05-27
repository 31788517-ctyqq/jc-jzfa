// Test totalGoals extraction
var fo = require('/var/www/zj.100qiu.com/server/fetch_500odds');

fo.fetchOdds('2026-05-24').then(function(data) {
  var tgCount = 0, hasSpf = 0;
  Object.keys(data).forEach(function(k) {
    var m = data[k];
    if (m.spf && m.spf.home) hasSpf++;
    if (m.totalGoals) {
      tgCount++;
      console.log(k + ': totalGoals=' + JSON.stringify(m.totalGoals).substring(0, 80));
    }
  });
  console.log('\nTotal: ' + Object.keys(data).length + ' matches, ' + hasSpf + ' with SPF, ' + tgCount + ' with totalGoals');
}).catch(function(e) { console.log('ERROR: ' + e.message); });
