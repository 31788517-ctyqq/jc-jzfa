/**
 * 回填数据质量优化 P1+P2 — 含 handicap 补全
 * 用法: node server/optimize_backfill_quality.js [--dry]
 */
var fs = require('fs'),
  path = require('path'),
  db = require('better-sqlite3');
var DB_PATH = path.join(__dirname, 'midou_data.db');
var dryRun = process.argv.includes('--dry');
var from = '2024-01-01',
  to = '2026-03-18';

console.log('╔══════════════════════════════════════╗');
console.log('║  回填数据质量优化 P1+P2              ║');
console.log('║  ' + (dryRun ? 'DRY RUN' : '正式执行') + '                  ║');
console.log('╚══════════════════════════════════════╝\n');

var dbo = db(DB_PATH);

// ── 联赛基线 ──
var LG = {
  英超: 2.72,
  西甲: 2.63,
  意甲: 2.56,
  德甲: 3.18,
  法甲: 2.55,
  荷甲: 3.05,
  葡超: 2.67,
  挪超: 2.92,
  瑞典超: 2.85,
  日职: 2.62,
  日乙: 2.58,
  韩职: 2.48,
  美职: 2.78,
  俄超: 2.48,
  比甲: 2.82,
  奥甲: 2.72,
  苏超: 2.65,
  中超: 2.78,
  墨超: 2.68,
  巴甲: 2.42,
  阿甲: 2.18,
  欧冠: 2.82,
  欧罗巴: 2.72,
  亚冠: 2.65,
  澳洲甲: 2.88,
  德乙: 2.82,
  法乙: 2.42,
  英冠: 2.55,
  土超: 2.75,
  波兰超: 2.62,
  瑞士超: 2.82,
  希腊超: 2.32,
  丹麦超: 2.78,
  英甲: 2.42,
};
var LH = {
  英超: 85,
  西甲: 80,
  意甲: 75,
  德甲: 90,
  法甲: 70,
  日职: 72,
  韩职: 68,
  澳超: 65,
  美职: 75,
  欧冠: 95,
  亚冠: 78,
  欧罗巴: 82,
  英冠: 70,
  德乙: 68,
  荷甲: 80,
  葡超: 72,
  俄超: 60,
  中超: 55,
  挪超: 70,
  瑞典超: 68,
  日乙: 60,
  比甲: 72,
  巴甲: 55,
  阿甲: 50,
  土超: 65,
  苏超: 65,
};

function lgAvg(ln) {
  for (var k in LG) {
    if ((ln || '').indexOf(k) >= 0) return LG[k];
  }
  return 2.65;
}
function lHeat(ln) {
  for (var k in LH) {
    if ((ln || '').indexOf(k) >= 0) return LH[k];
  }
  return 50;
}

function getLadder(hdc, pk) {
  hdc = Number(hdc) || 0;
  pk = Number(pk) || 50;
  var s = hdc * 12 + (pk - 50) * 0.25;
  s = Math.max(-0.5, Math.min(0.5, s / 100));
  if (s >= 0.3) return { label: '👑 主队绝对大优势', level: 3 };
  if (s >= 0.15) return { label: '⚔️ 主队中等优势', level: 2 };
  if (s >= 0.05) return { label: '🔍 主队微弱优势', level: 1 };
  if (s > -0.05) return { label: '⚖️ 双方实力接近', level: 0 };
  if (s > -0.15) return { label: '🔍 客队微弱优势', level: -1 };
  if (s > -0.3) return { label: '⚔️ 客队中等优势', level: -2 };
  return { label: '👑 客队绝对大优势', level: -3 };
}

function simModels(hdc, pk, ln, mid) {
  hdc = Number(hdc) || 0;
  pk = Number(pk) || 50;
  var base = lgAvg(ln);
  var seed = Math.abs(((parseInt((mid || '0').replace(/\D/g, '').slice(-4)) || 0) + pk * 7) % 100) / 100;
  var a = base + (hdc > 0 ? 0.15 : -0.15) + (seed - 0.5) * 0.3;
  var b = base + (hdc > 0 ? 0.4 : -0.25) + (seed - 0.5) * 0.5;
  var c = base + (pk > 55 ? 0.35 : -0.15) + (seed - 0.5) * 0.7;
  return {
    a: Math.round(Math.max(1.5, Math.min(4.5, a)) * 100) / 100,
    b: Math.round(Math.max(1.5, Math.min(4.5, b)) * 100) / 100,
    c: Math.round(Math.max(1.5, Math.min(4.5, c)) * 100) / 100,
  };
}

// ── Step 0: 补全 handicap ──
console.log('[Step 0] 补全 handicap...');
var hcpMap = {};
var hcpRows = dbo
  .prepare("SELECT match_id,odds_json FROM sporttery_odds_snapshot WHERE odds_json LIKE '%_handicap%'")
  .all();
hcpRows.forEach(function (r) {
  try {
    var j = JSON.parse(r.odds_json);
    if (j._handicap !== undefined) hcpMap[r.match_id] = Number(j._handicap);
  } catch (e) {}
});
console.log('  sporttery handicap: ' + Object.keys(hcpMap).length + ' 个 matchId');

// 第二步: 用matches表中的handicap/rq补
var mHcp = dbo.prepare('SELECT matchId,num,homeName,visitName FROM matches WHERE date>=? AND date<=?').all(from, to);
// 用 match_num 中的让球信息

if (!dryRun) {
  var updHcp = dbo.prepare(
    "UPDATE prediction_logs SET handicap=?,updated_at=datetime('now','localtime') WHERE matchId=?",
  );
  var hcpDone = 0;
  dbo.transaction(function () {
    var rows2 = dbo
      .prepare('SELECT matchId FROM prediction_logs WHERE date>=? AND date<=? AND (handicap IS NULL OR handicap=0)')
      .all(from, to);
    rows2.forEach(function (r) {
      var h = hcpMap[r.matchId];
      if (h !== undefined) {
        updHcp.run(h, r.matchId);
        hcpDone++;
      }
    });
  })();
  console.log('  handicap补全: ' + hcpDone + ' 条');
}

// ── 主流程 ──
var rows = dbo
  .prepare(
    "SELECT matchId,date,homeName,visitName,leagueName,handicap,pk_composite_score FROM prediction_logs WHERE date>=? AND date<=? AND gs_scores_json IS NOT NULL AND gs_scores_json!=''",
  )
  .all(from, to);
console.log('\n[P1+P2] 优化目标: ' + rows.length + ' 条\n');

if (dryRun) {
  var lDist = {};
  rows.forEach(function (r) {
    var ld = getLadder(r.handicap || 0, r.pk_composite_score);
    lDist[ld.label] = (lDist[ld.label] || 0) + 1;
  });
  console.log('DRY - Ladder分布:');
  Object.entries(lDist)
    .sort(function (a, b) {
      return b[1] - a[1];
    })
    .forEach(function (e) {
      console.log('  ' + e[0] + ': ' + e[1] + ' (' + ((e[1] / rows.length) * 100).toFixed(1) + '%)');
    });
  console.log('\nDRY - Model ABC 样例:');
  rows.slice(0, 5).forEach(function (r) {
    var m = simModels(r.handicap || 0, r.pk_composite_score, r.leagueName, r.matchId);
    console.log(
      '  ' + r.homeName + ' vs ' + r.visitName + ' hdc=' + (r.handicap || 0) + ' A:' + m.a + ' B:' + m.b + ' C:' + m.c,
    );
  });
  console.log('\nDRY RUN 完成');
  dbo.close();
  process.exit(0);
}

// 正式执行
var updL = dbo.prepare(
  "UPDATE prediction_logs SET gs_ladder_label=?,gs_ladder_level=?,updated_at=datetime('now','localtime') WHERE matchId=?",
);
var updM = dbo.prepare(
  "UPDATE prediction_logs SET gs_modelA_total=?,gs_modelB_total=?,gs_modelC_total=?,updated_at=datetime('now','localtime') WHERE matchId=?",
);
var updH = dbo.prepare(
  "UPDATE prediction_logs SET pk_heat_score=?,updated_at=datetime('now','localtime') WHERE matchId=?",
);
var tx = dbo.transaction(function () {
  rows.forEach(function (r, i) {
    var hdc = r.handicap || 0;
    var ld = getLadder(hdc, r.pk_composite_score);
    updL.run(ld.label, ld.level, r.matchId);
    var m = simModels(hdc, r.pk_composite_score, r.leagueName, r.matchId);
    updM.run(m.a, m.b, m.c, r.matchId);
    updH.run(lHeat(r.leagueName), r.matchId);
    if (i % 2000 === 0) process.stdout.write('\r  ' + Math.round((i / rows.length) * 100) + '% ...');
  });
});
tx();

var vr = dbo
  .prepare(
    "UPDATE prediction_logs SET model_version='fallback-v1.0',feature_version='backfill',updated_at=datetime('now','localtime') WHERE date>=? AND date<=?",
  )
  .run(from, to);
console.log('\r  100% 完成');

// 验证
console.log('\n── 验证 ──');
var r = dbo
  .prepare(
    'SELECT gs_ladder_label,COUNT(*) as cnt FROM prediction_logs WHERE date>=? AND date<=? AND gs_ladder_label IS NOT NULL GROUP BY gs_ladder_label ORDER BY cnt DESC',
  )
  .all(from, to);
r.forEach(function (x) {
  console.log('  ' + x.gs_ladder_label + ': ' + x.cnt);
});
r = dbo
  .prepare(
    'SELECT AVG(gs_modelA_total) as a,AVG(gs_modelB_total) as b,AVG(gs_modelC_total) as c FROM prediction_logs WHERE date>=? AND date<=?',
  )
  .get(from, to);
console.log(
  'Model均值: A=' +
    (r.a ? r.a.toFixed(2) : 'null') +
    ' B=' +
    (r.b ? r.b.toFixed(2) : 'null') +
    ' C=' +
    (r.c ? r.c.toFixed(2) : 'null'),
);
r = dbo
  .prepare(
    'SELECT AVG(pk_heat_score) as h,MIN(pk_heat_score) as mn,MAX(pk_heat_score) as mx FROM prediction_logs WHERE date>=? AND date<=?',
  )
  .get(from, to);
console.log('PK heat: avg=' + (r.h ? r.h.toFixed(0) : 'null') + ' [' + (r.mn || 0) + ',' + (r.mx || 0) + ']');
r = dbo
  .prepare(
    'SELECT COUNT(*) as c FROM prediction_logs WHERE date>=? AND date<=? AND handicap IS NOT NULL AND handicap!=0',
  )
  .get(from, to);
console.log('handicap!=0: ' + r.c + ' 条');
r = dbo
  .prepare("SELECT COUNT(*) as c FROM prediction_logs WHERE date>=? AND date<=? AND model_version='fallback-v1.0'")
  .get(from, to);
console.log('标记fallback: ' + r.c + ' 条');
console.log('\n═══════════════════════════════════════ 完成');
dbo.close();
