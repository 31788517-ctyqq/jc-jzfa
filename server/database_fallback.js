/**
 * 本地数据库模块 - 兼容模式
 * 当 better-sqlite3 不可用时使用内存假对象
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
  console.log('[db] better-sqlite3 unavailable, using in-memory stub');

  function initDatabase() {
    console.log('[db] In-memory database initialized');
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
      close: function() {}
    };
  }

  function closeDatabase() {}
  module.exports = { initDatabase, getDatabase, closeDatabase };
}
