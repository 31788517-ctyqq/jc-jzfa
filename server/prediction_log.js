/**
 * server/prediction_log.js
 * 预测回测数据层 — prediction_logs 表 CRUD
 *
 * V8.0 重构：使用 database.js 适配器 API（execOne/execAll/execRun/execDDL）
 *           所有写操作自动持久化到 midou_data.db，进程重启不丢数据
 */

const database = require('./database');
let dbReady = false;
let _ensureReady = null;

function ensureDatabase() {
  if (_ensureReady) return _ensureReady;
  _ensureReady = new Promise(function (resolve) {
    database.initDatabase();
    if (database.isAvailable()) {
      dbReady = true;
      resolve(true);
      return;
    }
    // sql.js 异步初始化等待
    const start = Date.now();
    function check() {
      if (database.isAvailable()) {
        dbReady = true;
        resolve(true);
        return;
      }
      if (Date.now() - start > 10000) {
        resolve(false);
        return;
      }
      setTimeout(check, 300).unref();
    }
    check();
  });
  return _ensureReady;
}

// ═══ 获取适配器 ═══
function _getAdp() {
  const adp = database.getAdapter();
  if (!adp) {
    // 降级：better-sqlite3 后端下 getAdapter() 返回包装对象
    // sql.js 后端下返回 _createSqlJsAdapter 创建的对象
    return null;
  }
  return adp;
}

// ═══ 便捷封装：接受数组参数，内部展开传给适配器 ═══
function _exec(sql, paramsArr) {
  if (!dbReady) return null;
  const adp = _getAdp();
  if (!adp) return null;
  try {
    return adp.execRun(sql, ...(paramsArr || []));
  } catch (e) {
    console.error('[prediction_log] exec error:', e.message);
    return null;
  }
}

function _queryOne(sql, paramsArr) {
  if (!dbReady) return null;
  const adp = _getAdp();
  if (!adp) return null;
  try {
    return adp.execOne(sql, ...(paramsArr || []));
  } catch (e) {
    console.error('[prediction_log] queryOne error:', e.message);
    return null;
  }
}

function _queryAll(sql, paramsArr) {
  if (!dbReady) return [];
  const adp = _getAdp();
  if (!adp) return [];
  try {
    return adp.execAll(sql, ...(paramsArr || []));
  } catch (e) {
    console.error('[prediction_log] queryAll error:', e.message);
    return [];
  }
}

function _getTableColumns(adp, tableName) {
  try {
    return new Set(
      (adp.execAll('PRAGMA table_info(' + tableName + ')') || []).map(function (row) {
        return row.name;
      }),
    );
  } catch (e) {
    return new Set();
  }
}

function _addColumnIfMissing(adp, columns, tableName, columnName, columnDef) {
  if (columns.has(columnName)) return;
  adp.execRun('ALTER TABLE ' + tableName + ' ADD COLUMN ' + columnName + ' ' + columnDef);
  columns.add(columnName);
}

// ═══ 建表 ═══
function initTable() {
  if (!dbReady) return;
  const adp = _getAdp();
  if (!adp) return;
  try {
    // 统一使用 execRun 执行 DDL（自动持久化）
    adp.execRun(
      'CREATE TABLE IF NOT EXISTS prediction_logs (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        'matchId TEXT NOT NULL,' +
        'date TEXT,' +
        'homeName TEXT,' +
        'visitName TEXT,' +
        'leagueName TEXT,' +
        'matchNum TEXT,' +
        'handicap INTEGER,' +
        'ai_spf TEXT,' +
        'ai_overunder TEXT,' +
        'ai_score TEXT,' +
        'ai_confidence REAL,' +
        'ai_content TEXT,' +
        'ai_version TEXT,' +
        'ai_hit INTEGER,' +
        'model_version TEXT,' +
        'feature_version TEXT,' +
        'pk_composite_score REAL,' +
        'pk_power_score REAL,' +
        'pk_goal_score REAL,' +
        'pk_heat_score REAL,' +
        'pk_stability_score REAL,' +
        'pk_direction TEXT,' +
        'pk_direction_stars INTEGER,' +
        'pk_direction_desc TEXT,' +
        'pk_hcp_direction TEXT,' +
        'pk_goal_direction TEXT,' +
        'pk_goal_stars INTEGER,' +
        'pk_fusion_consensus TEXT,' +
        'pk_batch_date TEXT,' +
        'gs_scores_json TEXT,' +
        'gs_top_score TEXT,' +
        'gs_top_percent REAL,' +
        'gs_ladder_label TEXT,' +
        'gs_ladder_level INTEGER,' +
        'actual_score TEXT,' +
        'actual_half_score TEXT,' +
        'actual_home_goals INTEGER,' +
        'actual_away_goals INTEGER,' +
        'actual_spf TEXT,' +
        'actual_overunder TEXT,' +
        'actual_corrected_at TEXT,' +
        "created_at TEXT DEFAULT (datetime('now','localtime'))," +
        "updated_at TEXT DEFAULT (datetime('now','localtime'))" +
        ')',
    );
    adp.execRun('CREATE INDEX IF NOT EXISTS idx_logs_matchId ON prediction_logs(matchId)');
    adp.execRun('CREATE INDEX IF NOT EXISTS idx_logs_date ON prediction_logs(date)');
    adp.execRun('CREATE INDEX IF NOT EXISTS idx_logs_league ON prediction_logs(leagueName)');

    console.log('[prediction_log] table initialized');

    const columns = _getTableColumns(adp, 'prediction_logs');
    [
      ['handicap', 'INTEGER'],
      ['ai_version', 'TEXT'],
      ['ai_hit', 'INTEGER'],
      ['model_version', 'TEXT'],
      ['feature_version', 'TEXT'],
      ['pk_health_score', 'REAL'],
      ['pk_ev_home', 'REAL'],
      ['pk_ev_draw', 'REAL'],
      ['pk_ev_away', 'REAL'],
      ['pk_value_tag', 'TEXT'],
      ['pk_value_score', 'REAL'],
      ['pk_heat_zscore', 'REAL'],
      ['pk_heat_z_overheat', 'INTEGER'],
      ['actual_half_score', 'TEXT'],
      ['gs_modelA_total', 'REAL'],
      ['gs_modelB_total', 'REAL'],
      ['gs_modelC_total', 'REAL'],
      ['pk_scorer_version', 'TEXT'],
      ['experiment_id', 'TEXT'],
      ['experiment_group', 'TEXT'],
    ].forEach(function (item) {
      _addColumnIfMissing(adp, columns, 'prediction_logs', item[0], item[1]);
    });
  } catch (e) {
    console.error('[prediction_log] init error:', e.message);
  }
}

// ═══ 写入预测日志（UPSERT by matchId） ═══
function upsert(fields) {
  if (!dbReady || !fields || !fields.matchId) return false;
  const existing = _queryOne('SELECT id FROM prediction_logs WHERE matchId = ?', [fields.matchId]);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (existing) {
    const sets = [];
    var vals = [];
    Object.keys(fields).forEach(function (k) {
      if (k === 'matchId' || k === 'id') return;
      sets.push(k + ' = ?');
      vals.push(fields[k]);
    });
    sets.push('updated_at = ?');
    vals.push(now);
    vals.push(fields.matchId);
    return _exec('UPDATE prediction_logs SET ' + sets.join(', ') + ' WHERE matchId = ?', vals);
  } else {
    fields.created_at = now;
    fields.updated_at = now;
    const cols = Object.keys(fields).join(', ');
    const placeholders = Object.keys(fields)
      .map(function () {
        return '?';
      })
      .join(', ');
    var vals = Object.values(fields);
    return _exec('INSERT INTO prediction_logs (' + cols + ') VALUES (' + placeholders + ')', vals);
  }
}

// AI 预测快捷写入
function upsertAI(matchId, fields) {
  const data = { matchId: matchId };
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
  if (fields.handicap !== undefined) data.handicap = fields.handicap;
  return upsert(data);
}

// PK 预测快捷写入
function upsertPK(matchId, fields) {
  const data = { matchId: matchId };
  if (fields.compositeScore !== undefined) data.pk_composite_score = fields.compositeScore;
  if (fields.powerScore !== undefined) data.pk_power_score = fields.powerScore;
  if (fields.goalScore !== undefined) data.pk_goal_score = fields.goalScore;
  if (fields.heatScore !== undefined) data.pk_heat_score = fields.heatScore;
  if (fields.stabilityScore !== undefined) data.pk_stability_score = fields.stabilityScore;
  if (fields.healthScore !== undefined) data.pk_health_score = fields.healthScore; // V2.0
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
  if (fields.handicap !== undefined) data.handicap = fields.handicap;
  // V2.0: EV 价值字段
  if (fields.evHome !== undefined && fields.evHome !== null) data.pk_ev_home = fields.evHome;
  if (fields.evDraw !== undefined && fields.evDraw !== null) data.pk_ev_draw = fields.evDraw;
  if (fields.evAway !== undefined && fields.evAway !== null) data.pk_ev_away = fields.evAway;
  if (fields.valueTag) data.pk_value_tag = fields.valueTag;
  if (fields.valueScore !== undefined) data.pk_value_score = fields.valueScore;
  if (fields.heatZScore !== undefined && fields.heatZScore !== null) data.pk_heat_zscore = fields.heatZScore;
  if (fields.heatZOverheat !== undefined) data.pk_heat_z_overheat = fields.heatZOverheat;
  // ★ 版本追踪字段
  if (fields.pkScorerVersion) data.pk_scorer_version = fields.pkScorerVersion;
  if (fields.experimentId) data.experiment_id = fields.experimentId;
  if (fields.experimentGroup) data.experiment_group = fields.experimentGroup;
  return upsert(data);
}

// 功守道预测快捷写入
function upsertGS(matchId, fields) {
  const data = { matchId: matchId };
  if (fields.scoresJson) data.gs_scores_json = fields.scoresJson;
  if (fields.topScore) data.gs_top_score = fields.topScore;
  if (fields.topPercent !== undefined) data.gs_top_percent = fields.topPercent;
  if (fields.ladderLabel) data.gs_ladder_label = fields.ladderLabel;
  if (fields.ladderLevel !== undefined) data.gs_ladder_level = fields.ladderLevel;
  // ★ V9.1: 模型预测总值（供 model-weights 真实代理指标）
  if (fields.modelATotal !== undefined && fields.modelATotal !== null) data.gs_modelA_total = fields.modelATotal;
  if (fields.modelBTotal !== undefined && fields.modelBTotal !== null) data.gs_modelB_total = fields.modelBTotal;
  if (fields.modelCTotal !== undefined && fields.modelCTotal !== null) data.gs_modelC_total = fields.modelCTotal;
  if (fields.date) data.date = fields.date;
  if (fields.homeName) data.homeName = fields.homeName;
  if (fields.visitName) data.visitName = fields.visitName;
  if (fields.leagueName) data.leagueName = fields.leagueName;
  if (fields.matchNum) data.matchNum = fields.matchNum;
  if (fields.handicap !== undefined) data.handicap = fields.handicap;
  return upsert(data);
}

function upsertGSBatch(records) {
  if (!Array.isArray(records) || records.length === 0) return 0;
  let count = 0;

  function runOne(record) {
    if (!record || !record.matchId) return;
    const ok = upsertGS(record.matchId, record.fields || {});
    if (ok !== false) count++;
  }

  const adp = _getAdp();
  if (dbReady && adp && typeof adp.transaction === 'function') {
    adp.transaction(function () {
      records.forEach(runOne);
    })();
    return count;
  }

  records.forEach(runOne);
  return count;
}

// 赛果回填
function backfillResult(matchId, fields) {
  const data = { matchId: matchId };
  if (fields.actualScore) data.actual_score = fields.actualScore;
  if (fields.actualHalfScore) data.actual_half_score = fields.actualHalfScore;
  if (fields.homeGoals !== undefined) data.actual_home_goals = fields.homeGoals;
  if (fields.awayGoals !== undefined) data.actual_away_goals = fields.awayGoals;
  if (fields.actualSpf) data.actual_spf = fields.actualSpf;
  if (fields.actualOverunder) data.actual_overunder = fields.actualOverunder;
  if (fields.handicap !== undefined) data.handicap = fields.handicap;
  data.actual_corrected_at = new Date().toISOString();
  return upsert(data);
}

// ★ 复合方向命中判断辅助函数（模块级 — queryBacktest 和 queryPKVersionCompare 共享）
// 支持 "平、让平" / "胜/平双选" / "总进球-2、3球" / "半全场-平负/平胜/平平" 等复合方向
// 支持无分隔符双选 "胜平" / "平负"：任一命中即算赢
function _checkDirectionHit(direction, actSpf, row) {
  if (!direction) return false;

  // 提前解析比分数据（供后续所有分支使用）
  var hg = row.actual_home_goals;
  var ag = row.actual_away_goals;
  var totalGoals = hg != null && ag != null && !isNaN(hg) && !isNaN(ag) ? hg + ag : null;

  // ── 无分隔符双选 "胜平" / "平负" ──
  if (direction === '胜平' && actSpf) return actSpf === '主胜' || actSpf === '平';
  if (direction === '平负' && actSpf) return actSpf === '平' || actSpf === '客胜';

  // ── 半全场方向（"半全场-平负、平胜、平平"） ──
  var hfResult = _getHalfFullResult(row.actual_half_score, hg, ag);
  if (direction.indexOf('半全场-') === 0) {
    // 复合半全场（如 "半全场-平负、平胜、平平"）
    if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
      var hfParts = direction.split(/[、,]/);
      for (var hfi = 0; hfi < hfParts.length; hfi++) {
        var hfSub = hfParts[hfi].trim();
        if (_matchHalfFullPattern(hfSub, hfResult)) return true;
      }
      return false;
    }
    // 单一半全场（如 "半全场-平负"）
    return _matchHalfFullPattern(direction, hfResult);
  }

  // ── 复合方向（含 、 / , 分隔符） ──
  const hasSep = direction.indexOf('、') >= 0 || direction.indexOf('/') >= 0 || direction.indexOf(',') >= 0;
  const subParts = hasSep
    ? direction
        .split(/[、\/,]/)
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean)
    : [direction];
  for (var si = 0; si < subParts.length; si++) {
    var sub = subParts[si];
    if (!sub) continue;
    // ── SPF 方向 ──
    if (actSpf) {
      // 直接 SPF 匹配
      if (sub === actSpf) return true;
      // 胜→主胜 / 负→客胜 映射（兼容 PK 双选："胜/平双选"）
      if (sub === '胜' && actSpf === '主胜') return true;
      if (sub === '负' && actSpf === '客胜') return true;
      // 无分隔符双选："胜平" / "平负" 简化
      if (sub === '胜平') {
        if (actSpf === '主胜' || actSpf === '平') return true;
      }
      if (sub === '平负') {
        if (actSpf === '平' || actSpf === '客胜') return true;
      }
      // 让球方向（让平/让胜/让负）：用让球数计算有效比分
      if (sub === '让平' || sub === '让胜' || sub === '让负') {
        var hcp = row.handicap != null ? parseFloat(row.handicap) || 0 : 0;
        if (hg != null && ag != null && !isNaN(hg) && !isNaN(ag)) {
          var effective = hg + hcp;
          if (sub === '让平' && effective === ag) return true;
          if (sub === '让胜' && effective > ag) return true;
          if (sub === '让负' && effective < ag) return true;
        }
      }
    }
    // ── 总进球方向（"总进球-2" / "3球"） ──
    if (totalGoals != null) {
      var gm = sub.match(/^总进球-(\d+)/);
      if (gm) {
        if (totalGoals === parseInt(gm[1])) return true;
      }
      var sgm = sub.match(/^(\d+)球$/);
      if (sgm) {
        if (totalGoals === parseInt(sgm[1])) return true;
      }
    }
  }
  return false;
}

// ★ 辅: 解析半场比分得到半全场结果（主胜/平/客胜）
function _getHalfFullResult(halfScore, hg, ag) {
  var halfResult = null;
  if (halfScore && halfScore.trim()) {
    var hp = String(halfScore).replace(/[-:]/g, ':').split(':');
    var hh = parseInt(hp[0]),
      ha = parseInt(hp[1]);
    if (!isNaN(hh) && !isNaN(ha)) {
      halfResult = hh > ha ? '主胜' : hh < ha ? '客胜' : '平';
    }
  }
  var fullResult = null;
  if (hg != null && ag != null && !isNaN(hg) && !isNaN(ag)) {
    fullResult = hg > ag ? '主胜' : hg < ag ? '客胜' : '平';
  }
  return { half: halfResult, full: fullResult };
}

// ★ 辅: 匹配半全场模式（如 "半全场-平负" → 半场平+全场客胜）
function _matchHalfFullPattern(direction, hfResult) {
  var pm = direction.match(/^半全场-(.+)$/);
  if (!pm || !hfResult.half || !hfResult.full) return false;
  var pat = pm[1]; // 如 "平负"、"平平"、"平胜"
  if (pat.length < 2) return false;
  var halfChar = pat[0]; // 第一个字=半场
  var fullChar = pat[1]; // 第二个字=全场
  var halfOk =
    (halfChar === '胜' && hfResult.half === '主胜') ||
    (halfChar === '平' && hfResult.half === '平') ||
    (halfChar === '负' && hfResult.half === '客胜');
  var fullOk =
    (fullChar === '胜' && hfResult.full === '主胜') ||
    (fullChar === '平' && hfResult.full === '平') ||
    (fullChar === '负' && hfResult.full === '客胜');
  return halfOk && fullOk;
}

// ═══ 回测查询 ═══
function queryBacktest(filters) {
  filters = filters || {};
  const conditions = [];
  const params = [];

  // 只查询有实际赛果的比赛
  conditions.push("actual_score IS NOT NULL AND actual_score != ''");

  if (filters.dateRange && filters.dateRange !== 'all') {
    let days = parseInt(filters.dateRange) || 30;
    if (filters.dateRange === '7d') days = 7;
    else if (filters.dateRange === '30d') days = 30;
    else if (filters.dateRange === '60d') days = 60;
    else if (filters.dateRange === '90d') days = 90;
    const since = new Date();
    since.setDate(since.getDate() - days);
    conditions.push('date >= ?');
    params.push(since.toISOString().slice(0, 10));
  }

  if (filters.league && filters.league !== 'all') {
    conditions.push('leagueName = ?');
    params.push(filters.league);
  }

  if (filters.direction && filters.direction !== 'all') {
    if (filters.direction === 'home') {
      conditions.push("(ai_spf = '主胜' OR pk_direction = '主胜')");
    } else if (filters.direction === 'away') {
      conditions.push("(ai_spf = '客胜' OR pk_direction = '客胜')");
    } else if (filters.direction === 'draw') {
      conditions.push("(ai_spf = '平' OR pk_direction = '平')");
    }
  }

  const type = filters.type || 'all';
  if (filters.aiConf && filters.aiConf !== 'all') {
    if (filters.aiConf === 'high') {
      conditions.push('ai_confidence >= 80');
    } else if (filters.aiConf === 'mid') {
      conditions.push('ai_confidence >= 70 AND ai_confidence < 80');
    } else if (filters.aiConf === 'low') {
      conditions.push('ai_confidence < 70');
    }
  }
  if (filters.pkConf && filters.pkConf !== 'all') {
    if (filters.pkConf === 'high') {
      conditions.push('pk_composite_score >= 70');
    } else if (filters.pkConf === 'mid') {
      conditions.push('pk_composite_score >= 50 AND pk_composite_score < 70');
    } else if (filters.pkConf === 'low') {
      conditions.push('pk_composite_score < 50');
    }
  }
  if (filters.consensus && filters.consensus !== 'all') {
    conditions.push('pk_fusion_consensus = ?');
    params.push(filters.consensus);
  }
  if (filters.model && filters.model !== 'all') {
    conditions.push('matchNum IN (SELECT DISTINCT match_num FROM prediction_outcomes WHERE model_name = ?)');
    params.push(filters.model);
  }

  const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
  const list = _queryAll('SELECT * FROM prediction_logs' + where + ' ORDER BY date DESC, matchNum ASC', params);

  // 计算命中
  list.forEach(function (row) {
    const actSpf = row.actual_spf || '';
    const actOU = row.actual_overunder || '';
    row.ai_hit = _checkDirectionHit(row.ai_spf, actSpf, row);
    row.pk_hit = _checkDirectionHit(row.pk_direction, actSpf, row);
    row.ai_ou_hit = row.ai_overunder && actOU && row.ai_overunder === actOU;
    row.pk_ou_hit = row.pk_goal_direction && actOU && row.pk_goal_direction === actOU;
    // GS hit: compare score formats
    if (row.gs_top_score && row.actual_score) {
      const gsScore = row.gs_top_score.replace(/-/g, ':');
      row.gs_hit = gsScore === row.actual_score;
    } else {
      row.gs_hit = false;
    }
    // ★ V9: 新增命中字段
    // GS SPF方向命中 (ladder方向 vs actual)
    row.gs_spf_hit = false;
    if (row.gs_ladder_level !== undefined && row.gs_ladder_level !== null && actSpf) {
      if (row.gs_ladder_level > 0 && actSpf === '主胜') row.gs_spf_hit = true;
      else if (row.gs_ladder_level < 0 && actSpf === '客胜') row.gs_spf_hit = true;
      else if (row.gs_ladder_level === 0 && (actSpf === '平' || actSpf === '平局')) row.gs_spf_hit = true;
    }
    // AI 比分命中
    row.ai_score_hit = false;
    if (row.ai_score && row.actual_score) {
      const aiSc = row.ai_score.replace(/-/g, ':').replace(/\s/g, '');
      row.ai_score_hit = aiSc === row.actual_score;
    }
    // PK 让球方向命中
    row.pk_hcp_hit = false;
    if (row.pk_hcp_direction && actSpf && row.pk_hcp_direction === actSpf) {
      row.pk_hcp_hit = true;
    }
  });

  // 统计
  const stats = computeStats(list, type);

  // 分页
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const total = list.length;
  const start = (page - 1) * pageSize;
  const paged = list.slice(start, start + pageSize);

  return { items: paged, stats: stats, page: page, pageSize: pageSize, total: total };
}

function computeStats(list, type) {
  const stats = { total: list.length };

  // ═══ 辅助：命中率计算 ═══
  function hitRate(total, hits) {
    return total > 0 ? parseFloat((hits / total).toFixed(4)) : 0;
  }
  function pct(total, hits) {
    return total > 0 ? parseFloat((hits / total).toFixed(2)) : 0;
  }

  const aiList = list.filter(function (r) {
    return r.ai_spf;
  });
  const pkList = list.filter(function (r) {
    return r.pk_direction;
  });
  const gsList = list.filter(function (r) {
    return r.gs_top_score;
  });

  // ── GS 功守道统计 ──
  stats.gs = {
    total: gsList.length,
    score_hit_rate: pct(
      gsList.length,
      gsList.filter(function (r) {
        return r.gs_hit;
      }).length,
    ),
    spf_hit_rate: pct(
      gsList.length,
      gsList.filter(function (r) {
        return r.gs_spf_hit;
      }).length,
    ),
    // 共识分级
    byConsensus: (function () {
      var map = { strong: { t: 0, h: 0 }, weak: { t: 0, h: 0 }, meltdown: { t: 0, h: 0 } };
      gsList.forEach(function (r) {
        var c = (r.pk_fusion_consensus || r.fusionConsensus || '').toLowerCase();
        if (c === 'strong' || c === '强一致') c = 'strong';
        else if (c === 'weak' || c === '弱一致') c = 'weak';
        else if (c === 'meltdown' || c === '熔断') c = 'meltdown';
        else c = null;
        if (c && map[c]) {
          map[c].t++;
          if (r.gs_hit) map[c].h++;
        }
      });
      return {
        strong: { total: map.strong.t, hit: map.strong.h, rate: pct(map.strong.t, map.strong.h) },
        weak: { total: map.weak.t, hit: map.weak.h, rate: pct(map.weak.t, map.weak.h) },
        meltdown: { total: map.meltdown.t, hit: map.meltdown.h, rate: pct(map.meltdown.t, map.meltdown.h) },
      };
    })(),
    // 概率校准曲线数据（预测概率 vs 实际命中率）
    calibration: buildCalibration(
      gsList,
      function (r) {
        return r.gs_top_percent || 0;
      },
      function (r) {
        return r.gs_hit;
      },
    ),
    // 按联赛分组
    byLeague: groupByLeague(gsList, 'gs_hit', 'gs_score'),
  };

  // ── AI 深度分析统计 ──
  stats.ai = {
    total: aiList.length,
    spf_accuracy: pct(
      aiList.length,
      aiList.filter(function (r) {
        return r.ai_hit;
      }).length,
    ),
    ou_accuracy: (function () {
      var ouList = aiList.filter(function (r) {
        return r.ai_overunder;
      });
      return pct(
        ouList.length,
        ouList.filter(function (r) {
          return r.ai_ou_hit;
        }).length,
      );
    })(),
    ou_total: aiList.filter(function (r) {
      return r.ai_overunder;
    }).length,
    score_accuracy: (function () {
      var scList = aiList.filter(function (r) {
        return r.ai_score;
      });
      return pct(
        scList.length,
        scList.filter(function (r) {
          return r.ai_score_hit;
        }).length,
      );
    })(),
    score_total: aiList.filter(function (r) {
      return r.ai_score;
    }).length,
    // 置信度分级
    byConfidence: (function () {
      var buckets = [
        { label: '90-100', min: 90, max: 101, t: 0, h: 0 },
        { label: '80-89', min: 80, max: 90, t: 0, h: 0 },
        { label: '70-79', min: 70, max: 80, t: 0, h: 0 },
        { label: '60-69', min: 60, max: 70, t: 0, h: 0 },
        { label: '0-59', min: 0, max: 60, t: 0, h: 0 },
      ];
      aiList.forEach(function (r) {
        var conf = parseFloat(r.ai_confidence) || 0;
        for (var i = 0; i < buckets.length; i++) {
          if (conf >= buckets[i].min && conf < buckets[i].max) {
            buckets[i].t++;
            if (r.ai_hit) buckets[i].h++;
            break;
          }
        }
      });
      return buckets.map(function (b) {
        return { label: b.label, total: b.t, hit: b.h, rate: pct(b.t, b.h) };
      });
    })(),
    // 置信度校准曲线
    calibration: buildCalibration(
      aiList,
      function (r) {
        return parseFloat(r.ai_confidence) || 0;
      },
      function (r) {
        return r.ai_hit;
      },
    ),
    // 按联赛分组
    byLeague: groupByLeague(aiList, 'ai_hit', 'ai_spf'),
  };

  // ── PK 融合分析统计 ──
  stats.pk = {
    total: pkList.length,
    direction_accuracy: pct(
      pkList.length,
      pkList.filter(function (r) {
        return r.pk_hit;
      }).length,
    ),
    hcp_accuracy: (function () {
      var hcpList = pkList.filter(function (r) {
        return r.pk_hcp_direction;
      });
      return pct(
        hcpList.length,
        hcpList.filter(function (r) {
          return r.pk_hcp_hit;
        }).length,
      );
    })(),
    hcp_total: pkList.filter(function (r) {
      return r.pk_hcp_direction;
    }).length,
    goal_accuracy: (function () {
      var gList = pkList.filter(function (r) {
        return r.pk_goal_direction;
      });
      return pct(
        gList.length,
        gList.filter(function (r) {
          return r.pk_ou_hit;
        }).length,
      );
    })(),
    goal_total: pkList.filter(function (r) {
      return r.pk_goal_direction;
    }).length,
    // 星级校准
    byStars: (function () {
      var stars = {};
      pkList.forEach(function (r) {
        var s = r.pk_direction_stars;
        if (s === undefined || s === null || s === 0) return;
        if (!stars[s]) stars[s] = { t: 0, h: 0 };
        stars[s].t++;
        if (r.pk_hit) stars[s].h++;
      });
      var result = [];
      for (var i = 5; i >= 1; i--) {
        var d = stars[i] || { t: 0, h: 0 };
        result.push({ stars: i, total: d.t, hit: d.h, rate: pct(d.t, d.h) });
      }
      return result;
    })(),
    // EV价值标签分组
    byValueTag: (function () {
      var map = {};
      pkList.forEach(function (r) {
        var tag = r.pk_value_tag || '未知';
        if (!map[tag]) map[tag] = { t: 0, h: 0 };
        map[tag].t++;
        if (r.pk_hit) map[tag].h++;
      });
      var result = [];
      Object.keys(map).forEach(function (k) {
        result.push({ tag: k, total: map[k].t, hit: map[k].h, rate: pct(map[k].t, map[k].h) });
      });
      return result;
    })(),
    // 综合信心分校准曲线
    calibration: buildCalibration(
      pkList,
      function (r) {
        return parseFloat(r.pk_composite_score) || 0;
      },
      function (r) {
        return r.pk_hit;
      },
    ),
    // 按联赛分组
    byLeague: groupByLeague(pkList, 'pk_hit', 'pk_dir'),
  };

  // ── 全局按联赛统计（用于筛选器） ──
  const leagueMap = {};
  list.forEach(function (r) {
    const lg = r.leagueName || '未知';
    if (!leagueMap[lg])
      leagueMap[lg] = {
        league: lg,
        total: 0,
        ai_hits: 0,
        pk_hits: 0,
        gs_hits: 0,
        ai_total: 0,
        pk_total: 0,
        gs_total: 0,
      };
    leagueMap[lg].total++;
    if (r.ai_spf) {
      leagueMap[lg].ai_total++;
      if (r.ai_hit) leagueMap[lg].ai_hits++;
    }
    if (r.pk_direction) {
      leagueMap[lg].pk_total++;
      if (r.pk_hit) leagueMap[lg].pk_hits++;
    }
    if (r.gs_top_score) {
      leagueMap[lg].gs_total++;
      if (r.gs_hit) leagueMap[lg].gs_hits++;
    }
  });
  stats.byLeague = Object.values(leagueMap).map(function (l) {
    return {
      league: l.league,
      total: l.total,
      ai_acc: l.ai_total > 0 ? pct(l.ai_total, l.ai_hits) : 0,
      pk_acc: l.pk_total > 0 ? pct(l.pk_total, l.pk_hits) : 0,
      gs_acc: l.gs_total > 0 ? pct(l.gs_total, l.gs_hits) : 0,
    };
  });

  return stats;
}

// ═══ 校准曲线构建（预测概率 vs 实际命中率） ═══
// scoreFn: 取预测概率(0-1)或信心分(0-100), hitFn: 取是否命中(bool)
function buildCalibration(list, scoreFn, hitFn) {
  if (!list || list.length === 0) return [];
  // 自动判断是 0-1 概率还是 0-100 信心分
  var maxScore = 0;
  list.forEach(function (r) {
    var s = scoreFn(r);
    if (s > maxScore) maxScore = s;
  });
  var isProb = maxScore <= 1 && maxScore > 0; // 概率(0-1)
  var isPct = maxScore > 1; // 信心分(0-100)

  var buckets = [];
  if (isProb) {
    // 0-1 概率分 5 档
    var cuts = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 1.01];
    for (var i = 0; i < cuts.length - 1; i++) {
      buckets.push({
        min: cuts[i],
        max: cuts[i + 1],
        label: Math.round(cuts[i] * 100) + '-' + Math.round((cuts[i + 1] - 0.01) * 100) + '%',
        t: 0,
        h: 0,
      });
    }
  } else if (isPct) {
    // 0-100 信心分分 6 档
    var cuts2 = [0, 20, 35, 50, 65, 80, 101];
    for (var i = 0; i < cuts2.length - 1; i++) {
      var lmax = cuts2[i + 1] - 1;
      buckets.push({ min: cuts2[i], max: cuts2[i + 1], label: cuts2[i] + '-' + lmax, t: 0, h: 0 });
    }
  } else {
    return [];
  }

  list.forEach(function (r) {
    var s = scoreFn(r);
    if (s === undefined || s === null || isNaN(s)) return;
    for (var i = 0; i < buckets.length; i++) {
      if (s >= buckets[i].min && s < buckets[i].max) {
        buckets[i].t++;
        if (hitFn(r)) buckets[i].h++;
        break;
      }
    }
  });

  return buckets
    .filter(function (b) {
      return b.t >= 3;
    }) // 至少3个样本
    .map(function (b) {
      var midpoint = (b.min + b.max) / 2;
      // 归一化为 0-1 概率（兼容百分比输入）
      var prob = isPct ? midpoint / 100 : midpoint;
      return {
        label: b.label,
        total: b.t,
        predictProb: parseFloat(prob.toFixed(4)),
        actualRate: b.t > 0 ? parseFloat((b.h / b.t).toFixed(4)) : 0,
        hit: b.h,
      };
    });
}

// ═══ 按联赛分组统计 ═══
function groupByLeague(subList, hitField, typeField) {
  var map = {};
  subList.forEach(function (r) {
    var lg = r.leagueName || '未知';
    if (!map[lg]) map[lg] = { league: lg, total: 0, hits: 0 };
    map[lg].total++;
    if (r[hitField]) map[lg].hits++;
  });
  return Object.values(map)
    .filter(function (l) {
      return l.total >= 2;
    })
    .sort(function (a, b) {
      return b.total - a.total;
    })
    .map(function (l) {
      return {
        league: l.league,
        total: l.total,
        accuracy: l.total > 0 ? parseFloat((l.hits / l.total).toFixed(2)) : 0,
      };
    });
}

// 获取可用联赛列表
function getLeagues() {
  return _queryAll(
    "SELECT DISTINCT leagueName FROM prediction_logs WHERE leagueName IS NOT NULL AND leagueName != '' ORDER BY leagueName",
  ).map(function (r) {
    return r.leagueName;
  });
}

// 统计总数
function getTotalCount() {
  const r = _queryOne(
    "SELECT COUNT(*) as cnt FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != ''",
  );
  return r ? r.cnt : 0;
}

// 获取可用模型列表（from prediction_outcomes）
function getModels() {
  return _queryAll(
    "SELECT DISTINCT model_name FROM prediction_outcomes WHERE model_name NOT IN ('data_fusion','market_signal') ORDER BY model_name",
  ).map(function (r) {
    return r.model_name;
  });
}

// ═══ PK 版本对比查询 ═══
function queryPKVersionCompare(filters) {
  filters = filters || {};
  const versions = Array.isArray(filters.versions) && filters.versions.length > 0 ? filters.versions : [];
  if (versions.length === 0) {
    // 自动发现所有有数据的版本
    const avail = _queryAll(
      "SELECT DISTINCT pk_scorer_version FROM prediction_logs WHERE pk_scorer_version IS NOT NULL AND pk_scorer_version != '' ORDER BY pk_scorer_version",
    );
    return { versions: (avail || []).map(function (r) { return r.pk_scorer_version; }), stats: {} };
  }

  const results = [];
  const statsByVersion = {};

  versions.forEach(function (ver) {
    const conditions = [
      "actual_score IS NOT NULL AND actual_score != ''",
      'pk_scorer_version = ?',
    ];
    const params = [ver];

    if (filters.dateRange && filters.dateRange !== 'all') {
      const days = filters.dateRange === '7d' ? 7 : filters.dateRange === '30d' ? 30 : filters.dateRange === '60d' ? 60 : filters.dateRange === '90d' ? 90 : parseInt(filters.dateRange) || 30;
      const since = new Date();
      since.setDate(since.getDate() - days);
      conditions.push('date >= ?');
      params.push(since.toISOString().slice(0, 10));
    }
    if (filters.league && filters.league !== 'all') {
      conditions.push('leagueName = ?');
      params.push(filters.league);
    }

    const where = ' WHERE ' + conditions.join(' AND ');
    const list = _queryAll('SELECT * FROM prediction_logs' + where, params) || [];

    const total = list.length;
    const hits = list.filter(function (r) { return _checkDirectionHit(r.pk_direction, r.actual_spf || '', r); }).length;
    const goalTotal = list.filter(function (r) { return r.pk_goal_direction; }).length;
    const goalHits = list.filter(function (r) { return r.pk_goal_direction && r.actual_overunder && r.pk_goal_direction === r.actual_overunder; }).length;
    const avgScore = total > 0 ? parseFloat((list.reduce(function (s, r) { return s + (parseFloat(r.pk_composite_score) || 0); }, 0) / total).toFixed(1)) : 0;

    // 按联赛细分
    const leagueMap = {};
    list.forEach(function (r) {
      const lg = r.leagueName || '未知';
      if (!leagueMap[lg]) leagueMap[lg] = { total: 0, hits: 0 };
      leagueMap[lg].total++;
      if (_checkDirectionHit(r.pk_direction, r.actual_spf || '', r)) leagueMap[lg].hits++;
    });
    const byLeague = Object.keys(leagueMap).map(function (lg) {
      return {
        league: lg,
        total: leagueMap[lg].total,
        accuracy: leagueMap[lg].total > 0 ? parseFloat((leagueMap[lg].hits / leagueMap[lg].total).toFixed(4)) : 0,
      };
    }).sort(function (a, b) { return b.total - a.total; });

    // 按星级细分
    const starsMap = {};
    list.forEach(function (r) {
      const s = r.pk_direction_stars;
      if (s === undefined || s === null || s === 0) return;
      if (!starsMap[s]) starsMap[s] = { total: 0, hits: 0 };
      starsMap[s].total++;
      if (_checkDirectionHit(r.pk_direction, r.actual_spf || '', r)) starsMap[s].hits++;
    });
    const byStars = Object.keys(starsMap).sort(function (a, b) { return parseInt(b) - parseInt(a); }).map(function (s) {
      return {
        stars: parseInt(s),
        total: starsMap[s].total,
        accuracy: starsMap[s].total > 0 ? parseFloat((starsMap[s].hits / starsMap[s].total).toFixed(4)) : 0,
      };
    });

    statsByVersion[ver] = {
      total: total,
      hits: hits,
      hitRate: total > 0 ? parseFloat((hits / total).toFixed(4)) : 0,
      goalTotal: goalTotal,
      goalHits: goalHits,
      goalHitRate: goalTotal > 0 ? parseFloat((goalHits / goalTotal).toFixed(4)) : 0,
      avgCompositeScore: avgScore,
      byLeague: byLeague,
      byStars: byStars,
      samples: list.slice(0, 100).map(function (r) {
        return {
          matchId: r.matchId,
          date: r.date,
          homeName: r.homeName,
          visitName: r.visitName,
          leagueName: r.leagueName,
          direction: r.pk_direction,
          stars: r.pk_direction_stars,
          score: r.pk_composite_score,
          actual: r.actual_spf,
          hit: _checkDirectionHit(r.pk_direction, r.actual_spf || '', r),
        };
      }),
    };
  });

  // 汇总对比
  const comparison = [];
  Object.keys(statsByVersion).forEach(function (ver) {
    comparison.push({ version: ver, stats: statsByVersion[ver] });
  });

  // 版本间差异分析
  var diffData = null;
  if (comparison.length >= 2) {
    diffData = {};
    for (var ci = 1; ci < comparison.length; ci++) {
      var prev = comparison[ci - 1].stats;
      var curr = comparison[ci].stats;
      diffData[comparison[ci].version + '_vs_' + comparison[ci - 1].version] = {
        hitRateDiff: parseFloat(((curr.hitRate - prev.hitRate) * 100).toFixed(2)) + '%',
        goalHitRateDiff: parseFloat(((curr.goalHitRate - prev.goalHitRate) * 100).toFixed(2)) + '%',
        sampleCountDiff: curr.total - prev.total,
        avgScoreDiff: parseFloat((curr.avgCompositeScore - prev.avgCompositeScore).toFixed(1)),
        direction: curr.hitRate > prev.hitRate ? (curr.total >= 30 ? '✅ 优化有效' : '⚠️ 样本不足') : (curr.total >= 30 ? '❌ 需要回滚' : '⚠️ 样本不足'),
      };
    }
  }

  return { versions: versions, stats: statsByVersion, comparison: comparison, diff: diffData };
}
ensureDatabase().then(function (ready) {
  if (ready) {
    initTable();
    console.log('[prediction_log] ready');
  } else {
    console.log('[prediction_log] DB not available');
  }
});

// 自动确保数据库就绪 — 返回 Promise，在 async handler 中 await
// 同步调用（不等待完成，仅触发初始化，用于不需要立即读写的场景）
function autoEnsure() {
  if (dbReady && database.isAvailable()) return;
  database.initDatabase();
  if (database.isAvailable()) {
    dbReady = true;
    return;
  }
  // 异步等待（sql.js）
  return ensureDatabase();
}

// 异步确保数据库就绪并建表 — 用于需要立即读写的 async handler
async function asyncEnsure() {
  if (dbReady && database.isAvailable()) return true;
  database.initDatabase();
  if (database.isAvailable()) {
    dbReady = true;
    initTable();
    return true;
  }
  // sql.js: 等待异步 WASM 初始化完成（最多10秒）
  try {
    const ready = await ensureDatabase();
    if (ready) {
      initTable();
    }
    return ready;
  } catch (e) {
    console.error('[prediction_log] asyncEnsure failed:', e.message);
    return false;
  }
}

module.exports = {
  ensureDatabase,
  asyncEnsure,
  initTable,
  upsert,
  upsertAI,
  upsertPK,
  upsertGS,
  upsertGSBatch,
  backfillResult,
  queryBacktest,
  queryPKVersionCompare,
  getLeagues,
  getModels,
  getTotalCount,
  autoEnsure,
  isReady: function () {
    return dbReady && database.isAvailable() && _getAdp() !== null;
  },
};
