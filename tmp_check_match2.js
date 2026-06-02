var d = require('./core/cache').getDataJson();
var m = d.m;
// 查找莱比锡红牛 vs 圣保利
Object.keys(m).forEach(function(k) {
  var x = m[k];
  if (x && x.homeName && x.homeName.indexOf('莱比锡') >= 0) {
    console.log(JSON.stringify({key: k, matchId: x.matchId, date: x.date, matchStatus: x.matchStatus, score: x.score, homeName: x.homeName, visitName: x.visitName}));
  }
});
// 检查 rMap
var r = d.r;
Object.keys(r).forEach(function(k) {
  if (k.indexOf('20400') >= 0 || k.indexOf('2040') >= 0) {
    console.log('rMap key: ' + k + ' -> ' + JSON.stringify(r[k]));
  }
});
