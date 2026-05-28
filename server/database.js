/**
 * server/database.js
 * SQLite 数据库模块 — 主数据存储层
 * 
 * 表结构:
 *   matches      — 比赛信息（matchId 主键）
 *   recommends   — 推荐数据（matchId + type + fetchDate 唯一）
 *   crawl_logs   — 爬取日志
 *   ai_predictions — AI 预测缓存
 */

let db = null;
let dbAvailable = false;

try {
  const Database = require('better-sqlite3');
  const path = require('path');
  const DB_PATH = path.join(__dirname, 'midou_data.db');

  function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -8000'); // 8MB cache
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
    console.log('[db] SQLite 初始化成功: ' + DB_PATH);
    return true;
  }

  function isAvailable() { return dbAvailable; }
  function getDatabase() { return db; }
  function closeDatabase() { if (db) db.close(); }

  // ═══ Matches CRUD ═══
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

  // ═══ Recommends CRUD ═══
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
    // 按条件筛选命中率（兼容旧接口）
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

  module.exports = {
    initDatabase, getDatabase, closeDatabase, isAvailable,
    upsertMatch, batchUpsertMatches, getMatchesByDate, getAllMatches, getAllLeagues,
    batchUpsertRecommends, getRecommendsByMatchId, updateRecommendResult, getStaleRecommendations,
    logCrawl, getCrawledDates,
    getHitRateStats, getDailyTrend, getFilterStats, getFilterRate,
    upsertAIPrediction, getAIPrediction,
    getTodayUnfinishedMatches, getTodayMatchSummary
  };

} catch (e) {
  console.log('[db] better-sqlite3 不可用，使用 JSON 降级模式: ' + e.message);

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
}
