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
const AUTH_DB_PATH = path.join(__dirname, 'auth.db'); // ★ P0: 认证独立 DB（~10MB vs 300MB）
const ARCHIVE_DB_PATH = path.join(__dirname, 'sporttery_archive.db'); // ★ P1: sporttery 大表独立 DB（~350MB 冷数据）

let db = null;
let authDb = null; // ★ P0: 认证 DB 适配器
let dbAvailable = false;
let _adapterReady = false; // sql.js 异步初始化完成标志
let _dataDbLazy = false; // ★ P0: 数据 DB 懒加载标志（DATA_DB_LAZY=1 时为 true）
let _archiveDbInstance = null; // ★ P1: sporttery 归档 DB（懒加载）
let _archiveAdp = null;

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

`;

// ★ P1: sporttery 大表归档 DDL（从 NEW_TABLES_DDL 分离到独立 sporttery_archive.db）
const SPORTTERY_ARCHIVE_DDL = `
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

  CREATE TABLE IF NOT EXISTS user_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    plan_id TEXT,
    plan_data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_plans_device_id ON user_plans(device_id);
  CREATE INDEX IF NOT EXISTS idx_user_plans_plan_id ON user_plans(plan_id);
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
 * ★ P0: sql.js 查询辅助函数（从 _createSqlJsAdapter 内部提取，供 auth DB 复用）
 */
function _sqlJsExecOne(dbInst, sql, params) {
  let stmt;
  try {
    stmt = dbInst.prepare(sql);
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

function _sqlJsExecAll(dbInst, sql, params) {
  let stmt;
  try {
    stmt = dbInst.prepare(sql);
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
  let _saving = false; // ★ P1 异步写入锁，防止并发 export+write
  function _saveToFile() {
    if (_inTransaction) return; // 事务中不保存，等 COMMIT
    if (_saving) return; // ★ 正在异步写入中，跳过（下次 _scheduleSave 会重试）
    _saving = true;
    try {
      // export() 是 WASM 同步操作（~230ms），不阻塞事件循环的 I/O
      const data = dbInstance.export();
      const buffer = Buffer.from(data);
      const tmpFile = DB_FILE + '.tmp';
      // ★ 写入前清理旧 .tmp
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}
      // ★ P1 优化：writeFile + rename 异步化，消除 3.4s 同步 I/O 阻塞
      fs.writeFile(tmpFile, buffer, function (writeErr) {
        if (writeErr) {
          _saving = false;
          console.error('[db] 异步写入失败: ' + writeErr.message);
          if (_dbMetrics) _dbMetrics.recordError(writeErr.message);
          try {
            fs.unlinkSync(tmpFile);
          } catch (_) {}
          return;
        }
        // 异步 rename（~2.9s 同步操作改异步）
        fs.rename(tmpFile, DB_FILE, function (renameErr) {
          _saving = false;
          if (renameErr) {
            console.error('[db] 异步 rename 失败: ' + renameErr.message);
            if (_dbMetrics) _dbMetrics.recordError(renameErr.message);
            try {
              fs.unlinkSync(tmpFile);
            } catch (_) {}
            return;
          }
          if (_dbMetrics) _dbMetrics.recordWrite();
          // ★ 异步写入期间若有新写入，触发再次保存
          if (_dirty && !_inTransaction) {
            _dirty = false;
            _scheduleSave();
          }
        });
      });
    } catch (e) {
      _saving = false;
      console.error('[db] export 失败: ' + e.message);
      if (_dbMetrics) _dbMetrics.recordError(e.message);
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

  // ★ V17: DB 写入指标追踪
  let _dbMetrics = null;
  try {
    _dbMetrics = require('./core/db-metrics');
  } catch (_) {}

  // execRun: 执行 INSERT/UPDATE/DELETE
  function execRun(sql, ...args) {
    const params = _normalizeParams(args);
    try {
      dbInstance.run(sql, params);
      _scheduleSave(); // ★ P1-3: 防抖写入，延迟到响应用 setImmediate 合并保存
      if (_dbMetrics) _dbMetrics.recordWrite();
      return { changes: dbInstance.getRowsModified() };
    } catch (e) {
      console.error('[db] execRun error:', e.message, sql.slice(0, 80));
      if (_dbMetrics) _dbMetrics.recordError(e.message);
      return { changes: 0 };
    }
  }

  // execDDL: 执行建表等 DDL（多条语句用 exec）
  function execDDL(sql) {
    try {
      dbInstance.run(sql);
      _scheduleSave(); // ★ P1-3: 防抖写入
      if (_dbMetrics) _dbMetrics.recordWrite();
    } catch (e) {
      console.error('[db] execDDL error:', e.message);
      if (_dbMetrics) _dbMetrics.recordError(e.message);
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

  // ★ P1: 同步保存版本（仅用于 close/flush/进程退出等必须同步落盘的场景）
  function _saveToFileSync() {
    if (_inTransaction) return;
    try {
      const data = dbInstance.export();
      const buffer = Buffer.from(data);
      const tmpFile = DB_FILE + '.tmp';
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {}
      fs.writeFileSync(tmpFile, buffer);
      fs.renameSync(tmpFile, DB_FILE);
      if (_dbMetrics) _dbMetrics.recordWrite();
    } catch (e) {
      console.error('[db] 同步保存失败: ' + e.message);
      try {
        fs.unlinkSync(DB_FILE + '.tmp');
      } catch (_) {}
    }
  }

  function close() {
    _saveToFileSync();
    dbInstance.close();
  }

  function flush() {
    if (_saveTimer) {
      clearImmediate(_saveTimer);
      _saveTimer = null;
    }
    _dirty = false;
    _saveToFileSync(); // ★ flush 用同步版本（进程退出场景）
    return true;
  }

  // ★ V12: sql.js 跨 worker 共享 — 从磁盘重载数据库
  let _lastReloadMtime = 0;
  function reload() {
    if (!fs.existsSync(DB_FILE)) return false;
    // ★ B: 检查文件 mtime，未变化则跳过重载（避免无意义的 300MB 全量读取）
    try {
      const stat = fs.statSync(DB_FILE);
      if (stat.mtimeMs === _lastReloadMtime) return false; // 未变更，跳过
      _lastReloadMtime = stat.mtimeMs;
    } catch (e) {}
    try {
      const fileBuf = fs.readFileSync(DB_FILE);
      const newDb = new sqlDb.Database(fileBuf);
      dbInstance.close();
      dbInstance = newDb;
      _dirty = false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ★ A: 写入后通知 reload 追踪器（注册等场景，后续登录跳过无效 reload）
  function markDirty() {
    try {
      _lastReloadMtime = fs.statSync(DB_FILE).mtimeMs;
    } catch (e) {}
  }

  // ★ P1 优化：定期 flush 定时器（5分钟），替代 auth-service 的同步 flush
  // _scheduleSave 的 setImmediate 防抖已处理写入调度，
  // 但如果进程长时间不退出，需定期落盘防止内存数据丢失
  const _periodicFlushTimer = setInterval(
    function () {
      if (_dirty && !_inTransaction && !_saving) {
        _dirty = false;
        _saveToFile(); // 异步版本，不阻塞事件循环
        console.log('[db] 定期 flush 触发 (5min)');
      }
    },
    5 * 60 * 1000,
  );
  _periodicFlushTimer.unref(); // 不阻止进程退出

  // ★ P1 优化：进程退出时最终 flush（确保数据不丢失，用同步版本）
  process.on('beforeExit', function () {
    if (_dirty && !_inTransaction) {
      _dirty = false;
      _saveToFileSync();
      console.log('[db] 退出前同步 flush 完成');
    }
  });

  // ★ C: 增量查询 — 只在磁盘文件上执行 SELECT，不入内存 DB
  //   缓存窗口 5s：即使 jc-sync 持续写入，5s 内复用同一磁盘连接（<50ms/次）
  let _diskDB = null;
  let _diskDBMtime = 0;
  let _diskDBTime = 0;
  function execOneOnDisk(sql, params) {
    try {
      const stat = fs.statSync(DB_FILE);
      const mtime = stat.mtimeMs;
      const now = Date.now();
      // 30 秒缓存窗口：即使 jc-sync 持续写 DB 也复用（users 表极少变化）
      const cacheValid = _diskDB && now - _diskDBTime < 30000;
      if (!cacheValid) {
        if (_diskDB) _diskDB.close();
        const t0 = Date.now();
        const fileBuf = fs.readFileSync(DB_FILE);
        _diskDB = new sqlDb.Database(fileBuf);
        _diskDBMtime = mtime;
        _diskDBTime = now;
        console.log('[db] diskDB reloaded in ' + (Date.now() - t0) + 'ms');
      }
      const stmt = _diskDB.prepare(sql);
      if (stmt) {
        stmt.bind(params || []);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          for (let i = 0; i < cols.length; i++) row[cols[i]] = vals[i];
          return row;
        }
        stmt.free();
      }
    } catch (e) {
      /* fallback to null */
    }
    return null;
  }

  // 将磁盘 DB 查到的新用户同步到内存 DB
  function syncUserFromDisk(user) {
    if (!user || !user.id) return false;
    try {
      // 检查内存 DB 是否已有该用户
      const existing = execOne('SELECT id FROM users WHERE id = ?', user.id);
      if (existing) return true; // 已存在，无需同步
      // INSERT OR IGNORE 避免冲突
      const cols = [
        'id',
        'username',
        'password_hash',
        'status',
        'must_change_password',
        'password_updated_at',
        'failed_login_count',
        'locked_until',
        'last_login_at',
        'referral_code',
        'referred_by',
        'subscription_status',
        'subscription_expires_at',
        'vip_gift_claimed_at',
        'vip_gift_expires_at',
        'referral_enabled',
        'device_fingerprint',
        'registration_ip',
        'created_at',
        'updated_at',
      ];
      const placeholders = cols
        .map(function () {
          return '?';
        })
        .join(',');
      const vals = cols.map(function (c) {
        return user[c] !== undefined ? user[c] : null;
      });
      execRun('INSERT OR IGNORE INTO users(' + cols.join(',') + ') VALUES(' + placeholders + ')', vals);
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    execOne,
    execAll,
    execRun,
    execDDL,
    transaction,
    close,
    flush,
    reload,
    markDirty,
    execOneOnDisk,
    syncUserFromDisk,
    backend: 'sqljs',
    raw: dbInstance,
  };
}

/**
 * ★ P0: 创建 sql.js 认证 DB 适配器（与主 DB 相同逻辑，但文件不同）
 * 只包含 AUTH_TABLES_DDL + 支付表，文件小 (~10MB vs 300MB)
 */
function _createSqlJsAuthAdapter(sqlDb) {
  let authDbInstance;
  if (fs.existsSync(AUTH_DB_PATH)) {
    try {
      const fileBuffer = fs.readFileSync(AUTH_DB_PATH);
      authDbInstance = new sqlDb.Database(fileBuffer);
    } catch (e) {
      console.log('[auth-db] 加载已有认证数据库失败: ' + e.message + '，创建新库');
      authDbInstance = new sqlDb.Database();
    }
  } else {
    authDbInstance = new sqlDb.Database();
  }

  // 认证建表
  try {
    authDbInstance.exec(AUTH_TABLES_DDL);
  } catch (e) {
    console.warn('[auth-db] 建表可能已存在: ' + e.message);
  }

  // ★ 支付相关表
  try {
    const { initPaymentSchema } = require('./payments/schema');
    initPaymentSchema({
      execDDL: (sql) => { try { authDbInstance.exec(sql); } catch (_) {} },
      execOne: (sql, ...a) => {
        const params = _normalizeParams(a);
        try { return _sqlJsExecOne(authDbInstance, sql, params); } catch (_) { return null; }
      },
      execRun: (sql, ...a) => {
        const params = _normalizeParams(a);
        try { authDbInstance.run(sql, params); } catch (_) {}
      },
    });
  } catch (_) {} // 支付模块可能不存在

  // 异步保存（与主 DB 相同逻辑但文件更小）
  let _authDirty = false;
  let _authSaving = false;
  function _authScheduleSave() {
    _authDirty = true;
    setImmediate(_authSaveToFile);
  }
  function _authSaveToFile() {
    if (_authSaving || !_authDirty) return;
    _authSaving = true;
    _authDirty = false;
    try {
      const data = authDbInstance.export();
      const tmpFile = AUTH_DB_PATH + '.tmp';
      fs.writeFileSync(tmpFile, data);
      fs.renameSync(tmpFile, AUTH_DB_PATH);
    } catch (e) {
      console.warn('[auth-db] 保存失败: ' + e.message);
    }
    _authSaving = false;
  }

  // 认证 DB 适配器接口
  return {
    backend: 'sql.js-auth',
    execOne: function (sql, ...args) {
      const params = _normalizeParams(args);
      return _sqlJsExecOne(authDbInstance, sql, params);
    },
    execAll: function (sql, ...args) {
      const params = _normalizeParams(args);
      return _sqlJsExecAll(authDbInstance, sql, params);
    },
    execRun: function (sql, ...args) {
      const params = _normalizeParams(args);
      authDbInstance.run(sql, params);
      _authScheduleSave();
    },
    execDDL: function (sql) {
      try { authDbInstance.exec(sql); } catch (e) { console.warn('[auth-db] DDL: ' + e.message); }
    },
    markDirty: function () {
      _authDirty = true;
    },
    close: function () {
      try { _authSaveToFile(); authDbInstance.close(); } catch (_) {}
    },
    raw: authDbInstance,
  };
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
    db.pragma('busy_timeout = 10000'); // ★ 从 3s 增加到 10s，避免 jc-sync 写锁导致 SQLITE_BUSY

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

  // ═══ ★ P0: 认证独立 DB（auth.db ~10MB，API服务器只需加载此文件） ═══
  let authDbInstance = null;
  let authAdp = null;

  function initAuthDatabase() {
    if (authDbInstance) return true;
    try {
      authDbInstance = new Database(AUTH_DB_PATH);
      authDbInstance.pragma('journal_mode = WAL');
      authDbInstance.pragma('synchronous = NORMAL');
      authDbInstance.pragma('busy_timeout = 3000');
      authDbInstance.exec(AUTH_TABLES_DDL);
      // ★ 支付相关表（auth.db 内）
      try {
        const { initPaymentSchema } = require('./payments/schema');
        initPaymentSchema({
          execDDL: (sql) => authDbInstance.exec(sql),
          execOne: (sql, ...a) => authDbInstance.prepare(sql).get(..._normalizeParams(a)),
          execRun: (sql, ...a) => authDbInstance.prepare(sql).run(..._normalizeParams(a)),
        });
      } catch (_) {} // 支付表可能已存在
      authAdp = {
        backend: 'better-sqlite3-auth',
        execOne: function (sql, ...args) {
          const params = _normalizeParams(args);
          return authDbInstance.prepare(sql).get(...params);
        },
        execAll: function (sql, ...args) {
          const params = _normalizeParams(args);
          return authDbInstance.prepare(sql).all(...params);
        },
        execRun: function (sql, ...args) {
          const params = _normalizeParams(args);
          return authDbInstance.prepare(sql).run(...params);
        },
        execDDL: function (sql) { authDbInstance.exec(sql); },
        markDirty: function () {}, // better-sqlite3 WAL 模式自动持久化
      };
      console.log('[auth-db] better-sqlite3 认证DB初始化成功: ' + AUTH_DB_PATH);
      return true;
    } catch (e) {
      console.error('[auth-db] 认证DB初始化失败: ' + e.message);
      return false;
    }
  }

  function getAuthAdapter() {
    if (!authAdp) initAuthDatabase();
    return authAdp;
  }

  function isAuthDbAvailable() {
    return !!authDbInstance;
  }

  // ═══ ★ P1: sporttery 归档 DB（懒加载，冷数据独立文件） ═══
  function initArchiveDatabase() {
    if (_archiveDbInstance) return true;
    try {
      _archiveDbInstance = new Database(ARCHIVE_DB_PATH);
      _archiveDbInstance.pragma('journal_mode = WAL');
      _archiveDbInstance.pragma('synchronous = NORMAL');
      _archiveDbInstance.pragma('busy_timeout = 10000');
      _archiveDbInstance.pragma('cache_size = -2000'); // ★ 2MB page cache（676MB DB 不需要大缓存）
      _archiveDbInstance.pragma('wal_autocheckpoint = 1000'); // ★ 每1000页 checkpoint
      _archiveDbInstance.exec(SPORTTERY_ARCHIVE_DDL);
      _archiveAdp = {
        backend: 'better-sqlite3-archive',
        execOne: function (sql, ...args) {
          const params = _normalizeParams(args);
          return _archiveDbInstance.prepare(sql).get(...params);
        },
        execAll: function (sql, ...args) {
          const params = _normalizeParams(args);
          return _archiveDbInstance.prepare(sql).all(...params);
        },
        execRun: function (sql, ...args) {
          const params = _normalizeParams(args);
          const info = _archiveDbInstance.prepare(sql).run(...params);
          return { changes: info.changes };
        },
        execDDL: function (sql) { _archiveDbInstance.exec(sql); },
        flush: function () { return true; },
        raw: _archiveDbInstance,
      };
      console.log('[archive-db] better-sqlite3 归档DB初始化成功: ' + ARCHIVE_DB_PATH);
      return true;
    } catch (e) {
      console.error('[archive-db] 归档DB初始化失败: ' + e.message + '，将降级到主DB');
      _archiveAdp = null;
      return false;
    }
  }

  function getArchiveAdapter() {
    // ★ 降级策略: 归档DB不存在时回退到主DB（sporttery表仍在主DB中）
    if (!_archiveAdp) initArchiveDatabase();
    return _archiveAdp || getAdapter(); // 降级到主DB
  }

  function isArchiveDbAvailable() {
    return !!_archiveDbInstance;
  }

  return (module.exports = {
    initDatabase,
    initAuthDatabase,
    initArchiveDatabase,
    getDatabase,
    getAdapter,
    getAuthAdapter,
    getArchiveAdapter,
    closeDatabase,
    isAvailable,
    isAuthDbAvailable,
    isArchiveDbAvailable,
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
      // ★ P1: sporttery 大表仍保留在 sql.js 主 DB 中（sql.js 不用独立归档 DB）
      adp.execDDL(SPORTTERY_ARCHIVE_DDL);
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

  // ═══ ★ P0: 认证独立 DB（auth.db ~10MB） ═══
  let authAdp = null;

  function initAuthDatabase() {
    if (authAdp) return true;
    // ★ sql.js 版本：使用已加载的 WASM 模块创建新 DB 实例
    // 因为 sql.js WASM 已在 _initSqlJs 中加载，这里只需用同模块创建新实例
    try {
      const initSqlJsModule = require('sql.js');
      const wasmPath2 = require.resolve('sql.js/dist/sql-wasm.wasm');
      const wasmBinary2 = fs.readFileSync(wasmPath2);
      // ★ 如果 WASM 已在内存中，sql.js 会复用；首次加载 ~100ms，远比 midou_data.db 300ms 快
      initSqlJsModule({ wasmBinary: wasmBinary2 }).then((SQL2) => {
        authAdp = _createSqlJsAuthAdapter(SQL2);
        console.log('[auth-db] sql.js 认证DB初始化成功: ' + AUTH_DB_PATH);
      }).catch((e) => {
        console.error('[auth-db] 认证DB WASM加载失败: ' + e.message);
        // ★ 降级：使用主 DB 的 auth 表（兼容旧部署）
        authAdp = adp;
      });
    } catch (e) {
      console.warn('[auth-db] 认证DB初始化异常，降级到主DB: ' + e.message);
      authAdp = adp;
    }
    return true;
  }

  function getAuthAdapter() {
    if (!authAdp) {
      // ★ 同步降级：认证DB未就绪时使用主DB（确保认证不中断）
      return adp;
    }
    return authAdp;
  }

  function isAuthDbAvailable() {
    return !!authAdp && authAdp.backend !== 'sql.js'; // 降级模式下 backend 相同
  }

  // ★ P1: sql.js 层的 archive adapter — 降级到主适配器（sporttery 表仍在主 DB）
  function initArchiveDatabase() { return true; } // sql.js 不需要单独归档 DB
  function getArchiveAdapter() { return adp || getAdapter(); } // 降级到主 DB 适配器
  function isArchiveDbAvailable() { return false; }

  module.exports = {
    initDatabase,
    initAuthDatabase,
    initArchiveDatabase,
    getDatabase,
    getAdapter,
    getAuthAdapter,
    getArchiveAdapter,
    closeDatabase,
    isAvailable,
    isAuthDbAvailable,
    isArchiveDbAvailable,
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

let _backendSelected = false;

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
    initAuthDatabase: function () {
      console.log('[auth-db] JSON 降级模式，认证DB不可用');
      return false;
    },
    getDatabase,
    getAdapter: function () {
      return null;
    },
    getAuthAdapter: function () {
      return null;
    },
    initArchiveDatabase: function () { return true; },
    getArchiveAdapter: nullFn,
    closeDatabase,
    isAvailable,
    isAuthDbAvailable: function () { return false; },
    isArchiveDbAvailable: function () { return false; },
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

// ═══════════════════════════════════════════════════════
// ★ P0: 数据 DB 懒加载 — DATA_DB_LAZY=1 时，API 服务器不主动加载 midou_data.db
// 首次调用 getAdapter() 时才触发加载
// ═══════════════════════════════════════════════════════

// 读取环境变量（只在 module.exports 初始化后生效）
const DATA_DB_LAZY_FLAG = String(process.env.DATA_DB_LAZY || '0') === '1';
if (DATA_DB_LAZY_FLAG && !_backendSelected) {
  // 没有后端被选中时，懒加载标志无效
  console.log('[P0] DATA_DB_LAZY=1 但无 SQLite 后端，忽略');
} else if (DATA_DB_LAZY_FLAG && module.exports.initDatabase) {
  // ★ 标记懒加载：initDatabase() 变为延迟执行
  _dataDbLazy = true;
  const _origInitDatabase = module.exports.initDatabase;
  let _dataDbInitialized = false;

  // ★ 覆盖 initDatabase：标记但不执行（等待首次 getAdapter 调用触发）
  module.exports.initDatabase = function () {
    if (_dataDbInitialized) return true;
    console.log('[P0] 数据DB懒加载模式 — initDatabase() 延迟执行');
    return true; // 返回 true，不阻塞启动
  };

  // ★ 覆盖 getAdapter：首次调用时触发真实初始化
  const _origGetAdapter = module.exports.getAdapter;
  module.exports.getAdapter = function () {
    if (!_dataDbInitialized) {
      _dataDbInitialized = true;
      console.log('[P0] 数据DB懒加载触发 — 首次 getAdapter() 调用，开始加载 midou_data.db...');
      _origInitDatabase();
      // ★ sql.js 异步加载，getAdapter 返回 null 直到就绪
      // 后续调用会返回真实适配器
    }
    return _origGetAdapter();
  };

  // ★ 覆盖 isAvailable：懒加载时始终返回 false 直到真实初始化完成
  const _origIsAvailable = module.exports.isAvailable;
  module.exports.isAvailable = function () {
    if (!_dataDbInitialized) return false; // 未触发懒加载
    return _origIsAvailable();
  };
}
