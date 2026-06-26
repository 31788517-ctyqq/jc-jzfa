#!/usr/bin/env node
/**
 * server/migrate_to_archive_db.js
 * ★ P1: 将 sporttery_odds_snapshot 和 sporttery_preview 从 midou_data.db 迁移到 sporttery_archive.db
 * 
 * 步骤:
 *   1. 创建 sporttery_archive.db（含 sporttery 表 DDL）
 *   2. 从 midou_data.db 读取 sporttery 表数据
 *   3. 写入 sporttery_archive.db
 *   4. 从 midou_data.db 删除 sporttery 表数据（DROP TABLE）
 *   5. VACUUM midou_data.db 回收空间
 * 
 * 用法: cd /root/server && node migrate_to_archive_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const MAIN_DB = path.join(__dirname, 'midou_data.db');
const ARCHIVE_DB = path.join(__dirname, 'sporttery_archive.db');

console.log('=== P1: sporttery 大表迁移到归档 DB ===');
console.log('主DB: ' + MAIN_DB);
console.log('归档DB: ' + ARCHIVE_DB);

// Step 0: 检查主 DB 文件大小
const mainSizeBefore = fs.statSync(MAIN_DB).size;
console.log('主DB当前大小: ' + (mainSizeBefore / 1048576).toFixed(1) + ' MB');

// Step 1: 打开主 DB
const mainDb = new Database(MAIN_DB);
mainDb.pragma('journal_mode = WAL');

// Step 2: 检查 sporttery 表是否存在
const tables = mainDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sporttery_odds_snapshot', 'sporttery_preview')").all();
if (tables.length === 0) {
  console.log('主DB中没有 sporttery 表，无需迁移');
  mainDb.close();
  process.exit(0);
}

// Step 3: 统计数据量
const oddsCount = tables.find(t => t.name === 'sporttery_odds_snapshot') 
  ? mainDb.prepare('SELECT count(*) as c FROM sporttery_odds_snapshot').get().c : 0;
const previewCount = tables.find(t => t.name === 'sporttery_preview') 
  ? mainDb.prepare('SELECT count(*) as c FROM sporttery_preview').get().c : 0;
console.log('sporttery_odds_snapshot: ' + oddsCount + ' rows');
console.log('sporttery_preview: ' + previewCount + ' rows');

// Step 4: 创建归档 DB
if (fs.existsSync(ARCHIVE_DB)) {
  console.log('归档DB已存在，追加数据');
} else {
  console.log('创建归档DB');
}
const archiveDb = new Database(ARCHIVE_DB);
archiveDb.pragma('journal_mode = WAL');
archiveDb.pragma('synchronous = NORMAL');
archiveDb.pragma('busy_timeout = 3000');

// Step 5: 创建归档表结构
archiveDb.exec(`
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
`);

// Step 6: 迁移数据（批量事务）
console.log('\n=== 开始迁移数据 ===');
const migrateOdds = archiveDb.transaction((rows) => {
  const insert = archiveDb.prepare(
    `INSERT OR IGNORE INTO sporttery_odds_snapshot (match_id, match_num, date, home_team, away_team, league, play_type, snapshot_time, odds_json, trend, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    insert.run(row.match_id, row.match_num, row.date, row.home_team, row.away_team, row.league, row.play_type, row.snapshot_time, row.odds_json, row.trend, row.created_at);
  }
});

const migratePreview = archiveDb.transaction((rows) => {
  const insert = archiveDb.prepare(
    `INSERT OR IGNORE INTO sporttery_preview (match_id, match_num, date, home_team, away_team, league, feature_analysis, h2h_history, standings, recent_form, future_matches, scorers, injuries, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const row of rows) {
    insert.run(row.match_id, row.match_num, row.date, row.home_team, row.away_team, row.league, row.feature_analysis, row.h2h_history, row.standings, row.recent_form, row.future_matches, row.scorers, row.injuries, row.created_at);
  }
});

// 迁移 sporttery_odds_snapshot（分批，每批 10K 行避免内存溢出）
if (oddsCount > 0) {
  const BATCH = 10000;
  let offset = 0;
  console.log('迁移 sporttery_odds_snapshot (' + oddsCount + ' rows)...');
  while (offset < oddsCount) {
    const rows = mainDb.prepare(`SELECT match_id, match_num, date, home_team, away_team, league, play_type, snapshot_time, odds_json, trend, created_at FROM sporttery_odds_snapshot LIMIT ? OFFSET ?`).all(BATCH, offset);
    migrateOdds(rows);
    offset += BATCH;
    if (offset % 50000 === 0 || offset >= oddsCount) {
      console.log('  已迁移: ' + Math.min(offset, oddsCount) + '/' + oddsCount);
    }
  }
}

// 迁移 sporttery_preview
if (previewCount > 0) {
  console.log('迁移 sporttery_preview (' + previewCount + ' rows)...');
  const rows = mainDb.prepare(`SELECT match_id, match_num, date, home_team, away_team, league, feature_analysis, h2h_history, standings, recent_form, future_matches, scorers, injuries, created_at FROM sporttery_preview`).all();
  migratePreview(rows);
  console.log('  已迁移: ' + previewCount + '/' + previewCount);
}

// Step 7: 验证归档 DB 数据
const archiveOddsCount = archiveDb.prepare('SELECT count(*) as c FROM sporttery_odds_snapshot').get().c;
const archivePreviewCount = archiveDb.prepare('SELECT count(*) as c FROM sporttery_preview').get().c;
console.log('\n归档DB验证:');
console.log('  sporttery_odds_snapshot: ' + archiveOddsCount + ' rows (源: ' + oddsCount + ')');
console.log('  sporttery_preview: ' + archivePreviewCount + ' rows (源: ' + previewCount + ')');

if (archiveOddsCount !== oddsCount) {
  console.log('⚠ sporttery_odds_snapshot 行数不匹配！有 ' + (oddsCount - archiveOddsCount) + ' 行被 IGNORE（可能是 UNIQUE 冲突）');
}
if (archivePreviewCount !== previewCount) {
  console.log('⚠ sporttery_preview 行数不匹配！有 ' + (previewCount - archivePreviewCount) + ' 行被 IGNORE');
}

archiveDb.close();

// Step 8: 从主 DB 删除 sporttery 表数据
console.log('\n=== 从主DB删除 sporttery 表 ===');
mainDb.exec('DROP TABLE IF EXISTS sporttery_odds_snapshot');
mainDb.exec('DROP TABLE IF EXISTS sporttery_preview');
console.log('已 DROP sporttery_odds_snapshot 和 sporttery_preview');

// Step 9: VACUUM 回收空间
console.log('\n=== VACUUM 主DB ===');
mainDb.pragma('journal_mode = DELETE'); // VACUUM 需要 DELETE 模式
try {
  mainDb.exec('VACUUM');
  console.log('VACUUM 成功');
} catch (e) {
  console.log('VACUUM 失败: ' + e.message + '（不影响功能）');
}
mainDb.pragma('journal_mode = WAL');
mainDb.close();

// Step 10: 检查结果
const mainSizeAfter = fs.statSync(MAIN_DB).size;
const archiveSize = fs.existsSync(ARCHIVE_DB) ? fs.statSync(ARCHIVE_DB).size : 0;
console.log('\n=== 迁移结果 ===');
console.log('主DB大小: ' + (mainSizeBefore / 1048576).toFixed(1) + ' MB → ' + (mainSizeAfter / 1048576).toFixed(1) + ' MB (节省 ' + ((mainSizeBefore - mainSizeAfter) / 1048576).toFixed(1) + ' MB)');
console.log('归档DB大小: ' + (archiveSize / 1048576).toFixed(1) + ' MB');
console.log('节省比例: ' + ((1 - mainSizeAfter / mainSizeBefore) * 100).toFixed(1) + '%');
console.log('\n★ 完成！重启 jc-zjfa 后 getArchiveAdapter() 将自动加载归档DB');
