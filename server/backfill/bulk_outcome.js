/**
 * 从 prediction_logs 批量回填 prediction_outcomes（事务包裹）
 */
const database = require('./database');
database.initDatabase();

function wait(n) {
  if (database.isAvailable()) return run(database.getAdapter());
  if (n > 60) { console.log('timeout'); process.exit(1); }
  setTimeout(() => wait(n + 1), 300);
}

function run(adp) {
  var rows = adp.execAll(
    "SELECT matchId, date, homeName, visitName, matchNum, " +
    "actual_score, actual_home_goals, actual_away_goals, actual_spf, " +
    "gs_top_score, pk_direction, ai_spf, " +
    "gs_top_percent, pk_composite_score, ai_confidence " +
    "FROM prediction_logs " +
    "WHERE actual_score IS NOT NULL AND actual_score != ''"
  );
  console.log('Total records:', rows.length);

  function scoreToResult(sc) {
    if (!sc) return '';
    var p = String(sc).replace(/-/g, ':').split(':');
    var h = parseInt(p[0]), a = parseInt(p[1]);
    if (isNaN(h) || isNaN(a)) return '';
    return h > a ? '主胜' : (h < a ? '客胜' : '平');
  }

  function makePid(prefix, mid) {
    return prefix + '_v1.0_' + (mid || '').replace(/^m_/, '');
  }

  var backfilled = 0, skipped = 0;

  // ★ 事务包裹：避免 8000+ 次 _saveToFile，仅提交时写盘一次
  adp.transaction(function () {
    rows.forEach(function (r) {
      try {
        var mid = String(r.matchId || '').replace(/^m_/, '');
        var date = (r.date || '').slice(0, 10);
        var matchNum = r.matchNum || '';
        var actualResult = scoreToResult(r.actual_score);
        var actualHG = r.actual_home_goals !== null ? r.actual_home_goals : 0;
        var actualAG = r.actual_away_goals !== null ? r.actual_away_goals : 0;
        var actSpf = r.actual_spf || '';

        var models = [];
        if (r.gs_top_score) {
          var gsDir = scoreToResult(r.gs_top_score);
          models.push({ pid: makePid('gs', mid), name: '功守道', ver: 'v1.0', dh: gsDir === actSpf ? 1 : 0, sh: r.gs_top_score === r.actual_score ? 1 : 0 });
        }
        if (r.pk_direction) {
          models.push({ pid: makePid('pk', mid), name: 'PK评分', ver: 'v1.0', dh: r.pk_direction === actSpf ? 1 : 0, sh: 0 });
        }
        if (r.ai_spf) {
          models.push({ pid: makePid('ai', mid), name: 'AI预测', ver: 'v1.0', dh: r.ai_spf === actSpf ? 1 : 0, sh: 0 });
        }

        models.forEach(function (m) {
          var existing = adp.execOne("SELECT id FROM prediction_outcomes WHERE prediction_id = ?", [m.pid]);
          if (existing) { skipped++; return; }
          adp.execRun(
            "INSERT INTO prediction_outcomes (prediction_id, match_num, match_date, model_name, model_version, " +
            "actual_home_score, actual_away_score, actual_result, actual_total_goals, " +
            "direction_hit, over_under_hit, score_hit) " +
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            m.pid, matchNum, date, m.name, m.ver, actualHG, actualAG, actualResult, actualHG + actualAG, m.dh, 0, m.sh
          );
          backfilled++;
        });
      } catch (e) {}
    });
  })(); // transaction end

  console.log('Backfilled:', backfilled, 'Skipped:', skipped);

  // Verify
  var v = adp.execAll("SELECT model_name, COUNT(*) as cnt FROM prediction_outcomes GROUP BY model_name ORDER BY cnt DESC");
  console.log('=== prediction_outcomes ===');
  v.forEach(function (x) { console.log('  ' + x.model_name + ': ' + x.cnt); });
  process.exit(0);
}
wait(0);
