/**
 * 本地数据库模块 - 基于 better-sqlite3
 * 存储比赛数据、推荐数据、命中率数据
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'midou_data.db');

let db;

/**
 * 初始化数据库，创建表结构
 */
function initDatabase() {
  db = new Database(DB_PATH);
  
  // 开启 WAL 模式提升并发性能
  db.pragma('journal_mode = WAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      matchId TEXT PRIMARY KEY,
      num TEXT,
      homeName TEXT,
      visitName TEXT,
      leagueName TEXT,
      startTime TEXT,
      matchStatus INTEGER DEFAULT 0,
      score TEXT DEFAULT '',
      recommNum INTEGER DEFAULT 0,
      date TEXT,
      fetchDate TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      updatedAt TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS recommends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT NOT NULL,
      type TEXT NOT NULL,
      num INTEGER DEFAULT 0,
      result INTEGER,
      fetchDate TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(matchId, type, fetchDate)
    );

    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      matchCount INTEGER DEFAULT 0,
      recommCount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      message TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(matchStatus);
    CREATE INDEX IF NOT EXISTS idx_recommends_matchId ON recommends(matchId);
    CREATE INDEX IF NOT EXISTS idx_recommends_fetchDate ON recommends(fetchDate);
  `);

  console.log('[db] 数据库初始化完成:', DB_PATH);
  return db;
}

/**
 * 保存或更新比赛数据
 */
function upsertMatch(match) {
  const stmt = db.prepare(`
    INSERT INTO matches (matchId, num, homeName, visitName, leagueName, startTime, 
      matchStatus, score, recommNum, date, fetchDate, updatedAt)
    VALUES (@matchId, @num, @homeName, @visitName, @leagueName, @startTime,
      @matchStatus, @score, @recommNum, @date, @fetchDate, datetime('now','localtime'))
    ON CONFLICT(matchId) DO UPDATE SET
      matchStatus = @matchStatus,
      score = @score,
      recommNum = @recommNum,
      updatedAt = datetime('now','localtime')
  `);
  return stmt.run(match);
}

/**
 * 批量保存比赛数据
 */
function batchUpsertMatches(matches, fetchDate) {
  const insertMany = db.transaction((items) => {
    for (const m of items) {
      upsertMatch({
        matchId: String(m.matchId),
        num: m.num || '',
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        startTime: m.startTime || '',
        matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
        score: m.score || '',
        recommNum: m.recommNum || 0,
        date: fetchDate,
        fetchDate
      });
    }
  });
  insertMany(matches);
}

/**
 * 保存推荐数据
 */
function batchUpsertRecommends(matchId, items, fetchDate) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO recommends (matchId, type, num, result, fetchDate)
    VALUES (@matchId, @type, @num, @result, @fetchDate)
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run({
        matchId,
        type: r.type,
        num: r.num,
        result: r.result !== undefined ? r.result : null,
        fetchDate
      });
    }
  });
  insertMany(items);
}

/**
 * 记录抓取日志
 */
function logCrawl(date, matchCount, recommCount, status, message) {
  const stmt = db.prepare(`
    INSERT INTO crawl_logs (date, matchCount, recommCount, status, message)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(date, matchCount, recommCount, status, message);
}

/**
 * 查询已抓取的日期列表
 */
function getCrawledDates() {
  const rows = db.prepare('SELECT DISTINCT date FROM crawl_logs WHERE status = ? ORDER BY date').all('success');
  return rows.map(r => r.date);
}

/**
 * 查询某日期的比赛数据
 */
function getMatchesByDate(date) {
  return db.prepare('SELECT * FROM matches WHERE date = ? ORDER BY startTime ASC').all(date);
}

/**
 * 查询某场比赛的推荐数据
 */
function getRecommendsByMatchId(matchId, fetchDate) {
  if (fetchDate) {
    return db.prepare('SELECT * FROM recommends WHERE matchId = ? AND fetchDate = ?').all(matchId, fetchDate);
  }
  return db.prepare('SELECT * FROM recommends WHERE matchId = ?').all(matchId);
}

/**
 * 获取所有比赛数据（不按日期过滤）
 */
function getAllMatches() {
  return db.prepare('SELECT * FROM matches ORDER BY date DESC, startTime ASC').all();
}

/**
 * 获取命中率统计（每场比赛只取专家数前5的方向）
 */
function getHitRateStats(days = 60) {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  const dateStr = dateLimit.toISOString().slice(0, 10);

  const rows = db.prepare(`
    WITH ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY matchId, fetchDate ORDER BY num DESC) as rn
      FROM recommends
      WHERE result IS NOT NULL
    )
    SELECT r.type as direction, 
           COUNT(*) as totalRecommends,
           SUM(CASE WHEN r.result = 1 THEN 1 ELSE 0 END) as hitCount,
           SUM(CASE WHEN r.result = 0 THEN 1 ELSE 0 END) as missCount
    FROM ranked r
    WHERE r.rn <= 8 AND r.fetchDate >= ?
    GROUP BY r.type
    ORDER BY hitCount DESC
  `).all(dateStr);

  return rows.map(r => ({
    direction: r.direction,
    totalRecommends: r.totalRecommends,
    hitCount: r.hitCount,
    missCount: r.missCount,
    hitRate: r.totalRecommends > 0 ? Math.round(r.hitCount / r.totalRecommends * 100 * 10) / 10 : 0
  }));
}

/**
 * 获取每日命中率趋势（每场比赛只取专家数前5的方向）
 */
function getDailyTrend(days = 60) {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  const dateStr = dateLimit.toISOString().slice(0, 10);

  const rows = db.prepare(`
    WITH ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY matchId, fetchDate ORDER BY num DESC) as rn
      FROM recommends
      WHERE result IS NOT NULL
    )
    SELECT r.fetchDate as date, r.type as direction,
           COUNT(*) as total,
           SUM(CASE WHEN r.result = 1 THEN 1 ELSE 0 END) as hits
    FROM ranked r
    WHERE r.rn <= 8 AND r.fetchDate >= ?
    GROUP BY r.fetchDate, r.type
    ORDER BY r.fetchDate ASC
  `).all(dateStr);

  // 整理成按日期分组的格式
  const dateMap = {};
  for (const r of rows) {
    if (!dateMap[r.date]) dateMap[r.date] = { date: r.date, directions: [] };
    dateMap[r.date].directions.push({
      direction: r.direction,
      hitRate: r.total > 0 ? Math.round(r.hits / r.total * 100 * 10) / 10 : 0
    });
  }

  return Object.values(dateMap);
}

/**
 * 关闭数据库连接
 */
function closeDatabase() {
  if (db) {
    db.close();
    console.log('[db] 数据库连接已关闭');
  }
}

module.exports = {
  initDatabase,
  batchUpsertMatches,
  batchUpsertRecommends,
  logCrawl,
  getCrawledDates,
  getMatchesByDate,
  getRecommendsByMatchId,
  getAllMatches,
  getHitRateStats,
  getDailyTrend,
  closeDatabase
};
