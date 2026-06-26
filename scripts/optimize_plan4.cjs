/* 方案四参数扫描 — 平、让平 × 胜 (2串1) */
var fs=require('fs'),path=require('path'),ROOT=path.join(__dirname,'..');
var rawJson=JSON.parse(fs.readFileSync(path.join(ROOT,'server','data.json'),'utf8'));
var mM=rawJson.m||{},rM=rawJson.r||{};
function norm(r){return(r||[]).map(function(x){var v=x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;return{type:x.t||x.type,num:x.n||x.num,result:v===0||v===1?v:null}})}
function loadO(d){try{var p=path.join(ROOT,'server','odds_history',d+'.json');if(!fs.existsSync(p))return null;return(JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds||null}catch(e){return null}}

var P={},D=[];
Object.keys(mM).forEach(function(k){var m=mM[k];if(m&&m.date){var d=m.date.slice(0,10);if(d>='2026-03-19'&&d<='2026-06-21'){if(!P[d]){P[d]=[];D.push(d)}if((m.leagueName||'').indexOf('世界杯')>=0)return;var mid=String(m.matchId);var r=norm(rM['m_'+mid]||rM[mid]||[]);var a=0,b=0;r.forEach(function(x){if(x.type==='平'||x.type==='让平')a+=x.num||0;if(x.type==='胜')b+=x.num||0});P[d].push({match:m,cA:a,cB:b})}}});
D.sort();

D.forEach(function(d){var o=loadO(d);P[d].forEach(function(e){if(o){var od=o[e.match.num||'']||null;if(od){e.odds=od;e.drD=od.spf&&od.spf.draw?od.spf.draw:0;e.rqD=od.rqspf&&od.rqspf.draw?od.rqspf.draw:0;e.spfH=od.spf&&od.spf.home?od.spf.home:0;e.rqH=od.rqspf&&od.rqspf.handicap!=null?od.rqspf.handicap:0}}
var m=e.match,rec=norm(rM['m_'+m.matchId]||rM[String(m.matchId)]||[]);
e.wA=null;var ha=false,hn=false;rec.forEach(function(r){if(r.type==='平'||r.type==='让平'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});if(ha)e.wA=true;else if(hn)e.wA=false;if(e.wA===null&&m.score&&m.matchStatus>=2){var p=String(m.score).replace(/[-:]/g,':').split(':');var h=parseInt(p[0]),a=parseInt(p[1]);if(!isNaN(h)&&!isNaN(a))e.wA=(h===a||h-a+(e.rqH||0)===0)}
e.wB=null;ha=false;hn=false;rec.forEach(function(r){if(r.type==='胜'){if(r.result===1)ha=true;else if(r.result===0)hn=true}});if(ha)e.wB=true;else if(hn)e.wB=false;if(e.wB===null&&m.score&&m.matchStatus>=2){var p2=String(m.score).replace(/[-:]/g,':').split(':');var h2=parseInt(p2[0]),a2=parseInt(p2[1]);if(!isNaN(h2)&&!isNaN(a2))e.wB=(h2>a2)}
e.eA=e.drD>0&&e.rqD>0?1/(1/e.drD+1/e.rqD):(e.drD||e.rqD||0);e.eB=e.spfH||0})});

var aT=[],bT=[],mT=[],cT=[];
for(var a=5;a<=60;a+=5)aT.push(a);for(var b=5;b<=60;b+=5)bT.push(b);
for(var m=1.1;m<=3.0;m+=0.3)mT.push(parseFloat(m.toFixed(1)));
for(var c=0;c<=3.0;c+=0.3)cT.push(parseFloat(c.toFixed(1)));

var G=[];aT.forEach(function(a){bT.forEach(function(b){cT.forEach(function(c){mT.forEach(function(m){G.push({a:a,b:b,cp:c,mp:m})})})})});

var R=[],cnt=0;
G.forEach(function(g){var tp=0,tw=0,tl=0,pr=0,iv=0;
D.forEach(function(d){var ml=P[d];if(ml.length<6)return;var ca=[],cb=[];ml.forEach(function(e){if(e.cA>=g.a&&e.drD>0)ca.push(e);if(e.cB>=g.b)cb.push(e)});
var be=null,bs=-Infinity;for(var ai=0;ai<ca.length;ai++){for(var bi=0;bi<cb.length;bi++){var ea=ca[ai],eb=cb[bi];if(ea.match.matchId===eb.match.matchId)continue;if(ea.eA<=0||eb.eB<=0)continue;var p=ea.eA*eb.eB;if(g.cp>0&&p<g.cp)continue;var mz=Math.round(1000*p);if(mz<1000*g.mp)continue;if(ea.wA===null||eb.wB===null)continue;var q=p*(ea.cA+eb.cB);if(q>bs){bs=q;be={ea:ea,eb:eb,mz:mz}}}}if(be){tp++;iv+=1000;if(be.ea.wA&&be.eb.wB){tw++;pr+=(be.mz-1000)}else if(be.ea.wA===false||be.eb.wB===false){tl++;pr-=1000}}});
if(tp>0)R.push({a:g.a,b:g.b,cp:g.cp,mp:g.mp,plans:tp,won:tw,lost:tl,iv:iv,pr:pr,sc:iv*0.08+pr,roi:(pr/iv*100).toFixed(1)});
cnt++;if(cnt%2000===0)process.stdout.write('.');
});

R.sort(function(a,b){return b.sc-a.sc});
console.log('\n\n══ TOP 12 ══');
console.log('A>=人 B>=人 合赔>= 盈>=x  方案 命中 亏损   投入     盈利    评分   ROI');
console.log('-'.repeat(72));
for(var i=0;i<Math.min(12,R.length);i++){var r=R[i];console.log(p(r.a,3)+' '+p(r.b,3)+' '+p(r.cp,4)+' '+p(r.mp,4)+' '+p(r.plans,4)+' '+p(r.won,3)+' '+p(r.lost,3)+' '+p(r.iv,7)+' '+p(r.pr>=0?'+'+r.pr:r.pr,8)+' '+p(r.sc.toFixed(0),7)+' '+r.roi+'%')}
var be=R[0];console.log('\n══ 最优: A>='+be.a+' B>='+be.b+' 合赔>='+be.cp+' 盈>='+be.mp+'x | '+be.plans+'方案 '+be.won+'W/'+be.lost+'L '+(be.pr>=0?'+':'')+be.pr+' ROI '+be.roi+'%');
R.sort(function(a,b){return b.pr-a.pr});var bp=R[0];console.log('══ 纯盈利: A>='+bp.a+' B>='+bp.b+' 合赔>='+bp.cp+' 盈>='+bp.mp+'x | '+bp.plans+'方案 '+(bp.pr>=0?'+':'')+bp.pr+' ROI '+bp.roi+'%');
R.sort(function(a,b){return(b.won/(b.won+b.lost))-(a.won/(a.won+a.lost))});var bh=R[0];console.log('══ 命中率: A>='+bh.a+' B>='+bh.b+' 合赔>='+bh.cp+' 盈>='+bh.mp+'x | '+bh.plans+'方案 '+bh.won+'/'+bh.lost+' 命中率'+(bh.won/(bh.won+bh.lost)*100).toFixed(1)+'%')
function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s}
