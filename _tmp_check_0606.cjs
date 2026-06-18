var s=require('./_server_live/data.json');
var m=s.m||{};
var cnt=0;
Object.keys(m).forEach(function(k){
  var mm=m[k];
  if(mm&&(mm.date||'').slice(0,10)==='2026-06-06'){
    cnt++;
    console.log(mm.matchId+' '+mm.homeName+' vs '+mm.visitName+' score='+(mm.score||'N/A')+' status='+mm.matchStatus);
  }
});
console.log('06-06 matches: '+cnt);
