/* V16.3 全量回测: 总盈利 vs 投入×8%+盈利 */
var fs=require('fs'),path=require('path');
var PG=require(path.join(__dirname,'..','server','core','plan-generator'));
var rawJson=JSON.parse(fs.readFileSync(path.join(__dirname,'..','server','data.json'),'utf8'));
var mM=rawJson.m||{},rM=rawJson.r||{};
function norm(r){return(r||[]).map(function(x){var v=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:v===0||v===1?v:null}})}
function loadO(d){try{var p=path.join(__dirname,'..','server','odds_history',d+'.json');if(!fs.existsSync(p))return null;return(JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds||null}catch(e){return null}}

var P={},D=[];
Object.keys(mM).forEach(function(k){var m=mM[k];if(m&&m.date){var d=m.date.slice(0,10);if(d<'2026-03-19'||d>'2026-06-21')return;if(!P[d]){P[d]=[];D.push(d)}var mid=String(m.matchId);var r=norm(rM['m_'+mid]||rM[mid]||[]);P[d].push({match:m,recs:r})}});
D.sort();

var totalP=0,totalInv=0,totalProf=0,totalW=0,totalL=0,totalPe=0;
var regS={plans:0,won:0,lost:0,pending:0,inv:0,prof:0},wcS={plans:0,won:0,lost:0,pending:0,inv:0,prof:0};
var planS={};

function update(s,p,isWC){
  var iw=p.isPlanWon===true,il=p.isPlanLose===true,ip=!(iw||il);
  var pr=iw?(p.winningPrize||p.maxPrize||0):0,pf=pr-(p.amount||1000);
  s.plans++;s.inv+=(p.amount||1000);s.prof+=pf;if(iw)s.won++;else if(il)s.lost++;else s.pending++;
  totalP++;totalInv+=(p.amount||1000);totalProf+=pf;if(iw)totalW++;else if(il)totalL++;else totalPe++;
  var pn=p.planName||'';if(!planS[pn])planS[pn]={plans:0,won:0,lost:0,pending:0,inv:0,prof:0};
  var ps=planS[pn];ps.plans++;ps.inv+=(p.amount||1000);ps.prof+=pf;if(iw)ps.won++;else if(il)ps.lost++;else ps.pending++;
}

D.forEach(function(ds){
  var mList=[],mdm={};
  P[ds].forEach(function(e){mList.push(e.match);mdm[e.match.matchId]={match:e.match,recs:e.recs}});
  var odds=loadO(ds);
  Object.keys(mdm).forEach(function(k){var m=mdm[k].match;var od=odds&&odds[m.num||'']?odds[m.num||'']:null;mdm[k].odds=od?{spf:od.spf||null,rqspf:od.rqspf||null,totalGoals:od.totalGoals||null,halfFull:od.halfFull||null,isSingleGame:od.isSingleGame||null}:null});
  try{var plans=PG.generateExpertPlans(mList,mdm,ds);
    plans.forEach(function(p){var isWC=(p.planName||'').indexOf('世界杯')===0;update(isWC?wcS:regS,p,isWC)})}catch(e){}
});

function show(s,label){
  var hr=s.won+s.lost>0?(s.won/(s.won+s.lost)*100).toFixed(1)+'%':'N/A';
  var roi=s.inv>0?(s.prof/s.inv*100).toFixed(1)+'%':'N/A';
  var score=s.inv*0.08+s.prof;
  console.log(label);
  console.log('  方案:'+p(s.plans,3)+' 命中:'+p(s.won,3)+' 亏损:'+p(s.lost,3)+' 待开:'+p(s.pending,2)+' 命中率:'+hr);
  console.log('  投入:'+p(s.inv,7)+' 盈利:'+p(s.prof>=0?'+'+s.prof:s.prof,8)+' ROI:'+roi+' 评分('+p((s.inv*0.08).toFixed(0),5)+'+'+p(s.prof,6)+')='+p(score.toFixed(0),7));
  return s;
}

console.log('\n══════════════════════ V16.3 全量回测 ══════════════════════\n');
var r=show(regS,'══ 常规方案(一~七+A123/A345) ══');
var w=show(wcS,'══ 世界杯方案(01~08) ══');
var all={plans:r.plans+w.plans,won:r.won+w.won,lost:r.lost+w.lost,pending:r.pending+w.pending,inv:r.inv+w.inv,prof:r.prof+w.prof};
show(all,'══ 总计 ══');

console.log('\n══════ 按方案明细 (按盈利排序) ══════');
var pks=Object.keys(planS).sort(function(a,b){return(planS[b].prof||0)-(planS[a].prof||0)});
console.log('方案             方案 命中 亏损 待开   投入     盈利     ROI    评分');
pks.forEach(function(pk){var s=planS[pk];var roi=s.inv>0?(s.prof/s.inv*100).toFixed(1)+'%':'N/A';var sc=s.inv*0.08+s.prof;
  console.log(pr(pk,14)+' '+p(s.plans,3)+' '+p(s.won,3)+' '+p(s.lost,3)+' '+p(s.pending,2)+' '+p(s.inv,6)+' '+p(s.prof>=0?'+'+s.prof:s.prof,7)+' '+roi+' '+p(sc.toFixed(0),7))});

function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s}
function pr(v,w){var s=String(v);while(s.length<w)s=s+' ';return s}
