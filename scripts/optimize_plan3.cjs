/**
 * 方案三参数扫描 — 胜 × 让负 (2串1)
 * 规则: 同赛程日 + 两场不同 + 每天1方案
 * 目标: 投入×8% + 盈利 → 最大
 */
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var DATA_FILE = path.join(ROOT, 'server', 'data.json');
var rawJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
var mMap = rawJson.m || {};
var rMap = rawJson.r || {};

function norm(raw) {
  return (raw||[]).map(function(x){
    var r = x.rs!==undefined?x.rs:x.result!==undefined?x.result:null;
    return {type:x.t||x.type, num:x.n||x.num, result:r===0||r===1?r:null};
  });
}
function loadOdds(ds) {
  try {
    var p = path.join(ROOT, 'server', 'odds_history', ds + '.json');
    if (!fs.existsSync(p)) return null;
    return (JSON.parse(fs.readFileSync(p,'utf8'))||{}).odds || null;
  } catch(e) { return null; }
}

// Precompute
var precalc = {}, dates = [];
Object.keys(mMap).forEach(function(k){
  var m = mMap[k];
  if (m && m.date) {
    var d = m.date.slice(0,10);
    if (d>='2026-03-19' && d<='2026-06-21') {
      if (!precalc[d]) { precalc[d] = []; dates.push(d); }
      if ((m.leagueName||'').indexOf('世界杯')>=0) return;
      var mid = String(m.matchId);
      var raw = rMap['m_'+mid] || rMap[mid] || [];
      var recs = norm(raw);
      var countA=0, countB=0;
      recs.forEach(function(r){ if(r.type==='胜') countA+=r.num||0; if(r.type==='让负') countB+=r.num||0; });
      precalc[d].push({match:m, countA:countA, countB:countB});
    }
  }
});
dates.sort();

dates.forEach(function(ds) {
  var odds = loadOdds(ds);
  precalc[ds].forEach(function(e) {
    if (odds) {
      var od = odds[e.match.num||'']; if (!od) return;
      e.odds = od;
      e.spfHome = od.spf && od.spf.home ? od.spf.home : 0;
      e.rqAway = od.rqspf && od.rqspf.away ? od.rqspf.away : 0;
      e.rqHcp = od.rqspf && od.rqspf.handicap!=null ? od.rqspf.handicap : 0;
    }
    var m = e.match, recs = norm(rMap['m_'+m.matchId]||rMap[String(m.matchId)]||[]);
    // A: 胜
    e.wonA=null; var ha=false,hna=false;
    recs.forEach(function(r){if(r.type==='胜'){if(r.result===1)ha=true;else if(r.result===0)hna=true}});
    if(ha)e.wonA=true; else if(hna)e.wonA=false;
    if(e.wonA===null&&m.score&&m.matchStatus>=2){
      var p=String(m.score).replace(/[-:]/g,':').split(':');
      var h=parseInt(p[0]),a=parseInt(p[1]);
      if(!isNaN(h)&&!isNaN(a)) e.wonA=(h>a);
    }
    // B: 让负
    e.wonB=null; var hb=false,hnb=false;
    recs.forEach(function(r){if(r.type==='让负'){if(r.result===1)hb=true;else if(r.result===0)hnb=true}});
    if(hb)e.wonB=true; else if(hnb)e.wonB=false;
    if(e.wonB===null&&m.score&&m.matchStatus>=2){
      var p2=String(m.score).replace(/[-:]/g,':').split(':');
      var h2=parseInt(p2[0]),a2=parseInt(p2[1]);
      if(!isNaN(h2)&&!isNaN(a2)) e.wonB=(h2-a2+(e.rqHcp||0)<0);
    }
    e.effA = e.spfHome||0;
    e.effB = e.rqAway||0;
  });
});

console.log('dates: '+dates.length+' 预计算完成');

// Grid
var aThr=[],bThr=[],cpThr=[], mps=[];
for(var a=5;a<=60;a+=5) aThr.push(a);
for(var b=5;b<=60;b+=5) bThr.push(b);
for(var cp=0;cp<=3.0;cp+=0.3) cpThr.push(parseFloat(cp.toFixed(1)));
for(var mp=1.1;mp<=3.0;mp+=0.3) mps.push(parseFloat(mp.toFixed(1)));

var grids=[];
aThr.forEach(function(a){bThr.forEach(function(b){cpThr.forEach(function(cp){mps.forEach(function(mp){grids.push({a:a,b:b,cp:cp,mp:mp})})})})});

var results=[], cnt=0;
grids.forEach(function(g){
  var tp=0,tw=0,tl=0,profit=0,invest=0;
  dates.forEach(function(ds){
    var ml=precalc[ds]; if(ml.length<2) return;
    var ca=[],cb=[];
    ml.forEach(function(e){ if(e.countA>=g.a&&e.spfHome>0) ca.push(e); if(e.countB>=g.b) cb.push(e); });
    var best=null, bs=-Infinity;
    for(var ai=0;ai<ca.length;ai++){
      for(var bi=0;bi<cb.length;bi++){
        var ea=ca[ai],eb=cb[bi];
        if(ea.match.matchId===eb.match.matchId) continue;
        if(ea.effA<=0||eb.effB<=0) continue;
        var prod=ea.effA*eb.effB;
        if(g.cp>0&&prod<g.cp) continue;
        var mpz=Math.round(1000*prod);
        if(mpz<1000*g.mp) continue;
        if(ea.wonA===null||eb.wonB===null) continue;
        var q=prod*(ea.countA+eb.countB);
        if(q>bs){bs=q;best={ea:ea,eb:eb,mpz:mpz}}
      }
    }
    if(best){
      tp++;invest+=1000;
      if(best.ea.wonA&&best.eb.wonB){tw++;profit+=(best.mpz-1000)}
      else if(best.ea.wonA===false||best.eb.wonB===false){tl++;profit-=1000}
    }
  });
  if(tp>0) results.push({a:g.a,b:g.b,cp:g.cp,mp:g.mp,plans:tp,won:tw,lost:tl,invest:invest,profit:profit,score:invest*0.08+profit,roi:(profit/invest*100).toFixed(1)});
  cnt++; if(cnt%2000===0) process.stdout.write('.');
});

results.sort(function(a,b){return b.score-a.score});
console.log('\n\n══════ TOP 15 ══════');
console.log('A≥人 B≥人 合赔≥ 盈≥x  方案 命中 亏损   投入     盈利    评分   ROI');
console.log('─'.repeat(72));
for(var i=0;i<Math.min(15,results.length);i++){
  var r=results[i];
  console.log(p(r.a,3)+' '+p(r.b,3)+' '+p(r.cp,4)+' '+p(r.mp,4)+' '+p(r.plans,4)+' '+p(r.won,3)+' '+p(r.lost,3)+' '+p(r.invest,7)+' '+p(r.profit>=0?'+'+r.profit:r.profit,8)+' '+p(r.score.toFixed(0),7)+' '+r.roi+'%');
}

var best=results[0];
console.log('\n══ 最优 ══');
console.log('A≥'+best.a+'(胜) B≥'+best.b+'(让负) 合赔≥'+best.cp+' 盈≥'+best.mp+'x');
console.log(best.plans+'方案 '+best.won+'W/'+best.lost+'L 盈利'+(best.profit>=0?'+':'')+best.profit+' ROI '+best.roi+'%');

results.sort(function(a,b){return b.profit-a.profit});
var bp=results[0];
console.log('\n══ 纯盈利最优 ══ A≥'+bp.a+' B≥'+bp.b+' 合赔≥'+bp.cp+' 盈≥'+bp.mp+'x | '+bp.plans+'方案 '+(bp.profit>=0?'+':'')+bp.profit+' ROI '+bp.roi+'%');

results.sort(function(a,b){return (b.won/(b.won+b.lost))-(a.won/(a.won+a.lost))});
var bh=results[0];
console.log('\n══ 命中率最优 ══ A≥'+bh.a+' B≥'+bh.b+' 合赔≥'+bh.cp+' 盈≥'+bh.mp+'x | '+bh.plans+'方案 命中率'+(bh.won/(bh.won+bh.lost)*100).toFixed(1)+'%');

function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s;}
