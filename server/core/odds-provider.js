/**
 * core/odds-provider.js
 * 统一赔率读取辅助：500/allplays 主链 + sporttery 快照兜底
 */

function toArrayByType(type, source) {
  if (!source || typeof source !== 'object') return null;
  var arr = [];
  Object.keys(source).forEach(function (k) {
    if (String(k).startsWith('_')) return;
    if (type === 'bf') arr.push({ score: k, odds: source[k] });
    if (type === 'jqs') arr.push({ goals: k, odds: source[k] });
    if (type === 'bqc') arr.push({ combo: k, odds: source[k] });
  });
  return arr.length ? arr : null;
}

function findOddsEntryByMatchNum(oddsMap, matchNum) {
  if (!oddsMap || !matchNum) return null;
  if (oddsMap[matchNum]) return oddsMap[matchNum];
  var numOnly = String(matchNum).replace(/^[周一二三四五六日]+/, '');
  var keys = Object.keys(oddsMap);
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i]).replace(/^[周一二三四五六日]+/, '') === numOnly) {
      return oddsMap[keys[i]];
    }
  }
  return null;
}

function getSportteryFallback(database, matchNum) {
  var empty = {
    spf: null,
    rqspf: null,
    handicap: null,
    bf: null,
    jqs: null,
    bqc: null,
    source: null,
  };
  if (!database || !matchNum) return empty;

  try {
    var rows = null;

    // 优先通过适配器查询
    var adp = database.getAdapter && database.getAdapter();
    if (adp) {
      rows = adp.execAll(
        'SELECT play_type, odds_json FROM sporttery_odds_snapshot WHERE match_num = ? ORDER BY snapshot_time DESC LIMIT 60',
        matchNum,
      );
    } else {
      // ★ A: 适配器未就绪(sql.js异步初始化)→用raw db直接查询(只读，安全)
      var rawDb = database.getDatabase && database.getDatabase();
      if (rawDb) {
        try {
          var stmt = rawDb.prepare(
            'SELECT play_type, odds_json FROM sporttery_odds_snapshot WHERE match_num = ? ORDER BY snapshot_time DESC LIMIT 60',
          );
          stmt.bind([matchNum]);
          rows = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          stmt.free();
        } catch (e) { /* raw db fallback failed */ }
      }
    }
    if (!rows || !rows.length) return empty;

    var out = {
      spf: null,
      rqspf: null,
      handicap: null,
      bf: null,
      jqs: null,
      bqc: null,
      source: 'sporttery_fallback',
    };

    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var odds = {};
      try {
        odds = JSON.parse(r.odds_json || '{}');
      } catch (e) {
        continue;
      }

      if (r.play_type === 'spf' && !out.spf) {
        out.spf = { home: odds['胜'] || null, draw: odds['平'] || null, away: odds['负'] || null };
      }
      if (r.play_type === 'rqspf' && !out.rqspf) {
        out.rqspf = { home: odds['胜'] || null, draw: odds['平'] || null, away: odds['负'] || null };
        if (odds._handicap != null) out.handicap = odds._handicap;
      }
      if (r.play_type === 'bf' && !out.bf) out.bf = toArrayByType('bf', odds);
      if (r.play_type === 'jqs' && !out.jqs) out.jqs = toArrayByType('jqs', odds);
      if (r.play_type === 'bqc' && !out.bqc) out.bqc = toArrayByType('bqc', odds);
    }

    return out;
  } catch (e) {
    return empty;
  }
}

module.exports = {
  toArrayByType: toArrayByType,
  findOddsEntryByMatchNum: findOddsEntryByMatchNum,
  getSportteryFallback: getSportteryFallback,
};
