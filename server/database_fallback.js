/**
 * 本地数据库模块 - 兼容模式
 * 当 better-sqlite3 不可用时使用内存假对象（兼容 CentOS 6 / Node 10）
 */
let db;

try {
  const Database = require('better-sqlite3');
  const path = require('path');
  const DB_PATH = path.join(__dirname, 'midou_data.db');

  function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE IF NOT EXISTS matches (matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT, leagueName TEXT, startTime TEXT, matchStatus INTEGER DEFAULT 0, score TEXT DEFAULT '', halfScore TEXT DEFAULT '', duration TEXT DEFAULT '', yellow TEXT DEFAULT '', red TEXT DEFAULT '', recommNum INTEGER DEFAULT 0, date TEXT, fetchDate TEXT, createdAt TEXT, updatedAt TEXT)");
    db.exec("CREATE TABLE IF NOT EXISTS recommends (id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT, type TEXT, num INTEGER, result REAL, fetchDate TEXT, UNIQUE(matchId, type, fetchDate))");
    db.exec("CREATE TABLE IF NOT EXISTS crawl_logs (date TEXT PRIMARY KEY, matchCount INTEGER, recommCount INTEGER, status TEXT DEFAULT 'pending', message TEXT, createdAt TEXT)");
    db.exec("CREATE TABLE IF NOT EXISTS ai_predictions (matchId TEXT PRIMARY KEY, leagueName TEXT, homeName TEXT, visitName TEXT, matchDate TEXT, content TEXT, confidence REAL, rawPrompt TEXT, rawResponse TEXT, tokenUsage TEXT, createdAt TEXT, updatedAt TEXT)");
    return true;
  }

  function getDatabase() { return db; }
  function closeDatabase() { if (db) db.close(); }
  module.exports = { initDatabase, getDatabase, closeDatabase };

} catch (e) {
  // Fallback: complete stub for all database functions
  console.log('[db] better-sqlite3 unavailable, using in-memory stub');

  function initDatabase() {
    console.log('[db] In-memory database initialized (stub mode)');
    return true;
  }

  function getDatabase() {
    return {
      prepare: function() {
        return {
          run: function() { return { lastInsertRowid: 1, changes: 1 }; },
          get: function() { return null; },
          all: function() { return []; }
        };
      },
      pragma: function() {},
      exec: function() {},
      close: function() {},
      transaction: function(fn) { return function(items) { fn(items); }; }
    };
  }

  function closeDatabase() { console.log('[db] closed (stub)'); }

  // All stub functions returning sensible empty data
  var noop = function() {};
  var emptyArr = function() { return []; };
  var nullFn = function() { return null; };
  var zeroObj = function() { return { matchCount: 0, leagueCount: 0, directionCount: 0 }; };
  var emptyRate = function() { return { hitCount: 0, totalCount: 0, hitRate: 0, conditionSummary: '', detailList: [], dailyResults: [] }; };
  var emptySummary = function() {
    var today = new Date().toISOString().slice(0, 10);
    return { todayDate: today, totalMatches: 0, finishedMatches: 0, unfinishedMatches: 0, canShowCards: false };
  };

  module.exports = {
    initDatabase: initDatabase,
    getDatabase: getDatabase,
    closeDatabase: closeDatabase,
    // Matches
    upsertMatch: noop,
    batchUpsertMatches: noop,
    getMatchesByDate: emptyArr,
    getAllMatches: emptyArr,
    // Recommends
    batchUpsertRecommends: noop,
    getRecommendsByMatchId: emptyArr,
    updateRecommendResult: noop,
    // Crawl
    logCrawl: noop,
    getCrawledDates: emptyArr,
    // Stats
    getHitRateStats: emptyArr,
    getDailyTrend: emptyArr,
    getAllLeagues: emptyArr,
    getStaleRecommendations: emptyArr,
    getFilterStats: zeroObj,
    getFilterRate: emptyRate,
    // AI
    upsertAIPrediction: noop,
    getAIPrediction: nullFn,
    getTodayUnfinishedMatches: emptyArr,
    getTodayMatchSummary: emptySummary
  };
}
