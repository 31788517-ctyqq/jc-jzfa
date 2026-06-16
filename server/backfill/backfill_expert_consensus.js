/**
 * 专家共识回填 — 从 data.json 的 r 字段聚合 midou310 推荐
 * 匹配 ExpertConsensusAdapter 逻辑：胜→home 平→draw 负→away
 * 用法: node server/backfill_expert_consensus.js [--dry]
 */
var fs = require('fs'),
  path = require('path'),
  database = require('./database');
var DATA_FILE = path.join(__dirname, 'data.json');
var dryRun = process.argv.includes('--dry');

console.log('╔══════════════════════════════════════╗');
console.log('║  专家共识回填                        ║');
console.log('║  ' + (dryRun ? 'DRY RUN' : '正式执行') + '                  ║');
console.log('╚══════════════════════════════════════╝\n');

var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
var rMap = data.r || {},
  mMap = data.m || {};
var keys = Object.keys(rMap).filter(function (k) {
  return Array.isArray(rMap[k]) && rMap[k].length > 0;
});
console.log('有推荐数据的比赛: ' + keys.length);

// ★ 等待数据库初始化（兼容 sql.js 异步加载）
function waitForDb(cb) {
  database.initDatabase();
  if (database.isAvailable()) {
    cb(database.getAdapter());
    return;
  }
  var start = Date.now();
  function check() {
    if (database.isAvailable()) {
      cb(database.getAdapter());
      return;
    }
    if (Date.now() - start > 30000) {
      console.log('[db] 超时');
      cb(null);
      return;
    }
    setTimeout(check, 500);
  }
  setTimeout(check, 500);
}

waitForDb(function (adp) {
  if (!adp) {
    console.error('DB不可用');
    process.exit(1);
  }

  // 聚合推荐 → 专家共识
  // ★ V9: 增加 RQSPF 类型匹配（让胜/让平/让负），midou310主力推荐类型
  function computeConsensus(recs) {
    var dirs = { home: 0, draw: 0, away: 0 },
      total = 0;
    recs.forEach(function (r) {
      var type = r.type || '',
        num = Number(r.num) || 1;
      total += num;
      // SPF: 胜/主胜→home, 平/平局→draw, 负/客胜→away
      if (type === '胜' || type === '主胜') dirs.home += num;
      else if (type === '平' || type === '平局') dirs.draw += num;
      else if (type === '负' || type === '客胜') dirs.away += num;
      // RQSPF: 让胜→home, 让平→draw, 让负→away (主力推荐类型)
      else if (type === '让胜') dirs.home += num;
      else if (type === '让平') dirs.draw += num;
      else if (type === '让负') dirs.away += num;
      // 组合类型
      else if (type === '胜平') {
        dirs.home += num / 2;
        dirs.draw += num / 2;
      } else if (type === '平负') {
        dirs.draw += num / 2;
        dirs.away += num / 2;
      }
      // 非方向型推荐不计入
      else total -= num;
    });
    if (total <= 0) return null;

    var top = 'home',
      topCount = dirs.home;
    if (dirs.draw > topCount) {
      top = 'draw';
      topCount = dirs.draw;
    }
    if (dirs.away > topCount) {
      top = 'away';
      topCount = dirs.away;
    }

    var conf = topCount / total;
    return {
      direction: top,
      confidence: Math.min(conf, 1),
      consensusTag: conf >= 0.6 ? 'strong' : conf >= 0.4 ? 'weak' : 'neutral',
      homeCount: dirs.home,
      drawCount: dirs.draw,
      awayCount: dirs.away,
      total: total,
    };
  }

  var stats = { new: 0, skipped: 0, noSPF: 0, errors: 0 };

  keys.forEach(function (k) {
    try {
      var recs = rMap[k] || [];
      var m = mMap[k] || {};
      var mid = (m.matchId || '').replace(/^m_/, '');
      var date = (m.date || '').substring(0, 10);
      var num = m.num || '';

      var cons = computeConsensus(recs);
      if (!cons) {
        stats.noSPF++;
        return;
      }

      // Skip if direction is neutral and no majority
      var predId = 'expert_consensus_v1.0_' + mid + '_' + date;

      // Check existing
      var existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id=?', predId);
      if (existing) {
        stats.skipped++;
        return;
      }

      if (dryRun) {
        stats.new++;
        if (stats.new <= 5)
          console.log(
            m.homeName +
              ' vs ' +
              m.visitName +
              ' h:' +
              cons.homeCount +
              ' d:' +
              cons.drawCount +
              ' a:' +
              cons.awayCount +
              ' -> ' +
              cons.direction +
              '(' +
              (cons.confidence * 100).toFixed(0) +
              '%) ' +
              cons.consensusTag,
          );
        return;
      }

      adp.execRun(
        'INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,consensus_tag,raw_output_json,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        num,
        date,
        mid,
        '专家共识',
        'v1.0',
        predId,
        cons.direction,
        cons.confidence,
        cons.consensusTag,
        JSON.stringify({
          homeCount: cons.homeCount,
          drawCount: cons.drawCount,
          awayCount: cons.awayCount,
          total: cons.total,
        }),
        new Date().toISOString(),
      );
      stats.new++;
    } catch (e) {
      stats.errors++;
      if (stats.errors <= 3) console.log('err:' + e.message);
    }
    if (stats.new % 200 === 0) process.stdout.write('\r  ' + stats.new + ' 新, ' + stats.skipped + ' 跳过 ...');
  });

  console.log('\n');
  console.log('── 结果 ──');
  console.log('新增: ' + stats.new);
  console.log('跳过(已有): ' + stats.skipped);
  console.log('无SPF推荐: ' + stats.noSPF);
  console.log('错误: ' + stats.errors);

  if (dryRun) {
    console.log('\n*** DRY RUN ***');
    process.exit(0);
  }

  // Outcome backfill
  console.log('\n── Outcome回填 ──');
  var { backfiller } = require('./core/outcome-backfill');
  backfiller.backfill(adp, { dryRun: false }).then(function (r) {
    console.log('OutcomeBackfill:' + JSON.stringify(r));
    // Stats
    var ro = adp.execOne("SELECT COUNT(*) as c FROM prediction_outcomes WHERE model_name='专家共识'");
    console.log('prediction_outcomes(专家共识):' + ro.c);
    var rh = adp.execAll(
      "SELECT model_name,COUNT(*) as total,SUM(direction_hit) as hits FROM prediction_outcomes WHERE model_name='专家共识' GROUP BY model_name",
    );
    rh.forEach(function (x) {
      console.log(
        '命中率: ' + (x.total > 0 ? ((x.hits / x.total) * 100).toFixed(1) : '0') + '% (' + x.hits + '/' + x.total + ')',
      );
    });
    console.log('\n══════════════════════════ 完成');
  });
}); // waitForDb callback end
