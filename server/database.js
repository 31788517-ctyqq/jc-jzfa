/**
 * server/database.js
 * SQLite 数据库模块 — 主数据存储层
 *
 * 后端优先级: better-sqlite3（本地开发） → sql.js（生产 CentOS 6） → JSON 降级
 *
 * 表结构:
 *   matches       — 比赛信息（matchId 主键）
 *   recommends    — 推荐数据（matchId + type + fetchDate 唯一）
 *   crawl_logs    — 爬取日志
 *   ai_predictions — AI 预测缓存
 */

const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'midou_data.db');

let db = null;
let dbAvailable = false;
let _adapterReady = false; // sql.js 异步初始化完成标志

// ═══════════════════════════════════════════════════════
// 蓝图新增 7 张表 DDL（两套后端共用）
// ═══════════════════════════════════════════════════════
const NEW_TABLES_DDL = `
  -- 赔率历史 V2（替代 odds_history/*.json 150+ 文件）
  CREATE TABLE IF NOT EXISTS odds_history_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_num TEXT NOT NULL,
    date TEXT NOT NULL,
    fetch_date TEXT NOT NULL,
    fetch_time TEXT NOT NULL,
    play_type TEXT NOT NULL,
    odds_json TEXT NOT NULL,
    home_name TEXT,
    visit_name TEXT,
    handicap REAL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_num, date, fetch_date, fetch_time, play_type)
  );
  CREATE INDEX IF NOT EXISTS idx_odds_match ON odds_history_v2(match_num, date, fetch_time);
  CREATE INDEX IF NOT EXISTS idx_odds_date ON odds_history_v2(date, play_type);

  -- 交锋历史
  CREATE TABLE IF NOT EXISTS h2h_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    home_team TEXT NOT NULL,
    away_team TEXT NOT NULL,
    match_date TEXT NOT NULL,
    league TEXT,
    home_score INTEGER,
    away_score INTEGER,
    half_home_score INTEGER,
    half_away_score INTEGER,
    spf_result TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(home_team, away_team, match_date)
  );
  CREATE INDEX IF NOT EXISTS idx_h2h_teams ON h2h_history(home_team, away_team);

  -- 联赛积分榜
  CREATE TABLE IF NOT EXISTS league_standings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    league_name TEXT NOT NULL,
    team_name TEXT NOT NULL,
    rank INTEGER,
    played INTEGER,
    won INTEGER,
    drawn INTEGER,
    lost INTEGER,
    goals_for INTEGER,
    goals_against INTEGER,
    goal_diff INTEGER,
    points INTEGER,
    home_played INTEGER,
    home_won INTEGER,
    home_drawn INTEGER,
    home_lost INTEGER,
    away_played INTEGER,
    away_won INTEGER,
    away_drawn INTEGER,
    away_lost INTEGER,
    fetch_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(league_name, team_name, fetch_date)
  );
  CREATE INDEX IF NOT EXISTS idx_standings_team ON league_standings(team_name, fetch_date);

  -- 数据血缘追踪
  CREATE TABLE IF NOT EXISTS data_lineage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_key TEXT NOT NULL,
    version INTEGER NOT NULL,
    source TEXT NOT NULL,
    fetch_batch_id TEXT,
    data_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_lineage_entity ON data_lineage(entity_type, entity_key, version DESC);

  -- 特征库
  CREATE TABLE IF NOT EXISTS feature_store (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_num TEXT NOT NULL,
    match_date TEXT NOT NULL,
    feature_version TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    feature_value REAL,
    feature_source TEXT,
    computed_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_num, match_date, feature_version, feature_name)
  );
  CREATE INDEX IF NOT EXISTS idx_feature_match ON feature_store(match_num, match_date, feature_version);

  -- 多模型统一预测记录
  CREATE TABLE IF NOT EXISTS unified_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_num TEXT NOT NULL,
    match_date TEXT NOT NULL,
    match_id TEXT,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    prediction_id TEXT NOT NULL,
    direction TEXT,
    direction_confidence REAL,
    goal_total REAL,
    goal_range TEXT,
    over_under TEXT,
    predicted_score TEXT,
    score_probability REAL,
    features_json TEXT,
    raw_output_json TEXT,
    consensus_tag TEXT,
    fetch_batch_id TEXT,
    computed_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_num, match_date, model_name, model_version, prediction_id)
  );
  CREATE INDEX IF NOT EXISTS idx_up_match ON unified_predictions(match_num, match_date, model_name, model_version);
  CREATE INDEX IF NOT EXISTS idx_up_date_model ON unified_predictions(match_date, model_name);

  -- JczqBasic 全字段缓存（V9.0 三源融合数据层）
  CREATE TABLE IF NOT EXISTS jczq_basic_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    match_num TEXT NOT NULL,
    home_team TEXT,
    guest_team TEXT,
    league_name TEXT,
    data_json TEXT NOT NULL,
    fetch_ts TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(date, match_num)
  );
  CREATE INDEX IF NOT EXISTS idx_jczq_basic_date ON jczq_basic_cache(date);
  CREATE INDEX IF NOT EXISTS idx_jczq_basic_match ON jczq_basic_cache(date, match_num);

  -- 预测结果回填
  CREATE TABLE IF NOT EXISTS prediction_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id TEXT NOT NULL,
    match_num TEXT NOT NULL,
    match_date TEXT NOT NULL,
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    actual_home_score INTEGER,
    actual_away_score INTEGER,
    actual_result TEXT,
    actual_total_goals INTEGER,
    direction_hit INTEGER DEFAULT 0,
    over_under_hit INTEGER DEFAULT 0,
    score_hit INTEGER DEFAULT 0,
    brier_score REAL,
    log_loss REAL,
    filled_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(prediction_id)
  );
  CREATE INDEX IF NOT EXISTS idx_outcome_model ON prediction_outcomes(model_name, model_version, match_date);

  -- 竞彩赛事前瞻（7大模块：特征分析/历史交锋/积分榜/近况/未来赛事/射手/伤停）
  CREATE TABLE IF NOT EXISTS sporttery_preview (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    match_num TEXT,
    date TEXT NOT NULL,
    home_team TEXT,
    away_team TEXT,
    league TEXT,
    feature_analysis TEXT,
    h2h_history TEXT,
    standings TEXT,
    recent_form TEXT,
    future_matches TEXT,
    scorers TEXT,
    injuries TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(match_id)
  );
  CREATE INDEX IF NOT EXISTS idx_sp_match_num ON sporttery_preview(match_num);

  -- 竞彩赔率时间序列快照（SPF/RQSPF/BF/JQS/BQC 变更历史含涨跌标记）
  CREATE TABLE IF NOT EXISTS sporttery_odds_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    match_num TEXT,
    date TEXT NOT NULL,
    home_team TEXT,
    away_team TEXT,
    league TEXT,
    play_type TEXT NOT NULL,
    snapshot_time TEXT NOT NULL,
    odds_json TEXT NOT NULL,
    trend TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_sos_match ON sporttery_odds_snapshot(match_id, date, play_type);
  CREATE INDEX IF NOT EXISTS idx_sos_match_num ON sporttery_odds_snapshot(match_num);
`;

const AUTH_TABLES_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    must_change_password INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    password_updated_at TEXT,
    failed_login_count INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_builtin INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'medium',
    description TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);
  CREATE INDEX IF NOT EXISTS idx_permissions_risk_level ON permissions(risk_level);

  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(role_id, permission_id)
  );

  CREATE TABLE IF NOT EXISTS user_roles (
    user_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, role_id)
  );

  CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token_hash TEXT UNIQUE NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    ip TEXT,
    user_agent TEXT,
    last_seen_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    event_type TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    detail_json TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
`;

// ═══════════════════════════════════════════════════════
// sql.js 适配器辅助函数
// ═══════════════════════════════════════════════════════

/**
 * 将参数标准化为数组（兼容 better-sqlite3 的多参数/数组/单参数调用）
 */
function _normalizeParams(args) {
  if (args.length === 0) return [];
  if (args.length === 1) {
    const p = args[0];
    if (Array.isArray(p)) return p;
    if (p === undefined || p === null) return [];
    return [p];
  }
  return Array.from(args);
}

/**
 * 创建 sql.js 适配器包装层
 * sql.js API: stmt.bind(params), stmt.step(), stmt.getAsObject(), stmt.free()
 *             db.run(sql, params), db.exec(sql)
 */
function _createSqlJsAdapter(sqlDb) {
  const DB_FILE = DB_PATH;

  // 尝试从文件加载已有数据库
  let dbInstance;
  if (fs.existsSync(DB_FILE)) {
    try {
      const fileBuffer = fs.readFileSync(DB_FILE);
      dbInstance = new sqlDb.Database(fileBuffer);
    } catch (e) {
      console.log('[db] 加载已有数据库失败: ' + e.message + '，创建新库');
      dbInstance = new sqlDb.Database();
    }
  } else {
    dbInstance = new sqlDb.Database();
  }

  // 自动保存到文件（事务中跳过）—— V3.0 原子写入防损坏
  // ★ P1-3 优化：防抖写入，同一事件循环周期内的多次写操作合并为单次 _saveToFile()
  let _inTransaction = false;
  let _dirty = false;
  let _saveTimer = null;
  function _saveToFile() {
    if (_inTransaction) return; // 事务中不保存，等 COMMIT
    try {
      const data = dbInstance.export();
      const buffer = Buffer.from(data);
      const tmpFile = DB_FILE + '.tmp';
      // ★ 写入前清理旧 .tmp，避免重叠写导致读回 0 字节
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}
      fs.writeFileSync(tmpFile, buffer);
      // 写入后校验完整性
      const written = fs.readFileSync(tmpFile);
      if (written.length !== buffer.length) {
        throw new Error('写入字节数不匹配(' + written.length + '≠' + buffer.length + ')');
      }
      // 原子替换
      fs.renameSync(tmpFile, DB_FILE);
    } catch (e) {
      console.error('[db] 保存数据库失败: ' + e.message);
      // 清理残留 .tmp 文件
      try {
        fs.unlinkSync(DB_FILE + '.tmp');
      } catch (_) {}
    }
  }

  // ★ P1-3 优化：防抖写入调度器
  // 同一事件循环周期内的多次 execRun/execDDL 合并为单次 _saveToFile()
  // setImmediate 在 Check 阶段执行，晚于 Poll（I/O）阶段，
  // 因此 HTTP 响应先于 DB 持久化发送，登录延迟从 18-52s 降至 100-300ms
  function _scheduleSave() {
    _dirty = true;
    if (!_saveTimer) {
      _saveTimer = setImmediate(function () {
        _saveTimer = null;
        if (_dirty) {
          _dirty = false;
          _saveToFile();
        }
      });
    }
  }

  // execOne: 查询单行
  function execOne(sql, ...args) {
    const params = _normalizeParams(args);
    let stmt;
    try {
      stmt = dbInstance.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      if (stmt.step()) {
        return stmt.getAsObject();
      }
      return undefined;
    } catch (e) {
      console.error('[db] execOne error:', e.message, sql.slice(0, 80));
      return undefined;
    } finally {
      if (stmt) stmt.free();
    }
  }

  // execAll: 查询多行
  function execAll(sql, ...args) {
    const params = _normalizeParams(args);
    let stmt;
    try {
      stmt = dbInstance.prepare(sql);
      if (params.length > 0) stmt.bind(params);
      const results = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      return results;
    } catch (e) {
      console.error('[db] execAll error:', e.message, sql.slice(0, 80));
      return [];
    } finally {
      if (stmt) stmt.free();
    }
  }

  // execRun: 执行 INSERT/UPDATE/DELETE
  function execRun(sql, ...args) {
    const params = _normalizeParams(args);
    try {
      dbInstance.run(sql, params);
      _scheduleSave(); // ★ P1-3: 防抖写入，延迟到响应用 setImmediate 合并保存
      return { changes: dbInstance.getRowsModified() };
    } catch (e) {
      console.error('[db] execRun error:', e.message, sql.slice(0, 80));
      return { changes: 0 };
    }
  }

  // execDDL: 执行建表等 DDL（多条语句用 exec）
  function execDDL(sql) {
    try {
      dbInstance.run(sql);
      _scheduleSave(); // ★ P1-3: 防抖写入
    } catch (e) {
      console.error('[db] execDDL error:', e.message);
    }
  }

  // 事务包装
  function transaction(fn) {
    return function (...args) {
      try {
        _inTransaction = true;
        dbInstance.run('BEGIN');
        fn(...args);
        dbInstance.run('COMMIT');
        _inTransaction = false;
        _saveToFile();
      } catch (e) {
        _inTransaction = false;
        // 忽略 rollback 错误（可能事务未成功开启）
        try {
          dbInstance.run('ROLLBACK');
        } catch (_) {}
        console.error('[db] transaction error:', e.message);
        throw e;
      }
    };
  }

  function close() {
    _saveToFile();
    dbInstance.close();
  }

  function flush() {
    if (_saveTimer) {
      clearImmediate(_saveTimer);
      _saveTimer = null;
    }
    _dirty = false;
    _saveToFile();
    return true;
  }

  // ★ V12: sql.js 跨 worker 共享 — 从磁盘重载数据库
  function reload() {
    if (!fs.existsSync(DB_FILE)) return false;
    try {
      var fileBuf = fs.readFileSync(DB_FILE);
      var newDb = new sqlDb.Database(fileBuf);
      dbInstance.close();
      dbInstance = newDb;
      _dirty = false;
      return true;
    } catch (e) {
      return false;
    }
  }

  return { execOne, execAll, execRun, execDDL, transaction, close, flush, reload, backend: 'sqljs', raw: dbInstance };
}

// ═══════════════════════════════════════════════════════
// Tier 1: better-sqlite3 (本地开发环境)
// ═══════════════════════════════════════════════════════
function _initBetterSqlite3() {
  const Database = require('better-sqlite3');

  function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL'); // ★ NORMAL→FULL，每次提交 fsync
    db.pragma('wal_autocheckpoint = 1000'); // ★ WAL 超 1000 页自动 checkpoint
    db.pragma('cache_size = -8000');
    db.pragma('busy_timeout = 3000');

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
      CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(matchStatus);

      CREATE TABLE IF NOT EXISTS recommends (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        matchId   TEXT,
        type      TEXT,
        num       INTEGER,
        result    REAL,
        fetchDate TEXT,
        UNIQUE(matchId, type, fetchDate)
      );
      CREATE INDEX IF NOT EXISTS idx_recs_match ON recommends(matchId);

      CREATE TABLE IF NOT EXISTS crawl_logs (
        date        TEXT PRIMARY KEY,
        matchCount  INTEGER,
        recommCount INTEGER,
        status      TEXT DEFAULT 'pending',
        message     TEXT,
        createdAt   TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_predictions (
        matchId      TEXT PRIMARY KEY,
        leagueName   TEXT,
        homeName     TEXT,
        visitName    TEXT,
        matchDate    TEXT,
        content      TEXT,
        confidence   REAL,
        rawPrompt    TEXT,
        rawResponse  TEXT,
        tokenUsage   TEXT,
        createdAt    TEXT,
        updatedAt    TEXT
      );
    `);
    // ★ 蓝图新增 7 张表
    db.exec(NEW_TABLES_DDL);
    // ★ 登录与权限系统表
    db.exec(AUTH_TABLES_DDL);
    dbAvailable = true;
    _adapterReady = true;
    console.log('[db] better-sqlite3 初始化成功: ' + DB_PATH);
    // ★ 启动完整性校验
    try {
      const check = db.prepare('PRAGMA integrity_check').get();
      if (check && check['integrity_check'] === 'ok') {
        console.log('[db] 完整性校验通过');
      } else {
        console.error('[db] ⚠️ 完整性校验失败: ' + JSON.stringify(check));
      }
    } catch (e) {
      console.error('[db] 完整性校验异常: ' + e.message);
    }
    return true;
  }

  function isAvailable() {
    return dbAvailable;
  }
  function getDatabase() {
    return db;
  }
  function closeDatabase() {
    if (db) db.close();
  }

  // ═══ 适配器（兼容 prediction_log.js 等模块的统一 API） ═══
  const _bs3Adp = {
    backend: 'better-sqlite3',
    execOne: function (sql, ...args) {
      const params = _normalizeParams(args);
      const stmt = db.prepare(sql);
      return stmt.get(...params);
    },
    execAll: function (sql, ...args) {
      const params = _normalizeParams(args);
      const stmt = db.prepare(sql);
      return stmt.all(...params);
    },
    execRun: function (sql, ...args) {
      const params = _normalizeParams(args);
      const stmt = db.prepare(sql);
      const info = stmt.run(...params);
      return { changes: info.changes };
    },
    execDDL: function (sql) {
      db.exec(sql);
    },
    flush: function () {
      // better-sqlite3 事务提交后已直接落盘（WAL），此处保持兼容接口
      return true;
    },
    raw: db,
  };

  function getAdapter() {
    return _bs3Adp;
  }

  // ═══ Matches ═══
  function upsertMatch(match) {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT matchId FROM matches WHERE matchId = ?').get(match.matchId);
    if (existing) {
      db.prepare(
        `UPDATE matches SET num=?,homeName=?,visitName=?,leagueName=?,startTime=?,
        matchStatus=?,score=?,halfScore=?,recommNum=?,date=?,fetchDate=?,updatedAt=?
        WHERE matchId=?`,
      ).run(
        match.num,
        match.homeName,
        match.visitName,
        match.leagueName,
        match.startTime,
        match.matchStatus,
        match.score || '',
        match.halfScore || '',
        match.recommNum || 0,
        match.date,
        now,
        now,
        match.matchId,
      );
    } else {
      db.prepare(
        `INSERT INTO matches (matchId,num,homeName,visitName,leagueName,startTime,
        matchStatus,score,recommNum,date,fetchDate,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        match.matchId,
        match.num,
        match.homeName,
        match.visitName,
        match.leagueName,
        match.startTime,
        match.matchStatus,
        match.score || '',
        match.recommNum || 0,
        match.date,
        now,
        now,
        now,
      );
    }
  }

  function batchUpsertMatches(matches) {
    const upsert = db.prepare(`INSERT OR REPLACE INTO matches
      (matchId,num,homeName,visitName,leagueName,startTime,matchStatus,score,recommNum,
       date,fetchDate,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const now = new Date().toISOString();
    const tx = db.transaction((items) => {
      for (const m of items) {
        upsert.run(
          m.matchId,
          m.num,
          m.homeName,
          m.visitName,
          m.leagueName,
          m.startTime,
          m.matchStatus,
          m.score || '',
          m.recommNum || 0,
          m.date,
          now,
          now,
        );
      }
    });
    tx(matches);
  }

  function getMatchesByDate(dateStr) {
    return db.prepare('SELECT * FROM matches WHERE date = ? ORDER BY CAST(num AS INTEGER) ASC').all(dateStr);
  }

  function getAllMatches() {
    return db.prepare('SELECT * FROM matches ORDER BY date DESC, CAST(num AS INTEGER) ASC').all();
  }

  function getAllLeagues() {
    return db
      .prepare('SELECT DISTINCT leagueName FROM matches ORDER BY leagueName')
      .all()
      .map((r) => r.leagueName);
  }

  // ═══ Recommends ═══
  function batchUpsertRecommends(items) {
    const upsert = db.prepare(`INSERT OR REPLACE INTO recommends (matchId,type,num,result,fetchDate)
      VALUES (?,?,?,?,?)`);
    const now = new Date().toISOString().slice(0, 10);
    const tx = db.transaction((list) => {
      for (const r of list) {
        upsert.run(r.matchId, r.type, r.num, r.result, r.fetchDate || now);
      }
    });
    tx(items);
  }

  function getRecommendsByMatchId(matchId) {
    return db.prepare('SELECT * FROM recommends WHERE matchId = ? ORDER BY fetchDate DESC').all(matchId);
  }

  function updateRecommendResult(matchId, type, fetchDate, result) {
    db.prepare('UPDATE recommends SET result = ? WHERE matchId = ? AND type = ? AND fetchDate = ?').run(
      result,
      matchId,
      type,
      fetchDate,
    );
  }

  function getStaleRecommendations(dateStr) {
    return db
      .prepare(
        `
      SELECT DISTINCT m.matchId FROM matches m
      LEFT JOIN recommends r ON m.matchId = r.matchId AND r.fetchDate >= ?
      WHERE m.date = ? AND m.matchStatus >= 2 AND r.id IS NULL
    `,
      )
      .all(dateStr, dateStr)
      .map((r) => r.matchId);
  }

  // ═══ Crawl Logs ═══
  function logCrawl(dateStr, matchCount, recommCount, status, message) {
    db.prepare(
      `INSERT OR REPLACE INTO crawl_logs (date,matchCount,recommCount,status,message,createdAt)
      VALUES (?,?,?,?,?,?)`,
    ).run(dateStr, matchCount, recommCount, status, message, new Date().toISOString());
  }

  function getCrawledDates() {
    return db
      .prepare('SELECT date FROM crawl_logs ORDER BY date DESC')
      .all()
      .map((r) => r.date);
  }

  // ═══ AI Predictions ═══
  function upsertAIPrediction(pred) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO ai_predictions
      (matchId,leagueName,homeName,visitName,matchDate,content,confidence,
       rawPrompt,rawResponse,tokenUsage,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      pred.matchId,
      pred.leagueName,
      pred.homeName,
      pred.visitName,
      pred.matchDate,
      pred.content,
      pred.confidence,
      pred.rawPrompt,
      pred.rawResponse,
      pred.tokenUsage,
      now,
      now,
    );
  }

  function getAIPrediction(matchId) {
    return db.prepare('SELECT * FROM ai_predictions WHERE matchId = ?').get(matchId) || null;
  }

  // ═══ Stats ═══
  function getHitRateStats(daysBack) {
    const since = new Date();
    since.setDate(since.getDate() - (daysBack || 30));
    const sinceStr = since.toISOString().slice(0, 10);
    return db
      .prepare(
        `
      SELECT r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY r.type
    `,
      )
      .all(sinceStr);
  }

  function getDailyTrend(daysBack) {
    const since = new Date();
    since.setDate(since.getDate() - (daysBack || 30));
    const sinceStr = since.toISOString().slice(0, 10);
    return db
      .prepare(
        `
      SELECT m.date, r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY m.date, r.type
      ORDER BY m.date ASC
    `,
      )
      .all(sinceStr);
  }

  function getFilterStats() {
    const matchCount = db.prepare('SELECT COUNT(*) as cnt FROM matches').get().cnt || 0;
    const leagueCount = db.prepare('SELECT COUNT(DISTINCT leagueName) as cnt FROM matches').get().cnt || 0;
    const directionCount = db.prepare('SELECT COUNT(DISTINCT type) as cnt FROM recommends').get().cnt || 0;
    return { matchCount, leagueCount, directionCount };
  }

  function getFilterRate(conditions) {
    return {
      hitCount: 0,
      totalCount: 0,
      hitRate: 0,
      conditionSummary: JSON.stringify(conditions || {}),
      detailList: [],
      dailyResults: [],
    };
  }

  // ═══ JczqBasic 全字段缓存（V9.0） ═══
  function upsertJczqBasic(dateStr, matchNum, dataObj) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT OR REPLACE INTO jczq_basic_cache (date, match_num, home_team, guest_team, league_name, data_json, fetch_ts)
      VALUES (?,?,?,?,?,?,?)`,
    ).run(
      dateStr,
      matchNum,
      dataObj.homeTeam || null,
      dataObj.guestTeam || null,
      dataObj.gameShortName || null,
      JSON.stringify(dataObj),
      now,
    );
  }

  function getJczqBasic(dateStr, matchNum) {
    const row = db
      .prepare('SELECT data_json FROM jczq_basic_cache WHERE date = ? AND match_num = ?')
      .get(dateStr, matchNum);
    if (!row) return null;
    try {
      return JSON.parse(row.data_json);
    } catch {
      return null;
    }
  }

  function getJczqBasicByDate(dateStr) {
    return db
      .prepare('SELECT match_num, data_json FROM jczq_basic_cache WHERE date = ? ORDER BY CAST(match_num AS INTEGER)')
      .all(dateStr)
      .map(function (r) {
        try {
          return { match_num: r.match_num, data: JSON.parse(r.data_json) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function getTodayUnfinishedMatches() {
    const today = new Date().toISOString().slice(0, 10);
    return db.prepare('SELECT * FROM matches WHERE date = ? AND matchStatus < 2').all(today);
  }

  function getTodayMatchSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const total = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date = ?').get(today).cnt || 0;
    const finished =
      db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date = ? AND matchStatus >= 2').get(today).cnt || 0;
    return {
      todayDate: today,
      totalMatches: total,
      finishedMatches: finished,
      unfinishedMatches: total - finished,
      canShowCards: finished > 0,
    };
  }

  return (module.exports = {
    initDatabase,
    getDatabase,
    getAdapter,
    closeDatabase,
    isAvailable,
    upsertMatch,
    batchUpsertMatches,
    getMatchesByDate,
    getAllMatches,
    getAllLeagues,
    batchUpsertRecommends,
    getRecommendsByMatchId,
    updateRecommendResult,
    getStaleRecommendations,
    logCrawl,
    getCrawledDates,
    getHitRateStats,
    getDailyTrend,
    getFilterStats,
    getFilterRate,
    upsertAIPrediction,
    getAIPrediction,
    upsertJczqBasic,
    getJczqBasic,
    getJczqBasicByDate,
    getTodayUnfinishedMatches,
    getTodayMatchSummary,
  });
}

// ═══════════════════════════════════════════════════════
// Tier 2: sql.js (生产环境 CentOS 6)
// ═══════════════════════════════════════════════════════
function _initSqlJs() {
  let adp = null; // 适配器引用，异步初始化完成后赋值

  // 异步初始化 sql.js
  const initSqlJs = require('sql.js');
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);

  initSqlJs({ wasmBinary })
    .then((SQL) => {
      adp = _createSqlJsAdapter(SQL);
      // 建表
      adp.execDDL(`
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
      CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(matchStatus);

      CREATE TABLE IF NOT EXISTS recommends (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        matchId   TEXT,
        type      TEXT,
        num       INTEGER,
        result    REAL,
        fetchDate TEXT,
        UNIQUE(matchId, type, fetchDate)
      );
      CREATE INDEX IF NOT EXISTS idx_recs_match ON recommends(matchId);

      CREATE TABLE IF NOT EXISTS crawl_logs (
        date        TEXT PRIMARY KEY,
        matchCount  INTEGER,
        recommCount INTEGER,
        status      TEXT DEFAULT 'pending',
        message     TEXT,
        createdAt   TEXT
      );

      CREATE TABLE IF NOT EXISTS ai_predictions (
        matchId      TEXT PRIMARY KEY,
        leagueName   TEXT,
        homeName     TEXT,
        visitName    TEXT,
        matchDate    TEXT,
        content      TEXT,
        confidence   REAL,
        rawPrompt    TEXT,
        rawResponse  TEXT,
        tokenUsage   TEXT,
        createdAt    TEXT,
        updatedAt    TEXT
      );
    `);
      // ★ 蓝图新增 7 张表
      adp.execDDL(NEW_TABLES_DDL);
      // ★ 登录与权限系统表
      adp.execDDL(AUTH_TABLES_DDL);
      dbAvailable = true;
      _adapterReady = true;
      console.log('[db] sql.js 初始化成功: ' + DB_PATH);
      // ★ 启动完整性校验
      try {
        const check = adp.execOne('PRAGMA integrity_check');
        if (check && check['integrity_check'] === 'ok') {
          console.log('[db] 完整性校验通过');
        } else {
          console.error('[db] ⚠️ 完整性校验失败: ' + JSON.stringify(check));
        }
      } catch (e) {
        console.error('[db] 完整性校验异常: ' + e.message);
      }
    })
    .catch((e) => {
      console.log('[db] sql.js 初始化失败: ' + e.message);
    });

  function initDatabase() {
    console.log('[db] sql.js 后端等待初始化...');
    return true;
  }

  function isAvailable() {
    return _adapterReady && dbAvailable;
  }
  function getDatabase() {
    return adp ? adp.raw : null;
  }
  function closeDatabase() {
    if (adp) adp.close();
  }

  // ═══ Matches (sql.js adapter) ═══
  function upsertMatch(match) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    const existing = adp.execOne('SELECT matchId FROM matches WHERE matchId = ?', match.matchId);
    if (existing) {
      adp.execRun(
        `UPDATE matches SET num=?,homeName=?,visitName=?,leagueName=?,startTime=?,
        matchStatus=?,score=?,halfScore=?,recommNum=?,date=?,fetchDate=?,updatedAt=?
        WHERE matchId=?`,
        match.num,
        match.homeName,
        match.visitName,
        match.leagueName,
        match.startTime,
        match.matchStatus,
        match.score || '',
        match.halfScore || '',
        match.recommNum || 0,
        match.date,
        now,
        now,
        match.matchId,
      );
    } else {
      adp.execRun(
        `INSERT INTO matches (matchId,num,homeName,visitName,leagueName,startTime,
        matchStatus,score,recommNum,date,fetchDate,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        match.matchId,
        match.num,
        match.homeName,
        match.visitName,
        match.leagueName,
        match.startTime,
        match.matchStatus,
        match.score || '',
        match.recommNum || 0,
        match.date,
        now,
        now,
        now,
      );
    }
  }

  function batchUpsertMatches(matches) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    const batch = adp.transaction((items) => {
      for (const m of items) {
        adp.execRun(
          `INSERT OR REPLACE INTO matches
          (matchId,num,homeName,visitName,leagueName,startTime,matchStatus,score,recommNum,
           date,fetchDate,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          m.matchId,
          m.num,
          m.homeName,
          m.visitName,
          m.leagueName,
          m.startTime,
          m.matchStatus,
          m.score || '',
          m.recommNum || 0,
          m.date,
          now,
          now,
        );
      }
    });
    batch(matches);
  }

  function getMatchesByDate(dateStr) {
    if (!_adapterReady) return [];
    return adp.execAll('SELECT * FROM matches WHERE date = ? ORDER BY CAST(num AS INTEGER) ASC', dateStr);
  }

  function getAllMatches() {
    if (!_adapterReady) return [];
    return adp.execAll('SELECT * FROM matches ORDER BY date DESC, CAST(num AS INTEGER) ASC');
  }

  function getAllLeagues() {
    if (!_adapterReady) return [];
    return adp.execAll('SELECT DISTINCT leagueName FROM matches ORDER BY leagueName').map((r) => r.leagueName);
  }

  // ═══ Recommends ═══
  function batchUpsertRecommends(items) {
    if (!_adapterReady) return;
    const now = new Date().toISOString().slice(0, 10);
    const batch = adp.transaction((list) => {
      for (const r of list) {
        adp.execRun(
          'INSERT OR REPLACE INTO recommends (matchId,type,num,result,fetchDate) VALUES (?,?,?,?,?)',
          r.matchId,
          r.type,
          r.num,
          r.result,
          r.fetchDate || now,
        );
      }
    });
    batch(items);
  }

  function getRecommendsByMatchId(matchId) {
    if (!_adapterReady) return [];
    return adp.execAll('SELECT * FROM recommends WHERE matchId = ? ORDER BY fetchDate DESC', matchId);
  }

  function updateRecommendResult(matchId, type, fetchDate, result) {
    if (!_adapterReady) return;
    adp.execRun(
      'UPDATE recommends SET result = ? WHERE matchId = ? AND type = ? AND fetchDate = ?',
      result,
      matchId,
      type,
      fetchDate,
    );
  }

  function getStaleRecommendations(dateStr) {
    if (!_adapterReady) return [];
    return adp
      .execAll(
        `
      SELECT DISTINCT m.matchId FROM matches m
      LEFT JOIN recommends r ON m.matchId = r.matchId AND r.fetchDate >= ?
      WHERE m.date = ? AND m.matchStatus >= 2 AND r.id IS NULL
    `,
        dateStr,
        dateStr,
      )
      .map((r) => r.matchId);
  }

  // ═══ Crawl Logs ═══
  function logCrawl(dateStr, matchCount, recommCount, status, message) {
    if (!_adapterReady) return;
    adp.execRun(
      `INSERT OR REPLACE INTO crawl_logs (date,matchCount,recommCount,status,message,createdAt)
      VALUES (?,?,?,?,?,?)`,
      dateStr,
      matchCount,
      recommCount,
      status,
      message,
      new Date().toISOString(),
    );
  }

  function getCrawledDates() {
    if (!_adapterReady) return [];
    return adp.execAll('SELECT date FROM crawl_logs ORDER BY date DESC').map((r) => r.date);
  }

  // ═══ AI Predictions ═══
  function upsertAIPrediction(pred) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    adp.execRun(
      `INSERT OR REPLACE INTO ai_predictions
      (matchId,leagueName,homeName,visitName,matchDate,content,confidence,
       rawPrompt,rawResponse,tokenUsage,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      pred.matchId,
      pred.leagueName,
      pred.homeName,
      pred.visitName,
      pred.matchDate,
      pred.content,
      pred.confidence,
      pred.rawPrompt,
      pred.rawResponse,
      pred.tokenUsage,
      now,
      now,
    );
  }

  function getAIPrediction(matchId) {
    if (!_adapterReady) return null;
    return adp.execOne('SELECT * FROM ai_predictions WHERE matchId = ?', matchId) || null;
  }

  // ═══ Stats ═══
  function getHitRateStats(daysBack) {
    if (!_adapterReady) return [];
    const since = new Date();
    since.setDate(since.getDate() - (daysBack || 30));
    const sinceStr = since.toISOString().slice(0, 10);
    return adp.execAll(
      `
      SELECT r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY r.type
    `,
      sinceStr,
    );
  }

  function getDailyTrend(daysBack) {
    if (!_adapterReady) return [];
    const since = new Date();
    since.setDate(since.getDate() - (daysBack || 30));
    const sinceStr = since.toISOString().slice(0, 10);
    return adp.execAll(
      `
      SELECT m.date, r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY m.date, r.type
      ORDER BY m.date ASC
    `,
      sinceStr,
    );
  }

  function getFilterStats() {
    if (!_adapterReady) return { matchCount: 0, leagueCount: 0, directionCount: 0 };
    const matchCount = (adp.execOne('SELECT COUNT(*) as cnt FROM matches') || {}).cnt || 0;
    const leagueCount = (adp.execOne('SELECT COUNT(DISTINCT leagueName) as cnt FROM matches') || {}).cnt || 0;
    const directionCount = (adp.execOne('SELECT COUNT(DISTINCT type) as cnt FROM recommends') || {}).cnt || 0;
    return { matchCount, leagueCount, directionCount };
  }

  function getFilterRate(conditions) {
    return {
      hitCount: 0,
      totalCount: 0,
      hitRate: 0,
      conditionSummary: JSON.stringify(conditions || {}),
      detailList: [],
      dailyResults: [],
    };
  }

  // ═══ JczqBasic 全字段缓存（V9.0） ═══
  function upsertJczqBasic(dateStr, matchNum, dataObj) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    adp.execRun(
      `INSERT OR REPLACE INTO jczq_basic_cache (date, match_num, home_team, guest_team, league_name, data_json, fetch_ts)
      VALUES (?,?,?,?,?,?,?)`,
      dateStr,
      matchNum,
      dataObj.homeTeam || null,
      dataObj.guestTeam || null,
      dataObj.gameShortName || null,
      JSON.stringify(dataObj),
      now,
    );
  }

  function getJczqBasic(dateStr, matchNum) {
    if (!_adapterReady) return null;
    const row = adp.execOne(
      'SELECT data_json FROM jczq_basic_cache WHERE date = ? AND match_num = ?',
      dateStr,
      matchNum,
    );
    if (!row) return null;
    try {
      return JSON.parse(row.data_json);
    } catch {
      return null;
    }
  }

  function getJczqBasicByDate(dateStr) {
    if (!_adapterReady) return [];
    return adp
      .execAll(
        'SELECT match_num, data_json FROM jczq_basic_cache WHERE date = ? ORDER BY CAST(match_num AS INTEGER)',
        dateStr,
      )
      .map(function (r) {
        try {
          return { match_num: r.match_num, data: JSON.parse(r.data_json) };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  function getTodayUnfinishedMatches() {
    if (!_adapterReady) return [];
    const today = new Date().toISOString().slice(0, 10);
    return adp.execAll('SELECT * FROM matches WHERE date = ? AND matchStatus < 2', today);
  }

  function getTodayMatchSummary() {
    if (!_adapterReady)
      return { todayDate: '', totalMatches: 0, finishedMatches: 0, unfinishedMatches: 0, canShowCards: false };
    const today = new Date().toISOString().slice(0, 10);
    const total = (adp.execOne('SELECT COUNT(*) as cnt FROM matches WHERE date = ?', today) || {}).cnt || 0;
    const finished =
      (adp.execOne('SELECT COUNT(*) as cnt FROM matches WHERE date = ? AND matchStatus >= 2', today) || {}).cnt || 0;
    return {
      todayDate: today,
      totalMatches: total,
      finishedMatches: finished,
      unfinishedMatches: total - finished,
      canShowCards: finished > 0,
    };
  }

  function getAdapter() {
    return adp;
  }

  module.exports = {
    initDatabase,
    getDatabase,
    getAdapter,
    closeDatabase,
    isAvailable,
    upsertMatch,
    batchUpsertMatches,
    getMatchesByDate,
    getAllMatches,
    getAllLeagues,
    batchUpsertRecommends,
    getRecommendsByMatchId,
    updateRecommendResult,
    getStaleRecommendations,
    logCrawl,
    getCrawledDates,
    getHitRateStats,
    getDailyTrend,
    getFilterStats,
    getFilterRate,
    upsertAIPrediction,
    getAIPrediction,
    upsertJczqBasic,
    getJczqBasic,
    getJczqBasicByDate,
    getTodayUnfinishedMatches,
    getTodayMatchSummary,
  };
}

// ═══════════════════════════════════════════════════════
// 选择后端
// ═══════════════════════════════════════════════════════

var _backendSelected = false;

// 尝试 Tier 1: better-sqlite3
if (!_backendSelected) {
  try {
    require.resolve('better-sqlite3');
    _initBetterSqlite3();
    _backendSelected = true;
  } catch (e) {
    // better-sqlite3 不可用
  }
}

// 尝试 Tier 2: sql.js (纯 JS，兼容 CentOS 6)
if (!_backendSelected) {
  try {
    require.resolve('sql.js');
    _initSqlJs();
    _backendSelected = true;
  } catch (e) {
    // sql.js 也不可用
  }
}

// ═══════════════════════════════════════════════════════
// Tier 3: JSON 降级模式
// ═══════════════════════════════════════════════════════
if (!_backendSelected) {
  function isAvailable() {
    return false;
  }
  function initDatabase() {
    console.log('[db] JSON 降级模式就绪');
    return true;
  }
  function getDatabase() {
    return null;
  }
  function closeDatabase() {}

  const emptyArr = () => [];
  const nullFn = () => null;
  const zeroObj = () => ({ matchCount: 0, leagueCount: 0, directionCount: 0 });

  module.exports = {
    initDatabase,
    getDatabase,
    getAdapter: function () {
      return null;
    },
    closeDatabase,
    isAvailable,
    upsertMatch: () => {},
    batchUpsertMatches: () => {},
    getMatchesByDate: emptyArr,
    getAllMatches: emptyArr,
    getAllLeagues: emptyArr,
    batchUpsertRecommends: () => {},
    getRecommendsByMatchId: emptyArr,
    updateRecommendResult: () => {},
    getStaleRecommendations: emptyArr,
    logCrawl: () => {},
    getCrawledDates: emptyArr,
    getHitRateStats: emptyArr,
    getDailyTrend: emptyArr,
    getFilterStats: zeroObj,
    getFilterRate: () => ({
      hitCount: 0,
      totalCount: 0,
      hitRate: 0,
      conditionSummary: '',
      detailList: [],
      dailyResults: [],
    }),
    upsertAIPrediction: () => {},
    getAIPrediction: nullFn,
    upsertJczqBasic: () => {},
    getJczqBasic: nullFn,
    getJczqBasicByDate: emptyArr,
    getTodayUnfinishedMatches: emptyArr,
    getTodayMatchSummary: () => ({
      todayDate: '',
      totalMatches: 0,
      finishedMatches: 0,
      unfinishedMatches: 0,
      canShowCards: false,
    }),
  };
} // end _backendSelected
