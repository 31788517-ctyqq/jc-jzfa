/* 世界杯方案参数扫描 — 01/02/03/04 */
var fs=require('fs'),path=require('path'),ROOT=path.join(__dirname,'..');
var rawJson=JSON.parse(fs.readFileSync(path.join(ROOT,'server','data.json'),'utf8'));
var mM=rawJson.m||{},rM=rawJson.r||{};
function norm(r){return(r||[]).map(function(x){var v=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:v===0||v===1?v:null}})}
function loadO(d){try{var p=path.join(ROOT,'server','odds_history',d+'.json');if(!fs.existsSync(p))return null;return(JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds||null}catch(e){return null}}

var P={},D=[];
Object.keys(mM).forEach(function(k){var m=mM[k];if(m&&m.date){var d=m.date.slice(0,10);if(d<'2026-03-19')return;if((m.leagueName||'').indexOf('世界杯')<0)return;if(!P[d]){P[d]=[];D.push(d)}var mid=String(m.matchId);var r=norm(rM['m_'+mid]||rM[mid]||[]);
  var dA=0,dB=0,tg=0,win=0;
  r.forEach(function(x){if(x.type==='平'||x.type==='让平')dA+=x.num||0;if(x.type==='让负')dB+=x.num||0;if(x.type==='总进球-2、3球')tg+=x.num||0;if(x.type==='胜')win+=x.num||0});
  P[d].push({match:m,dA,dB,tg,win})}});
D.sort();
console.log('WC days:'+D.length+' matches:'+D.reduce(function(s,d){return s+P[d].length},0));

D.forEach(function(ds){var o=loadO(ds);P[ds].forEach(function(e){
  if(o){var od=o[e.match.num||'']||null;if(od){e.odds=od;e.spfD=od.spf&&od.spf.draw?od.spf.draw:0;e.rqD=od.rqspf&&od.rqspf.draw?od.rqspf.draw:0;e.rqA=od.rqspf&&od.rqspf.away?od.rqspf.away:0;e.spfH=od.spf&&od.spf.home?od.spf.home:0;e.tg2=od.totalGoals&&od.totalGoals['2']?od.totalGoals['2']:0;e.tg3=od.totalGoals&&od.totalGoals['3']?od.totalGoals['3']:0;e.rqHcp=od.rqspf&&od.rqspf.handicap!=null?od.rqspf.handicap:0}}
  var m=e.match,rec=norm(rM['m_'+m.matchId]||rM[String(m.matchId)]||[]);
  // 结果判定
  e.wDraw=null;var ha=false,hn=false;rec.forEach(function(r){if(r.type==='平'||r.type==='让平'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wDraw=true;else if(!ha&&hn)e.wDraw=false;
  if(e.wDraw===null&&m.score&&m.matchStatus>=2){var p=String(m.score).replace(/[-:]/g,':').split(':');var h=parseInt(p[0]),a=parseInt(p[1]);if(!isNaN(h)&&!isNaN(a))e.wDraw=(h===a||h-a+(e.rqHcp||0)===0)}
  e.wRQ=null;ha=false;hn=false;rec.forEach(function(r){if(r.type==='让负'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wRQ=true;else if(!ha&&hn)e.wRQ=false;
  if(e.wRQ===null&&m.score&&m.matchStatus>=2){var p2=String(m.score).replace(/[-:]/g,':').split(':');var h2=parseInt(p2[0]),a2=parseInt(p2[1]);if(!isNaN(h2)&&!isNaN(a2))e.wRQ=(h2-a2+(e.rqHcp||0)<0)}
  e.wTG=null;ha=false;hn=false;rec.forEach(function(r){if(r.type==='总进球-2、3球'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wTG=true;else if(!ha&&hn)e.wTG=false;
  if(e.wTG===null&&m.score&&m.matchStatus>=2){var p3=String(m.score).replace(/[-:]/g,':').split(':');var h3=parseInt(p3[0]),a3=parseInt(p3[1]);if(!isNaN(h3)&&!isNaN(a3)){var t=h3+a3;e.wTG=(t===2||t===3)}}
  e.wWin=null;ha=false;hn=false;rec.forEach(function(r){if(r.type==='胜'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});
  if(ha&&!hn)e.wWin=true;else if(!ha&&hn)e.wWin=false;
  if(e.wWin===null&&m.score&&m.matchStatus>=2){var p4=String(m.score).replace(/[-:]/g,':').split(':');var h4=parseInt(p4[0]),a4=parseInt(p4[1]);if(!isNaN(h4)&&!isNaN(a4))e.wWin=(h4>a4)}
  // 有效赔率
  e.effDA=e.spfD>0&&e.rqD>0?1/(1/e.spfD+1/e.rqD):(e.spfD||e.rqD||0);
  e.effTG=e.tg2>0&&e.tg3>0?1/(1/e.tg2+1/e.tg3):0;
  e.effRQ=e.rqA||0;e.effWin=e.spfH||0;
})});

// ─── WC01: 平让平 × 让负 ───
function scan(pname,aT,bT,mpT,cpT,fA,fB,minMatch,extraCheck){
  var G=[];aT.forEach(function(a){bT.forEach(function(b){cpT.forEach(function(c){mpT.forEach(function(m){G.push({a:a,b:b,cp:c,mp:m})})})})});
  R=[];G.forEach(function(g){var tp=0,tw=0,tl=0,pr=0,iv=0;
  D.forEach(function(d){var ml=P[d];if(ml.length<minMatch)return;
    var ca=[],cb=[];ml.forEach(function(e){if(fA(e,g.a)&&extraCheck.A(e,g))ca.push(e);if(fB(e,g.b)&&extraCheck.B(e,g))cb.push(e)});
    var be=null,bs=-Infinity;
    for(var ai=0;ai<ca.length;ai++){for(var bi=0;bi<cb.length;bi++){var ea=ca[ai],eb=cb[bi];
      if(ea.match.matchId===eb.match.matchId)continue;if(ea.eA<=0||eb.eB<=0)continue;
      var p=ea.eA*eb.eB;if(g.cp>0&&p<g.cp)continue;var mz=Math.round(1000*p);if(mz<1000*g.mp)continue;
      if(ea.wA===null||eb.wB===null)continue;var q=p*(ea.cA+eb.cB);if(q>bs){bs=q;be={ea:ea,eb:eb,mz:mz}}}}
    if(be){tp++;iv+=1000;if(be.ea.wA&&be.eb.wB){tw++;pr+=(be.mz-1000)}else if(be.ea.wA===false||be.eb.wB===false){tl++;pr-=1000}}});
  if(tp>0)R.push({a:g.a,b:g.b,cp:g.cp,mp:g.mp,plans:tp,won:tw,lost:tl,iv:iv,pr:pr,sc:iv*0.08+pr,roi:(pr/iv*100).toFixed(1)})});
  R.sort(function(a,b){return b.sc-a.sc});
  if(R.length===0){console.log(pname+': ⚠ 无有效组合');return;}
  var be=R[0];console.log(pname+': A>='+be.a+' B>='+be.b+' 合赔>='+be.cp+' 盈>='+be.mp+'x | '+be.plans+'方案 '+be.won+'W/'+be.lost+'L '+(be.pr>=0?'+':'')+be.pr+' ROI '+be.roi+'%');
  R.sort(function(a,b){return b.pr-a.pr});var bp=R[0];if(bp!==be)console.log('  纯盈利: A>='+bp.a+' B>='+bp.b+' 合赔>='+bp.cp+' 盈>='+bp.mp+'x | '+bp.plans+'方案 '+(bp.pr>=0?'+':'')+bp.pr+' ROI '+bp.roi+'%');
}

function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s}

// WC01: 平让平×让负
var aT1=[5,10,15,20,25,30],bT1=[5,10,15,20,25,30],cpT1=[0],mpT1=[1.1,1.2,1.3,1.5,1.8,2.0,2.2,2.5];
console.log('\n══ WC01: 平让平×让负 ══ (当前 A≥15/B≥15 盈≥0.1x | 8方案 +5,185)');
scan('WC01',aT1,bT1,mpT1,cpT1,function(e,a){e.cA=e.dA;return e.cA>=a},function(e,b){e.cB=e.dB;return e.cB>=b},3,{A:function(e,g){e.eA=e.effDA;e.wA=e.wDraw;return e.spfD>0},B:function(e,g){e.eB=e.effRQ;e.wB=e.wRQ;return true}});

// WC02: 总进球23×让负
var aT2=[5,10,15,20,25],bT2=[5,10,15,20,25],cpT2=[0,0.5,1.0,1.5,2.0],mpT2=[1.1,1.3,1.5,1.8,2.0,2.5,3.0];
console.log('\n══ WC02: 总进球23×让负 ══ (当前 A≥15/B≥15 合赔≥2.0 盈≥0.3x | 8方案 -708)');
scan('WC02',aT2,bT2,mpT2,cpT2,function(e,a){e.cA=e.tg;return e.cA>=a},function(e,b){e.cB=e.dB;return e.cB>=b},3,{A:function(e,g){e.eA=e.effTG;e.wA=e.wTG;return e.tg2>0&&e.tg3>0},B:function(e,g){e.eB=e.effRQ;e.wB=e.wRQ;return true}});

// WC03: 胜×让负
var aT3=[10,15,20,25,30,35,40],bT3=[5,10,15,20],cpT3=[0,0.5,1.0,1.5,2.0],mpT3=[1.1,1.2,1.5,1.8,2.0,2.5,3.0];
console.log('\n══ WC03: 胜×让负 ══ (当前 A≥30/B无 合赔≥2.0 盈≥0.15x | 1方案 +2,544)');
scan('WC03',aT3,bT3,mpT3,cpT3,function(e,a){e.cA=e.win;return e.cA>=a},function(e,b){e.cB=e.dB;return e.cB>=b},2,{A:function(e,g){e.eA=e.effWin;e.wA=e.wWin;return true},B:function(e,g){e.eB=e.effRQ;e.wB=e.wRQ;return true}});

// WC04: 平让平×胜
var aT4=[5,10,15,20],bT4=[10,15,20,25,30,35,40],cpT4=[0],mpT4=[1.1,1.2,1.5,1.8,2.0,2.5,3.0];
console.log('\n══ WC04: 平让平×胜 ══ (当前 A无/B≥30 盈≥0.15x | 0方案)');
scan('WC04',aT4,bT4,mpT4,cpT4,function(e,a){e.cA=e.dA;return e.cA>=a},function(e,b){e.cB=e.win;return e.cB>=b},3,{A:function(e,g){e.eA=e.effDA;e.wA=e.wDraw;return e.spfD>0},B:function(e,g){e.eB=e.effWin;e.wB=e.wWin;return true}});
