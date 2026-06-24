/**
 * bridge_sporttery_to_odds.js
 * 将 scrape_sporttery.py 抓取的数据接入 SQLite，打通消费链路
 *
 * 数据源:
 *   server/sporttery_odds/{matchId}.json    → sporttery_odds_snapshot 表
 *   server/sporttery_preview/{matchId}.json → sporttery_preview 表
 *
 * 用法:
 *   node scripts/bridge_sporttery_to_odds.js          (全量迁移)
 *   node scripts/bridge_sporttery_to_odds.js --dry    (预览)
 *   node scripts/bridge_sporttery_to_odds.js --match 1022750  (单场预览)
 */

const fs = require('fs');
const path = require('path');

// 兼容本地(scripts/../server/sporttery_odds)和服务器(scripts/../sporttery_odds)两种目录结构
const ODDS_DIR = (function () {
  const serverPath = path.join(__dirname, '..', 'server', 'sporttery_odds');
  const directPath = path.join(__dirname, '..', 'sporttery_odds');
  if (fs.existsSync(directPath)) return directPath;
  return serverPath;
})();
const PREVIEW_DIR = (function () {
  const serverPath = path.join(__dirname, '..', 'server', 'sporttery_preview');
  const directPath = path.join(__dirname, '..', 'sporttery_preview');
  if (fs.existsSync(directPath)) return directPath;
  return serverPath;
})();
const DRY_RUN = process.argv.includes('--dry');
const SINGLE_MATCH = process.argv.includes('--match') ? process.argv[process.argv.indexOf('--match') + 1] || '' : '';
// 兼容本地(scripts/)和服务器(/root/server/scripts/)两种路径
let database;
try {
  database = require('../server/database');
} catch (e) {
  database = require('../database');
}

// ★ 初始化数据库（better-sqlite3 同步 / sql.js 异步）
// ★ P1: sporttery 表写入归档 DB，避免与 jc-zjfa 主进程的 SQLITE_BUSY 锁冲突
function initDb() {
  return new Promise(function (resolve) {
    database.initDatabase();
    database.initArchiveDatabase(); // ★ P1: 初始化归档 DB
    if (database.isAvailable()) {
      // ★ P1: sporttery 写入走归档 DB
      resolve(database.getArchiveAdapter());
      return;
    }
    // sql.js 异步初始化
    let attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (database.isAvailable()) {
        clearInterval(timer);
        resolve(database.getArchiveAdapter()); // ★ P1: sporttery 写入走归档 DB
      } else if (attempts > 30) {
        clearInterval(timer);
        resolve(null);
      }
    }, 200);
  });
}

// ═══ 工具 ═══
function extractMatchNum(raw) {
  if (!raw) return '';
  // "周一002 英冠>" → "周一002"
  const m = String(raw).match(/(周[一二三四五六日]\d{3})/);
  return m ? m[1] : '';
}

function extractLeague(raw) {
  if (!raw) return '';
  const m = String(raw).match(/>\s*$/);
  if (m) {
    const before = String(raw).replace(/>\s*$/, '');
    const parts = before.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || '';
  }
  const parts = String(raw).split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function extractDate(raw) {
  if (!raw) return '';
  const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

// ═══ 赔率时间序列解析 ═══
const PLAY_TABLE_MAP = [
  { index: 1, playType: 'rqspf', headerPattern: ['胜', '平', '负'] },
  { index: 3, playType: 'jqs', headerPattern: ['0', '1', '2'] },
  { index: 4, playType: 'bqc', headerPattern: ['胜胜', '胜平', '胜负'] },
];

function extractHandicap(headerRow) {
  // 从表头提取让球数，如 "让球\n\n-2\n\n彩果:" → -2
  if (!headerRow || !Array.isArray(headerRow)) return null;
  for (let i = 0; i < headerRow.length; i++) {
    const cell = String(headerRow[i] || '');
    const m = cell.match(/([+-]?\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function parseOddsSnapshots(matchId, matchNum, date, home, away, league, data) {
  const tables = data.tables || [];
  const results = [];

  for (const cfg of PLAY_TABLE_MAP) {
    const table = tables[cfg.index];
    if (!table || !Array.isArray(table) || table.length < 2) continue;

    // Find header row (contains the play type labels)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(5, table.length); i++) {
      const row = table[i];
      if (!Array.isArray(row)) continue;
      const allMatch = cfg.headerPattern.every(function (pat) {
        return row.some(function (cell) {
          return String(cell).trim() === pat;
        });
      });
      if (allMatch) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const header = table[headerIdx];
    // Find column indices: header columns after "发布时间"
    const pubIdx = header.findIndex(function (c) {
      return String(c).includes('发布时间');
    });
    const dataCols = header.slice(pubIdx + 1).map(function (c) {
      return String(c).trim();
    });

    // Parse each time row
    for (let r = headerIdx + 1; r < table.length; r++) {
      const row = table[r];
      if (!Array.isArray(row) || row.length < 3) continue;

      const timeCell = String(row[0] || '')
        .replace(/\n/g, ' ')
        .trim();
      if (!timeCell.match(/\d{2}:\d{2}/)) continue;

      const snapTime = timeCell;
      const oddsData = {};
      const trends = [];

      // ★ 数据行：column 0 始终是时间戳，赔率值从 column 1 开始
      const rowStart = 1;
      for (let c = 0; c < dataCols.length && rowStart + c < row.length; c++) {
        const rawVal = String(row[rowStart + c] || '').trim();
        const trendMatch = rawVal.match(/([↑↓])$/);
        const trend = trendMatch ? trendMatch[1] : '';
        const cleanVal = rawVal.replace(/[↑↓]$/, '').trim();
        const numVal = parseFloat(cleanVal);
        const key = dataCols[c];
        if (key && !isNaN(numVal) && numVal > 0) {
          oddsData[key] = numVal;
          if (trend) trends.push(key + ':' + trend);
        }
      }

      if (Object.keys(oddsData).length > 0) {
        // ★ 提取让球数 (rqspf 玩法)
        if (cfg.playType === 'rqspf') {
          const hcp = extractHandicap(header);
          if (hcp !== null) oddsData._handicap = hcp;
        }
        results.push({
          match_id: matchId,
          match_num: matchNum,
          date: date,
          home_team: home,
          away_team: away,
          league: league,
          play_type: cfg.playType,
          snapshot_time: snapTime,
          odds_json: JSON.stringify(oddsData),
          trend: trends.join(','),
        });
      }
    }
  }

  return results;
}

// ═══ 主流程 ═══
async function main() {
  console.log('══════════════════════════════════════');
  console.log('  sporttery 数据桥接到 SQLite');
  console.log(DRY_RUN ? '  >>> DRY RUN' : '  >>> 写入模式');
  console.log('══════════════════════════════════════\n');

  const adp = DRY_RUN ? null : await initDb();
  if (!DRY_RUN && !adp) {
    console.error('[FAIL] 数据库适配器未就绪');
    process.exit(1);
  }

  // ═══ Phase A: 赔率时间序列 ═══
  console.log('[1/3] 迁移赔率时间序列...');
  const oddsFiles = fs.readdirSync(ODDS_DIR).filter(function (f) {
    return f.endsWith('.json');
  });
  if (SINGLE_MATCH) {
    const filtered = oddsFiles.filter(function (f) {
      return f.includes(SINGLE_MATCH);
    });
    oddsFiles.length = 0;
    oddsFiles.push.apply(oddsFiles, filtered);
  }
  console.log('  文件数: ' + oddsFiles.length);

  let oddsCount = 0;
  for (let fi = 0; fi < oddsFiles.length; fi++) {
    const fname = oddsFiles[fi];
    const matchId = fname.replace('.json', '');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, fname), 'utf8'));
    } catch (e) {
      if (fi % 50 === 0) console.log('  [SKIP] ' + fname + ': 解析失败');
      continue;
    }

    const matchNum = extractMatchNum(data.matchNum);
    const date = extractDate(data.matchInfo);
    const home = data.home || '';
    const away = data.away || '';
    const league = extractLeague(data.matchNum);

    const snapshots = parseOddsSnapshots(matchId, matchNum, date, home, away, league, data);

    if (snapshots.length > 0) {
      oddsCount += snapshots.length;
      if (!DRY_RUN) {
        for (const snap of snapshots) {
          adp.execRun(
            'INSERT OR REPLACE INTO sporttery_odds_snapshot (match_id, match_num, date, home_team, away_team, league, play_type, snapshot_time, odds_json, trend) VALUES (?,?,?,?,?,?,?,?,?,?)',
            [
              snap.match_id,
              snap.match_num,
              snap.date,
              snap.home_team,
              snap.away_team,
              snap.league,
              snap.play_type,
              snap.snapshot_time,
              snap.odds_json,
              snap.trend,
            ],
          );
        }
      }
    }

    if ((fi + 1) % 30 === 0 || fi === oddsFiles.length - 1) {
      console.log('  [' + (fi + 1) + '/' + oddsFiles.length + '] 快照数: ' + oddsCount);
    }
  }

  // ═══ Phase B: 赛事前瞻 ═══
  console.log('\n[2/3] 迁移赛事前瞻...');
  const previewFiles = fs.readdirSync(PREVIEW_DIR).filter(function (f) {
    return f.endsWith('.json');
  });
  if (SINGLE_MATCH) {
    const filtered = previewFiles.filter(function (f) {
      return f.includes(SINGLE_MATCH);
    });
    previewFiles.length = 0;
    previewFiles.push.apply(previewFiles, filtered);
  }
  console.log('  文件数: ' + previewFiles.length);

  let previewCount = 0;
  for (let fi = 0; fi < previewFiles.length; fi++) {
    const fname = previewFiles[fi];
    const matchId = fname.replace('.json', '');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(PREVIEW_DIR, fname), 'utf8'));
    } catch (e) {
      continue;
    }

    if (!data.featureAnalysis && !data.h2h && !data.standings) continue;

    // 从 featureAnalysis 尝试推导 matchNum（需另查映射表）
    // 先走 odds 表反查
    let matchNum = '';
    let home = '',
      away = '',
      league = '',
      date = '';
    if (!DRY_RUN) {
      const row = adp.execOne(
        'SELECT match_num, home_team, away_team, league, date FROM sporttery_odds_snapshot WHERE match_id = ? LIMIT 1',
        matchId,
      );
      if (row) {
        matchNum = row.match_num || '';
        home = row.home_team || '';
        away = row.away_team || '';
        league = row.league || '';
        date = row.date || '';
      }
    }

    previewCount++;
    if (!DRY_RUN) {
      adp.execRun(
        'INSERT OR REPLACE INTO sporttery_preview (match_id, match_num, date, home_team, away_team, league, feature_analysis, h2h_history, standings, recent_form, future_matches, scorers, injuries) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          matchId,
          matchNum,
          date,
          home,
          away,
          league,
          JSON.stringify(data.featureAnalysis || null),
          JSON.stringify(data.h2h || null),
          JSON.stringify(data.standings || null),
          JSON.stringify(data.recentForm || null),
          JSON.stringify(data.futureMatches || null),
          JSON.stringify(data.scorers || null),
          JSON.stringify(data.injuries || null),
        ],
      );
    }

    if ((fi + 1) % 50 === 0 || fi === previewFiles.length - 1) {
      console.log('  [' + (fi + 1) + '/' + previewFiles.length + '] 前瞻数: ' + previewCount);
    }
  }

  // ═══ Phase C: 统计 ═══
  console.log('\n[3/3] 迁移结果:');
  if (DRY_RUN) {
    console.log('  赔率快照: ' + oddsCount + ' 条 (DRY RUN)');
    console.log('  赛事前瞻: ' + previewCount + ' 条 (DRY RUN)');
  } else {
    const odTotal = (adp.execOne('SELECT COUNT(*) as cnt FROM sporttery_odds_snapshot') || {}).cnt || 0;
    const pvTotal = (adp.execOne('SELECT COUNT(*) as cnt FROM sporttery_preview') || {}).cnt || 0;
    const odMatches =
      (adp.execOne('SELECT COUNT(DISTINCT match_id) as cnt FROM sporttery_odds_snapshot') || {}).cnt || 0;
    const pvMatches = (adp.execOne('SELECT COUNT(DISTINCT match_id) as cnt FROM sporttery_preview') || {}).cnt || 0;
    console.log('  sporttery_odds_snapshot: ' + odTotal + ' 条快照 (' + odMatches + ' 场比赛)');
    console.log('  sporttery_preview:      ' + pvTotal + ' 条前瞻 (' + pvMatches + ' 场比赛)');
  }
  console.log('\nDone.');
}

main().catch(function (e) {
  console.error('错误:', e);
  process.exit(1);
});
