/**
 * server/migrate_to_db.js
 * JSON → SQLite 数据迁移脚本
 * 
 * 将 data.json / trends.json 中的历史数据导入 SQLite 数据库
 * 用法: node server/migrate_to_db.js           # 完整迁移
 *       node server/migrate_to_db.js --dry-run  # 试运行，不写入
 *       node server/migrate_to_db.js --stats    # 仅查看统计
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const database = require('./database');
const logger = require('./logger');

const DATA_PATH = path.join(__dirname, 'data.json');
const TRENDS_PATH = path.join(__dirname, 'trends.json');

const dryRun = process.argv.includes('--dry-run');
const showStats = process.argv.includes('--stats');

function fmtLocal(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

(async () => {
  console.log('═══════════════════════════════════');
  console.log('  JSON → SQLite 数据迁移');
  console.log('═══════════════════════════════════');

  // 初始化数据库
  database.initDatabase();

  if (!database.isAvailable()) {
    console.log('\n[错误] better-sqlite3 不可用，无法执行迁移');
    console.log('请先安装: npm install better-sqlite3');
    process.exit(1);
  }

  // ── 读取 JSON ──
  console.log('\n[1/3] 读取 JSON 数据...');
  let dataJson, trendsJson;

  try {
    dataJson = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    console.log('  data.json: ' + Object.keys(dataJson.m || {}).length + ' 场比赛, ' + Object.keys(dataJson.r || {}).length + ' 条推荐');
  } catch (e) {
    console.log('  [跳过] data.json 不可读: ' + e.message);
    dataJson = null;
  }

  try {
    trendsJson = JSON.parse(fs.readFileSync(TRENDS_PATH, 'utf8'));
    console.log('  trends.json: ' + Object.keys(trendsJson).length + ' 条趋势记录');
  } catch (e) {
    console.log('  [跳过] trends.json 不可读');
    trendsJson = null;
  }

  if (showStats) {
    // 仅统计
    console.log('\n📊 数据统计:');
    if (dataJson) {
      const mMap = dataJson.m || {};
      const dates = new Set();
      Object.values(mMap).forEach(m => { if (m.date) dates.add(m.date.slice(0, 10)); });
      console.log('  日期范围: ' + Math.min(...Array.from(dates)) + ' ~ ' + Math.max(...Array.from(dates)));
      const statusCounts = {};
      Object.values(mMap).forEach(m => { statusCounts[m.matchStatus] = (statusCounts[m.matchStatus] || 0) + 1; });
      Object.keys(statusCounts).forEach(s => {
        const labels = {0:'未开始',1:'进行中',2:'已结束',3:'取消',4:'延期'};
        console.log('  状态 ' + s + '(' + (labels[s] || '未知') + '): ' + statusCounts[s] + ' 场');
      });
    }
    database.closeDatabase();
    return;
  }

  // ── 迁移比赛数据 ──
  console.log('\n[2/3] 迁移比赛数据...');
  if (dataJson) {
    const mMap = dataJson.m || {};
    const matches = Object.entries(mMap).map(([matchId, m]) => ({
      matchId: String(matchId),
      num: m.num || '',
      homeName: m.homeName || '',
      visitName: m.visitName || '',
      leagueName: m.leagueName || '',
      startTime: m.startTime || '',
      matchStatus: m.matchStatus || 0,
      score: m.score || '',
      halfScore: m.halfScore || '',
      duration: m.duration || '',
      yellow: m.yellow || '',
      red: m.red || '',
      recommNum: m.recommNum || 0,
      date: (m.date || '').slice(0, 10),
      fetchDate: m.fetchDate || fmtLocal()
    })).filter(m => m.matchId && m.date);

    if (dryRun) {
      console.log('  [DRY] 将迁移 ' + matches.length + ' 场比赛');
    } else {
      database.batchUpsertMatches(matches);
      console.log('  ✅ 已迁移 ' + matches.length + ' 场比赛');
    }
  }

  // ── 迁移推荐数据 ──
  if (dataJson) {
    const rMap = dataJson.r || {};
    const recs = [];
    Object.entries(rMap).forEach(([key, items]) => {
      const matchId = key.startsWith('m_') ? key.slice(2) : key;
      if (!Array.isArray(items)) return;
      items.forEach(r => {
        if (!r || !r.type || !r.num) return;
        recs.push({
          matchId: String(matchId),
          type: r.type,
          num: r.num,
          result: r.result !== undefined ? r.result : null,
          fetchDate: r.fetchDate || fmtLocal()
        });
      });
    });

    if (dryRun) {
      console.log('  [DRY] 将迁移 ' + recs.length + ' 条推荐');
    } else {
      database.batchUpsertRecommends(recs);
      console.log('  ✅ 已迁移 ' + recs.length + ' 条推荐');
    }
  }

  // ── 迁移趋势数据（存入 recommends 表） ──
  if (trendsJson && !dryRun) {
    const trendRecs = [];
    Object.entries(trendsJson).forEach(([matchId, snapshots]) => {
      if (!Array.isArray(snapshots)) return;
      snapshots.forEach(snap => {
        const fetchDate = (snap.time || '').slice(0, 10);
        if (!fetchDate) return;
        (snap.recs || []).forEach(r => {
          if (!r.type || !r.num) return;
          trendRecs.push({
            matchId: String(matchId),
            type: r.type,
            num: r.num,
            result: r.result !== undefined ? r.result : null,
            fetchDate: fetchDate
          });
        });
      });
    });
    if (trendRecs.length > 0) {
      database.batchUpsertRecommends(trendRecs);
      console.log('  ✅ 已同步 ' + trendRecs.length + ' 条趋势推荐');
    }
  }

  // ── 完成 ──
  console.log('\n[3/3] 迁移完成');
  if (dryRun) {
    console.log('  [DRY RUN] 未实际写入，移除 --dry-run 执行正式迁移');
  } else {
    // 备份原文件
    const bak1 = DATA_PATH + '.pre_migrate_bak';
    const bak2 = TRENDS_PATH + '.pre_migrate_bak';
    try { fs.copyFileSync(DATA_PATH, bak1); console.log('  备份: ' + bak1); } catch (e) {}
    try { fs.copyFileSync(TRENDS_PATH, bak2); console.log('  备份: ' + bak2); } catch (e) {}

    // 验证
    const db = database.getDatabase();
    const matchCount = db.prepare('SELECT COUNT(*) as cnt FROM matches').get().cnt;
    const recommCount = db.prepare('SELECT COUNT(*) as cnt FROM recommends').get().cnt;
    console.log('\n📊 验证: DB 中有 ' + matchCount + ' 场比赛, ' + recommCount + ' 条推荐');
  }

  database.closeDatabase();
  console.log('\n迁移完毕。');
})().catch(e => {
  console.error('迁移异常: ' + e.message);
  try { database.closeDatabase(); } catch (_) {}
  process.exit(1);
});
