#!/usr/bin/env node
/**
 * scripts/migrate_odds_to_db.js
 * odds_history JSON → odds_history_v2 SQLite 表迁移
 *
 * 用法: node scripts/migrate_odds_to_db.js [--dry] [--date 2026-06-02]
 */
const fs = require('fs');
const path = require('path');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const database = require('../server/database');

function log(msg) {
  console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry');
  const dateFilter = args.includes('--date') ? args[args.indexOf('--date') + 1] : null;

  log('=== odds_history → odds_history_v2 迁移 ===');
  if (dryRun) log('DRY RUN - 不写入数据');

  // 初始化数据库
  database.initDatabase();
  const start = Date.now();
  while (!database.isAvailable() && Date.now() - start < 15000) {
    /* wait for sql.js async */
  }
  if (!database.isAvailable()) {
    log('数据库不可用');
    process.exit(1);
  }
  const adp = database.getAdapter();
  if (!adp) {
    log('getAdapter 返回 null');
    process.exit(1);
  }

  // 列出所有 JSON 文件
  const files = fs
    .readdirSync(ODDS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'batch_report.json')
    .sort();
  log('找到 ' + files.length + ' 个 JSON 文件');

  let totalMatches = 0,
    totalRecords = 0,
    skipped = 0,
    errors = 0;
  const playTypes = ['spf', 'rqspf', 'halfFull', 'totalGoals', 'scores'];

  for (const filename of files) {
    const dateStr = filename.replace('.json', '');
    if (dateFilter && dateStr !== dateFilter) continue;

    try {
      const filePath = path.join(ODDS_DIR, filename);
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const odds = raw.odds || {};
      const matchNums = Object.keys(odds);

      if (matchNums.length === 0) {
        log(filename + ': 无数据');
        continue;
      }

      for (const matchNum of matchNums) {
        const entry = odds[matchNum];
        if (!entry || !entry.num) continue;
        totalMatches++;

        for (const pt of playTypes) {
          const playData = entry[pt];
          if (!playData) continue;

          const oddsJson = JSON.stringify(playData);
          const record = {
            match_num: entry.num || matchNum,
            date: dateStr,
            fetch_date: dateStr,
            fetch_time: '00:00',
            play_type: pt,
            odds_json: oddsJson,
            home_name: entry.homeName || null,
            visit_name: entry.visitName || null,
            handicap: entry.handicap || null,
          };

          if (!dryRun) {
            try {
              adp.execRun(
                `INSERT OR IGNORE INTO odds_history_v2
                 (match_num, date, fetch_date, fetch_time, play_type, odds_json, home_name, visit_name, handicap)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                record.match_num,
                record.date,
                record.fetch_date,
                record.fetch_time,
                record.play_type,
                record.odds_json,
                record.home_name,
                record.visit_name,
                record.handicap,
              );
              totalRecords++;
            } catch (e) {
              if (e.message && e.message.includes('UNIQUE')) {
                skipped++;
              } else {
                errors++;
                console.error('Insert error:', e.message.slice(0, 100));
              }
            }
          } else {
            totalRecords++;
          }
        }
      }
      log(filename + ': ' + matchNums.length + ' matches');
    } catch (e) {
      errors++;
      console.error(filename + ' parse error:', e.message);
    }
  }

  log('---');
  log(
    '完成: ' + totalRecords + ' records, ' + totalMatches + ' matches, ' + skipped + ' skipped, ' + errors + ' errors',
  );

  // 验证
  if (!dryRun && adp) {
    const count = adp.execOne('SELECT COUNT(*) as cnt FROM odds_history_v2');
    log('odds_history_v2 表记录数: ' + (count ? count.cnt : 0));
  }

  if (database.closeDatabase) database.closeDatabase();
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
