/**
 * ============================================================
 * 回填三阶段 — Phase 1: 导入历史比赛到 matches 表 + 构建 data.json
 * ============================================================
 *
 * 数据源: sporttery_odds_snapshot (2024-01-01 ~ 2026-03-18)
 * 目标:
 *   1. matches 表 — 批量 INSERT OR IGNORE
 *   2. data.json  — 构建 compatible map（供 PK/GS 读取）
 *   3. prediction_logs — 预建记录（仅元数据，预测列留空）
 *   4. 尝试从 midou310 回填比分（已结束的比赛）
 *
 * 用法:
 *   node server/backfill_phase1_matches.js [--dry] [--skip-scores]
 *     --dry         试运行，不写入
 *     --skip-scores 跳过比分回填
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ═══ 配置 ═══
const START_DATE = '2024-01-01';
const END_DATE = '2026-03-18';
const DB_PATH = path.join(__dirname, 'midou_data.db');
const DATA_FILE = path.join(__dirname, 'data.json');
const DATA_BAK_FILE = path.join(__dirname, 'data.json.bak_phase1');

const dryRun = process.argv.includes('--dry');
const skipScores = process.argv.includes('--skip-scores');

// ═══ 工具函数 ═══
function parseScore(scoreStr) {
  if (!scoreStr) return null;
  var parts = String(scoreStr).split(/[-:：]/);
  if (parts.length < 2) return null;
  var h = parseInt(parts[0]), a = parseInt(parts[1]);
  if (isNaN(h) || isNaN(a)) return null;
  return { home: h, away: a };
}

function sleep(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
}

function httpGet(url, params, headers) {
  return new Promise(function(resolve, reject) {
    var qs = params ? '?' + Object.keys(params).map(function(k) {
      return k + '=' + encodeURIComponent(params[k]);
    }).join('&') : '';
    var u = new URL(url + qs);
    var req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname + u.search,
      headers: Object.assign({ 'User-Agent': 'Mozilla/5.0', Accept: '*/*' }, headers || {}),
      rejectUnauthorized: false
    }, function(res) {
      var chunks = [];
      res.on('data', function(d) { chunks.push(d); });
      res.on('end', function() {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch(e) { resolve({ code: 0, msg: 'parse error' }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, function() { req.abort(); reject(new Error('timeout')); });
    req.end();
  });
}

// ═══ 主逻辑 ═══
async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Phase 1: 历史比赛导入               ║');
  console.log('║  ' + START_DATE + ' ~ ' + END_DATE + '            ║');
  console.log('║  ' + (dryRun ? 'DRY RUN' : '正式执行') + '                  ║');
  console.log('╚══════════════════════════════════════╝\n');

  // ═══ 初始化数据库 ═══
  var Database = require('better-sqlite3');
  var db = new Database(DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      matchId     TEXT PRIMARY KEY,
      num         TEXT,
      homeName    TEXT,
      visitName   TEXT,
      leagueName  TEXT,
      startTime   TEXT,
      matchStatus INTEGER DEFAULT 0,
      score       TEXT DEFAULT '',
      halfScore   TEXT DEFAULT '',
      duration    TEXT DEFAULT '',
      yellow      TEXT DEFAULT '',
      red         TEXT DEFAULT '',
      recommNum   INTEGER DEFAULT 0,
      date        TEXT,
      fetchDate   TEXT,
      createdAt   TEXT,
      updatedAt   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
  `);

  // ═══ Step 1: 从 sporttery_odds_snapshot 提取去重比赛 ═══
  console.log('── Step 1: 提取去重比赛 ──');

  var matches = db.prepare(`
    SELECT DISTINCT
      match_id,
      match_num,
      MIN(date) as match_date,
      home_team,
      away_team,
      league
    FROM sporttery_odds_snapshot
    WHERE date >= ? AND date <= ?
      AND match_id IS NOT NULL AND match_id != ''
      AND home_team IS NOT NULL AND home_team != ''
    GROUP BY match_id
    ORDER BY date, match_num
  `).all(START_DATE, END_DATE);

  console.log('  distinct matches: ' + matches.length);

  var yearDist = {};
  matches.forEach(function(m) {
    var yr = (m.match_date || '').slice(0, 4);
    yearDist[yr] = (yearDist[yr] || 0) + 1;
  });
  Object.entries(yearDist).sort().forEach(function(e) {
    console.log('    ' + e[0] + ': ' + e[1] + ' 场');
  });

  // ═══ Step 2: 导入 matches 表 ═══
  console.log('\n── Step 2: 写入 matches 表 ──');

  var insertMatch = db.prepare(`
    INSERT OR IGNORE INTO matches
      (matchId, num, homeName, visitName, leagueName, date, matchStatus, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now','localtime'))
  `);

  var inserted = 0, skipped = 0;
  if (!dryRun) {
    var tx = db.transaction(function() {
      matches.forEach(function(m) {
        var result = insertMatch.run(
          m.match_id, m.match_num || '', m.home_team, m.away_team,
          m.league || '', m.match_date
        );
        if (result.changes > 0) inserted++;
        else skipped++;
      });
    });
    tx();
    console.log('  新增: ' + inserted + ', 已存在(跳过): ' + skipped);
  } else {
    console.log('  DRY: 将写入 ' + matches.length + ' 场');
  }

  var totalInDb = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date >= ? AND date <= ?').get(START_DATE, END_DATE);
  console.log('  matches 表该时间段总数: ' + totalInDb.cnt);

  // ═══ Step 3: 构建 data.json ═══
  console.log('\n── Step 3: 构建 data.json ──');

  var existingData = { m: {}, r: {}, _meta: {} };
  if (fs.existsSync(DATA_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      console.log('  现有 data.json: ' + Object.keys(existingData.m || {}).length + ' 场比赛');
    } catch(e) {
      console.log('  现有 data.json 损坏，重建');
      existingData = { m: {}, r: {}, _meta: {} };
    }
  }

  if (!dryRun && fs.existsSync(DATA_FILE)) {
    fs.copyFileSync(DATA_FILE, DATA_BAK_FILE);
    console.log('  备份: ' + path.basename(DATA_BAK_FILE));
  }

  var newMatches = 0;
  matches.forEach(function(m) {
    var key = 'm_' + m.match_id;
    if (existingData.m[key] || existingData.m[m.match_id]) return;

    var obj = {
      matchId: m.match_id,
      num: m.match_num || '',
      homeName: m.home_team,
      visitName: m.away_team,
      leagueName: m.league || '',
      date: m.match_date,
      startTime: m.match_date,
      matchStatus: 2,
      score: '',
      halfScore: '',
      duration: '',
      yellow: '',
      red: '',
      recommNum: 0,
    };

    existingData.m[key] = obj;
    newMatches++;
  });

  console.log('  新增到 data.json: ' + newMatches + ' 场');
  console.log('  合并后 data.json: ' + Object.keys(existingData.m).length + ' 场');

  if (!dryRun) {
    var tmp = DATA_FILE + '.tmp_phase1';
    fs.writeFileSync(tmp, JSON.stringify(existingData));
    fs.renameSync(tmp, DATA_FILE);
    console.log('  data.json 已保存');
  } else {
    console.log('  DRY: 不写入 data.json');
  }

  // ═══ Step 4: 预建 prediction_logs 记录 ═══
  console.log('\n── Step 4: 预建 prediction_logs 记录 ──');

  db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT UNIQUE,
      date TEXT,
      homeName TEXT,
      visitName TEXT,
      leagueName TEXT,
      matchNum TEXT,
      handicap INTEGER,
      ai_spf TEXT, ai_overunder TEXT, ai_score TEXT, ai_confidence REAL, ai_content TEXT,
      pk_composite_score REAL, pk_power_score REAL, pk_goal_score REAL,
      pk_heat_score REAL, pk_stability_score REAL, pk_health_score REAL,
      pk_direction TEXT, pk_direction_stars INTEGER, pk_direction_desc TEXT,
      pk_hcp_direction TEXT, pk_goal_direction TEXT, pk_goal_stars INTEGER,
      pk_fusion_consensus TEXT, pk_batch_date TEXT,
      pk_ev_home REAL, pk_ev_draw REAL, pk_ev_away REAL,
      pk_value_tag TEXT, pk_value_score REAL,
      pk_heat_zscore REAL, pk_heat_z_overheat INTEGER,
      gs_scores_json TEXT, gs_top_score TEXT, gs_top_percent REAL,
      gs_ladder_label TEXT, gs_ladder_level INTEGER,
      gs_modelA_total REAL, gs_modelB_total REAL, gs_modelC_total REAL,
      actual_score TEXT, actual_home_goals INTEGER, actual_away_goals INTEGER,
      actual_spf TEXT, actual_overunder TEXT, actual_half_score TEXT,
      actual_corrected_at TEXT,
      created_at TEXT, updated_at TEXT,
      ai_version TEXT, ai_hit INTEGER,
      model_version TEXT, feature_version TEXT
    );
  `);

  var upsertLog = db.prepare(`
    INSERT OR IGNORE INTO prediction_logs
      (matchId, date, homeName, visitName, leagueName, matchNum, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `);

  var logsInserted = 0;
  if (!dryRun) {
    var tx2 = db.transaction(function() {
      matches.forEach(function(m) {
        var r = upsertLog.run(m.match_id, m.match_date, m.home_team, m.away_team, m.league || '', m.match_num || '');
        if (r.changes > 0) logsInserted++;
      });
    });
    tx2();
    console.log('  新增 prediction_logs: ' + logsInserted + ' 条');
  } else {
    console.log('  DRY: 将写入 ' + matches.length + ' 条');
  }

  // ═══ Step 5: 尝试从 midou310 回填比分 ═══
  if (skipScores) {
    console.log('\n── Step 5: 跳过比分回填 (--skip-scores) ──');
  } else {
    console.log('\n── Step 5: midou310 比分回填 ──');
    await backfillScoresFromMidou(matches, db, existingData);
  }

  // ═══ 汇总 ═══
  console.log('\n═══════════════════════════════════════');
  console.log('  Phase 1 完成!');
  console.log('  比赛数: ' + matches.length);
  console.log('  matches 表: ' + totalInDb.cnt + ' 场');
  console.log('  data.json: ' + Object.keys(existingData.m).length + ' 场');

  if (dryRun) {
    console.log('  *** DRY RUN — 去除 --dry 正式执行 ***');
  } else {
    console.log('\n  下一步: node server/backfill_phase2_predict.js');
  }
  console.log('═══════════════════════════════════════');

  db.close();
}

// ═══════════════════════════════════════════════════════════
// 从 midou310 回填比分
// ═══════════════════════════════════════════════════════════
async function backfillScoresFromMidou(matches, db, dataJson) {
  var env = {};
  try {
    var envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    envFile.split('\n').forEach(function(l) {
      var p = l.trim().split('=');
      if (p.length === 2) env[p[0]] = p[1];
    });
  } catch(e) {}

  var MOBILE = env.MIDOU_MOBILE || process.env.MIDOU_MOBILE;
  var PASSWORD = env.MIDOU_PASSWORD || process.env.MIDOU_PASSWORD;

  if (!MOBILE || !PASSWORD) {
    console.log('  ⚠️  缺少 MIDOU_MOBILE/MIDOU_PASSWORD，跳过比分回填');
    console.log('  (midou310 API 用于获取历史比分，缺失不影响后续 PK/GS 预测)');
    return;
  }

  console.log('  登录 midou310...');
  var token;
  try {
    var loginRes = await httpGet('https://midou310.com/mdsj/gduser/login.do', {
      mobile: MOBILE, password: PASSWORD
    });
    if (loginRes.code !== 1) {
      console.log('  登录失败: ' + JSON.stringify(loginRes));
      return;
    }
    token = loginRes.data.token;
    console.log('  登录成功');
  } catch(e) {
    console.log('  登录异常: ' + e.message);
    return;
  }

  var dates = [...new Set(matches.map(function(m) { return (m.match_date || '').slice(0, 10); }))].sort();
  console.log('  需回填 ' + dates.length + ' 天');

  var validDates = dates.filter(function(d) { return d >= '2024-01-01'; });
  console.log('  有效日期: ' + validDates.length + ' 天');

  if (dryRun) {
    console.log('  DRY: 将查询 ' + validDates.length + ' 天');
    validDates.slice(0, 5).forEach(function(d) { console.log('    ' + d); });
    console.log('  ...');
    return;
  }

  var updateMatch = db.prepare(`
    UPDATE matches SET matchStatus=?, score=?, halfScore=?, duration=?, updatedAt=datetime('now','localtime')
    WHERE matchId=?
  `);
  var updatePL = db.prepare(`
    UPDATE prediction_logs SET actual_score=?, actual_home_goals=?, actual_away_goals=?,
    actual_spf=?, actual_corrected_at=datetime('now','localtime')
    WHERE matchId=?
  `);

  var scoreUpdated = 0, apiErrors = 0;

  for (var i = 0; i < validDates.length; i++) {
    var d = validDates[i];
    var pct = Math.round((i + 1) / validDates.length * 100);
    try {
      var timestamp = new Date(d + 'T00:00:00+08:00').getTime();
      var res = await httpGet(
        'https://midou310.com/mdsj/score/footballDataList.do',
        { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
        { Cookie: 'token=' + token }
      );

      if (res.code === 1 && Array.isArray(res.data)) {
        var dayUpdated = 0;
        res.data.forEach(function(apiM) {
          var mid = String(apiM.matchId || apiM.dataId || '');
          if (!mid) return;
          var score = apiM.score || '';
          var halfScore = apiM.halfScore || '';
          var matchStatus = apiM.matchStatus || 0;
          if (matchStatus < 2 || !score) return;

          updateMatch.run(matchStatus, score, halfScore, apiM.duration || '', mid);

          var goals = parseScore(score);
          var spf = goals ? (goals.home > goals.away ? '主胜' : goals.home < goals.away ? '客胜' : '平') : null;
          updatePL.run(score, goals ? goals.home : null, goals ? goals.away : null, spf, mid);

          var key = 'm_' + mid;
          if (dataJson.m && dataJson.m[key]) {
            dataJson.m[key].matchStatus = matchStatus;
            dataJson.m[key].score = score;
            dataJson.m[key].halfScore = halfScore || dataJson.m[key].halfScore;
          }
          dayUpdated++;
        });
        if (dayUpdated > 0) {
          scoreUpdated += dayUpdated;
          process.stdout.write('\r  [' + pct + '%] ' + d + ': ' + dayUpdated + ' 场比分');
        } else if (i % 20 === 0) {
          process.stdout.write('\r  [' + pct + '%] ' + d + ': 无完赛...');
        }
      } else {
        apiErrors++;
        if (apiErrors <= 3) console.log('\n  ⚠ ' + d + ': API code=' + res.code);
      }
    } catch(e) {
      apiErrors++;
      if (apiErrors <= 3) console.log('\n  ✗ ' + d + ': ' + e.message);
    }

    if (i > 0 && i % 50 === 0) {
      var tmp = DATA_FILE + '.tmp_scores';
      fs.writeFileSync(tmp, JSON.stringify(dataJson));
      fs.renameSync(tmp, DATA_FILE);
    }

    await sleep(300 + Math.random() * 500);
  }

  var tmp = DATA_FILE + '.tmp_scores';
  fs.writeFileSync(tmp, JSON.stringify(dataJson));
  fs.renameSync(tmp, DATA_FILE);

  console.log('\n  比分回填完成: ' + scoreUpdated + ' 场, API错误: ' + apiErrors);
}

// ═══ 入口 ═══
main().catch(function(e) {
  console.error('脚本异常: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
