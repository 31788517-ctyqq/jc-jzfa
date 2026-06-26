/* 方案六参数扫描 — 总进球-2、3球 单关 */
var fs=require('fs'),path=require('path'),ROOT=path.join(__dirname,'..');
var rawJson=JSON.parse(fs.readFileSync(path.join(ROOT,'server','data.json'),'utf8'));
var mM=rawJson.m||{},rM=rawJson.r||{};
function norm(r){return(r||[]).map(function(x){var v=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:v===0||v===1?v:null}})}
function loadO(d){try{var p=path.join(ROOT,'server','odds_history',d+'.json');if(!fs.existsSync(p))return null;return(JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds||null}catch(e){return null}}

var P={},D=[];
Object.keys(mM).forEach(function(k){var m=mM[k];if(m&&m.date){var d=m.date.slice(0,10);if(d>='2026-03-19'&&d<='2026-06-21'){if(!P[d]){P[d]=[];D.push(d)}if((m.leagueName||'').indexOf('世界杯')>=0)return;var mid=String(m.matchId);var r=norm(rM['m_'+mid]||rM[mid]||[]);var a=0;r.forEach(function(x){if(x.type==='总进球-2、3球')a+=x.num||0});P[d].push({match:m,cA:a})}}});
D.sort();

D.forEach(function(ds){var o=loadO(ds);P[ds].forEach(function(e){
  if(o){var od=o[e.match.num||'']||null;if(od){e.tg2=od.totalGoals&&od.totalGoals['2']?od.totalGoals['2']:0;e.tg3=od.totalGoals&&od.totalGoals['3']?od.totalGoals['3']:0}}
  var m=e.match,rec=norm(rM['m_'+m.matchId]||rM[String(m.matchId)]||[]);
  e.ok=(e.tg2>0&&e.tg3>0);
  e.effA=e.ok?1/(1/e.tg2+1/e.tg3):0;
  e.wA=null;var ha=false,hn=false;rec.forEach(function(r){if(r.type==='总进球-2、3球'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wA=true;else if(!ha&&hn)e.wA=false;
  if(e.wA===null&&m.score&&m.matchStatus>=2){var p=String(m.score).replace(/[-:]/g,':').split(':');var h=parseInt(p[0]),a=parseInt(p[1]);if(!isNaN(h)&&!isNaN(a)){var t=h+a;e.wA=(t===2||t===3)}}
})});

var aT=[],mpT=[];
for(var a=0;a<=30;a+=5)aT.push(a);
for(var m=1000;m<=2500;m+=100)mpT.push(m);

var G=[];aT.forEach(function(a){mpT.forEach(function(m){G.push({a:a,mp:m})})});

var R=[],cnt=0;
G.forEach(function(g){var tp=0,tw=0,tl=0,pr=0,iv=0;
D.forEach(function(d){var ml=P[d];if(ml.length<2)return;var ca=[];
  ml.forEach(function(e){if(e.cA>=g.a&&e.ok)ca.push(e)});
  if(ca.length===0)return;
  // 选最高奖金方案
  var be=null,bs=-Infinity;
  for(var ai=0;ai<ca.length;ai++){var ea=ca[ai];
    var mz=Math.round(1000*ea.effA);if(mz<g.mp)continue;
    if(ea.wA===null)continue;
    var q=mz*(ea.cA+1);if(q>bs){bs=q;be={ea:ea,mz:mz}}}
  if(be){tp++;iv+=1000;if(be.ea.wA){tw++;pr+=(be.mz-1000)}else{tl++;pr-=1000}}
});
if(tp>0)R.push({a:g.a,mp:g.mp,plans:tp,won:tw,lost:tl,iv:iv,pr:pr,sc:iv*0.08+pr,roi:(pr/iv*100).toFixed(1)});
cnt++;if(cnt%100===0)process.stdout.write('.');
});

R.sort(function(a,b){return b.sc-a.sc});
console.log('\n\n══ TOP 10 ══');
console.log('A>=人 盈>=元  方案 命中 亏损   投入     盈利    评分   ROI');
console.log('-'.repeat(62));
for(var i=0;i<Math.min(10,R.length);i++){var r=R[i];console.log(p(r.a,3)+' '+p(r.mp,6)+' '+p(r.plans,4)+' '+p(r.won,3)+' '+p(r.lost,3)+' '+p(r.iv,7)+' '+p(r.pr>=0?'+'+r.pr:r.pr,8)+' '+p(r.sc.toFixed(0),7)+' '+r.roi+'%')}
var be=R[0];console.log('\n══ 最优: A>='+be.a+' 盈>='+be.mp+' | '+be.plans+'方案 '+be.won+'W/'+be.lost+'L '+(be.pr>=0?'+':'')+be.pr+' ROI '+be.roi+'%');
R.sort(function(a,b){return b.pr-a.pr});var bp=R[0];console.log('══ 纯盈利: A>='+bp.a+' 盈>='+bp.mp+' | '+bp.plans+'方案 '+(bp.pr>=0?'+':'')+bp.pr+' ROI '+bp.roi+'%');
R.sort(function(a,b){return(b.won/(b.won+b.lost))-(a.won/(a.won+a.lost))});var bh=R[0];console.log('══ 命中率: A>='+bh.a+' 盈>='+bh.mp+' | '+bh.plans+'方案 '+bh.won+'/'+bh.lost+' 命中率'+(bh.won/(bh.won+bh.lost)*100).toFixed(1)+'%')
function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s}
