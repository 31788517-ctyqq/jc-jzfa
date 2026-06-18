var fs=require('fs'),PG=require('./server/core/plan-generator');
var d=JSON.parse(fs.readFileSync('./server/data.json','utf8'));
var mm=d.m||{},rm=d.r||{};

function lo(ds){try{var j=JSON.parse(fs.readFileSync('server/odds_history/'+ds+'.json','utf8'));return(j&&j.odds)?j.odds:j;}catch(e){return null;}}

var dates=['2026-06-06','2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-17'];
var regenerated=0;

dates.forEach(function(ds){
  var ml=[];Object.keys(mm).forEach(function(k){var m=mm[k];if(m&&(m.date||'').slice(0,10)===ds)ml.push(Object.assign({},m));});
  if(ml.length===0){console.log(ds+': no matches, skip');return;}
  
  var odds=lo(ds);
  console.log(ds+': '+ml.length+' matches, odds='+(odds?'YES':'NO'));
  
  var mdm={};
  ml.forEach(function(m){
    var raw=rm['m_'+m.matchId]||rm[String(m.matchId)]||[];
    var od=odds&&odds[m.num]?odds[m.num]:null;
    mdm[m.matchId]={match:m,
      recs:(raw||[]).map(function(x){var r=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:r===0||r===1?r:null};}),
      odds:od?{spf:od.spf||null,rqspf:od.rqspf||null,totalGoals:od.totalGoals||null,halfFull:od.halfFull||null,isSingleGame:od.isSingleGame||false}:null};
  });
  
  var plans=PG.generateExpertPlans(ml,mdm,ds);
  console.log('  Generated '+plans.length+' plans: '+plans.map(function(p){return p.planName+'('+p.name+')'}).join(', '));
  
  PG.savePlanSnapshot(ds,plans,null,new Date().toISOString());
  regenerated++;
});

console.log('\nRegenerated: '+regenerated+' snapshots');
