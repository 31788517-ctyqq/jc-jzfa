/**
 * sync_sp_full.js — SP 官方数据编排器
 *
 * 支持模式：
 * - full:     赛程 + 详情(赔率+前瞻) + 桥接
 * - schedule: 仅赛程抓取并桥接到 data.json
 * - odds:     仅详情抓取(强制快照可选) + 赔率桥接
 * - preview:  仅详情抓取 + 前瞻桥接
 * - results:  仅从已抓详情回填赛果
 * - bridge:   仅执行桥接
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCHEDULE_DIR = path.join(__dirname, 'sporttery_schedule');
const ODDS_DIR = path.join(__dirname, 'sporttery_odds');
const PREVIEW_DIR = path.join(__dirname, 'sporttery_preview');
const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_HISTORY_DIR = path.join(__dirname, 'odds_history');

[SCHEDULE_DIR, ODDS_DIR, PREVIEW_DIR, ODDS_HISTORY_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const logger = require('./logger').child('sync_sp');

function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

function runCommand(cmd, timeout) {
  return execSync(cmd, {
    cwd: ROOT,
    timeout: timeout || 120000,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runPythonScraper(args, timeout) {
  const pyCmd = 'python';
  const script = path.join(ROOT, 'scripts', 'scrape_sporttery.py');
  const cmd = `${pyCmd} "${script}" ${args.join(' ')}`;
  return runCommand(cmd, timeout);
}

function scrapeSchedule() {
  logger.info('[sp:schedule] 抓取 SP 官方赛程...');
  try {
    runPythonScraper(['--schedule'], 120000);
    const files = fs
      .readdirSync(SCHEDULE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    if (!files.length) return { success: false, reason: 'no_schedule_file' };
    return { success: true, file: files[0] };
  } catch (e) {
    logger.error('[sp:schedule] 失败: ' + (e.stderr || e.message || '').slice(0, 300));
    return { success: false, reason: e.message };
  }
}

function scrapeDetails(opts) {
  opts = opts || {};
  const matchNumsStr = opts.matchNumsStr || '';
  const forceSnapshot = !!opts.forceSnapshot;

  logger.info('[sp:details] 抓取详情(赔率+前瞻)...');
  try {
    const args = ['--today'];
    if (matchNumsStr) args.push('--match-nums', `"${matchNumsStr}"`);
    if (forceSnapshot) args.push('--force');
    runPythonScraper(args, 12 * 60 * 1000);

    const oddsFiles = fs.readdirSync(ODDS_DIR).filter((f) => f.endsWith('.json')).length;
    const previewFiles = fs.readdirSync(PREVIEW_DIR).filter((f) => f.endsWith('.json')).length;
    logger.info(`[sp:details] ✓ odds=${oddsFiles}, preview=${previewFiles}`);
    return { success: true, oddsFiles, previewFiles };
  } catch (e) {
    logger.error('[sp:details] 失败: ' + (e.stderr || e.message || '').slice(0, 300));
    return { success: false, reason: e.message };
  }
}

function bridgeScheduleToData() {
  logger.info('[sp:bridge-sch] 桥接赛程到 data.json...');

  const files = fs
    .readdirSync(SCHEDULE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return { success: false, reason: 'no_schedule' };

  const scheduleData = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, files[0]), 'utf8'));
  const text = scheduleData.text || '';

  const matchPattern = /(周[一二三四五六日])(\d{3})\s+(\S+)\s+(\S+?)VS(\S+?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g;
  const matches = [];
  let m;
  while ((m = matchPattern.exec(text)) !== null) {
    const date = m[6].slice(0, 10);
    const time = m[6].slice(11);
    matches.push({
      matchNum: m[1] + m[2],
      league: m[3],
      home: m[4].trim(),
      away: m[5].trim(),
      date,
      time,
      startTime: `${date.slice(5).replace('-', '/')} ${time}`,
    });
  }

  if (matches.length === 0) return { success: false, reason: 'no_matches' };

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  if (!data.m) data.m = {};

  const numDateIndex = {};
  Object.entries(data.m).forEach(([k, v]) => {
    if (v && v.num) {
      const dt = String(v.date || '').slice(0, 10);
      numDateIndex[`${dt}|${v.num}`] = k;
    }
  });

  let added = 0;
  let updated = 0;
  for (const sp of matches) {
    const existingKey = numDateIndex[`${sp.date}|${sp.matchNum}`];
    if (existingKey) {
      const old = data.m[existingKey];
      let ch = false;
      if (!old.homeName) {
        old.homeName = sp.home;
        ch = true;
      }
      if (!old.visitName) {
        old.visitName = sp.away;
        ch = true;
      }
      if (!old.leagueName) {
        old.leagueName = sp.league;
        ch = true;
      }
      if (!old.startTime) {
        old.startTime = sp.startTime;
        ch = true;
      }
      if (ch) updated++;
      continue;
    }

    const mid = 'sp_' + sp.date.replace(/-/g, '') + '_' + sp.matchNum.replace(/周[一二三四五六日]/, '');
    data.m['m_' + mid] = {
      matchId: mid,
      num: sp.matchNum,
      homeName: sp.home,
      visitName: sp.away,
      leagueName: sp.league,
      startTime: sp.startTime,
      date: sp.date,
      matchStatus: 0,
      score: '',
      halfScore: '',
      duration: '',
      yellow: '',
      red: '',
      recommNum: 0,
      source: 'sp_schedule',
    };
    added++;
  }

  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);

  logger.info(`[sp:bridge-sch] ✓ 新增${added} 更新${updated} (共${matches.length}场)`);
  return { success: true, added, updated, total: matches.length };
}

function _extractMatchNum(raw) {
  const m = String(raw || '').match(/(周[一二三四五六日]\d{3})/);
  return m ? m[1] : '';
}

function _extractDate(raw) {
  const m = String(raw || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function bridgeOddsToHistory() {
  logger.info('[sp:bridge-odds] 桥接赔率/赛果到 odds_history + data.json...');

  const oddsFiles = fs.readdirSync(ODDS_DIR).filter((f) => f.endsWith('.json'));
  let oddsWritten = 0;
  let resultsFixed = 0;
  let dataJson = {};

  try {
    dataJson = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};
  } catch (e) {
    dataJson = {};
  }

  for (const fname of oddsFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, fname), 'utf8'));
      const matchNum = _extractMatchNum(data.matchNum);
      const date = _extractDate(data.matchInfo);
      if (!matchNum || !date) continue;

      const oddsFile = path.join(ODDS_HISTORY_DIR, date + '.json');
      let dayOdds = {};
      try {
        if (fs.existsSync(oddsFile)) dayOdds = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
      } catch (e) {}
      if (!dayOdds.odds) dayOdds.odds = {};

      if (!dayOdds.odds[matchNum]) {
        const tables = data.tables || [];
        let spf = {};
        let handicap = null;
        for (const table of tables) {
          if (!Array.isArray(table) || table.length < 2) continue;
          const header = (table[0] || []).join(' ');
          if (header.includes('胜') && header.includes('平') && header.includes('负') && !header.includes('让球')) {
            for (let r = table.length - 1; r >= 0; r--) {
              const row = table[r] || [];
              const nums = row.map((c) => parseFloat(String(c).replace(/[↑↓]/g, ''))).filter((n) => !isNaN(n) && n > 1);
              if (nums.length >= 3) {
                spf = { home: nums[nums.length - 3], draw: nums[nums.length - 2], away: nums[nums.length - 1] };
                break;
              }
            }
          }
          if (header.includes('让球')) {
            const h = (header.match(/[+-]?\d+/) || [''])[0];
            if (h) handicap = parseInt(h, 10);
          }
        }

        if (Object.keys(spf).length > 0) {
          dayOdds.odds[matchNum] = {
            homeName: data.home || '',
            visitName: data.away || '',
            spf,
            handicap,
          };
          oddsWritten++;
        }
      }

      const lottery = data.lotteryResult || {};
      const finalScore =
        lottery['比分'] && lottery['比分'].outcome ? String(lottery['比分'].outcome).replace(':', '-') : '';
      if (finalScore) {
        const mMap = dataJson.m || {};
        Object.keys(mMap).forEach((k) => {
          const m = mMap[k];
          if (!m) return;
          const dt = String(m.date || '').slice(0, 10);
          if (dt !== date || String(m.num || '') !== matchNum) return;
          if (!m.score || m.score === '-:-') {
            m.score = finalScore;
            m.matchStatus = 2;
            resultsFixed++;
          }
        });
      }

      fs.writeFileSync(oddsFile, JSON.stringify({ date, odds: dayOdds.odds }));
    } catch (e) {
      /* 单场容错 */
    }
  }

  try {
    fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(dataJson));
    fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
  } catch (e) {
    logger.warn('[sp:bridge-odds] data.json 回写失败: ' + e.message);
  }

  logger.info(`[sp:bridge-odds] ✓ odds=${oddsWritten}, result=${resultsFixed}`);
  return { success: true, oddsWritten, resultsFixed };
}

function bridgeToSQLite(matchId) {
  logger.info('[sp:bridge-db] 桥接到 SQLite...');
  try {
    const script = path.join(ROOT, 'scripts', 'bridge_sporttery_to_odds.js');
    const matchArg = matchId ? ` --match ${matchId}` : '';
    runCommand(`node "${script}"${matchArg}`, 5 * 60 * 1000);
    logger.info('[sp:bridge-db] ✓ 完成');
    return { success: true };
  } catch (e) {
    logger.warn('[sp:bridge-db] 失败: ' + (e.stderr || e.message || '').slice(0, 300));
    return { success: false, reason: e.message };
  }
}

function parseCliArgs() {
  const argv = process.argv.slice(2);
  const getArg = (name) => {
    const idx = argv.indexOf(name);
    if (idx >= 0 && idx + 1 < argv.length) return argv[idx + 1];
    return '';
  };

  let mode = 'full';
  if (argv.includes('--schedule')) mode = 'schedule';
  else if (argv.includes('--odds')) mode = 'odds';
  else if (argv.includes('--preview')) mode = 'preview';
  else if (argv.includes('--results')) mode = 'results';
  else if (argv.includes('--bridge')) mode = 'bridge';
  else if (argv.includes('--details')) mode = 'details';
  else if (argv.includes('--full')) mode = 'full';

  return {
    mode,
    date: getArg('--date') || fmtLocal(new Date()),
    matchNumsStr: getArg('--match-nums') || '',
    forceSnapshot: argv.includes('--force-snapshot') || argv.includes('--force'),
  };
}

async function main(opts) {
  const o = Object.assign(
    { mode: 'full', date: fmtLocal(new Date()), matchNumsStr: '', forceSnapshot: false },
    opts || {},
  );
  logger.info('═════════════════════════════');
  logger.info('  SP 同步模式: ' + o.mode + ' date=' + o.date + (o.forceSnapshot ? ' force=1' : ''));
  logger.info('═════════════════════════════');

  const shouldSchedule = o.mode === 'full' || o.mode === 'schedule';
  const shouldDetails = ['full', 'odds', 'preview', 'details'].includes(o.mode);
  const shouldBridgeOdds = ['full', 'odds', 'results', 'bridge', 'details'].includes(o.mode);
  const shouldBridgeDb = ['full', 'odds', 'preview', 'bridge', 'details'].includes(o.mode);

  const summary = {
    mode: o.mode,
    schedule: null,
    details: null,
    bridgeOdds: null,
    bridgeDb: null,
  };

  if (shouldSchedule) {
    summary.schedule = scrapeSchedule();
    if (summary.schedule && summary.schedule.success) {
      bridgeScheduleToData();
    }
  }

  if (shouldDetails) {
    summary.details = scrapeDetails({ matchNumsStr: o.matchNumsStr, forceSnapshot: o.forceSnapshot });
  }

  if (shouldBridgeOdds) {
    summary.bridgeOdds = bridgeOddsToHistory();
  }

  if (shouldBridgeDb) {
    summary.bridgeDb = bridgeToSQLite();
  }

  logger.info('[sp] 同步完成: ' + JSON.stringify(summary));
  return summary;
}

module.exports = {
  scrapeSchedule,
  scrapeDetails,
  bridgeScheduleToData,
  bridgeOddsToHistory,
  bridgeToSQLite,
  main,
};

if (require.main === module) {
  main(parseCliArgs()).catch((e) => {
    logger.error('FATAL: ' + e.message);
    process.exit(1);
  });
}
