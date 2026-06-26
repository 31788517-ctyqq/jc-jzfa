/**
 * 回测: 当前 generateExpertPlans 规则逐日重跑 03-19~06-21
 * 服务器运行: cd /root && node scripts/backtest_current_rules.cjs
 */
var fs = require('fs');
var PG = require('/root/server/core/plan-generator');

// 使用完整备份（含 r 推荐数据）。当前 data.json 的 r 字段不完整
var DATA_FILE = '/root/server/data.json.bak.polution_cleanup';
var rawJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
var mMap = rawJson.m || {};
var rMap = rawJson.r || {};

console.log('Loaded from data.json: m=' + Object.keys(mMap).length + ' r=' + Object.keys(rMap).length);

// 检查 r 格式
var rkeys = Object.keys(rMap).slice(0, 3);
console.log('r key samples:', rkeys);
if (rkeys.length > 0) {
  var sv = Array.isArray(rMap[rkeys[0]]) ? rMap[rkeys[0]][0] : rMap[rkeys[0]];
  console.log('r value sample:', JSON.stringify(sv).slice(0, 100));
}

// 收集日期
var dates = new Set();
Object.keys(mMap).forEach(function (k) {
  var m = mMap[k];
  if (m && m.date) {
    var d = m.date.slice(0, 10);
    if (d >= '2026-03-19' && d <= '2026-06-21') dates.add(d);
  }
});
var sortedDates = Array.from(dates).sort();

console.log('\n═══ 当前规则回测 ' + sortedDates[0] + ' ~ ' + sortedDates[sortedDates.length-1] + ' (' + sortedDates.length + '天) ═══\n');

function normalizeRecs(raw) {
  return (raw || []).map(function (x) {
    var r = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
    return { type: x.t || x.type, num: x.n || x.num, result: r === 0 || r === 1 ? r : null };
  });
}

function loadOdds(ds) {
  try {
    var p = '/root/server/odds_history/' + ds + '.json';
    if (!fs.existsSync(p)) return null;
    var json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (json && json.odds) ? json.odds : json;
  } catch (e) { return null; }
}

var monthStats = {}, planStats = {};
function ensM(ds) { var k=ds.slice(0,7); if(!monthStats[k]) monthStats[k]={plans:0,won:0,lost:0,pending:0,profit:0,invested:0}; return monthStats[k]; }
function ensP(pn) { if(!planStats[pn]) planStats[pn]={plans:0,won:0,lost:0,pending:0,profit:0,invested:0}; return planStats[pn]; }

var ti=0, tp=0, tw=0, tl=0, tpe=0, errDays=0, zeroPlanDays=0;

sortedDates.forEach(function (ds) {
  var mList = [];
  Object.keys(mMap).forEach(function (k) {
    var m = mMap[k];
    if (m && (m.date || '').slice(0, 10) === ds) mList.push(Object.assign({}, m));
  });
  if (mList.length === 0) return;

  var odds = loadOdds(ds);
  var matchDataMap = {};
  mList.forEach(function (m) {
    var mid = String(m.matchId);
    // 尝试多种 key 格式
    var raw = rMap['m_' + mid] || rMap[mid] || rMap['r_' + mid] || [];
    var num = m.num || '';
    var od = odds && odds[num] ? odds[num] : null;
    matchDataMap[mid] = {
      match: m,
      recs: normalizeRecs(raw),
      odds: od ? { spf: od.spf || null, rqspf: od.rqspf || null, totalGoals: od.totalGoals || null, halfFull: od.halfFull || null, isSingleGame: od.isSingleGame || null } : null,
    };
  });

  try {
    var plans = PG.generateExpertPlans(mList, matchDataMap, ds);
    if (plans.length === 0) zeroPlanDays++;

    plans.forEach(function (p) {
      var iw = p.isPlanWon === true, il = p.isPlanLose === true;
      var ip = p.isPlanWon === null || p.isPlanWon === undefined;
      var pr = iw ? (p.winningPrize || p.maxPrize || 0) : 0;
      var pf = pr - (p.amount || 1000);

      var mo = ensM(ds); mo.plans++; mo.invested += (p.amount||1000); mo.profit += pf;
      if(iw) mo.won++; else if(il) mo.lost++; else mo.pending++;
      var sp = ensP(p.planName); sp.plans++; sp.invested += (p.amount||1000); sp.profit += pf;
      if(iw) sp.won++; else if(il) sp.lost++; else sp.pending++;
      ti += (p.amount||1000); tp += pf;
      if(iw) tw++; else if(il) tl++; else tpe++;
    });
  } catch (e) {
    errDays++;
    if (errDays <= 3) console.error('ERR ' + ds + ': ' + e.message);
  }
});

console.log('零方案天数: ' + zeroPlanDays + ' / ' + sortedDates.length);
if (errDays) console.log('错误天数: ' + errDays);

console.log('\n══════ 每月 ══════');
console.log('月份       方案  命中  亏损  待开    投入      盈利      ROI');
console.log('─'.repeat(75));
Object.keys(monthStats).sort().forEach(function(mk){
  var s=monthStats[mk];
  var r=s.invested>0?(s.profit/s.invested*100).toFixed(1)+'%':'N/A';
  console.log(mk+'    '+p(s.plans,4)+'  '+p(s.won,4)+'  '+p(s.lost,4)+'  '+p(s.pending,4)+'  '+p(s.invested,7)+'  '+p(s.profit>=0?'+'+s.profit:s.profit,8)+'  '+r);
});

console.log('\n══════ 按方案 ══════');
console.log('方案              方案  命中  亏损  待开    投入      盈利      ROI');
console.log('─'.repeat(80));
Object.keys(planStats).sort(function(a,b){return (planStats[b].profit||0)-(planStats[a].profit||0)}).forEach(function(pk){
  var s=planStats[pk];
  var r=s.invested>0?(s.profit/s.invested*100).toFixed(1)+'%':'N/A';
  console.log(pr(pk,15)+'  '+p(s.plans,4)+'  '+p(s.won,4)+'  '+p(s.lost,4)+'  '+p(s.pending,4)+'  '+p(s.invested,7)+'  '+p(s.profit>=0?'+'+s.profit:s.profit,8)+'  '+r);
});

console.log('\n'+'─'.repeat(80));
var hr=tw+tl>0?(tw/(tw+tl)*100).toFixed(1)+'%':'N/A';
var tr=ti>0?(tp/ti*100).toFixed(1)+'%':'N/A';
console.log('总计: '+(tw+tl+tpe)+' 方案, 命中 '+tw+', 亏损 '+tl+', 待开 '+tpe+', 命中率 '+hr);
console.log('投入 '+ti+', 盈利 '+(tp>=0?'+':'')+tp+', ROI '+tr);

function p(v,w){var s=String(v);while(s.length<w)s=' '+s;return s;}
function pr(v,w){var s=String(v);while(s.length<w)s=s+' ';return s;}
