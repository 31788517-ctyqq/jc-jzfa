/**
 * 用备份 r 数据 + 当前 m 数据，V16.3 重生成全部专家快照
 * 备份 r=1092条覆盖到 ~06-13，之后用当前 r
 * cd /root && node scripts/regen_all_snapshots.cjs
 */
var fs = require('fs');
var pg = require('/root/server/core/plan-generator');

// 备份 r 数据（1092条）
var bakData = JSON.parse(fs.readFileSync('/root/server/data.json.bak.polution_cleanup', 'utf8'));
var bakR = bakData.r || {};
console.log('备份 r: ' + Object.keys(bakR).length + ' 条');

// 当前 m 数据（8244场）
var curData = JSON.parse(fs.readFileSync('/root/server/data.json', 'utf8'));
var mMap = curData.m || {};
var curR = curData.r || {};
console.log('当前 m: ' + Object.keys(mMap).length + ' 场, r: ' + Object.keys(curR).length + ' 条');

// ★ 合并: 备份 r 优先, 当前 r 补充
var rMap = {};
var fromBak=0, fromCur=0;
Object.keys(bakR).forEach(function(k){rMap[k]=bakR[k]; fromBak++;});
Object.keys(curR).forEach(function(k){if(!rMap[k]){rMap[k]=curR[k]; fromCur++;}});
console.log('合并 r: ' + Object.keys(rMap).length + ' 条 (' + fromBak + ' 备份 + ' + fromCur + ' 当前补充)\n');

// 收集所有日期
var dates = new Set();
Object.keys(mMap).forEach(function(k){
  var m = mMap[k];
  if(m && m.date){
    var d = m.date.slice(0,10);
    if(d >= '2026-03-19' && d <= '2026-06-21') dates.add(d);
  }
});
var sortedDates = Array.from(dates).sort();
console.log(sortedDates.length + ' 天 (' + sortedDates[0] + ' ~ ' + sortedDates[sortedDates.length-1] + ')\n');

function fmtDate(dd){return dd.getFullYear()+'-'+String(dd.getMonth()+1).padStart(2,'0')+'-'+String(dd.getDate()).padStart(2,'0');}

function normalizeRecs(raw){
  return (raw||[]).map(function(x){
    var r = x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;
    return {type:x.t||x.type, num:x.n||x.num, result:r===0||r===1?r:null};
  });
}

function loadOdds(ds){
  try{
    var p = '/root/server/odds_history/'+ds+'.json';
    if(!fs.existsSync(p)) return null;
    var j = JSON.parse(fs.readFileSync(p,'utf8'));
    return (j&&j.odds)?j.odds:j;
  }catch(e){return null;}
}

var totalPlans=0, totalDays=0, planStats={};

sortedDates.forEach(function(ds){
  var mList=[];
  Object.keys(mMap).forEach(function(k){
    var m=mMap[k];
    if(m&&(m.date||'').slice(0,10)===ds) mList.push(Object.assign({},m));
  });
  if(mList.length===0) return;

  var odds = loadOdds(ds);
  var matchDataMap = {};
  mList.forEach(function(m){
    var raw = rMap['m_'+m.matchId]||rMap[String(m.matchId)]||[];
    var num = m.num||'';
    var od = odds&&odds[num]?odds[num]:null;
    var recs = normalizeRecs(raw);
    matchDataMap[m.matchId] = {
      match:m, recs:recs,
      odds:od?{spf:od.spf||null,rqspf:od.rqspf||null,totalGoals:od.totalGoals||null,halfFull:od.halfFull||null,isSingleGame:od.isSingleGame||null}:null,
    };
  });

  try{
    var plans = pg.generateExpertPlans(mList, matchDataMap, ds);
    if(plans.length>0){
      var snap = {date:ds, plans:plans};
      fs.writeFileSync('/root/server/plan_snapshots/'+ds+'.json', JSON.stringify(snap,null,2));
      plans.forEach(function(p){var nm=p.planName||'?'; planStats[nm]=(planStats[nm]||0)+1;});
      console.log(ds+' '+mList.length+'场 '+plans.length+'方案');
      totalPlans+=plans.length; totalDays++;
    }
  }catch(e){
    console.error(ds+' ERR: '+e.message);
  }
});

console.log('\n═══ 完成: '+totalDays+'天 '+totalPlans+'方案 ═══');
var names=Object.keys(planStats).sort(function(a,b){return (planStats[b]||0)-(planStats[a]||0)});
names.forEach(function(nm){console.log('  '+nm+': '+planStats[nm]+' 方案')});
