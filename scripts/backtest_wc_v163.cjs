/* 世界杯 V16.3 回测 */
var fs=require('fs'),path=require('path');
var PG=require(path.join(__dirname,'..','server','core','plan-generator'));
var rawJson=JSON.parse(fs.readFileSync(path.join(__dirname,'..','server','data.json'),'utf8'));
var mM=rawJson.m||{},rM=rawJson.r||{};
function norm(r){return(r||[]).map(function(x){var v=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:v===0||v===1?v:null}})}
function loadO(d){try{var p=path.join(__dirname,'..','server','odds_history',d+'.json');if(!fs.existsSync(p))return null;return(JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds||null}catch(e){return null}}

var P={},wcDays=[];
Object.keys(mM).forEach(function(k){var m=mM[k];if(m&&m.date){var d=m.date.slice(0,10);if(d<'2026-03-19')return;if((m.leagueName||'').indexOf('世界杯')<0)return;if(!P[d]){P[d]=[];wcDays.push(d)}var mid=String(m.matchId);var r=norm(rM['m_'+mid]||rM[mid]||[]);P[d].push({match:m,recs:r})}});
wcDays.sort();

console.log('世界杯比赛天数: '+wcDays.length);
var totalM=0;wcDays.forEach(function(d){totalM+=P[d].length});
console.log('总场次: '+totalM);
if(wcDays.length===0){console.log('⚠ 无世界杯比赛数据');process.exit(0)}

// 预计算赔率
wcDays.forEach(function(d){var o=loadO(d);P[d].forEach(function(e){if(o){var od=o[e.match.num||'']||null;if(od){e.odds=od;e.odds.isSingleGame=e.match.isSingleGame||false}}})});

var monthS={},planS={};
function ensM(d){var k=d.slice(0,7);if(!monthS[k])monthS[k]={plans:0,won:0,lost:0,pending:0,profit:0,invest:0};return monthS[k]}
function ensP(pn){if(!planS[pn])planS[pn]={plans:0,won:0,lost:0,pending:0,profit:0,invest:0};return planS[pn]}
var ti=0,tp=0,tw=0,tl=0,tpe=0;

wcDays.forEach(function(ds){
  var mList=P[ds].map(function(e){return e.match});
  var matchDataMap={};
  P[ds].forEach(function(e){var m=e.match;var od=e.odds;matchDataMap[m.matchId]={match:m,recs:e.recs,odds:od?{spf:od.spf||null,rqspf:od.rqspf||null,totalGoals:od.totalGoals||null,halfFull:od.halfFull||null,isSingleGame:od.isSingleGame||null}:null}});

  try{var plans=PG.generateExpertPlans(mList,matchDataMap,ds);
    plans=plans.filter(function(p){return p.planName.indexOf('世界杯')===0});
    plans.forEach(function(p){var iw=p.isPlanWon===true,il=p.isPlanLose===true,ip=!(iw||il);var pr=iw?(p.winningPrize||p.maxPrize||0):0,pf=pr-(p.amount||1000);
      var mo=ensM(ds);mo.plans++;mo.invest+=(p.amount||1000);mo.profit+=pf;if(iw)mo.won++;else if(il)mo.lost++;else mo.pending++;
      var sp=ensP(p.planName);sp.plans++;sp.invest+=(p.amount||1000);sp.profit+=pf;if(iw)sp.won++;else if(il)sp.lost++;else sp.pending++;
      ti+=(p.amount||1000);tp+=pf;if(iw)tw++;else if(il)tl++;else tpe++})}catch(e){}
});

console.log('\n══ 每月 ══');
console.log('月份       方案 命中 亏损 待开   投入     盈利     ROI');
Object.keys(monthS).sort().forEach(function(mk){var s=monthS[mk];var r=s.invest>0?(s.profit/s.invest*100).toFixed(1)+'%':'N/A';console.log(mk+'    '+p(s.plans,3)+' '+p(s.won,3)+' '+p(s.lost,3)+' '+p(s.pending,3)+' '+p(s.invest,6)+' '+p(s.profit>=0?'+'+s.profit:s.profit,7)+' '+r)});

console.log('\n══ 按方案 ══');
console.log('方案           方案 命中 亏损 待开   投入     盈利     ROI');
Object.keys(planS).sort(function(a,b){return(planS[b].profit||0)-(planS[a].profit||0)}).forEach(function(pk){var s=planS[pk];var r=s.invest>0?(s.profit/s.invest*100).toFixed(1)+'%':'N/A';console.log(pr(pk,12)+' '+p(s.plans,3)+' '+p(s.won,3)+' '+p(s.lost,3)+' '+p(s.pending,3)+' '+p(s.invest,6)+' '+p(s.profit>=0?'+'+s.profit:s.profit,7)+' '+r)});

var hr=tw+tl>0?(tw/(tw+tl)*100).toFixed(1)+'%':'N/A';var tr=ti>0?(tp/ti*100).toFixed(1)+'%':'N/A';
console.log('\n总计: '+(tw+tl+tpe)+'方案 '+tw+'W/'+tl+'L/'+tpe+'待 命中率'+hr+' 盈利'+(tp>=0?'+':'')+tp+' ROI '+tr);
function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s}
function pr(v,w){var s=String(v);while(s.length<w)s=s+' ';return s}
