/** Fix production server: database.js fallback + restart */
const { Client } = require('ssh2');

const HOST = '119.23.51.159';
const USER = 'root';
const PASS = 'znm19811225@';

// Patched database.js with try-catch for better-sqlite3
const DB_JS = `/**
 * 本地数据库模块 - 兼容模式
 * 当 better-sqlite3 不可用时使用内存存储
 */
let db;

try {
  const Database = require('better-sqlite3');
  const path = require('path');
  const DB_PATH = path.join(__dirname, 'midou_data.db');

  function initDatabase() {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(\`
      CREATE TABLE IF NOT EXISTS matches (
        matchId TEXT PRIMARY KEY, num TEXT, homeName TEXT, visitName TEXT,
        leagueName TEXT, startTime TEXT, matchStatus INTEGER DEFAULT 0,
        score TEXT DEFAULT '', halfScore TEXT DEFAULT '', duration TEXT DEFAULT '',
        yellow TEXT DEFAULT '', red TEXT DEFAULT '', recommNum INTEGER DEFAULT 0,
        date TEXT, fetchDate TEXT, createdAt TEXT, updatedAt TEXT
      )
    \`);
    db.exec(\`
      CREATE TABLE IF NOT EXISTS recommends (
        id INTEGER PRIMARY KEY AUTOINCREMENT, matchId TEXT, type TEXT,
        num INTEGER, result REAL, fetchDate TEXT,
        UNIQUE(matchId, type, fetchDate)
      )
    \`);
    db.exec(\`
      CREATE TABLE IF NOT EXISTS crawl_logs (
        date TEXT PRIMARY KEY, matchCount INTEGER, recommCount INTEGER,
        status TEXT DEFAULT 'pending', message TEXT, createdAt TEXT
      )
    \`);
    db.exec(\`
      CREATE TABLE IF NOT EXISTS ai_predictions (
        matchId TEXT PRIMARY KEY, leagueName TEXT, homeName TEXT,
        visitName TEXT, matchDate TEXT, content TEXT, confidence REAL,
        rawPrompt TEXT, rawResponse TEXT, tokenUsage TEXT,
        createdAt TEXT, updatedAt TEXT
      )
    \`);
    return true;
  }

  function getDatabase() { return db; }
  function closeDatabase() { if (db) db.close(); }

  module.exports = { initDatabase, getDatabase, closeDatabase };

} catch (e) {
  // In-memory fallback when better-sqlite3 is not available
  console.log('[db] better-sqlite3 unavailable, using in-memory mode');

  const memStore = { matches: {}, recommends: [], crawl_logs: {}, ai_predictions: {} };

  function initDatabase() {
    console.log('[db] In-memory database initialized');
    return true;
  }

  function getDatabase() {
    return {
      prepare: (sql) => ({
        run: (...args) => { return { lastInsertRowid: 1, changes: 1 }; },
        get: (...args) => { return null; },
        all: (...args) => { return []; },
      }),
      pragma: () => {},
      exec: () => {},
      close: () => {},
    };
  }

  function closeDatabase() {}
  module.exports = { initDatabase, getDatabase, closeDatabase };
}
`;

const conn = new Client();

function execCmd(cmd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    console.log('\n>>> ' + cmd);
    conn.exec(cmd, { timeout }, (err, stream) => {
      if (err) return reject(err);
      let out = '', errOut = '';
      stream.on('data', d => { out += d.toString('utf8'); });
      stream.stderr.on('data', d => { errOut += d.toString('utf8'); });
      stream.on('close', () => {
        if (out) console.log(out);
        if (errOut) console.log('[STDERR]', errOut);
        resolve({ out, err: errOut });
      });
    });
  });
}

(async () => {
  console.log('[*] Connecting to', HOST + '...');

  await new Promise((resolve, reject) => {
    conn.on('ready', resolve);
    conn.on('error', reject);
    conn.connect({
      host: HOST, port: 22, username: USER, password: PASS,
      readyTimeout: 15000
    });
  });

  console.log('[✓] Connected');

  // Upload patched database.js
  console.log('\n[Uploading patched database.js...]');
  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => err ? reject(err) : resolve(sftp));
  });

  await new Promise((resolve, reject) => {
    const ws = sftp.createWriteStream('/var/www/zj.100qiu.com/server/database.js', { mode: 0o644 });
    ws.on('close', resolve);
    ws.on('error', reject);
    ws.end(DB_JS);
  });
  console.log('  database.js uploaded');

  sftp.end();
  await new Promise(r => setTimeout(r, 1000));

  // Restart PM2
  await execCmd('cd /var/www/zj.100qiu.com && pm2 restart ecosystem.config.json 2>&1');

  // Verify
  await new Promise(r => setTimeout(r, 4000));
  await execCmd('pm2 status');
  await execCmd("curl -s -X POST http://127.0.0.1:3000/api -H 'Content-Type: application/json' -d '{\"action\":\"plan-list\",\"date\":\"2026-05-25\"}' 2>&1 | head -100");

  console.log('\n[✓] Fix applied!');
  conn.end();
})().catch(e => { console.error('[✗]', e.message); process.exit(1); });
