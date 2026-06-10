/**
 * sync_sp_full.js — SP官方全量数据每日抓取调度器
 *
 * 数据源:
 *   - 赛程: scrape_sporttery.py --schedule → sporttery_schedule/
 *   - 赔率+赛果: scrape_sporttery.py --today → sporttery_odds/{mid}.json
 *   - 前瞻(特征/交锋/积分/近况/射手/伤停): scrape_sporttery.py --today → sporttery_preview/{mid}.json
 *
 * 桥接输出:
 *   → data.json (赛程/比分/赛果)
 *   → odds_history/ (SPF/RQSPF赔率)
 *   → SQLite sporttery_preview table (前瞻数据)
 *
 * 调度:
 *   12:00 + 每天 → 赛程
 *   赛程获取后 → 逐场抓取详情(赔率+前瞻)
 *   抓取完成 → 自动桥接
 *
 * 用法:
 *   node server/sync_sp_full.js               # 全量: 赛程→详情→桥接
 *   node server/sync_sp_full.js --schedule     # 仅赛程
 *   node server/sync_sp_full.js --details      # 仅详情(基于已有赛程)
 *   node server/sync_sp_full.js --bridge       # 仅桥接(已有详情文件)
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

[ODDS_DIR, PREVIEW_DIR, SCHEDULE_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const logger = require('./logger').child('sync_sp');

// ═══ Step 1: 赛程抓取 ═══
function scrapeSchedule() {
  logger.info('[sp:schedule] 抓取SP官方赛程...');
  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const script = path.join(ROOT, 'scripts', 'scrape_sporttery.py');

  try {
    const result = execSync(`${pyCmd} "${script}" --schedule`, {
      cwd: ROOT,
      timeout: 120000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    logger.info('[sp:schedule] ✓ 抓取完成');

    // 读取最新 schedule 文件
    const files = fs
      .readdirSync(SCHEDULE_DIR)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    if (files.length > 0) {
      const data = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, files[0]), 'utf8'));
      const text = data.text || '';

      // 解析日期和比赛数
      const datePattern = /(周[一二三四五六日]) (\d{4}-\d{2}-\d{2}) 共(\d+)场/g;
      const dates = [];
      let m;
      while ((m = datePattern.exec(text)) !== null) {
        dates.push({ dow: m[1], date: m[2], count: parseInt(m[3]) });
      }
      logger.info(
        `[sp:schedule] 覆盖 ${dates.length} 天: ${dates
          .slice(0, 3)
          .map((d) => d.date + '(' + d.count + '场)')
          .join(', ')}...`,
      );
      return { success: true, file: files[0], dates };
    }
    return { success: false, reason: 'no_schedule_file' };
  } catch (e) {
    logger.error('[sp:schedule] 失败: ' + (e.stderr || e.message || '').slice(0, 200));
    return { success: false, reason: e.message };
  }
}

// ═══ Step 2: 详情抓取（赔率+前瞻，按日期） ═══
function scrapeDetails(dateStr, matchNumsStr) {
  logger.info(`[sp:details] 抓取详情: ${dateStr}`);
  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
  const script = path.join(ROOT, 'scripts', 'scrape_sporttery.py');

  let cmd = `${pyCmd} "${script}" --today`;
  if (matchNumsStr) {
    cmd += ` --match-nums "${matchNumsStr}"`;
  }

  try {
    const result = execSync(cmd, {
      cwd: ROOT,
      timeout: 600000, // 10 minutes for all matches
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    logger.info('[sp:details] ✓ 抓取完成');

    // 统计产出
    const oddsFiles = fs.readdirSync(ODDS_DIR).filter((f) => f.endsWith('.json')).length;
    const previewFiles = fs.readdirSync(PREVIEW_DIR).filter((f) => f.endsWith('.json')).length;
    logger.info(`[sp:details] 赔率文件: ${oddsFiles}, 前瞻文件: ${previewFiles}`);
    return { success: true, oddsFiles, previewFiles };
  } catch (e) {
    logger.error('[sp:details] 失败: ' + (e.stderr || e.message || '').slice(0, 300));
    return { success: false, reason: e.message };
  }
}

// ═══ Step 3: 桥接赛程到 data.json ═══
function bridgeScheduleToData() {
  logger.info('[sp:bridge-sch] 桥接赛程到 data.json...');

  // 读取最新 schedule
  const files = fs
    .readdirSync(SCHEDULE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return { success: false, reason: 'no_schedule' };

  const scheduleData = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, files[0]), 'utf8'));
  const text = scheduleData.text || '';

  // 解析比赛
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

  // 合并到 data.json
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  if (!data.m) data.m = {};

  const numIndex = {};
  Object.entries(data.m).forEach(([k, v]) => {
    if (v && v.num) numIndex[v.num] = k;
  });

  let added = 0,
    updated = 0;
  for (const sp of matches) {
    const existingKey = numIndex[sp.matchNum];
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
    } else {
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
  }

  // 原子写入
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA_FILE);

  logger.info(`[sp:bridge-sch] ✓ 新增${added} 更新${updated} (共${matches.length}场)`);
  return { success: true, added, updated, total: matches.length };
}

// ═══ Step 4: 桥接赔率+赛果到 odds_history ═══
function bridgeOddsToHistory() {
  logger.info('[sp:bridge-odds] 桥接赔率到 odds_history...');

  const oddsFiles = fs.readdirSync(ODDS_DIR).filter((f) => f.startsWith('20') && f.endsWith('.json'));

  let oddsWritten = 0,
    resultsFixed = 0;

  for (const fname of oddsFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, fname), 'utf8'));
      const matchNumRaw = data.matchNum || '';
      const matchNum = (matchNumRaw.match(/(周[一二三四五六日]\d{3})/) || [''])[1];
      const matchInfo = data.matchInfo || '';
      const dateMatch = matchInfo.match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : '';

      if (!date || !matchNum) continue;

      const oddsFile = path.join(ODDS_HISTORY_DIR, date + '.json');
      let existing = {};
      try {
        if (fs.existsSync(oddsFile)) existing = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
      } catch (e) {}
      if (!existing.odds) existing.odds = {};

      // 不覆盖已有数据
      if (!existing.odds[matchNum]) {
        // 从 tables 提取 SPF 赔率
        const tables = data.tables || [];
        let spf = {},
          handicap = null;

        for (const table of tables) {
          if (!Array.isArray(table) || table.length < 2) continue;
          const header = (table[0] || []).join(' ');

          if (header.includes('胜') && header.includes('平') && header.includes('负') && !header.includes('让球')) {
            // SPF table - get last row
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
            handicap = parseInt((header.match(/[+-]?\d+/) || [''])[0]);
          }
        }

        if (Object.keys(spf).length > 0) {
          existing.odds[matchNum] = {
            homeName: data.home || '',
            visitName: data.away || '',
            spf,
            handicap,
          };
          oddsWritten++;
        }
      }

      // 赛果回填
      const lottery = data.lotteryResult;
      if (lottery && lottery['胜平负'] && lottery['比分']) {
        // Find match in data.json
        try {
          let dataJson = {};
          if (fs.existsSync(DATA_FILE)) dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
          for (const [k, m] of Object.entries(dataJson.m || {})) {
            if (m && m.num === matchNum && m.date && m.date.slice(0, 10) === date) {
              if (!m.score || m.score === '-:-' || m.score === '') {
                m.score = (lottery['比分'].outcome || '').replace(':', '-');
                m.matchStatus = 2;
                resultsFixed++;
                fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(dataJson));
                fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
              }
              break;
            }
          }
        } catch (e) {}
      }

      fs.writeFileSync(oddsFile, JSON.stringify({ date, odds: existing.odds }));
    } catch (e) {}
  }

  logger.info(`[sp:bridge-odds] ✓ 赔率${oddsWritten} 赛果${resultsFixed}`);
  return { oddsWritten, resultsFixed };
}

// ═══ Step 5: 桥接前瞻数据 ═══
function bridgePreviewToDB() {
  logger.info('[sp:bridge-prev] 桥接前瞻数据...');

  const previewFiles = fs.readdirSync(PREVIEW_DIR).filter((f) => f.startsWith('20') && f.endsWith('.json'));

  let previewCount = 0;
  const db = require('./database');

  for (const fname of previewFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PREVIEW_DIR, fname), 'utf8'));
      const matchId = fname.replace('.json', '');

      if (!data.featureAnalysis && !data.h2h && !data.standings) continue;

      const adp = db.getAdapter();
      if (adp) {
        adp.execRun(
          `INSERT OR REPLACE INTO sporttery_preview 
           (match_id, feature_analysis, h2h_history, standings, recent_form, future_matches, scorers, injuries)
           VALUES (?,?,?,?,?,?,?,?)`,
          [
            matchId,
            JSON.stringify(data.featureAnalysis || null),
            JSON.stringify(data.h2h || null),
            JSON.stringify(data.standings || null),
            JSON.stringify(data.recentForm || null),
            JSON.stringify(data.futureMatches || null),
            JSON.stringify(data.scorers || null),
            JSON.stringify(data.injuries || null),
          ],
        );
        previewCount++;
      }
    } catch (e) {}
  }

  logger.info(`[sp:bridge-prev] ✓ ${previewCount} 场前瞻入库`);
  return { previewCount };
}

// ═══ 主流程: 全量 ═══
async function main() {
  const mode = process.argv.includes('--schedule')
    ? 'schedule'
    : process.argv.includes('--details')
      ? 'details'
      : process.argv.includes('--bridge')
        ? 'bridge'
        : 'full';

  logger.info('═════════════════════════════');
  logger.info('  SP全量数据同步: ' + mode);
  logger.info('═════════════════════════════');

  if (mode === 'schedule' || mode === 'full') {
    const schResult = scrapeSchedule();
    if (schResult.success) {
      bridgeScheduleToData();
    }
  }

  if (mode === 'details' || mode === 'full') {
    const today = new Date().toISOString().slice(0, 10);
    scrapeDetails(today);
  }

  if (mode === 'bridge' || mode === 'full') {
    bridgeOddsToHistory();
    try {
      bridgePreviewToDB();
    } catch (e) {
      logger.info('[sp:bridge-prev] 跳过: ' + e.message);
    }
  }

  logger.info('[sp] 同步完成');
}

module.exports = { scrapeSchedule, scrapeDetails, bridgeScheduleToData, bridgeOddsToHistory, main };

if (require.main === module) {
  main().catch((e) => {
    logger.error('FATAL: ' + e.message);
    process.exit(1);
  });
}
