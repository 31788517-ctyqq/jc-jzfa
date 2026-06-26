/**
 * 方案一参数扫描 v3 — 约束版
 * 规则: 同赛程日 + 两场不同 + 每天最多1方案
 * 目标: 投入×8% + 盈利 → 最大
 */
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var DATA_FILE = path.join(ROOT, 'server', 'data.json');
var rawJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
var mMap = rawJson.m || {};
var rMap = rawJson.r || {};

console.log('m=' + Object.keys(mMap).length + ' r=' + Object.keys(rMap).length);

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
    var j = JSON.parse(fs.readFileSync(p,'utf8'));
    return (j&&j.odds)?j.odds:j;
  } catch(e) { return null; }
}

// Step 1: 预计算
var precalc = {};
var dates = [];
Object.keys(mMap).forEach(function(k){
  var m = mMap[k];
  if (m && m.date) {
    var d = m.date.slice(0,10);
    if (d>='2026-03-19' && d<='2026-06-21') {
      if (!precalc[d]) { precalc[d] = []; dates.push(d); }
      var mid = String(m.matchId);
      if ((m.leagueName||'').indexOf('世界杯')>=0) return;
      var raw = rMap['m_'+mid] || rMap[mid] || [];
      var recs = norm(raw);
      var countA=0, countB=0;
      recs.forEach(function(r){ if(r.type==='平'||r.type==='让平') countA+=r.num||0; if(r.type==='让负') countB+=r.num||0; });
      precalc[d].push({match:m, countA:countA, countB:countB});
    }
  }
});
dates.sort();

// 加载赔率 + 预判
dates.forEach(function(ds) {
  var odds = loadOdds(ds);
  precalc[ds].forEach(function(e) {
    if (odds) {
      var num = e.match.num || ''; var od = odds[num];
      if (od) {
        e.odds = od;
        e.spfDraw = od.spf && od.spf.draw ? od.spf.draw : 0;
        e.rqspfAway = od.rqspf && od.rqspf.away ? od.rqspf.away : 0;
        e.rqspfDraw = od.rqspf && od.rqspf.draw ? od.rqspf.draw : 0;
        e.rqHcp = od.rqspf && od.rqspf.handicap!=null ? od.rqspf.handicap : 0;
      }
    }
    // 预判 A (平/让平)
    var m = e.match, recs = norm(rMap['m_'+m.matchId]||rMap[String(m.matchId)]||[]);
    e.wonA=null; var hd=false,hnd=false;
    recs.forEach(function(r){if(r.type==='平'||r.type==='让平'){if(r.result===1)hd=true;else if(r.result===0)hnd=true}});
    if(hd)e.wonA=true; else if(hnd)e.wonA=false;
    if(e.wonA===null&&m.score&&m.matchStatus>=2){
      var p=String(m.score).replace(/[-:]/g,':').split(':');
      var h=parseInt(p[0]),a=parseInt(p[1]);
      if(!isNaN(h)&&!isNaN(a)) e.wonA=(h===a||h-a+(e.rqHcp||0)===0);
    }
    // 预判 B (让负)
    e.wonB=null; var hbw=false,hbl=false;
    recs.forEach(function(r){if(r.type==='让负'){if(r.result===1)hbw=true;else if(r.result===0)hbl=true}});
    if(hbw)e.wonB=true; else if(hbl)e.wonB=false;
    if(e.wonB===null&&m.score&&m.matchStatus>=2){
      var p2=String(m.score).replace(/[-:]/g,':').split(':');
      var h2=parseInt(p2[0]),a2=parseInt(p2[1]);
      if(!isNaN(h2)&&!isNaN(a2)) e.wonB=(h2-a2+(e.rqHcp||0)<0);
    }
    e.effA = e.spfDraw>0&&e.rqspfDraw>0?1/(1/e.spfDraw+1/e.rqspfDraw):(e.spfDraw||e.rqspfDraw||0);
    e.effB = e.rqspfAway||0;
  });
});

console.log('dates: '+dates.length+' 预计算完成\n');

// Step 2: 参数网格
var aThr=[],bThr=[];
for(var a=10;a<=50;a+=5) aThr.push(a);
for(var b=10;b<=50;b+=5) bThr.push(b);
var mps=[1.2,1.3,1.5,1.8,2.0,2.2,2.5,2.8,3.0,3.5,4.0];

var grids=[];
aThr.forEach(function(a){bThr.forEach(function(b){mps.forEach(function(mp){grids.push({a:a,b:b,mp:mp})})})});
console.log('参数组合: '+grids.length+'\n');

var results=[], cnt=0;
grids.forEach(function(g){
  var tp=0,tw=0,tl=0,profit=0,invest=0;

  dates.forEach(function(ds){
    var mList = precalc[ds];
    if (mList.length < 2) return; // 同赛程日至少2场

    var ca=[], cb=[];
    mList.forEach(function(e){
      if (e.countA >= g.a && e.spfDraw > 0) ca.push(e);
      if (e.countB >= g.b) cb.push(e);
    });

    // ★ 每天只取一个最优配对
    var bestPair = null, bestScore = -Infinity;
    for (var ai=0; ai<ca.length; ai++) {
      for (var bi=0; bi<cb.length; bi++) {
        var ea=ca[ai], eb=cb[bi];
        // 两场不能相同
        if (ea.match.matchId === eb.match.matchId) continue;
        if (ea.effA<=0 || eb.effB<=0) continue;
        var prod = ea.effA * eb.effB;
        var mpz = Math.round(1000*prod);
        if (mpz < 1000*g.mp) continue;
        if (ea.wonA===null || eb.wonB===null) continue; // 结果未知 → 不计入选择

        // ★ 赛前选择标准: 合赔×专家数 (无 look-ahead bias)
        var pairQuality = prod * (ea.countA + eb.countB);

        if (pairQuality > bestScore) {
          bestScore = pairQuality;
          bestPair = {ea:ea, eb:eb, mpz:mpz};
        }
      }
    }

    // 选取当日最优方案 (赛前选择，赛后结算盈亏)
    if (bestPair) {
      tp++;
      invest += 1000;
      if (bestPair.ea.wonA && bestPair.eb.wonB) { tw++; profit += (bestPair.mpz-1000); }
      else if (bestPair.ea.wonA===false || bestPair.eb.wonB===false) { tl++; profit -= 1000; }
      // 结果未知则不计入
    }
  });

  if (tp>0){
    var score = invest * 0.08 + profit;
    results.push({a:g.a,b:g.b,mp:g.mp,plans:tp,won:tw,lost:tl,invest:invest,profit:profit,score:score,roi:(profit/invest*100).toFixed(1)});
  }
  cnt++; if(cnt%100===0) process.stdout.write('.');
});

// 按评分排序
results.sort(function(a,b){return b.score-a.score});
console.log('\n\n══════ TOP 20 (每天1方案, 投入×8%+盈利) ══════');
console.log('A≥人 B≥人 盈≥x   方案  命中  亏损    投入      盈利     评分     ROI');
console.log('─'.repeat(75));
for(var i=0;i<Math.min(20,results.length);i++){
  var r=results[i];
  console.log(p(r.a,3)+' '+p(r.b,3)+' '+p(r.mp,4)+' '+p(r.plans,4)+' '+p(r.won,4)+' '+p(r.lost,4)+' '+p(r.invest,8)+' '+p(r.profit>=0?'+'+r.profit:r.profit,8)+' '+p(r.score.toFixed(0),8)+' '+r.roi+'%');
}

var best=results[0];
console.log('\n══════ 最优 ══════');
console.log('评分: 投入×8%('+(best.invest*0.08).toFixed(0)+') + 盈利('+(best.profit>=0?'+':'')+best.profit+') = '+best.score.toFixed(0));
console.log('A≥'+best.a+'人(平让平) B≥'+best.b+'人(让负) 盈≥'+best.mp+'x');
console.log('方案'+best.plans+'/天 命中'+best.won+' 亏损'+best.lost+' 命中率'+(best.won/(best.won+best.lost)*100).toFixed(1)+'%');
console.log('盈利'+(best.profit>=0?'+':'')+best.profit+' ROI '+best.roi+'%');

// 纯盈利最优
results.sort(function(a,b){return b.profit-a.profit});
var bp=results[0];
console.log('\n══════ 纯盈利最优 ══════');
console.log('A≥'+bp.a+' B≥'+bp.b+' 盈≥'+bp.mp+'x | '+bp.plans+'方案 盈利'+(bp.profit>=0?'+':'')+bp.profit+' ROI '+bp.roi+'%');

// 按命中率
results.sort(function(a,b){return (b.won/(b.won+b.lost))-(a.won/(a.won+a.lost))});
var bh=results[0];
console.log('\n══════ 命中率最优 ══════');
console.log('A≥'+bh.a+' B≥'+bh.b+' 盈≥'+bh.mp+'x | '+bh.plans+'方案 命中率'+(bh.won/(bh.won+bh.lost)*100).toFixed(1)+'% ROI '+bh.roi+'%');

function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s;}
