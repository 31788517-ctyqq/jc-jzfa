// Fresh process - no cached modules from other scripts
var fs=require('fs');
var PG=require('./server/core/plan-generator');

var d=JSON.parse(fs.readFileSync('./server/data.json','utf8'));
var mm=d.m||{},rm=d.r||{};
var snap=JSON.parse(fs.readFileSync('server/plan_snapshots/2026-05-19.json','utf8'));
var odds;try{var j=JSON.parse(fs.readFileSync('server/odds_history/2026-05-19.json','utf8'));odds=(j&&j.odds)?j.odds:j;}catch(e){odds=null;}

var hyd=PG.hydrateSnapshotWithResults(snap,mm,rm,odds);
var hp=hyd.find(function(p){return p.name==='plan_a345_01'});

console.log('plan_a345_01 hydrate: won='+hp.isPlanWon+' lost='+hp.isPlanLose+' prize='+hp.winningPrize);
hp.matches.forEach(function(m){
  console.log('  match: '+m.direction+' won='+m.isMatchWon+' lost='+m.isMatchLose+' score='+m.actualScore);
  console.log('  subResults:');
  (m.subResults||[]).forEach(function(sr){
    console.log('    '+sr.direction+' result='+sr.result);
  });
});

// Test judgeByScore
var r=PG.judgeByScore('总进球-3、4、5球','0:0',null);
console.log('judgeByScore("总进球-3、4、5球","0:0") = '+r);
var r2=PG.judgeByScore('总进球-3','0:0',null);
console.log('judgeByScore("总进球-3","0:0") = '+r2);
