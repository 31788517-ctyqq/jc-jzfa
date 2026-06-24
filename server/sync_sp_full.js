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
const cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const SCHEDULE_DIR = path.join(__dirname, 'sporttery_schedule');
const ODDS_DIR = path.join(__dirname, 'sporttery_odds');
const PREVIEW_DIR = path.join(__dirname, 'sporttery_preview');
const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_HISTORY_DIR = path.join(__dirname, 'odds_history');

const SCHEDULE_URL = 'https://www.lottery.gov.cn/jc/zqszsc/';
const DETAIL_BASE = 'https://www.sporttery.cn/jc/zqdz/index.html';

[SCHEDULE_DIR, ODDS_DIR, PREVIEW_DIR, ODDS_HISTORY_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const logger = require('./logger').child('sync_sp');

function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

// ═══ 赛程抓取 (已由 midou310 替代,Sporttery 赛程页为 JS 渲染不可用纯 HTTP) ═══
async function scrapeSchedule() {
  logger.info('[sp:schedule] 赛程由 midou310 提供, 跳过 Sporttery 赛程页');
  // 检查是否已有 schedule 文件
  const files = fs
    .readdirSync(SCHEDULE_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length > 0) return { success: true, file: files[0], source: 'cache' };
  return { success: false, reason: 'handled_by_midou' };
}

// ═══ 详情抓取：赔率(showType=3) + 前瞻(showType=2) (纯 HTTP) ═══
const https = require('https');

function httpGet(url, referer) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0' } };
    if (referer) opts.headers.Referer = referer;
    https
      .get(url, opts, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => resolve(data));
      })
      .on('error', reject);
  });
}

// 从已有 odds 文件构建 matchNum → mid 映射
function buildNumToMid() {
  const map = {};
  try {
    const files = fs.readdirSync(ODDS_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const mid = f.replace('.json', '');
      try {
        const d = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf8'));
        const num = _extractMatchNum(d.matchNum || d._match_num || '');
        if (num && !map[num]) map[num] = mid;
      } catch (e) {}
    }
  } catch (e) {}
  return map;
}

// 从 HTML 页面解析赔率表格
function parseOddsHtml(html) {
  const result = {};
  // matchNum: 第一个 "周Xnnn" 模式
  const numMatch = html.match(/周[一二三四五六日]\d{3}/);
  result.matchNum = numMatch ? numMatch[0] : '';

  // matchInfo: 日期行
  const infoMatch = html.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
  result.matchInfo = infoMatch ? infoMatch[1] : '';

  // score: num 标签中的数字
  const scoreMatch = html.match(/<span[^>]*class="[^"]*num[^"]*"[^>]*>(\d+)[:\uFF1A](\d+)</);
  result.score = scoreMatch ? scoreMatch[1] + ':' + scoreMatch[2] : '';

  // home/away: u-middleLf/u-middleRt 中的 a 标签文字
  const homeMatch = html.match(/u-middleLf[^>]*>[\s\S]*?<a[^>]*>([^<]+)</);
  result.home = homeMatch ? homeMatch[1].trim() : '';
  const awayMatch = html.match(/u-middleRt[^>]*>[\s\S]*?<a[^>]*>([^<]+)</);
  result.away = awayMatch ? awayMatch[1].trim() : '';

  // handicaps
  result.handicaps = [];
  const hcpRe = /u-handicap[^>]*>([^<]+)</g;
  let hm;
  while ((hm = hcpRe.exec(html)) !== null) result.handicaps.push(hm[1].trim());

  // tables
  const allTables = [];
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rm;
    while ((rm = rowRe.exec(tm[1])) !== null) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cm;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        let txt = cm[1].replace(/<[^>]+>/g, '').trim();
        // trend icons
        if (cm[1].indexOf('icon_sjt') >= 0) txt += ' \u2191';
        else if (cm[1].indexOf('icon_xjt') >= 0) txt += ' \u2193';
        cells.push(txt);
      }
      if (cells.length >= 2) rows.push(cells);
    }
    if (rows.length > 0) allTables.push(rows);
  }
  result.tables = allTables;

  // rawText
  result.rawText = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .substring(0, 3000);

  return result;
}

async function scrapeDetails(opts) {
  opts = opts || {};
  const matchNumsStr = opts.matchNumsStr || '';
  const forceSnapshot = !!opts.forceSnapshot;
  const filterNums = matchNumsStr
    ? new Set(
        matchNumsStr
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
      )
    : null;

  logger.info('[sp:details] 抓取详情(赔率+前瞻,纯HTTP)...');

  try {
    // Step 1: 从 data.json 获取今天需要抓取的比赛，再通过已有映射找到 mid
    let dataJson = {};
    try {
      dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {}

    const numToMid = buildNumToMid();
    const today = fmtLocal(new Date());
    const targets = [];

    if (filterNums) {
      for (const num of filterNums) {
        const mid = numToMid[num];
        if (mid) targets.push({ mid, matchNum: num });
        else logger.warn('[sp:details] 未找到 mid 映射: ' + num);
      }
    } else {
      // 从 data.json 找今天比赛，匹配 Sporttery mid
      Object.values(dataJson.m || {}).forEach((m) => {
        if (!m || !m.num) return;
        const dt = String(m.date || '').slice(0, 10);
        if (dt !== today) return;
        const mid = numToMid[m.num];
        if (mid) targets.push({ mid, matchNum: m.num });
      });
    }

    logger.info('[sp:details] 映射到 ' + targets.length + ' 场比赛');

    if (targets.length === 0) {
      // 如果无映射，尝试用已知 mid 范围抓取（从 data.json matchId 提取）
      Object.values(dataJson.m || {}).forEach((m) => {
        if (!m || !m.matchId) return;
        const dt = String(m.date || '').slice(0, 10);
        if (dt !== today) return;
        const mid = String(m.matchId);
        if (mid.length >= 7 && /^\d+$/.test(mid)) {
          if (!targets.find((t) => t.mid === mid)) {
            targets.push({ mid, matchNum: m.num || '' });
          }
        }
      });
      logger.info('[sp:details] fallback matchId: ' + targets.length + ' 场');
    }

    if (targets.length === 0) {
      return { success: false, reason: 'no_mid_mapping' };
    }

    // Step 2: 逐个 HTTP 抓取赔率 + 前瞻
    let savedOdds = 0;
    let savedPreview = 0;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const mid = t.mid;
      const matchNum = t.matchNum || '未知' + mid.slice(0, 4);

      // 赔率
      const oddsFile = path.join(ODDS_DIR, mid + '.json');
      const skipOdds =
        !forceSnapshot && fs.existsSync(oddsFile) && Date.now() - fs.statSync(oddsFile).mtimeMs < 6 * 3600 * 1000;

      if (!skipOdds) {
        try {
          const html = await httpGet(DETAIL_BASE + '?showType=3&mid=' + mid, 'https://www.lottery.gov.cn/');
          if (html.length > 5000) {
            const data = parseOddsHtml(html);
            if (data.tables && data.tables.length > 1) {
              data._match_num = matchNum;
              data._scraped_at = fmtLocal(new Date()) + ' ' + new Date().toTimeString().slice(0, 8);
              fs.writeFileSync(oddsFile, JSON.stringify(data, null, 2));
              savedOdds++;
            }
          }
        } catch (e) {
          logger.warn('[sp:details] 赔率 ' + mid + ' 失败: ' + e.message.slice(0, 100));
        }
      }

      // 前瞻 (showType=2) — 页面为 JS 渲染 SPA, 纯 HTTP 只能获取框架 HTML
      const previewFile = path.join(PREVIEW_DIR, mid + '.json');
      const skipPreview =
        !forceSnapshot &&
        fs.existsSync(previewFile) &&
        Date.now() - fs.statSync(previewFile).mtimeMs < 24 * 3600 * 1000;

      if (!skipPreview) {
        try {
          const html2 = await httpGet(DETAIL_BASE + '?showType=2&mid=' + mid, 'https://www.lottery.gov.cn/');
          if (html2.length > 5000) {
            // 解析表格结构（页面数据由 JS 加载，存原始表格+页面正文）
            const tables = [];
            const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
            let tm;
            while ((tm = tableRe.exec(html2)) !== null) {
              const rows = [];
              const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
              let rm;
              while ((rm = rowRe.exec(tm[1])) !== null) {
                const cells = [];
                const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
                let cm;
                while ((cm = cellRe.exec(rm[1])) !== null) {
                  cells.push(cm[1].replace(/<[^>]+>/g, '').trim());
                }
                if (cells.length >= 2) rows.push(cells);
              }
              if (rows.length > 0) tables.push(rows);
            }
            const bodyText = html2
              .replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s{2,}/g, ' ')
              .trim()
              .substring(0, 3000);
            const previewData = {
              match_id: mid,
              _note: 'JS-rendered SPA, tables are page framework',
              tables,
              bodyText,
              _scraped_at: fmtLocal(new Date()),
            };
            if (tables.length > 0 || bodyText.length > 100) {
              fs.writeFileSync(previewFile, JSON.stringify(previewData, null, 2));
              savedPreview++;
            }
          }
        } catch (e) {
          logger.warn('[sp:details] 前瞻 ' + mid + ' 失败: ' + e.message.slice(0, 100));
        }
      }

      if (i % 10 === 0 || i === targets.length - 1) {
        logger.info(
          '[sp:details] 进度 ' + (i + 1) + '/' + targets.length + ' odds=' + savedOdds + ' preview=' + savedPreview,
        );
      }

      // Rate limit
      if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }

    logger.info('[sp:details] ✓ odds=' + savedOdds + ', preview=' + savedPreview);
    return { success: true, oddsFiles: savedOdds, previewFiles: savedPreview };
  } catch (e) {
    logger.error('[sp:details] 失败: ' + (e.message || '').slice(0, 300));
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

  // ★ 日期上限过滤：只保留今天+1天的比赛，避免未来赛程污染 data.json
  const maxDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  })();
  let futureSkipped = 0;
  const filteredMatches = matches.filter((sp) => {
    if (sp.date > maxDate) {
      futureSkipped++;
      return false;
    }
    return true;
  });
  if (futureSkipped > 0) {
    logger.info(`[sp:bridge-sch] 过滤未来比赛 ${futureSkipped} 场 (日期上限: ${maxDate})`);
  }

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
  for (const sp of filteredMatches) {
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

  logger.info(
    `[sp:bridge-sch] ✓ 新增${added} 更新${updated} 过滤未来${futureSkipped} (共${matches.length}场, 写入${filteredMatches.length}场)`,
  );
  return { success: true, added, updated, futureSkipped, maxDate, total: matches.length };
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
    cp.execSync(`node "${script}"${matchArg}`, { timeout: 5 * 60 * 1000 });
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
