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
let _adapterReady = false;  // sql.js 异步初始化完成标志

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

  // 自动保存到文件（事务中跳过）
  let _inTransaction = false;
  function _saveToFile() {
    if (_inTransaction) return; // 事务中不保存，等 COMMIT
    try {
      const data = dbInstance.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(DB_FILE, buffer);
    } catch (e) {
      console.error('[db] 保存数据库失败: ' + e.message);
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
      _saveToFile();
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
      _saveToFile();
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
        try { dbInstance.run('ROLLBACK'); } catch (_) {}
        console.error('[db] transaction error:', e.message);
        throw e;
      }
    };
  }

  function close() {
    _saveToFile();
    dbInstance.close();
  }

  return { execOne, execAll, execRun, execDDL, transaction, close, raw: dbInstance };
}

// ═══════════════════════════════════════════════════════
// Tier 1: better-sqlite3 (本地开发环境)
// ═══════════════════════════════════════════════════════
function _initBetterSqlite3() {
  const Database = require('better-sqlite3');

  function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
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
    dbAvailable = true;
    _adapterReady = true;
    console.log('[db] better-sqlite3 初始化成功: ' + DB_PATH);
    return true;
  }

  function isAvailable() { return dbAvailable; }
  function getDatabase() { return db; }
  function closeDatabase() { if (db) db.close(); }

  // ═══ Matches ═══
  function upsertMatch(match) {
    const now = new Date().toISOString();
    const existing = db.prepare('SELECT matchId FROM matches WHERE matchId = ?').get(match.matchId);
    if (existing) {
      db.prepare(`UPDATE matches SET num=?,homeName=?,visitName=?,leagueName=?,startTime=?,
        matchStatus=?,score=?,halfScore=?,recommNum=?,date=?,fetchDate=?,updatedAt=?
        WHERE matchId=?`).run(
        match.num, match.homeName, match.visitName, match.leagueName, match.startTime,
        match.matchStatus, match.score || '', match.halfScore || '', match.recommNum || 0,
        match.date, now, now, match.matchId
      );
    } else {
      db.prepare(`INSERT INTO matches (matchId,num,homeName,visitName,leagueName,startTime,
        matchStatus,score,recommNum,date,fetchDate,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        match.matchId, match.num, match.homeName, match.visitName, match.leagueName,
        match.startTime, match.matchStatus, match.score || '', match.recommNum || 0,
        match.date, now, now, now
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
        upsert.run(m.matchId, m.num, m.homeName, m.visitName, m.leagueName,
          m.startTime, m.matchStatus, m.score || '', m.recommNum || 0, m.date, now, now);
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
    return db.prepare('SELECT DISTINCT leagueName FROM matches ORDER BY leagueName').all().map(r => r.leagueName);
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
    db.prepare('UPDATE recommends SET result = ? WHERE matchId = ? AND type = ? AND fetchDate = ?')
      .run(result, matchId, type, fetchDate);
  }

  function getStaleRecommendations(dateStr) {
    return db.prepare(`
      SELECT DISTINCT m.matchId FROM matches m
      LEFT JOIN recommends r ON m.matchId = r.matchId AND r.fetchDate >= ?
      WHERE m.date = ? AND m.matchStatus >= 2 AND r.id IS NULL
    `).all(dateStr, dateStr).map(r => r.matchId);
  }

  // ═══ Crawl Logs ═══
  function logCrawl(dateStr, matchCount, recommCount, status, message) {
    db.prepare(`INSERT OR REPLACE INTO crawl_logs (date,matchCount,recommCount,status,message,createdAt)
      VALUES (?,?,?,?,?,?)`).run(dateStr, matchCount, recommCount, status, message, new Date().toISOString());
  }

  function getCrawledDates() {
    return db.prepare('SELECT date FROM crawl_logs ORDER BY date DESC').all().map(r => r.date);
  }

  // ═══ AI Predictions ═══
  function upsertAIPrediction(pred) {
    const now = new Date().toISOString();
    db.prepare(`INSERT OR REPLACE INTO ai_predictions
      (matchId,leagueName,homeName,visitName,matchDate,content,confidence,
       rawPrompt,rawResponse,tokenUsage,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      pred.matchId, pred.leagueName, pred.homeName, pred.visitName, pred.matchDate,
      pred.content, pred.confidence, pred.rawPrompt, pred.rawResponse,
      pred.tokenUsage, now, now
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
    return db.prepare(`
      SELECT r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY r.type
    `).all(sinceStr);
  }

  function getDailyTrend(daysBack) {
    const since = new Date();
    since.setDate(since.getDate() - (daysBack || 30));
    const sinceStr = since.toISOString().slice(0, 10);
    return db.prepare(`
      SELECT m.date, r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY m.date, r.type
      ORDER BY m.date ASC
    `).all(sinceStr);
  }

  function getFilterStats() {
    const matchCount = db.prepare('SELECT COUNT(*) as cnt FROM matches').get().cnt || 0;
    const leagueCount = db.prepare('SELECT COUNT(DISTINCT leagueName) as cnt FROM matches').get().cnt || 0;
    const directionCount = db.prepare('SELECT COUNT(DISTINCT type) as cnt FROM recommends').get().cnt || 0;
    return { matchCount, leagueCount, directionCount };
  }

  function getFilterRate(conditions) {
    return {
      hitCount: 0, totalCount: 0, hitRate: 0,
      conditionSummary: JSON.stringify(conditions || {}),
      detailList: [], dailyResults: []
    };
  }

  function getTodayUnfinishedMatches() {
    const today = new Date().toISOString().slice(0, 10);
    return db.prepare('SELECT * FROM matches WHERE date = ? AND matchStatus < 2').all(today);
  }

  function getTodayMatchSummary() {
    const today = new Date().toISOString().slice(0, 10);
    const total = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date = ?').get(today).cnt || 0;
    const finished = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date = ? AND matchStatus >= 2').get(today).cnt || 0;
    return {
      todayDate: today, totalMatches: total, finishedMatches: finished,
      unfinishedMatches: total - finished, canShowCards: finished > 0
    };
  }

  return module.exports = {
    initDatabase, getDatabase, closeDatabase, isAvailable,
    upsertMatch, batchUpsertMatches, getMatchesByDate, getAllMatches, getAllLeagues,
    batchUpsertRecommends, getRecommendsByMatchId, updateRecommendResult, getStaleRecommendations,
    logCrawl, getCrawledDates,
    getHitRateStats, getDailyTrend, getFilterStats, getFilterRate,
    upsertAIPrediction, getAIPrediction,
    getTodayUnfinishedMatches, getTodayMatchSummary
  };
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

  initSqlJs({ wasmBinary }).then(SQL => {
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
    dbAvailable = true;
    _adapterReady = true;
    console.log('[db] sql.js 初始化成功: ' + DB_PATH);
  }).catch(e => {
    console.log('[db] sql.js 初始化失败: ' + e.message);
  });

  function initDatabase() {
    console.log('[db] sql.js 后端等待初始化...');
    return true;
  }

  function isAvailable() { return _adapterReady && dbAvailable; }
  function getDatabase() { return adp ? adp.raw : null; }
  function closeDatabase() { if (adp) adp.close(); }

  // ═══ Matches (sql.js adapter) ═══
  function upsertMatch(match) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    const existing = adp.execOne('SELECT matchId FROM matches WHERE matchId = ?', match.matchId);
    if (existing) {
      adp.execRun(`UPDATE matches SET num=?,homeName=?,visitName=?,leagueName=?,startTime=?,
        matchStatus=?,score=?,halfScore=?,recommNum=?,date=?,fetchDate=?,updatedAt=?
        WHERE matchId=?`,
        match.num, match.homeName, match.visitName, match.leagueName, match.startTime,
        match.matchStatus, match.score || '', match.halfScore || '', match.recommNum || 0,
        match.date, now, now, match.matchId
      );
    } else {
      adp.execRun(`INSERT INTO matches (matchId,num,homeName,visitName,leagueName,startTime,
        matchStatus,score,recommNum,date,fetchDate,createdAt,updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        match.matchId, match.num, match.homeName, match.visitName, match.leagueName,
        match.startTime, match.matchStatus, match.score || '', match.recommNum || 0,
        match.date, now, now, now
      );
    }
  }

  function batchUpsertMatches(matches) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    const batch = adp.transaction((items) => {
      for (const m of items) {
        adp.execRun(`INSERT OR REPLACE INTO matches
          (matchId,num,homeName,visitName,leagueName,startTime,matchStatus,score,recommNum,
           date,fetchDate,updatedAt)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          m.matchId, m.num, m.homeName, m.visitName, m.leagueName,
          m.startTime, m.matchStatus, m.score || '', m.recommNum || 0, m.date, now, now
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
    return adp.execAll('SELECT DISTINCT leagueName FROM matches ORDER BY leagueName').map(r => r.leagueName);
  }

  // ═══ Recommends ═══
  function batchUpsertRecommends(items) {
    if (!_adapterReady) return;
    const now = new Date().toISOString().slice(0, 10);
    const batch = adp.transaction((list) => {
      for (const r of list) {
        adp.execRun('INSERT OR REPLACE INTO recommends (matchId,type,num,result,fetchDate) VALUES (?,?,?,?,?)',
          r.matchId, r.type, r.num, r.result, r.fetchDate || now);
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
    adp.execRun('UPDATE recommends SET result = ? WHERE matchId = ? AND type = ? AND fetchDate = ?',
      result, matchId, type, fetchDate);
  }

  function getStaleRecommendations(dateStr) {
    if (!_adapterReady) return [];
    return adp.execAll(`
      SELECT DISTINCT m.matchId FROM matches m
      LEFT JOIN recommends r ON m.matchId = r.matchId AND r.fetchDate >= ?
      WHERE m.date = ? AND m.matchStatus >= 2 AND r.id IS NULL
    `, dateStr, dateStr).map(r => r.matchId);
  }

  // ═══ Crawl Logs ═══
  function logCrawl(dateStr, matchCount, recommCount, status, message) {
    if (!_adapterReady) return;
    adp.execRun(`INSERT OR REPLACE INTO crawl_logs (date,matchCount,recommCount,status,message,createdAt)
      VALUES (?,?,?,?,?,?)`, dateStr, matchCount, recommCount, status, message, new Date().toISOString());
  }

  function getCrawledDates() {
    if (!_adapterReady) return [];
    return adp.execAll('SELECT date FROM crawl_logs ORDER BY date DESC').map(r => r.date);
  }

  // ═══ AI Predictions ═══
  function upsertAIPrediction(pred) {
    if (!_adapterReady) return;
    const now = new Date().toISOString();
    adp.execRun(`INSERT OR REPLACE INTO ai_predictions
      (matchId,leagueName,homeName,visitName,matchDate,content,confidence,
       rawPrompt,rawResponse,tokenUsage,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      pred.matchId, pred.leagueName, pred.homeName, pred.visitName, pred.matchDate,
      pred.content, pred.confidence, pred.rawPrompt, pred.rawResponse,
      pred.tokenUsage, now, now
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
    return adp.execAll(`
      SELECT r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY r.type
    `, sinceStr);
  }

  function getDailyTrend(daysBack) {
    if (!_adapterReady) return [];
    const since = new Date();
    since.setDate(since.getDate() - (daysBack || 30));
    const sinceStr = since.toISOString().slice(0, 10);
    return adp.execAll(`
      SELECT m.date, r.type as direction, COUNT(*) as count, SUM(r.num) as total,
        SUM(CASE WHEN r.result = 1 THEN r.num ELSE 0 END) as hit,
        SUM(CASE WHEN r.result = 0 THEN r.num ELSE 0 END) as miss
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE m.matchStatus >= 2 AND r.fetchDate >= ?
      GROUP BY m.date, r.type
      ORDER BY m.date ASC
    `, sinceStr);
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
      hitCount: 0, totalCount: 0, hitRate: 0,
      conditionSummary: JSON.stringify(conditions || {}),
      detailList: [], dailyResults: []
    };
  }

  function getTodayUnfinishedMatches() {
    if (!_adapterReady) return [];
    const today = new Date().toISOString().slice(0, 10);
    return adp.execAll('SELECT * FROM matches WHERE date = ? AND matchStatus < 2', today);
  }

  function getTodayMatchSummary() {
    if (!_adapterReady) return { todayDate: '', totalMatches: 0, finishedMatches: 0, unfinishedMatches: 0, canShowCards: false };
    const today = new Date().toISOString().slice(0, 10);
    const total = (adp.execOne('SELECT COUNT(*) as cnt FROM matches WHERE date = ?', today) || {}).cnt || 0;
    const finished = (adp.execOne('SELECT COUNT(*) as cnt FROM matches WHERE date = ? AND matchStatus >= 2', today) || {}).cnt || 0;
    return {
      todayDate: today, totalMatches: total, finishedMatches: finished,
      unfinishedMatches: total - finished, canShowCards: finished > 0
    };
  }

  module.exports = {
    initDatabase, getDatabase, closeDatabase, isAvailable,
    upsertMatch, batchUpsertMatches, getMatchesByDate, getAllMatches, getAllLeagues,
    batchUpsertRecommends, getRecommendsByMatchId, updateRecommendResult, getStaleRecommendations,
    logCrawl, getCrawledDates,
    getHitRateStats, getDailyTrend, getFilterStats, getFilterRate,
    upsertAIPrediction, getAIPrediction,
    getTodayUnfinishedMatches, getTodayMatchSummary
  };
}

// ═══════════════════════════════════════════════════════
// 选择后端
// ═══════════════════════════════════════════════════════

// 尝试 Tier 1: better-sqlite3
try {
  require.resolve('better-sqlite3');
  _initBetterSqlite3();
  return;  // 成功则退出
} catch (e) {
  // better-sqlite3 不可用
}

// 尝试 Tier 2: sql.js (纯 JS，兼容 CentOS 6)
try {
  require.resolve('sql.js');
  _initSqlJs();
  return;  // sql.js 异步初始化，exports 已设置
} catch (e) {
  // sql.js 也不可用
}

// ═══════════════════════════════════════════════════════
// Tier 3: JSON 降级模式
// ═══════════════════════════════════════════════════════
console.log('[db] 无可用 SQLite 后端，使用 JSON 降级模式');

function isAvailable() { return false; }
function initDatabase() { console.log('[db] JSON 降级模式就绪'); return true; }
function getDatabase() { return null; }
function closeDatabase() {}

const emptyArr = () => [];
const nullFn = () => null;
const zeroObj = () => ({ matchCount: 0, leagueCount: 0, directionCount: 0 });

module.exports = {
  initDatabase, getDatabase, closeDatabase, isAvailable,
  upsertMatch: () => {}, batchUpsertMatches: () => {},
  getMatchesByDate: emptyArr, getAllMatches: emptyArr, getAllLeagues: emptyArr,
  batchUpsertRecommends: () => {},
  getRecommendsByMatchId: emptyArr, updateRecommendResult: () => {},
  getStaleRecommendations: emptyArr,
  logCrawl: () => {}, getCrawledDates: emptyArr,
  getHitRateStats: emptyArr, getDailyTrend: emptyArr,
  getFilterStats: zeroObj,
  getFilterRate: () => ({ hitCount: 0, totalCount: 0, hitRate: 0, conditionSummary: '', detailList: [], dailyResults: [] }),
  upsertAIPrediction: () => {}, getAIPrediction: nullFn,
  getTodayUnfinishedMatches: emptyArr,
  getTodayMatchSummary: () => ({ todayDate: '', totalMatches: 0, finishedMatches: 0, unfinishedMatches: 0, canShowCards: false })
};
