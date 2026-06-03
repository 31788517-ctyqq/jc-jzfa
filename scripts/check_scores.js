// 检查 data.json 中比分数据
var d = JSON.parse(require('fs').readFileSync('/root/server/data.json','utf8'));
var m = d.m || {};
var ks = Object.keys(m);
console.log('Total matches:', ks.length);
var scored = 0;
ks.forEach(function(k){
  var e = m[k];
  if (e && e.score) {
    scored++;
    console.log('Score:', k, e.num, JSON.stringify(e.score), (e.date||'').slice(0,10));
  }
});
console.log('Matches with scores:', scored);

// 检查 live_scores.json
try {
  var ls = JSON.parse(require('fs').readFileSync('/root/server/live_scores.json','utf8'));
  console.log('Live scores matches:', (ls.matches||[]).length);
  (ls.matches||[]).forEach(function(m){
    console.log('Live:', m.matchId, m.num, m.score, m.matchStatus);
  });
} catch(e) { console.log('No live_scores.json'); }
