/* 方案七参数扫描 — 胜平/平负 单关 */
var fs=require('fs'),path=require('path'),ROOT=path.join(__dirname,'..');
var rawJson=JSON.parse(fs.readFileSync(path.join(ROOT,'server','data.json'),'utf8'));
var mM=rawJson.m||{},rM=rawJson.r||{};
function norm(r){return(r||[]).map(function(x){var v=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:v===0||v===1?v:null}})}
function loadO(d){try{var p=path.join(ROOT,'server','odds_history',d+'.json');if(!fs.existsSync(p))return null;return(JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds||null}catch(e){return null}}

// 统计单关比赛 + 方向覆盖
var sgCount=0,spCount=0,pfCount=0;
var P={},D=[];
Object.keys(mM).forEach(function(k){var m=mM[k];if(m&&m.date){var d=m.date.slice(0,10);if(d>='2026-03-19'&&d<='2026-06-21'){if(!P[d]){P[d]=[];D.push(d)}if((m.leagueName||'').indexOf('世界杯')>=0)return;var mid=String(m.matchId);var r=norm(rM['m_'+mid]||rM[mid]||[]);var sa=0,sb=0;r.forEach(function(x){if(x.type==='胜平')sa+=x.num||0;if(x.type==='平负')sb+=x.num||0});
P[d].push({match:m,cA:sa,cB:sb})}}});
D.sort();

// 标记单关比赛
D.forEach(function(ds){var o=loadO(ds);P[ds].forEach(function(e){
  if(o){var od=o[e.match.num||'']||null;if(od){e.sg=od.isSingleGame===true;e.sH=od.spf&&od.spf.home?od.spf.home:0;e.sD=od.spf&&od.spf.draw?od.spf.draw:0;e.sA=od.spf&&od.spf.away?od.spf.away:0}}
  // 赔率: 胜平=荷兰式(胜+平), 平负=荷兰式(平+负)
  e.eSP=e.sH>0&&e.sD>0?1/(1/e.sH+1/e.sD):(e.sH||e.sD||0);
  e.ePF=e.sD>0&&e.sA>0?1/(1/e.sD+1/e.sA):(e.sD||e.sA||0);
  // 结果
  var m=e.match,rec=norm(rM['m_'+m.matchId]||rM[String(m.matchId)]||[]);
  e.wSP=null;var ha=false,hn=false;rec.forEach(function(r){if(r.type==='胜平'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wSP=true;else if(!ha&&hn)e.wSP=false;
  if(e.wSP===null&&m.score&&m.matchStatus>=2){var p=String(m.score).replace(/[-:]/g,':').split(':');var h=parseInt(p[0]),a=parseInt(p[1]);if(!isNaN(h)&&!isNaN(a))e.wSP=(h>=a)}
  e.wPF=null;ha=false;hn=false;rec.forEach(function(r){if(r.type==='平负'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wPF=true;else if(!ha&&hn)e.wPF=false;
  if(e.wPF===null&&m.score&&m.matchStatus>=2){var p2=String(m.score).replace(/[-:]/g,':').split(':');var h2=parseInt(p2[0]),a2=parseInt(p2[1]);if(!isNaN(h2)&&!isNaN(a2))e.wPF=(h2<=a2)}
})});

var t=0;D.forEach(function(d){P[d].forEach(function(e){if(e.sg)sgCount++})});
console.log('单关比赛: '+sgCount+' 场');

var aT=[1,5,10,15,20],mpT=[1000,1100,1200,1300,1500,1800,2000];
var G=[];aT.forEach(function(a){mpT.forEach(function(m){G.push({a:a,mp:m})})});

var R=[],cnt=0;
G.forEach(function(g){var tp=0,tw=0,tl=0,pr=0,iv=0;
D.forEach(function(d){var ml=P[d];var cand=[];
  ml.forEach(function(e){if(!e.sg)return;
    if(e.cA>=g.a&&e.eSP>0) cand.push({e:e,dir:'sp',eff:e.eSP,won:e.wSP,cnt:e.cA});
    if(e.cB>=g.a&&e.ePF>0) cand.push({e:e,dir:'pf',eff:e.ePF,won:e.wPF,cnt:e.cB})});
  if(cand.length===0)return;
  var be=null,bs=-Infinity;
  for(var ci=0;ci<cand.length;ci++){var c=cand[ci];var mz=Math.round(1000*c.eff);if(mz<g.mp)continue;if(c.won===null)continue;var q=mz*(c.cnt+1);if(q>bs){bs=q;be={c:c,mz:mz}}}
  if(be){tp++;iv+=1000;if(be.c.won){tw++;pr+=(be.mz-1000)}else{tl++;pr-=1000}}
});
if(tp>0)R.push({a:g.a,mp:g.mp,plans:tp,won:tw,lost:tl,iv:iv,pr:pr,sc:iv*0.08+pr,roi:(pr/iv*100).toFixed(1)});
cnt++;
});

R.sort(function(a,b){return b.sc-a.sc});
console.log('\n══ TOP 10 ══ (单关比赛才纳入)');
console.log('A>=人 盈>=元  方案 命中 亏损   投入     盈利    评分   ROI');
console.log('-'.repeat(62));
for(var i=0;i<Math.min(10,R.length);i++){var r=R[i];console.log(p(r.a,3)+' '+p(r.mp,6)+' '+p(r.plans,4)+' '+p(r.won,3)+' '+p(r.lost,3)+' '+p(r.iv,7)+' '+p(r.pr>=0?'+'+r.pr:r.pr,8)+' '+p(r.sc.toFixed(0),7)+' '+r.roi+'%')}
if(R.length===0)console.log('⚠ 无有效组合');
else{var be=R[0];console.log('\n══ 最优: A>='+be.a+' 盈>='+be.mp+' | '+be.plans+'方案 '+be.won+'W/'+be.lost+'L '+(be.pr>=0?'+':'')+be.pr+' ROI '+be.roi+'%')}
function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s}
