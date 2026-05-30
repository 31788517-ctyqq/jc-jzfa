/**
 * server/prediction_log.js
 * 预测回测数据层 — prediction_logs 表 CRUD
 */

const database = require('./database');
let dbReady = false;
let _ensureReady = null;

function ensureDatabase() {
  if (_ensureReady) return _ensureReady;
  _ensureReady = new Promise(function(resolve) {
    database.initDatabase();
    if (database.isAvailable()) { dbReady = true; resolve(true); return; }
    // sql.js 异步初始化等待
    var start = Date.now();
    function check() {
      if (database.isAvailable()) { dbReady = true; resolve(true); return; }
      if (Date.now() - start > 10000) { resolve(false); return; }
      setTimeout(check, 300);
    }
    check();
  });
  return _ensureReady;
}

function getDB() { return database.getDatabase(); }

// ═══ 建表 ═══
function initTable() {
  if (!dbReady) return;
  var db = getDB();
  if (!db) return;
  try {
    if (db.exec) {
      // sql.js
      db.run("CREATE TABLE IF NOT EXISTS prediction_logs (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "matchId TEXT NOT NULL," +
        "date TEXT," +
        "homeName TEXT," +
        "visitName TEXT," +
        "leagueName TEXT," +
        "matchNum TEXT," +
        "ai_spf TEXT," +
        "ai_overunder TEXT," +
        "ai_score TEXT," +
        "ai_confidence REAL," +
        "ai_content TEXT," +
        "pk_composite_score REAL," +
        "pk_power_score REAL," +
        "pk_goal_score REAL," +
        "pk_heat_score REAL," +
        "pk_stability_score REAL," +
        "pk_direction TEXT," +
        "pk_direction_stars INTEGER," +
        "pk_direction_desc TEXT," +
        "pk_hcp_direction TEXT," +
        "pk_goal_direction TEXT," +
        "pk_goal_stars INTEGER," +
        "pk_fusion_consensus TEXT," +
        "pk_batch_date TEXT," +
        "gs_scores_json TEXT," +
        "gs_top_score TEXT," +
        "gs_top_percent REAL," +
        "gs_ladder_label TEXT," +
        "gs_ladder_level INTEGER," +
        "actual_score TEXT," +
        "actual_home_goals INTEGER," +
        "actual_away_goals INTEGER," +
        "actual_spf TEXT," +
        "actual_overunder TEXT," +
        "actual_corrected_at TEXT," +
        "created_at TEXT DEFAULT (datetime('now','localtime'))," +
        "updated_at TEXT DEFAULT (datetime('now','localtime'))" +
      ")");
      db.run("CREATE INDEX IF NOT EXISTS idx_logs_matchId ON prediction_logs(matchId)");
      db.run("CREATE INDEX IF NOT EXISTS idx_logs_date ON prediction_logs(date)");
      db.run("CREATE INDEX IF NOT EXISTS idx_logs_league ON prediction_logs(leagueName)");
    } else if (db.prepare) {
      // better-sqlite3
      db.exec("CREATE TABLE IF NOT EXISTS prediction_logs (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT," +
        "matchId TEXT NOT NULL, date TEXT, homeName TEXT, visitName TEXT, leagueName TEXT, matchNum TEXT," +
        "ai_spf TEXT, ai_overunder TEXT, ai_score TEXT, ai_confidence REAL, ai_content TEXT," +
        "pk_composite_score REAL, pk_power_score REAL, pk_goal_score REAL, pk_heat_score REAL, pk_stability_score REAL," +
        "pk_direction TEXT, pk_direction_stars INTEGER, pk_direction_desc TEXT, pk_hcp_direction TEXT," +
        "pk_goal_direction TEXT, pk_goal_stars INTEGER, pk_fusion_consensus TEXT, pk_batch_date TEXT," +
        "gs_scores_json TEXT, gs_top_score TEXT, gs_top_percent REAL, gs_ladder_label TEXT, gs_ladder_level INTEGER," +
        "actual_score TEXT, actual_home_goals INTEGER, actual_away_goals INTEGER," +
        "actual_spf TEXT, actual_overunder TEXT, actual_corrected_at TEXT," +
        "created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')))");
      db.exec("CREATE INDEX IF NOT EXISTS idx_logs_matchId ON prediction_logs(matchId)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_logs_date ON prediction_logs(date)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_logs_league ON prediction_logs(leagueName)");
    }
    console.log('[prediction_log] table initialized');
  } catch (e) {
    console.error('[prediction_log] init error:', e.message);
  }
}

// ═══ 辅助：执行 SQL ═══
function _exec(sql, params) {
  var db = getDB();
  if (!db || !dbReady) return null;
  try {
    var stmt = db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params);
    stmt.step();
    stmt.free();
    return { changes: db.getRowsModified ? db.getRowsModified() : 0 };
  } catch (e) {
    console.error('[prediction_log] exec error:', e.message);
    return null;
  }
}

function _queryOne(sql, params) {
  var db = getDB();
  if (!db || !dbReady) return null;
  // 统一使用 sql.js 兼容的 step/getAsObject 方式
  try {
    var stmt = db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params);
    if (stmt.step()) {
      var obj = stmt.getAsObject();
      stmt.free();
      return obj;
    }
    stmt.free();
    return null;
  } catch (e) {
    // fallback: exec
    try {
      var r = db.exec(sql);
      if (r && r.length > 0 && r[0].values && r[0].values.length > 0) {
        return rowToObj(r[0].columns, r[0].values[0]);
      }
    } catch (e2) {}
    return null;
  }
}

function _queryAll(sql, params) {
  var db = getDB();
  if (!db || !dbReady) return [];
  try {
    var stmt = db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params);
    var results = [];
    while (stmt.step()) { results.push(stmt.getAsObject()); }
    stmt.free();
    return results;
  } catch (e) {
    // fallback: exec
    try {
      var r = db.exec(sql);
      if (r && r.length > 0) {
        return r[0].values.map(function(v) { return rowToObj(r[0].columns, v); });
      }
    } catch (e2) {}
    return [];
  }
}

function rowToObj(cols, vals) {
  var o = {};
  for (var i = 0; i < cols.length; i++) { o[cols[i]] = vals[i]; }
  return o;
}

// ═══ 写入预测日志（UPSERT by matchId） ═══
function upsert(fields) {
  if (!dbReady || !fields || !fields.matchId) return false;
  var existing = _queryOne("SELECT id FROM prediction_logs WHERE matchId = ?", [fields.matchId]);
  var now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  
  if (existing) {
    var sets = [];
    var vals = [];
    Object.keys(fields).forEach(function(k) {
      if (k === 'matchId' || k === 'id') return;
      sets.push(k + ' = ?');
      vals.push(fields[k]);
    });
    sets.push('updated_at = ?');
    vals.push(now);
    vals.push(fields.matchId);
    return _exec("UPDATE prediction_logs SET " + sets.join(', ') + " WHERE matchId = ?", vals);
  } else {
    fields.created_at = now;
    fields.updated_at = now;
    var cols = Object.keys(fields).join(', ');
    var placeholders = Object.keys(fields).map(function() { return '?'; }).join(', ');
    var vals = Object.values(fields);
    return _exec("INSERT INTO prediction_logs (" + cols + ") VALUES (" + placeholders + ")", vals);
  }
}

// AI 预测快捷写入
function upsertAI(matchId, fields) {
  var data = { matchId: matchId };
  if (fields.spf) data.ai_spf = fields.spf;
  if (fields.overunder) data.ai_overunder = fields.overunder;
  if (fields.score) data.ai_score = fields.score;
  if (fields.confidence !== undefined) data.ai_confidence = fields.confidence;
  if (fields.content) data.ai_content = fields.content;
  if (fields.date) data.date = fields.date;
  if (fields.homeName) data.homeName = fields.homeName;
  if (fields.visitName) data.visitName = fields.visitName;
  if (fields.leagueName) data.leagueName = fields.leagueName;
  if (fields.matchNum) data.matchNum = fields.matchNum;
  return upsert(data);
}

// PK 预测快捷写入
function upsertPK(matchId, fields) {
  var data = { matchId: matchId };
  if (fields.compositeScore !== undefined) data.pk_composite_score = fields.compositeScore;
  if (fields.powerScore !== undefined) data.pk_power_score = fields.powerScore;
  if (fields.goalScore !== undefined) data.pk_goal_score = fields.goalScore;
  if (fields.heatScore !== undefined) data.pk_heat_score = fields.heatScore;
  if (fields.stabilityScore !== undefined) data.pk_stability_score = fields.stabilityScore;
  if (fields.direction) data.pk_direction = fields.direction;
  if (fields.directionStars !== undefined) data.pk_direction_stars = fields.directionStars;
  if (fields.directionDesc) data.pk_direction_desc = fields.directionDesc;
  if (fields.hcpDirection) data.pk_hcp_direction = fields.hcpDirection;
  if (fields.goalDirection) data.pk_goal_direction = fields.goalDirection;
  if (fields.goalStars !== undefined) data.pk_goal_stars = fields.goalStars;
  if (fields.fusionConsensus) data.pk_fusion_consensus = fields.fusionConsensus;
  if (fields.batchDate) data.pk_batch_date = fields.batchDate;
  if (fields.date) data.date = fields.date;
  if (fields.homeName) data.homeName = fields.homeName;
  if (fields.visitName) data.visitName = fields.visitName;
  if (fields.leagueName) data.leagueName = fields.leagueName;
  if (fields.matchNum) data.matchNum = fields.matchNum;
  return upsert(data);
}

// 功守道预测快捷写入
function upsertGS(matchId, fields) {
  var data = { matchId: matchId };
  if (fields.scoresJson) data.gs_scores_json = fields.scoresJson;
  if (fields.topScore) data.gs_top_score = fields.topScore;
  if (fields.topPercent !== undefined) data.gs_top_percent = fields.topPercent;
  if (fields.ladderLabel) data.gs_ladder_label = fields.ladderLabel;
  if (fields.ladderLevel !== undefined) data.gs_ladder_level = fields.ladderLevel;
  if (fields.date) data.date = fields.date;
  if (fields.homeName) data.homeName = fields.homeName;
  if (fields.visitName) data.visitName = fields.visitName;
  if (fields.leagueName) data.leagueName = fields.leagueName;
  if (fields.matchNum) data.matchNum = fields.matchNum;
  return upsert(data);
}

// 赛果回填
function backfillResult(matchId, fields) {
  var data = { matchId: matchId };
  if (fields.actualScore) data.actual_score = fields.actualScore;
  if (fields.homeGoals !== undefined) data.actual_home_goals = fields.homeGoals;
  if (fields.awayGoals !== undefined) data.actual_away_goals = fields.awayGoals;
  if (fields.actualSpf) data.actual_spf = fields.actualSpf;
  if (fields.actualOverunder) data.actual_overunder = fields.actualOverunder;
  data.actual_corrected_at = new Date().toISOString();
  return upsert(data);
}

// ═══ 回测查询 ═══
function queryBacktest(filters) {
  filters = filters || {};
  var conditions = [];
  var params = [];

  // 只查询有实际赛果的比赛
  conditions.push("actual_score IS NOT NULL AND actual_score != ''");

  if (filters.dateRange && filters.dateRange !== 'all') {
    var days = parseInt(filters.dateRange) || 30;
    if (filters.dateRange === '7d') days = 7;
    else if (filters.dateRange === '30d') days = 30;
    else if (filters.dateRange === '60d') days = 60;
    else if (filters.dateRange === '90d') days = 90;
    var since = new Date();
    since.setDate(since.getDate() - days);
    conditions.push("date >= ?");
    params.push(since.toISOString().slice(0, 10));
  }

  if (filters.league && filters.league !== 'all') {
    conditions.push("leagueName = ?");
    params.push(filters.league);
  }

  if (filters.direction && filters.direction !== 'all') {
    if (filters.direction === 'home') { conditions.push("(ai_spf = '主胜' OR pk_direction = '主胜')"); }
    else if (filters.direction === 'away') { conditions.push("(ai_spf = '客胜' OR pk_direction = '客胜')"); }
    else if (filters.direction === 'draw') { conditions.push("(ai_spf = '平' OR pk_direction = '平')"); }
  }

  var type = filters.type || 'all';
  if (filters.aiConf && filters.aiConf !== 'all') {
    if (filters.aiConf === 'high') { conditions.push("ai_confidence >= 80"); }
    else if (filters.aiConf === 'mid') { conditions.push("ai_confidence >= 70 AND ai_confidence < 80"); }
    else if (filters.aiConf === 'low') { conditions.push("ai_confidence < 70"); }
  }
  if (filters.pkConf && filters.pkConf !== 'all') {
    if (filters.pkConf === 'high') { conditions.push("pk_composite_score >= 70"); }
    else if (filters.pkConf === 'mid') { conditions.push("pk_composite_score >= 50 AND pk_composite_score < 70"); }
    else if (filters.pkConf === 'low') { conditions.push("pk_composite_score < 50"); }
  }
  if (filters.consensus && filters.consensus !== 'all') {
    conditions.push("pk_fusion_consensus = ?");
    params.push(filters.consensus);
  }

  var where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  var list = _queryAll("SELECT * FROM prediction_logs" + where + " ORDER BY date DESC, matchNum ASC", params);

  // 计算命中
  list.forEach(function(row) {
    var actSpf = row.actual_spf || '';
    var actOU = row.actual_overunder || '';
    row.ai_hit = (row.ai_spf && actSpf && row.ai_spf === actSpf);
    row.pk_hit = (row.pk_direction && actSpf && row.pk_direction === actSpf);
    row.ai_ou_hit = (row.ai_overunder && actOU && row.ai_overunder === actOU);
    row.pk_ou_hit = (row.pk_goal_direction && actOU && row.pk_goal_direction === actOU);
    // GS hit: compare score formats
    if (row.gs_top_score && row.actual_score) {
      var gsScore = row.gs_top_score.replace(/-/g, ':');
      row.gs_hit = (gsScore === row.actual_score);
    } else {
      row.gs_hit = false;
    }
  });

  // 统计
  var stats = computeStats(list, type);

  // 分页
  var page = filters.page || 1;
  var pageSize = filters.pageSize || 20;
  var total = list.length;
  var start = (page - 1) * pageSize;
  var paged = list.slice(start, start + pageSize);

  return { items: paged, stats: stats, page: page, pageSize: pageSize, total: total };
}

function computeStats(list, type) {
  var stats = { total: list.length };
  
  var aiList = list.filter(function(r) { return r.ai_spf; });
  var pkList = list.filter(function(r) { return r.pk_direction; });
  var gsList = list.filter(function(r) { return r.gs_top_score; });

  stats.ai_total = aiList.length;
  stats.ai_accuracy = aiList.length > 0 ? parseFloat((aiList.filter(function(r) { return r.ai_hit; }).length / aiList.length).toFixed(2)) : 0;
  
  stats.pk_total = pkList.length;
  stats.pk_accuracy = pkList.length > 0 ? parseFloat((pkList.filter(function(r) { return r.pk_hit; }).length / pkList.length).toFixed(2)) : 0;
  
  stats.gs_total = gsList.length;
  stats.gs_score_hit_rate = gsList.length > 0 ? parseFloat((gsList.filter(function(r) { return r.gs_hit; }).length / gsList.length).toFixed(2)) : 0;

  // 按联赛统计
  var leagueMap = {};
  list.forEach(function(r) {
    var lg = r.leagueName || '未知';
    if (!leagueMap[lg]) leagueMap[lg] = { league: lg, total: 0, ai_hits: 0, pk_hits: 0, ai_total: 0, pk_total: 0 };
    leagueMap[lg].total++;
    if (r.ai_spf) { leagueMap[lg].ai_total++; if (r.ai_hit) leagueMap[lg].ai_hits++; }
    if (r.pk_direction) { leagueMap[lg].pk_total++; if (r.pk_hit) leagueMap[lg].pk_hits++; }
  });
  stats.byLeague = Object.values(leagueMap).map(function(l) {
    return {
      league: l.league, total: l.total,
      ai_acc: l.ai_total > 0 ? parseFloat((l.ai_hits / l.ai_total).toFixed(2)) : 0,
      pk_acc: l.pk_total > 0 ? parseFloat((l.pk_hits / l.pk_total).toFixed(2)) : 0
    };
  });

  return stats;
}

// 获取可用联赛列表
function getLeagues() {
  return _queryAll("SELECT DISTINCT leagueName FROM prediction_logs WHERE leagueName IS NOT NULL AND leagueName != '' ORDER BY leagueName")
    .map(function(r) { return r.leagueName; });
}

// 统计总数
function getTotalCount() {
  var r = _queryOne("SELECT COUNT(*) as cnt FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != ''");
  return r ? r.cnt : 0;
}

// 初始化
ensureDatabase().then(function(ready) {
  if (ready) { initTable(); console.log('[prediction_log] ready'); }
  else { console.log('[prediction_log] DB not available'); }
});

// 自动确保数据库就绪（同步检查+异步初始化）
function autoEnsure() {
  if (dbReady && database.isAvailable()) return;
  database.initDatabase();
  if (database.isAvailable()) { dbReady = true; return; }
  // 异步等待（sql.js）
  ensureDatabase();
}

module.exports = {
  ensureDatabase, initTable,
  upsert, upsertAI, upsertPK, upsertGS, backfillResult,
  queryBacktest, getLeagues, getTotalCount,
  getDB, autoEnsure,
  isReady: function() { return dbReady && database.isAvailable(); }
};
