/**
 * 统一数据同步守护进程
 * 替代旧的 period_daemon.js + score_daemon.js + sync_scores.js
 *
 * 调度计划:
 *   - 12:00 每天:     500.com 赔率抓取 + 赛程信息同步（各一次）
 *   - 每 1 小时:      AI 深度解析刷新（8:00~20:00）
 *   - 每 20 分钟:     专家推荐方向 + 专家数
 *   - 每 2 分钟:      实时比分（全场/半场比分、黄牌、红牌、比赛状态）
 *   - 赛后动态:       专家推荐命中结果（检测到比赛结束时自动回填）
 *   - 最后一场+3h:    全量核对收尾
 *
 * 反封策略:
 *   - 随机 UA 池轮换
 *   - 请求间隔随机抖动 (150~800ms)
 *   - Token 共享复用（统一 token_manager）
 *   - 失败重试 + 指数退避
 */
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { getWithUA, getWithRetry, jitter, sleep } = require('./http-utils');
const { getToken, refreshToken } = require('./token_manager');
const { fetchOdds: fetch500Odds, fetchShujuMap } = require('./fetch_500odds');
const { fetchShujuData } = require('./fetch_shuju');
const { mergeShuju } = require('./merge_shuju');
const { execSync } = require('child_process');
const alert = require('./alert');
const { fetchLive500 } = require('./sync_live_500');
const logger = require('./logger').child('data_sync');
const database = require('./database');
const autoHeal = require('./auto_heal');

// AI 模块（用于定时刷新）
let deepseek, doubao, aiMerger;
function loadAIModules() {
  try {
    deepseek = require('./deepseek');
  } catch (e) {}
  try {
    doubao = require('./doubao');
  } catch (e) {}
  try {
    aiMerger = require('./ai_merger');
  } catch (e) {}
}

// ═══ 配置常量 ═══
const DATA_FILE = path.join(__dirname, 'data.json');
const LIVE_FILE = path.join(__dirname, 'live_scores.json');
const TREND_FILE = path.join(__dirname, 'trends.json');
const ODDS_DIR = path.join(__dirname, 'odds_history');
const VERIFIED_RESULTS_FILE = path.join(__dirname, 'verified_results.json'); // P1 多源核实缓存

const MIDOU_BASE = 'https://midou310.com/mdsj';

// 告警防抖动：推荐同步故障至少间隔15分钟再重复告警
let _lastRecError = 0;

// 确保必要目录存在
if (!fs.existsSync(ODDS_DIR)) fs.mkdirSync(ODDS_DIR, { recursive: true });

// ═══ 工具函数 ═══
function log(msg) {
  logger.info(msg);
}

function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

function getCurrentPeriod() {
  const weekMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
  const now = new Date();
  return { date: fmtLocal(now), week: weekMap[now.getDay()] };
}

/** 原子写入：先写 .tmp 再 rename */
function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, filePath);
}

/** 数据已写入 data.json，服务端通过 mtimeMs 自动检测重载，无需额外通知 */
function notifyReload() {
  // 数据同步进程通过 atomicWrite 更新 data.json
  // Express 服务端 getDataJson() 通过 stat.mtimeMs 自动检测变更并重载
  // 无需 PM2 重启
}

/** 保存推荐趋势快照（每个 matchId 最多保留 48 条 = 16 小时） */
function saveTrendSnapshot(matchId, recs) {
  try {
    let trends = {};
    if (fs.existsSync(TREND_FILE)) trends = JSON.parse(fs.readFileSync(TREND_FILE, 'utf8'));
    const key = 'm_' + matchId;
    if (!trends[key]) trends[key] = [];
    const now = new Date();
    const t = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const snap = { t, ts: now.toISOString() };
    recs.forEach((r) => {
      snap[r.type] = r.num;
    });
    const list = trends[key];
    if (list.length > 0 && list[list.length - 1].t === t) {
      list[list.length - 1] = snap; // 同一分钟去重
    } else {
      list.push(snap);
    }
    if (list.length > 48) trends[key] = list.slice(-48);
    atomicWrite(TREND_FILE, trends);
  } catch (e) {}
}

// ═══ Task 1: 500.com 赔率抓取 + 完整性校验（每天 12:00） ═══
async function sync500Odds(dateStr) {
  log('[500odds] 开始抓取 ' + dateStr);

  const filePath = path.join(ODDS_DIR, dateStr + '.json');

  // 内容感知刷新：文件存在 + 大小 > 100B + 内容有效 → 跳过
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 100) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const oddsCount = Object.keys(existing.odds || {}).length;
        // 从 matches 表获取当天预期比赛数
        const db = database.getAdapter();
        const expectedCount = db
          ? (db.execOne('SELECT COUNT(*) as cnt FROM matches WHERE date = ?', dateStr) || {}).cnt || 0
          : 0;
        // 赔率 >= 预期比赛数 80% 且文件 1 小时内写过 → 跳过
        if (oddsCount > 0 && (!expectedCount || oddsCount >= expectedCount * 0.8)) {
          var age = Date.now() - stat.mtimeMs;
          if (age < 3600000) {
            log('[500odds] ' + dateStr + ' 有效数据 (' + oddsCount + '/' + expectedCount + '场)，跳过');
            return;
          }
        }
        log(
          '[500odds] ' +
            dateStr +
            ' 数据需刷新 (odds=' +
            oddsCount +
            '/match=' +
            expectedCount +
            ', age=' +
            Math.round(age / 60000) +
            'min)',
        );
      } catch (e) {
        log('[500odds] ' + dateStr + ' 文件损坏，重新抓取');
      }
    }
  }

  try {
    const odds = await fetch500Odds(dateStr);
    const matchNums = Object.keys(odds);

    if (matchNums.length === 0) {
      log('[500odds] ' + dateStr + ' 无赔率数据');
      fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, matches: [], empty: true }));
      return;
    }

    fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, odds }));
    log('[500odds] ' + dateStr + ' 抓取完成: ' + matchNums.length + ' 场');

    // 完整性校验
    await validate500Odds(dateStr, odds);
  } catch (e) {
    log('[500odds] ' + dateStr + ' 抓取失败: ' + e.message);
  }
}

// ═══ Task 1E: 赔率变化追踪（Delta日志，动态频率） ═══
async function sync500OddsDelta(dateStr) {
  log('[odds-delta] 开始 Delta 追踪: ' + dateStr);

  try {
    const newOdds = await fetch500Odds(dateStr);
    if (Object.keys(newOdds).length === 0) {
      log('[odds-delta] ' + dateStr + ' 无赔率数据，跳过');
      return;
    }

    const filePath = path.join(ODDS_DIR, dateStr + '.json');
    let oldOdds = {};
    let isFirstSnapshot = true;

    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
      try {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        oldOdds = raw.odds || {};
        isFirstSnapshot = false;
      } catch (e) {
        /* 解析失败则重新创建 */
      }
    }

    const { detectChanges, appendDeltaLog } = require('./core/odds-tracker');

    let changedCount = 0;
    if (!isFirstSnapshot) {
      for (const num of Object.keys(newOdds)) {
        const changes = detectChanges(oldOdds[num] || {}, newOdds[num], num);
        if (changes) {
          appendDeltaLog(ODDS_DIR, dateStr, num, changes);
          changedCount++;
        }
      }
    }

    // 更新最新快照（覆盖写）
    fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, odds: newOdds, updated: new Date().toISOString() }));

    if (isFirstSnapshot) {
      log('[odds-delta] ' + dateStr + ' 初盘基准已保存 (' + Object.keys(newOdds).length + ' 场)');
    } else if (changedCount > 0) {
      log('[odds-delta] ' + dateStr + ': ' + changedCount + ' 场赔率变化已记录');
    } else {
      log('[odds-delta] ' + dateStr + ': 无变化');
    }
  } catch (e) {
    log('[odds-delta] ' + dateStr + ' 失败: ' + e.message);
  }
}

/** 对比 data.json 中的比赛编号，检查 500.com 赔率是否完整 */
async function validate500Odds(dateStr, odds) {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const expectedNums = [];

    Object.keys(data.m || {}).forEach((k) => {
      const m = data.m[k];
      if (m && m.date && m.date.slice(0, 10) === dateStr && m.num) {
        expectedNums.push(m.num);
      }
    });

    const missing = expectedNums.filter((n) => !odds[n]);
    if (missing.length > 0) {
      log('[500odds] ⚠ 校验: 缺失 ' + missing.length + ' 场: ' + missing.join(', '));
    } else {
      log('[500odds] ✓ 校验: 全部 ' + expectedNums.length + ' 场赔率完整');
    }
  } catch (e) {
    log('[500odds] 校验失败: ' + e.message);
  }
}

/** 更新 data.json 中的比赛补充 500.com 队名（以 trade.500.com 为准） */
function enrichNamesFrom500(dateStr, odds, shujuMap) {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.m) return;
    let changed = false;
    Object.keys(data.m).forEach(function (k) {
      const match = data.m[k];
      if (!match || !match.num || (match.date || '').slice(0, 10) !== dateStr) return;
      const num = match.num;
      // 500.com odds 里有队名
      const odd = odds[num];
      if (odd && odd.homeName && odd.homeName.length > 0 && odd.homeName !== match.homeName) {
        match.homeName = odd.homeName;
        changed = true;
      }
      if (odd && odd.visitName && odd.visitName.length > 0 && odd.visitName !== match.visitName) {
        match.visitName = odd.visitName;
        changed = true;
      }
      // 注入 shuju ID
      if (shujuMap && shujuMap[num]) {
        match.shujuId = shujuMap[num].shujuId || shujuMap[num];
      }
    });
    if (changed) {
      atomicWrite(DATA_FILE, data);
      log('[500odds] 队名已从500.com修正');
    }
  } catch (e) {}
}

// ═══ Task 1B: 500.com shuju 近期战绩+攻防数据抓取（每天 12:00 跟在赔率之后） ═══
async function sync500Shuju(dateStr) {
  log('[500shuju] 开始抓取近期战绩+攻防数据: ' + dateStr);

  const shujuMapFile = path.join(__dirname, 'shuju_map_' + dateStr + '.json');
  const shujuDataFile = path.join(__dirname, 'shuju_data', 'shuju_' + dateStr + '.json');

  // 已有有效数据跳过
  if (fs.existsSync(shujuDataFile)) {
    const stat = fs.statSync(shujuDataFile);
    if (stat.size > 100) {
      log('[500shuju] ' + dateStr + ' 已有数据，跳过');
      return;
    }
  }

  try {
    // Step 1: 获取 shuju ID 映射
    let shujuMap = {};
    if (fs.existsSync(shujuMapFile)) {
      try {
        shujuMap = JSON.parse(fs.readFileSync(shujuMapFile, 'utf8'));
      } catch (e) {}
    }
    if (!shujuMap || Object.keys(shujuMap).length === 0) {
      log('[500shuju] 从 trade.500.com 获取 shuju ID 映射...');
      shujuMap = await fetchShujuMap(dateStr);
    }

    if (!shujuMap || Object.keys(shujuMap).length === 0) {
      log('[500shuju] ' + dateStr + ' 无 shuju ID 映射，可能是无比赛日或页面无分析链接');
      fs.writeFileSync(shujuMapFile, JSON.stringify({ date: dateStr, empty: true }));
      return;
    }

    // 保存映射
    fs.writeFileSync(shujuMapFile, JSON.stringify(shujuMap, null, 2));
    log('[500shuju] 映射表: ' + Object.keys(shujuMap).length + ' 个场次');

    // 将 shuju ID 注入 data.json
    try {
      const oddsFile = path.join(ODDS_DIR, dateStr + '.json');
      let oddsData = {};
      if (fs.existsSync(oddsFile)) {
        try {
          oddsData = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
        } catch (e) {}
      }
      enrichNamesFrom500(dateStr, oddsData.odds || {}, shujuMap);
    } catch (e) {}

    // Step 2: 调用 Node.js 抓取器（内置 HTML 解析，无 Python 依赖）
    try {
      const { fetchShujuData } = require('./fetch_shuju');
      await fetchShujuData(dateStr);
    } catch (e) {
      log('[500shuju] Node.js 抓取失败: ' + e.message);
    }

    // 确认文件产出
    if (fs.existsSync(shujuDataFile) && fs.statSync(shujuDataFile).size > 100) {
      log('[500shuju] ' + dateStr + ' 抓取完成 ✓');
    } else {
      log('[500shuju] ' + dateStr + ' 抓取后文件缺失或为空');
    }
  } catch (e) {
    log('[500shuju] ' + dateStr + ' 抓取失败: ' + e.message);
    // 如果是 Python 脚本失败，输出更多信息
    if (e.stderr) log('[500shuju] stderr: ' + e.stderr.toString().slice(0, 500));
  }
}

/** Task 1C: Selenium 补充抓取近6场数据 (JS 动态渲染, 速度较慢) */
async function sync500ShujuSelenium(dateStr) {
  log('[500shuju-sel] Selenium 近6场数据: ' + dateStr);

  const selFile = path.join(__dirname, 'shuju_data', 'shuju_selenium_' + dateStr + '.json');

  // 已有数据跳过
  if (fs.existsSync(selFile) && fs.statSync(selFile).size > 500) {
    log('[500shuju-sel] ' + dateStr + ' Selenium 数据已存在，跳过');
    return;
  }

  // 需要有 shuju_map 才执行
  const shujuMapFile = path.join(__dirname, 'shuju_map_' + dateStr + '.json');
  if (!fs.existsSync(shujuMapFile)) {
    log('[500shuju-sel] 无 shuju_map，跳过');
    return;
  }

  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi_selenium.py');
    // Selenium 较慢, 给 10 分钟超时
    const pyResult = execSync(pythonCmd + ' "' + scriptPath + '" ' + dateStr, {
      cwd: path.join(__dirname, '..'),
      timeout: 600000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    if (pyResult) {
      const lines = pyResult.trim().split('\n');
      log('[500shuju-sel] ' + lines[lines.length - 1] || 'done');
    }
  } catch (e) {
    log('[500shuju-sel] 失败: ' + e.message);
  }
}

/** Task 1D: liansai.500.com 积分榜抓取 (补齐赛季表) */
async function sync500ShujuStandings(dateStr) {
  log('[500shuju-standings] 积分榜抓取: ' + dateStr);

  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scriptPath = path.join(__dirname, '..', 'scripts', 'fetch_league_standings.py');
    const pyResult = execSync(pythonCmd + ' "' + scriptPath + '" ' + dateStr, {
      cwd: path.join(__dirname, '..'),
      timeout: 300000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    if (pyResult) {
      const lines = pyResult
        .trim()
        .split('\n')
        .filter((l) => l.includes('[OK]'));
      log('[500shuju-standings] ' + (lines[lines.length - 1] || 'done'));
    }
  } catch (e) {
    log('[500shuju-standings] 失败: ' + e.message);
  }
}

// ═══ Task 1F: SP官方赛程同步（作为主数据源） ═══
async function syncGovScheduleWrap() {
  log('[gov_sch] 开始SP官方赛程同步（主数据源）...');
  try {
    const { main } = require('./sync_gov_schedule');
    const result = await main();
    if (result && result.success) {
      log(
        '[gov_sch] ✓ SP赛程同步完成: +' +
          (result.added || 0) +
          '新, ' +
          (result.updated || 0) +
          '更新, ' +
          (result.skipped || 0) +
          '跳过',
      );
      return result;
    } else {
      log('[gov_sch] ✗ SP赛程同步失败: ' + (result ? result.reason : 'unknown'));
      return null;
    }
  } catch (e) {
    log('[gov_sch] SP赛程同步异常: ' + e.message);
    return null;
  }
}

// ═══ Task 2: 赛程信息同步（每天 12:00，替换旧的 footballDataList 全量更新） ═══
async function syncMatchList(dateStr) {
  // 支持指定日期，默认为当前日期
  let targetDate;
  let targetWeek;
  if (dateStr) {
    targetDate = dateStr;
    const d = new Date(dateStr + 'T00:00:00+08:00');
    const weekMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
    targetWeek = weekMap[d.getDay()];
  } else {
    const period = getCurrentPeriod();
    targetDate = period.date;
    targetWeek = period.week;
  }
  log('[match_list] 同步赛程: ' + targetDate + ' ' + targetWeek);

  try {
    const token = await getToken();
    const timestamp = new Date(targetDate + 'T00:00:00+08:00').getTime();

    const matchRes = await getWithRetry(
      MIDOU_BASE + '/score/footballDataList.do',
      { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
      { Cookie: 'token=' + token },
    );

    if (matchRes.code !== 1 || !matchRes.data) {
      log('[match_list] 获取失败: ' + (matchRes.msg || ''));
      return;
    }

    // 按竞彩期号前缀 + 日期双重过滤
    const periodMatches = (matchRes.data || []).filter((m) => {
      if (!m.num || m.num.indexOf(targetWeek) !== 0) return false;
      const bd = (m.bDate || '').slice(0, 10);
      if (bd === targetDate) return true;
      if (!bd && m.startTime && m.startTime.length >= 11) {
        const st = m.startTime.replace(/\//g, '-');
        const dt = new Date(
          new Date().getFullYear() + '-' + st.slice(0, 2) + '-' + st.slice(3, 5) + 'T' + st.slice(6, 11) + ':00+08:00',
        );
        if (!isNaN(dt.getTime())) {
          if (dt.getHours() < 9) dt.setDate(dt.getDate() - 1);
          return fmtLocal(dt) === targetDate;
        }
      }
      return false;
    });

    if (periodMatches.length === 0) {
      log('[match_list] ' + targetDate + ' 无比赛');
      return;
    }

    // 更新 data.json
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {}
    if (!data.m) data.m = {};
    if (!data.r) data.r = {};

    let newCount = 0,
      updateCount = 0;

    for (const m of periodMatches) {
      const mid = String(m.matchId || m.dataId || '');
      const mkey = 'm_' + mid;
      const md = m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10 ? m.bDate.slice(0, 10) : targetDate;

      const newMatch = {
        matchId: mid,
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
        date: md,
      };

      if (data.m[mkey]) {
        updateCount++;
      } else {
        newCount++;
      }
      data.m[mkey] = newMatch;
    }

    // 从 500.com 赔率数据补充单关标识
    try {
      const oddsFile = path.join(ODDS_DIR, targetDate + '.json');
      if (fs.existsSync(oddsFile)) {
        const oddsData = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
        const oddsMap = oddsData.odds || {};
        let singleCount = 0;
        Object.keys(data.m).forEach((k) => {
          const match = data.m[k];
          if (!match || (match.date || '').slice(0, 10) !== targetDate) return;
          const num = match.num || '';
          const fiveData = oddsMap[num];
          if (fiveData && fiveData.isSingleGame === true) {
            match.isSingleGame = true;
            singleCount++;
          }
        });
        if (singleCount > 0) log('[match_list] 单关标识更新 ' + singleCount + ' 场');
      }
    } catch (e) {}

    atomicWrite(DATA_FILE, data);
    log('[match_list] 赛程同步完成: 新增' + newCount + '场 更新' + updateCount + '场');

    // 同步到 SQLite 数据库
    if (database.isAvailable()) {
      try {
        const dbMatches = periodMatches.map((m) => ({
          matchId: String(m.matchId || m.dataId || ''),
          num: m.num || '',
          homeName: m.homeName || '',
          visitName: m.visitName || '',
          leagueName: m.leagueName || '',
          startTime: m.startTime || '',
          matchStatus: m.matchStatus || 0,
          score: m.score || '',
          halfScore: m.halfScore || '',
          recommNum: m.recommNum || 0,
          date: m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10 ? m.bDate.slice(0, 10) : targetDate,
        }));
        database.batchUpsertMatches(dbMatches);
      } catch (e) {
        log('[db] match_list sync failed: ' + e.message);
      }
    }

    notifyReload();
  } catch (e) {
    log('[match_list] 同步失败: ' + e.message);
    await refreshToken();
  }
}

// ═══ Task 3: 推荐方向同步（每 20 分钟） ═══
// ★ V9: 同时从 midou310 获取黄红牌数据（比分已改用 500.com）
async function syncMidouCards() {
  try {
    const token = await getToken();
    const matchRes = await getWithUA(
      MIDOU_BASE + '/score/footballDataList.do',
      { time: Date.now(), order: 'status desc, start_datetime asc, data_id asc' },
      { Cookie: 'token=' + token },
    );
    if (matchRes.code !== 1 || !matchRes.data) return 0;

    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      return 0;
    }
    if (!data.m) data.m = {};

    const numIndex = {};
    Object.keys(data.m).forEach((k) => {
      const m = data.m[k];
      if (m && m.num) numIndex[m.num] = true;
    });

    let cardUpdated = 0;
    (matchRes.data || []).forEach((m) => {
      const num = m.num || '';
      if (!num || !numIndex[num]) return;

      const key = Object.keys(data.m).find((k) => data.m[k] && data.m[k].num === num);
      if (!key) return;

      const old = data.m[key];
      if ((m.yellow || '') !== (old.yellow || '') || (m.red || '') !== (old.red || '')) {
        old.yellow = m.yellow || '';
        old.red = m.red || '';
        cardUpdated++;
      }
    });

    if (cardUpdated > 0) {
      atomicWrite(DATA_FILE, data);
      log('[cards] midou 黄红牌更新: ' + cardUpdated + ' 场');
    }
    return cardUpdated;
  } catch (e) {
    // 静默失败，不影响推荐同步
    return 0;
  }
}

async function syncRecommends(dateStr) {
  let targetDate;
  if (dateStr) {
    targetDate = dateStr;
  } else {
    targetDate = getCurrentPeriod().date;
  }

  try {
    const token = await getToken();

    // 加载 data.json
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {}
    if (!data.m) data.m = {};
    if (!data.r) data.r = {};

    // 筛选指定日期的比赛
    const dateMatches = [];
    Object.keys(data.m).forEach((k) => {
      const m = data.m[k];
      if (m && m.date && m.date.slice(0, 10) === targetDate) {
        dateMatches.push(m);
      }
    });

    if (dateMatches.length === 0) {
      log('[recommend] ' + targetDate + ' 无比赛');
      return;
    }

    let recChanged = 0,
      resultUpdated = 0;

    for (let i = 0; i < dateMatches.length; i++) {
      const m = dateMatches[i];
      const mid = String(m.matchId || '');

      try {
        const recRes = await getWithUA(
          MIDOU_BASE + '/score/getExpertRecommData.do',
          { dataId: mid, type: 0 },
          { Cookie: 'token=' + token },
        );

        if (recRes.code === 1 && recRes.data && recRes.data.length) {
          const recs = recRes.data
            .filter((x) => x && x.type && x.num > 0)
            .map((x) => ({
              type: x.type,
              num: x.num,
              result: x.result !== undefined ? x.result : null,
            }));

          const rk = 'm_' + mid;
          const oldRecs = data.r[rk] || [];
          const oldLen = oldRecs.length;
          const oldResultCount = oldRecs.filter((r) => r.result !== null && r.result !== 2).length;

          data.r[rk] = recs;
          if (recs.length !== oldLen) recChanged++;

          const newResultCount = recs.filter((r) => r.result !== null && r.result !== 2).length;
          if (newResultCount > oldResultCount) resultUpdated++;

          saveTrendSnapshot(mid, recs);
        }
      } catch (e) {
        log('[recommend] ' + mid + ' 获取失败: ' + e.message);
      }

      // 随机化请求间隔 150~800ms（防反爬）
      await sleep(jitter(300));
    }

    atomicWrite(DATA_FILE, data);

    // 同步推荐到 SQLite
    if (database.isAvailable() && recChanged > 0) {
      try {
        const dbRecs = [];
        Object.keys(data.r).forEach((rk) => {
          const mid = rk.startsWith('m_') ? rk.slice(2) : rk;
          (data.r[rk] || []).forEach((r) => {
            if (!r || !r.type || !r.num) return;
            dbRecs.push({
              matchId: String(mid),
              type: r.type,
              num: r.num,
              result: r.result !== undefined ? r.result : null,
              fetchDate: targetDate,
            });
          });
        });
        if (dbRecs.length > 0) {
          database.batchUpsertRecommends(dbRecs);
          log('[db] recommends synced: ' + dbRecs.length + ' records');
        }
      } catch (e) {
        log('[db] recommend sync failed: ' + e.message);
      }
    }

    // 状态汇总
    const allDone = dateMatches.every((m) => m.matchStatus >= 2);
    const summary = dateMatches
      .map(
        (m) =>
          (m.num || '') +
          ':' +
          (m.matchStatus === 0 ? '未' : m.matchStatus === 1 ? '赛中' : m.matchStatus === 2 ? '完' : '取消'),
      )
      .join(',');
    log(
      '[recommend] ' +
        dateMatches.length +
        '场 [' +
        summary +
        '] 推荐变更:' +
        recChanged +
        ' 命中更新:' +
        resultUpdated +
        (allDone ? ' ALL_DONE' : ''),
    );

    // 如果有命中结果更新，通知 simple.js 重载
    if (resultUpdated > 0 || recChanged > 0) notifyReload();
  } catch (e) {
    log('[recommend] 同步失败: ' + e.message);
    await refreshToken();
    // 连续失败告警
    if (!_lastRecError || Date.now() - _lastRecError > 900000) {
      alert.crawlFailed(e.message, 'data_sync recommend 同步连续失败');
      _lastRecError = Date.now();
    }
  }
}

// ═══ Task 4: 实时比分同步（每 2 分钟） ═══
async function syncLiveScores() {
  try {
    const token = await getToken();
    const today = new Date().toISOString().slice(0, 10);

    const matchRes = await getWithUA(
      MIDOU_BASE + '/score/footballDataList.do',
      { time: Date.now(), order: 'status desc, start_datetime asc, data_id asc' },
      { Cookie: 'token=' + token },
    );

    if (matchRes.code !== 1 || !matchRes.data) return;

    const matches = (matchRes.data || []).map((m) => {
      let md = '';
      if (m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10) md = m.bDate.slice(0, 10);
      if (!md) md = today;
      return {
        matchId: String(m.matchId || m.dataId || ''),
        num: m.num || '',
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        startTime: m.startTime || '',
        matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
        score: m.score || '',
        halfScore: m.halfScore || '',
        duration: m.duration || '',
        yellow: m.yellow || '',
        red: m.red || '',
        homeScore: m.homeScore !== undefined ? m.homeScore : -1,
        visitScore: m.visitScore !== undefined ? m.visitScore : -1,
        recommNum: m.recommNum || 0,
        date: md,
      };
    });

    // 写入 live_scores.json
    atomicWrite(LIVE_FILE, { date: today, matches, updated: new Date().toISOString() });

    // 同步到 data.json 的比分字段
    syncLiveToData(matches);

    const liveCount = matches.filter((m) => m.matchStatus === 1).length;
    const finishedCount = matches.filter((m) => m.matchStatus >= 2).length;
    log('[live_score] ' + matches.length + '场, 赛中:' + liveCount + ', 已结束:' + finishedCount);
  } catch (e) {
    // 比分同步失败不抛异常，静默跳过
  }
}

/** 把实时比分合并到 data.json（增加 num 回退匹配） */
function syncLiveToData(liveMatches) {
  try {
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      return;
    }
    if (!data.m) data.m = {};

    // 构建 num→key 的索引，用于 matchId 不匹配时的回退查找
    const numIndex = {};
    Object.keys(data.m).forEach((k) => {
      const m = data.m[k];
      if (m && m.num) numIndex[m.num] = k;
    });

    let updated = 0;
    liveMatches.forEach((lm) => {
      // 优先用 matchId 匹配
      let key = 'm_' + lm.matchId;
      let old = data.m[key];
      // 回退：用竞彩编号 num 匹配
      if (!old && lm.num && numIndex[lm.num]) {
        key = numIndex[lm.num];
        old = data.m[key];
      }
      // ★ P0 Layer 1: 统一摄入门禁（替代分散过滤规则）
      const guard = require('./core/ingestion-guard');
      var v = guard.validateLiveMatch(old, lm);
      if (v.fields === null) {
        // 门禁裁定：跳过覆盖（保留旧数据）
        if (v.flags && v.flags.suspectHalftime) {
          logger.warn('[guard] 疑似半场误判: ' + (lm.num||'') + ' dur=' + (lm.duration||'') + ' score=' + (lm.score||''));
        }
      } else {
        var mergedFields = v.fields;
        if (old.matchStatus !== mergedFields.matchStatus ||
            old.score !== mergedFields.score ||
            old.duration !== mergedFields.duration ||
            old.yellow !== mergedFields.yellow ||
            old.red !== mergedFields.red ||
            old.halfScore !== mergedFields.halfScore ||
            old.recommNum !== mergedFields.recommNum) {
          updated++;
          data.m[key] = Object.assign({}, old, mergedFields);
          if (v.flags && v.flags.suspectHalftime) {
            logger.warn('[guard] 半场误判已修正: ' + (lm.num||'') + ' ' + (lm.homeName||'') + ' vs ' + (lm.visitName||''));
          }
        }
      }
    });

    if (updated > 0) {
      atomicWrite(DATA_FILE, data);
      log('[live_score] 更新了 ' + updated + ' 场比赛数据');
    }
  } catch (e) {
    log('[live_score] 数据合并异常: ' + e.message);
  }
}

// ═══ Task 5: 赛后回填专家命中结果 (★ P1-2: 并发+失败队列) ═══
const BACKFILL_CONCURRENCY = 3; // 并发数
const BACKFILL_QUEUE_FILE = path.join(__dirname, 'backfill_queue.json');
const BACKFILL_HISTORY_FILE = path.join(__dirname, 'backfill_history.json');

/** 加载回填失败队列 */
function loadBackfillQueue() {
  try {
    if (fs.existsSync(BACKFILL_QUEUE_FILE)) {
      const q = JSON.parse(fs.readFileSync(BACKFILL_QUEUE_FILE, 'utf8'));
      return q.items || [];
    }
  } catch (e) {}
  return [];
}

/** 保存回填失败队列 */
function saveBackfillQueue(items) {
  try {
    fs.writeFileSync(
      BACKFILL_QUEUE_FILE,
      JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          items,
        },
        null,
        2,
      ),
    );
  } catch (e) {}
}

/** 记录回填历史 */
function recordBackfillHistory(mid, status, detail) {
  try {
    let history = {};
    if (fs.existsSync(BACKFILL_HISTORY_FILE)) {
      history = JSON.parse(fs.readFileSync(BACKFILL_HISTORY_FILE, 'utf8'));
    }
    history[mid] = {
      lastAttempt: new Date().toISOString(),
      status, // 'success' | 'failed' | 'retry'
      detail: detail || '',
    };
    // 只保留最近500条
    const keys = Object.keys(history);
    if (keys.length > 500) {
      const sorted = keys.sort((a, b) => history[a].lastAttempt.localeCompare(history[b].lastAttempt));
      sorted.slice(0, keys.length - 500).forEach((k) => delete history[k]);
    }
    fs.writeFileSync(BACKFILL_HISTORY_FILE, JSON.stringify(history));
  } catch (e) {}
}

/** 添加失败项到重试队列 */
function enqueueBackfillRetry(mid, retryCount, delayMinutes) {
  let items = loadBackfillQueue();
  // 去重
  items = items.filter((i) => i.mid !== mid);
  items.push({
    mid,
    retryCount: (retryCount || 0) + 1,
    nextRetryAt: new Date(Date.now() + (delayMinutes || 30) * 60 * 1000).toISOString(),
    addedAt: new Date().toISOString(),
  });
  saveBackfillQueue(items);
}

/** 处理重试队列中到期的项 */
async function processBackfillQueue() {
  const items = loadBackfillQueue();
  if (items.length === 0) return 0;

  const now = Date.now();
  const ready = items.filter((i) => new Date(i.nextRetryAt).getTime() <= now);
  const pending = items.filter((i) => new Date(i.nextRetryAt).getTime() > now);

  if (ready.length === 0) return 0;

  log('[backfill-queue] 处理重试队列: ' + ready.length + ' 项');
  let success = 0;

  try {
    const token = await getToken();
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {}

    // 并发处理
    const chunks = [];
    for (let i = 0; i < ready.length; i += BACKFILL_CONCURRENCY) {
      chunks.push(ready.slice(i, i + BACKFILL_CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((item) =>
          getWithUA(
            MIDOU_BASE + '/score/getExpertRecommData.do',
            { dataId: item.mid, type: 0 },
            { Cookie: 'token=' + token },
          )
            .then((recRes) => ({ mid: item.mid, retryCount: item.retryCount, recRes }))
            .catch((err) => ({ mid: item.mid, retryCount: item.retryCount, error: err })),
        ),
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const { mid, retryCount, recRes, error } = r.value;
        if (error || recRes.code !== 1 || !recRes.data) {
          recordBackfillHistory(mid, 'failed', error ? error.message : 'API返回空');
          // 最多重试3次
          if (retryCount < 3) {
            enqueueBackfillRetry(mid, retryCount, 30 * Math.pow(2, retryCount - 1));
          } else {
            log('[backfill-queue] ' + mid + ' 已达最大重试次数(' + retryCount + ')，放弃');
          }
          continue;
        }

        const newRecs = recRes.data
          .filter((x) => x && x.type && x.num > 0)
          .map((x) => ({ type: x.type, num: x.num, result: x.result !== undefined ? x.result : null }));

        const rk = 'm_' + mid;
        const oldStale = (data.r[rk] || []).filter((r) => r.result === null || r.result === 2).length;
        data.r[rk] = newRecs;
        const newStale = newRecs.filter((r) => r.result === null || r.result === 2).length;
        if (newStale < oldStale) {
          success++;
          recordBackfillHistory(mid, 'success', 'queue-retry, stale:' + oldStale + '→' + newStale);
          log('[backfill-queue] ' + mid + ' 重试成功 (第' + retryCount + '次)');
        } else {
          recordBackfillHistory(mid, 'failed', 'stale未减少');
          if (retryCount < 3) {
            enqueueBackfillRetry(mid, retryCount, 30 * Math.pow(2, retryCount - 1));
          }
        }
      }

      await sleep(jitter(500));
    }

    if (success > 0) {
      atomicWrite(DATA_FILE, data);
      notifyReload();
    }

    // 清理已处理的项
    const processedIds = new Set(ready.map((i) => i.mid));
    saveBackfillQueue(pending.filter((i) => !processedIds.has(i.mid)));
  } catch (e) {
    log('[backfill-queue] 队列处理异常: ' + e.message);
  }

  return success;
}

async function backfillResults(dateStr) {
  log('[backfill] 开始回填 ' + dateStr + ' 命中信息...');

  try {
    const token = await getToken();
    let data = {};
    try {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {}
    if (!data.m) data.m = {};
    if (!data.r) data.r = {};

    // ★ P1-1: 先用 autoInferStatus 修正可能的滞后状态
    autoInferStatus(dateStr);

    // ★ 第一步：先用 footballDataList API 刷新比赛状态（修正滞后的 status）
    let statusFixed = 0;
    try {
      const timestamp = new Date(dateStr + 'T00:00:00+08:00').getTime();
      const matchRes = await getWithUA(
        MIDOU_BASE + '/score/footballDataList.do',
        { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
        { Cookie: 'token=' + token },
      );
      if (matchRes.code === 1 && matchRes.data) {
        (matchRes.data || []).forEach(function (m) {
          const mid = String(m.matchId || m.dataId || '');
          const rk = 'm_' + mid;
          const old = data.m[rk] || data.m[mid];
          if (old && old.matchStatus < 2 && (m.matchStatus || 0) >= 2) {
            old.matchStatus = m.matchStatus;
            old.score = m.score || old.score;
            old.halfScore = m.halfScore || old.halfScore;
            old.duration = m.duration || old.duration;
            statusFixed++;
          }
        });
        if (statusFixed > 0) {
          log('[backfill] 修正 ' + statusFixed + ' 场比赛状态为"已结束"');
        }

        // ★ 第二遍：无条件补填缺失的半场/红黄牌/duration（不依赖status变更）
        let detailsFilled = 0;
        (matchRes.data || []).forEach(function (m) {
          const mid = String(m.matchId || m.dataId || '');
          const old = data.m['m_' + mid] || data.m[mid];
          if (!old || old.matchStatus < 2) return;
          let changed = false;
          // 半场比分
          if (!old.halfScore && m.halfScore) {
            old.halfScore = m.halfScore;
            changed = true;
          }
          // duration
          if ((!old.duration || old.duration === '未') && m.duration) {
            old.duration = m.duration;
            changed = true;
          }
          // 红黄牌
          if (!old.yellow && m.yellow) {
            old.yellow = m.yellow;
            changed = true;
          }
          if (!old.red && m.red) {
            old.red = m.red;
            changed = true;
          }
          if (changed) detailsFilled++;
        });
        if (detailsFilled > 0) {
          log('[backfill] 补填 ' + detailsFilled + ' 场比赛缺失详情(半场/红黄牌/duration)');
        }
      }
    } catch (e) {
      log('[backfill] 状态刷新失败: ' + e.message);
    }

    // 找已结束但 result 仍为 null/2 的比赛
    const needBackfill = [];
    Object.keys(data.r).forEach((rk) => {
      const mid = rk.replace('m_', '');
      const match = data.m[rk] || data.m['m_' + mid];
      if (!match || !match.date || match.date.slice(0, 10) !== dateStr) return;
      if (match.matchStatus < 2) return;
      const recs = data.r[rk] || [];
      const staleCount = recs.filter((r) => r.result === null || r.result === 2).length;
      if (staleCount > 0) {
        needBackfill.push({ mid, match, staleCount });
      }
    });

    if (needBackfill.length === 0) {
      log('[backfill] 无需回填');
      // ★ 处理重试队列中的到期项
      const queueDone = await processBackfillQueue();
      if (queueDone > 0) log('[backfill] 重试队列处理完成: ' + queueDone + ' 项');
      return;
    }

    log('[backfill] ' + needBackfill.length + ' 场比赛需要回填');

    // ★ P1-2: 并发请求（BACKFILL_CONCURRENCY路并发）
    let updated = 0;

    const chunks = [];
    for (let i = 0; i < needBackfill.length; i += BACKFILL_CONCURRENCY) {
      chunks.push(needBackfill.slice(i, i + BACKFILL_CONCURRENCY));
    }

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((item) =>
          getWithUA(
            MIDOU_BASE + '/score/getExpertRecommData.do',
            { dataId: item.mid, type: 0 },
            { Cookie: 'token=' + token },
          )
            .then((recRes) => ({ ...item, recRes }))
            .catch((err) => ({ ...item, error: err })),
        ),
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const item = r.value;

        if (item.error) {
          log('[backfill] ' + item.mid + ' 失败: ' + item.error.message);
          recordBackfillHistory(item.mid, 'failed', item.error.message);
          // 加入重试队列
          enqueueBackfillRetry(item.mid, 0, 30);
          continue;
        }

        if (item.recRes.code === 1 && item.recRes.data && item.recRes.data.length) {
          const newRecs = item.recRes.data
            .filter((x) => x && x.type && x.num > 0)
            .map((x) => ({ type: x.type, num: x.num, result: x.result !== undefined ? x.result : null }));

          const rk = 'm_' + item.mid;
          const oldStale = (data.r[rk] || []).filter((r) => r.result === null || r.result === 2).length;
          data.r[rk] = newRecs;
          const newStale = newRecs.filter((r) => r.result === null || r.result === 2).length;
          if (newStale < oldStale) {
            updated++;
            recordBackfillHistory(item.mid, 'success', 'stale:' + oldStale + '→' + newStale);
            log(
              '[backfill] ' +
                rk +
                ' (' +
                item.match.homeName +
                ' vs ' +
                item.match.visitName +
                ') stale:' +
                oldStale +
                '→' +
                newStale,
            );
          } else {
            // 结果无变化，检查是否仍为null
            if (newStale > 0) {
              const retries = (needBackfill.find((x) => x.mid === item.mid) || {})._retries || 0;
              if (retries < 2) {
                enqueueBackfillRetry(item.mid, 0, 60);
              }
            }
          }
        } else {
          // API无数据，可能是限流或比赛未开始
          recordBackfillHistory(item.mid, 'failed', 'API返回空数据');
          enqueueBackfillRetry(item.mid, 0, 30);
        }
      }

      await sleep(jitter(500)); // 批次间隔
    }

    if (updated > 0) {
      atomicWrite(DATA_FILE, data);
      notifyReload();
      log('[backfill] 完成, 更新了 ' + updated + ' 场比赛');
    } else {
      log('[backfill] 无新增命中');
    }

    // ★★ P3-1: 同步赛果到 prediction_logs（回测数据源）
    try {
      const predictionLog = require('./prediction_log');
      await predictionLog.asyncEnsure();
      let logsUpdated = 0;

      // ★ P1-1: 同步前先加载 AI 缓存和功守道缓存，补写预测数据
      let aiCache = {};
      try {
        const aiCacheFile = path.join(__dirname, 'ai_cache.json');
        if (fs.existsSync(aiCacheFile)) aiCache = JSON.parse(fs.readFileSync(aiCacheFile, 'utf8'));
      } catch (e) {}
      let gsCache = {};
      try {
        const gsCacheFile = path.join(__dirname, 'gongshoudao', 'cache.json');
        if (fs.existsSync(gsCacheFile)) {
          gsCache = JSON.parse(fs.readFileSync(gsCacheFile, 'utf8'));
          gsCache = gsCache['_global'] || {};
        }
      } catch (e) {}

      Object.keys(data.m).forEach(function (k) {
        const m = data.m[k];
        if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
        if (m.matchStatus < 2 && !(m.score && m.score.trim())) return; // 只处理已结束比赛或有比分的
        if (!m.score || !m.score.trim()) return;
        const mid = String(m.matchId || '');
        if (!mid) return;

        // ★ P1-1: 补写 AI 预测数据（如已有但未写入 prediction_logs）
        if (aiCache[mid]) {
          const entry = aiCache[mid];
          try {
            const preds = entry.content && entry.content['预测建议'] ? entry.content['预测建议'] : [];
            const aiFields = {
              date: (m.date || '').slice(0, 10),
              homeName: m.homeName || '',
              visitName: m.visitName || '',
              leagueName: m.leagueName || '',
              matchNum: m.num || '',
              confidence: entry.confidence || 0,
              content: JSON.stringify(entry.content || ''),
              handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
            };
            preds.forEach(function (p) {
              if (p['玩法'] === '胜平负') aiFields.spf = p['建议方向'];
              if (p['玩法'] === '大小球') aiFields.overunder = p['建议方向'];
              if (p['玩法'] === '比分预测') aiFields.score = p['建议方向'];
            });
            predictionLog.upsertAI(mid, aiFields);
          } catch (e) {}
        }

        // ★ P1-1: 补写 GS 预测数据（如已有但未通过 computeAll 写入）
        const gsKey = k.replace(/^m_/, '');
        const gs = gsCache[mid] || gsCache['m_' + mid] || gsCache[gsKey];
        if (gs && gs.scores) {
          try {
            predictionLog.upsertGS(mid.replace(/^m_/, ''), {
              date: (m.date || '').slice(0, 10),
              homeName: m.homeName || '',
              visitName: m.visitName || '',
              leagueName: m.leagueName || '',
              matchNum: m.num || '',
              scoresJson: JSON.stringify(gs.scores),
              topScore: gs.scores && gs.scores[0] ? gs.scores[0].score : '',
              topPercent: gs.scores && gs.scores[0] ? parseFloat(gs.scores[0].percent) || 0 : 0,
              ladderLabel: gs.ladderLabel || '',
              ladderLevel: gs.ladderLevel || 0,
              handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
            });
          } catch (e) {}
        }

        const scoreStr = (m.score || '').replace('-', ':');
        const parts = scoreStr.split(':');
        const homeGoals = parseInt(parts[0]);
        const awayGoals = parseInt(parts[1]);
        if (isNaN(homeGoals) || isNaN(awayGoals)) return;
        const totalGoals = homeGoals + awayGoals;
        let actualSpf = '';
        if (homeGoals > awayGoals) actualSpf = '主胜';
        else if (homeGoals < awayGoals) actualSpf = '客胜';
        else actualSpf = '平';
        let actualOverunder = '';
        if (totalGoals > 2) actualOverunder = '大球';
        else if (totalGoals < 2) actualOverunder = '小球';
        else actualOverunder = '走';
        try {
          predictionLog.backfillResult(mid, {
            actualScore: m.score,
            homeGoals: homeGoals,
            awayGoals: awayGoals,
            actualSpf: actualSpf,
            actualOverunder: actualOverunder,
            handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
          });
          logsUpdated++;
        } catch (e2) {
          // 单条失败不影响整体
        }
      });
      if (logsUpdated > 0) {
        log('[backfill] prediction_logs 赛果同步: ' + logsUpdated + ' 场');
      }
    } catch (e) {
      log('[backfill] prediction_logs 同步异常: ' + e.message);
    }

    // ★ P2-2: 回填历史比赛详情（半场比分/红黄牌/duration）
    //   昨天及更早的比赛不会出现在今天的500live页面，需要主动补抓
    const todayStr = fmtLocal(new Date());
    if (dateStr !== todayStr) {
      try {
        log('[backfill] 尝试补抓 ' + dateStr + ' 比赛详情(半场/红黄牌)...');
        await fetchLive500(dateStr);
        log('[backfill] ' + dateStr + ' 比赛详情回填完成');
      } catch (e) {
        log('[backfill] 比赛详情回填失败: ' + e.message);
      }
    }

    // ★ 处理重试队列
    await processBackfillQueue();
  } catch (e) {
    log('[backfill] 错误: ' + e.message);
  }
}

// ═══ Task 5B: AI 深度解析定时刷新（每小时，8:00~20:00） ═══
let aiRefreshRunning = false;

async function refreshTodayAI() {
  if (aiRefreshRunning) return;
  const now = new Date();
  const hour = now.getHours();
  // 仅在 8:00~19:59 之间执行（20:00 前截止）
  if (hour < 8 || hour >= 20) return;

  aiRefreshRunning = true;
  const today = fmtLocal(now);
  log('[ai_refresh] 开始刷新 ' + today + ' AI 深度解析...');

  try {
    loadAIModules();
    if (!deepseek || !doubao || !aiMerger) {
      log('[ai_refresh] AI 模块未加载，跳过');
      aiRefreshRunning = false;
      return;
    }

    if (!fs.existsSync(DATA_FILE)) {
      aiRefreshRunning = false;
      return;
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const mMap = data.m || {};

    // 找今天比赛
    const todayMatches = [];
    Object.keys(mMap).forEach((k) => {
      const m = mMap[k];
      if (m && (m.date || '').slice(0, 10) === today) todayMatches.push(m);
    });

    if (todayMatches.length === 0) {
      log('[ai_refresh] ' + today + ' 无比赛，跳过');
      aiRefreshRunning = false;
      return;
    }

    log('[ai_refresh] 共 ' + todayMatches.length + ' 场比赛，开始逐场分析...');

    const cacheFile = path.join(__dirname, 'ai_cache.json');
    // ★ P1-1: 引入 prediction_log 用于 AI 预测持久化
    let predictionLog;
    try {
      predictionLog = require('./prediction_log');
    } catch (e) {}

    function saveAICache(mid, source, content, conf) {
      try {
        let cache = {};
        try {
          cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        } catch (e) {}
        const entry = cache[mid] || { sources: {} };
        if (!entry.sources) entry.sources = {};
        entry.sources[source] = { content, confidence: conf, generatedAt: new Date().toISOString() };
        if (entry.sources.deepseek && entry.sources.doubao) {
          let matchInfo = { matchId: mid };
          const m = mMap['m_' + mid] || mMap[mid];
          if (m)
            matchInfo = {
              matchId: mid,
              homeName: m.homeName,
              visitName: m.visitName,
              leagueName: m.leagueName,
              date: m.date,
              num: m.num,
            };
          const merged = aiMerger.mergeAnalyses(
            { content: entry.sources.deepseek.content, confidence: entry.sources.deepseek.confidence || 70 },
            { content: entry.sources.doubao.content, confidence: entry.sources.doubao.confidence || 70 },
            matchInfo,
          );
          entry.content = merged.content;
          entry.confidence = merged.confidence;
          entry.merged = true;

          // ★ P1-1: 双模型合并后写入 prediction_logs
          if (predictionLog) {
            try {
              const preds = merged.content && merged.content['预测建议'] ? merged.content['预测建议'] : [];
              const aiFields = { confidence: merged.confidence || 0, content: JSON.stringify(merged.content) };
              if (matchInfo.date) aiFields.date = matchInfo.date.slice(0, 10);
              if (matchInfo.homeName) aiFields.homeName = matchInfo.homeName;
              if (matchInfo.visitName) aiFields.visitName = matchInfo.visitName;
              if (matchInfo.leagueName) aiFields.leagueName = matchInfo.leagueName;
              if (matchInfo.num) aiFields.matchNum = matchInfo.num;
              if (matchInfo.handicap !== undefined) aiFields.handicap = matchInfo.handicap;
              else if (matchInfo.rq !== undefined) aiFields.handicap = matchInfo.rq;
              preds.forEach(function (p) {
                if (p['玩法'] === '胜平负') aiFields.spf = p['建议方向'];
                if (p['玩法'] === '大小球') aiFields.overunder = p['建议方向'];
                if (p['玩法'] === '比分预测') aiFields.score = p['建议方向'];
              });
              predictionLog.upsertAI(mid, aiFields);
            } catch (e) {
              /* 单条失败不影响整体 */
            }
          }
        } else {
          entry.content = content;
          entry.confidence = conf;
        }
        entry.updatedAt = new Date().toISOString();
        cache[mid] = entry;
        fs.writeFileSync(cacheFile, JSON.stringify(cache));
        return entry;
      } catch (e) {
        return null;
      }
    }

    for (const m of todayMatches) {
      const mid = m.matchId;
      const matchInfo = {
        matchId: mid,
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        date: m.date || '',
        num: m.num || '',
      };

      try {
        const dsR = await deepseek.generateAnalysis(matchInfo);
        const dsC = dsR && dsR.content ? dsR.content || dsR : null;
        if (dsC) saveAICache(mid, 'deepseek', dsC, dsC.confidence || 70);
      } catch (e) {
        log('[ai_refresh] DS ' + mid + ' 失败: ' + e.message.slice(0, 80));
      }

      try {
        const dbR = await doubao.generateAnalysis(matchInfo);
        const dbC = dbR && dbR.content ? dbR.content || dbR : null;
        if (dbC) saveAICache(mid, 'doubao', dbC, dbC.confidence || 70);
      } catch (e) {
        log('[ai_refresh] DB ' + mid + ' 失败: ' + e.message.slice(0, 80));
      }

      log('[ai_refresh] ' + m.num + ' ' + m.homeName + ' vs ' + m.visitName + ' 完成');
      await sleep(jitter(3000)); // 间隔 3 秒避免限流
    }

    log('[ai_refresh] ' + today + ' AI 刷新完成: ' + todayMatches.length + ' 场');
  } catch (e) {
    log('[ai_refresh] 异常: ' + e.message);
  }
  aiRefreshRunning = false;
}

// ═══ Task 6: 计算出"最后一场+3h"的时间点 ═══
function getDayEndTime(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return 0;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    let latestTime = 0;
    const year = new Date().getFullYear();

    Object.values(data.m || {}).forEach((m) => {
      if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
      if (!m.startTime) return;

      const st = m.startTime.replace(/\//g, '-');
      const dt = new Date(year + '-' + st.slice(0, 2) + '-' + st.slice(3, 5) + 'T' + st.slice(6, 11) + ':00+08:00');
      if (!isNaN(dt.getTime()) && dt.getTime() > latestTime) {
        latestTime = dt.getTime();
      }
    });

    return latestTime > 0 ? latestTime + 3 * 3600000 : 0;
  } catch (e) {
    return 0;
  }
}

/** 增量同步 prediction_logs → unified_predictions（只补新记录） */
async function incrementalSyncToUnified(adp, dateStr) {
  try {
    // 只查有赛果的记录
    const rows = adp.execAll(
      `SELECT * FROM prediction_logs
       WHERE actual_score IS NOT NULL AND actual_score != ''
       AND date = ?
       ORDER BY date, matchNum`,
      dateStr,
    );
    if (!rows || rows.length === 0) return { added: 0, skipped: 0 };

    const mapDirection = (cn) => {
      if (!cn) return null;
      // 主胜方向
      if (cn === '主胜' || cn.startsWith('主胜') || cn === '主队不败' || cn === '胜平' || cn === '胜/平双选')
        return 'home';
      // 客胜方向
      if (
        cn === '客胜' ||
        cn.startsWith('客胜') ||
        cn === '客队不败' ||
        cn === '客队胜' ||
        cn === '平负' ||
        cn.includes('客胜')
      )
        return 'away';
      // 纯平
      if (cn === '平' || cn === '平局') return 'draw';
      return null;
    };
    const scoreToDirection = (score) => {
      if (!score) return null;
      const parts = String(score).split(/[-:：]/);
      if (parts.length < 2) return null;
      const h = parseInt(parts[0]),
        a = parseInt(parts[1]);
      if (isNaN(h) || isNaN(a)) return null;
      if (h > a) return 'home';
      if (h < a) return 'away';
      return 'draw';
    };
    const mapOverUnder = (s) => {
      if (!s) return null;
      if (s.includes('大球') || s.includes('over')) return 'over';
      if (s.includes('小球') || s.includes('under')) return 'under';
      return null;
    };

    let added = 0,
      skipped = 0;
    for (const row of rows) {
      const mid = (row.matchId || '').replace(/^m_/, '');
      const date = row.date || '';
      const num = row.matchNum || '';

      // 模型1: AI预测
      const aiDir = mapDirection(row.ai_spf);
      if (aiDir) {
        const predId = `ai_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (!existing) {
          adp.execRun(
            `INSERT INTO unified_predictions
             (match_num, match_date, match_id, model_name, model_version, prediction_id,
              direction, direction_confidence, over_under, predicted_score,
              raw_output_json, consensus_tag, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            num,
            date,
            mid,
            'AI预测',
            'v1.0',
            predId,
            aiDir,
            row.ai_confidence || 50,
            mapOverUnder(row.ai_overunder),
            row.ai_score || '',
            row.ai_content || null,
            null,
            row.created_at || date,
          );
          added++;
        } else {
          skipped++;
        }
      }

      // 模型2: 功守道
      if (row.gs_top_score || row.gs_scores_json) {
        let gsDir = scoreToDirection(row.gs_top_score);
        if (!gsDir && row.gs_scores_json) {
          try {
            const sj = JSON.parse(row.gs_scores_json);
            if (Array.isArray(sj) && sj.length > 0) gsDir = scoreToDirection(sj[0].score);
          } catch (_) {}
        }
        if (gsDir) {
          const predId = `gs_${mid}_${date}`;
          const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
          if (!existing) {
            adp.execRun(
              `INSERT INTO unified_predictions
               (match_num, match_date, match_id, model_name, model_version, prediction_id,
                direction, direction_confidence, over_under, predicted_score,
                raw_output_json, consensus_tag, computed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              num,
              date,
              mid,
              '功守道',
              'v1.0',
              predId,
              gsDir,
              row.gs_top_percent || 50,
              null,
              null,
              row.gs_scores_json || null,
              row.pk_fusion_consensus || null,
              row.created_at || date,
            );
            added++;
          } else {
            skipped++;
          }
        }
      }

      // 模型3: PK评分
      const pkDir = mapDirection(row.pk_direction);
      if (pkDir) {
        const predId = `pk_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (!existing) {
          adp.execRun(
            `INSERT INTO unified_predictions
             (match_num, match_date, match_id, model_name, model_version, prediction_id,
              direction, direction_confidence, over_under, predicted_score,
              raw_output_json, consensus_tag, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            num,
            date,
            mid,
            'PK评分',
            'v1.0',
            predId,
            pkDir,
            row.pk_composite_score || 50,
            mapOverUnder(row.pk_goal_direction),
            null,
            JSON.stringify({
              composite: row.pk_composite_score,
              power: row.pk_power_score,
              goal: row.pk_goal_score,
              heat: row.pk_heat_score,
              stability: row.pk_stability_score,
              hcp: row.pk_hcp_direction,
              value: row.pk_value_score,
              ev_home: row.pk_ev_home,
              ev_draw: row.pk_ev_draw,
              ev_away: row.pk_ev_away,
            }),
            row.pk_fusion_consensus || null,
            row.created_at || date,
          );
          added++;
        } else {
          skipped++;
        }
      }
    }
    if (added > 0) log('[sync-unified] 写入 ' + added + ' 条 (跳过 ' + skipped + ')');
    return { added, skipped };
  } catch (e) {
    log('[sync-unified] 异常: ' + e.message);
    return { added: 0, skipped: 0 };
  }
}

/** 全量核对收尾：回填命中 + 赔率完整性 + 状态修正 */
async function finalCheck(dateStr) {
  log('══════ 最终核对 [' + dateStr + '] 开始 ══════');

  // 1. 回填所有命中结果（prediction_logs 写入 actual_score）
  await backfillResults(dateStr);

  // ★ V8.1: 增量同步 prediction_logs → unified_predictions（再补新记录）
  try {
    const adp = database.getAdapter();
    if (adp) {
      const syncRes = await incrementalSyncToUnified(adp, dateStr);
      if (syncRes.added > 0) log('[final] unified_predictions 增量同步: +' + syncRes.added + ' 条');
    }
  } catch (e) {
    log('[final] unified_predictions 同步跳过: ' + e.message);
  }

  // ★ 蓝图：触发 outcome 回填（prediction_outcomes 表）
  try {
    const { backfiller } = require('./core/outcome-backfill');
    const adp = database.getAdapter();
    if (adp) {
      const result = await backfiller.backfill(adp, { date: dateStr });
      log('[outcome-backfill] ' + JSON.stringify(result));
    }
  } catch (e) {
    log('[outcome-backfill] 跳过: ' + e.message);
  }

  // 2. 500 赔率完整性
  const oddsFile = path.join(ODDS_DIR, dateStr + '.json');
  if (fs.existsSync(oddsFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
      const odds = raw.odds || {};
      await validate500Odds(dateStr, odds);
    } catch (e) {
      log('[final] 赔率文件读取失败: ' + e.message);
    }
  } else {
    log('[final] 赔率数据缺失，尝试补抓...');
    await sync500Odds(dateStr);
  }

  // 3. 根据推荐 result 修正比赛状态（已完成但 status 未更新）
  try {
    let data = {};
    if (fs.existsSync(DATA_FILE)) data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (data.m) {
      let fixed = 0;
      Object.keys(data.m).forEach((k) => {
        const m = data.m[k];
        if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
        if (m.matchStatus >= 2) return;
        const recs = data.r['m_' + m.matchId] || data.r[m.matchId] || [];
        if (recs.some((r) => r.result !== null && r.result !== 2)) {
          m.matchStatus = 2;
          fixed++;
        }
      });
      if (fixed > 0) {
        atomicWrite(DATA_FILE, data);
        log('[final] 修正 ' + fixed + ' 场比赛状态为"已结束"');
      }
    }
  } catch (e) {
    log('[final] 状态修正失败: ' + e.message);
  }

  log('══════ 最终核对 [' + dateStr + '] 完成 ══════');

  // ★ 自动触发回填：补充历史缺失赔率数据
  try {
    const { exec } = require('child_process');
    log('[final] 自动触发历史数据回填...');
    exec(
      'node ' + path.join(__dirname, 'catch_up.js') + ' --date ' + dateStr + ' --odds-only --timeout 300',
      {
        timeout: 360000,
        cwd: __dirname,
      },
      (err, stdout, stderr) => {
        if (err) {
          log('[final] 回填异常: ' + (err.message || ''));
        } else {
          const lines = (stdout || '').trim().split('\n').slice(-3);
          log('[final] 回填完成: ' + lines.join(' '));
        }
      },
    );
  } catch (e) {
    log('[final] 回填启动失败: ' + e.message);
  }

  notifyReload();
}

// ═══ Task 0: 今日赛程高频检查器（多源，5分钟间隔，找到即停） ═══
let _scheduleWatcherTimer = null;
let _scheduleWatcherRunning = false;

async function runTodayScheduleCheck() {
  if (_scheduleWatcherRunning) return;
  _scheduleWatcherRunning = true;

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const hour = now.getHours();

  // 仅在 6:00~12:00 期间高频检查（太早没必要，太晚有12:00同步覆盖）
  if (hour < 6 || hour >= 12) {
    _scheduleWatcherRunning = false;
    return;
  }

  if (todayHasMatches(today)) {
    log('[sch_watcher] ✓ 今日已有 ' + countTodayMatches(today) + ' 场比赛，停止检查');
    if (_scheduleWatcherTimer) {
      clearInterval(_scheduleWatcherTimer);
      _scheduleWatcherTimer = null;
    }
    _scheduleWatcherRunning = false;
    return;
  }

  log('[sch_watcher] 检查今日赛程（多源: 500.com→SP→midou）...');
  try {
    const { checkTodaySchedule } = require('./sync_today_schedule');
    const result = await checkTodaySchedule(today);
    if (result && result.success) {
      log(
        '[sch_watcher] ✓ 赛程获取成功! 来源:' +
          result.source +
          ' 共' +
          result.matches +
          '场 新增' +
          (result.added || 0),
      );
      if (_scheduleWatcherTimer) {
        clearInterval(_scheduleWatcherTimer);
        _scheduleWatcherTimer = null;
      }
      notifyReload();
    } else {
      log('[sch_watcher] 暂未获取到赛程数据，5分钟后重试');
    }
  } catch (e) {
    log('[sch_watcher] 检查失败: ' + e.message);
  }
  _scheduleWatcherRunning = false;
}

function startTodayScheduleWatcher() {
  const now = new Date();
  const hour = now.getHours();
  const today = now.toISOString().slice(0, 10);

  // 如果已有数据或不在检查窗口，跳过
  if (todayHasMatches(today) || hour < 6 || hour >= 12) {
    log('[sch_watcher] 跳过: 已有数据=' + todayHasMatches(today) + ' 时间=' + hour + 'h');
    return;
  }

  if (_scheduleWatcherTimer) clearInterval(_scheduleWatcherTimer);

  log('[sch_watcher] 启动高频赛程检查 (每5分钟, 6:00~12:00)');

  // 立即执行一次
  runTodayScheduleCheck();

  // 每5分钟检查
  _scheduleWatcherTimer = setInterval(
    () => {
      const h = new Date().getHours();
      if (h >= 12) {
        log('[sch_watcher] 已过12:00，停止高频检查（由12:00定时任务接管）');
        clearInterval(_scheduleWatcherTimer);
        _scheduleWatcherTimer = null;
        return;
      }
      runTodayScheduleCheck();
    },
    5 * 60 * 1000,
  );
}

// 兼容旧接口
function kickEnsure() {
  runTodayScheduleCheck();
}

function todayHasMatches(dateStr) {
  return countTodayMatches(dateStr) > 0;
}

function countTodayMatches(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return 0;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let count = 0;
    Object.values(data.m || {}).forEach((m) => {
      if (m && m.date && m.date.slice(0, 10) === dateStr) count++;
    });
    return count;
  } catch (e) {
    return 0;
  }
}

/**
 * ★ P1-1: 自动推断比赛状态
 * 当比赛开赛时间+120分钟已过且score有值时，主动将status标记为2（已结束）
 * 同时通过推荐result反推：有命中结果→比赛已结束
 */
function autoInferStatus(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return 0;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.m) return 0;

    const now = Date.now();
    const year = new Date().getFullYear();
    let fixed = 0;
    let usedScoreMethod = false;

    Object.keys(data.m).forEach((k) => {
      const m = data.m[k];
      if (!m || m.matchStatus >= 2) return; // 已结束，跳过
      if (!m.date || m.date.slice(0, 10) !== dateStr) return;

      let shouldFix = false;

      // ★ 方法0: 比分格式直接检测（最可靠——有比分=比赛已结束）
      //   支持 1-0、2:1、6-9（两位数）等所有比分格式
      if (!shouldFix && m.score && /\d+[:\-]\d+/.test(String(m.score.trim()))) {
        shouldFix = true;
        usedScoreMethod = true;
      }

      // 方法1: 时间推断——开赛时间+120分钟已过 + 比分有值
      if (!shouldFix && m.startTime && m.score && m.score.trim()) {
        try {
          const raw = m.startTime.replace(/\//g, '-');
          // 兼容 "06-08 21:00" 和 "06-08T21:00" 两种格式（去掉空格再拼接）
          const clean = raw.replace(/\s+/g, '');
          const dt = new Date(
            year + '-' + clean.slice(0, 2) + '-' + clean.slice(3, 5) + 'T' + clean.slice(5, 10) + ':00+08:00',
          );
          if (!isNaN(dt.getTime())) {
            const endTime = dt.getTime() + 120 * 60 * 1000; // 开赛+120分钟
            if (now > endTime) {
              shouldFix = true;
            }
          }
        } catch (e) {}
      }

      // 方法2: 推荐result反推——有命中结果 ≠ null/2 → 比赛已结束
      if (!shouldFix && data.r) {
        const rk = 'm_' + m.matchId;
        const recs = data.r[rk] || [];
        if (recs.some((r) => r.result !== null && r.result !== 2)) {
          shouldFix = true;
        }
      }

      // 方法3: 所有比赛时间都已过去超过6小时（兜底）
      if (!shouldFix && m.startTime) {
        try {
          const raw = m.startTime.replace(/\//g, '-');
          const clean = raw.replace(/\s+/g, '');
          const dt = new Date(
            year + '-' + clean.slice(0, 2) + '-' + clean.slice(3, 5) + 'T' + clean.slice(5, 10) + ':00+08:00',
          );
          if (!isNaN(dt.getTime())) {
            if (now > dt.getTime() + 6 * 3600 * 1000) {
              shouldFix = true;
            }
          }
        } catch (e) {}
      }

      if (shouldFix) {
        m.matchStatus = 2;
        fixed++;
      }
    });

    if (fixed > 0) {
      atomicWrite(DATA_FILE, data);
      const methodTag = usedScoreMethod ? ' method:score' : '';
      log('[auto_status] ' + dateStr + ' 自动推断 ' + fixed + ' 场比赛状态为"已结束"' + methodTag);
      notifyReload();
    }
    return fixed;
  } catch (e) {
    log('[auto_status] 推断失败: ' + e.message);
    return 0;
  }
}

/** 检查指定日期是否有已结束但未回填的比赛 */
function needBackfillCheck(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let hasStale = false;
    Object.keys(data.r || {}).forEach((rk) => {
      const mid = rk.replace('m_', '');
      const match = data.m[rk] || data.m['m_' + mid];
      if (!match || !match.date || match.date.slice(0, 10) !== dateStr) return;
      if (match.matchStatus < 2) return;
      const recs = data.r[rk] || [];
      if (recs.some((r) => r.result === null || r.result === 2)) hasStale = true;
    });
    return hasStale;
  } catch (e) {
    return false;
  }
}

function getTodayStatusSummary(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return '无数据';
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let total = 0,
      status0 = 0,
      status1 = 0,
      status2 = 0,
      other = 0;
    Object.values(data.m || {}).forEach((m) => {
      if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
      total++;
      if (m.matchStatus === 0) status0++;
      else if (m.matchStatus === 1) status1++;
      else if (m.matchStatus === 2) status2++;
      else other++;
    });
    return total + '场 [未:' + status0 + ' 赛中:' + status1 + ' 完:' + status2 + (other ? ' 其他:' + other : '') + ']';
  } catch (e) {
    return '?';
  }
}

// ═══ 调度器 ═══
let currentDate = '';
let recommendRunning = false;
let liveScoreRunning = false;
let finalCheckDone = false;
let _ensureRetries = 0;

/** 计算到下一个12:00的毫秒数 */
function getNextNoonDelay() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(12, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

async function start() {
  log('════════════════════════════════════════');
  log('  统一数据同步守护进程 v3 启动');
  log('  增强: 启动重试 + num回退匹配 + 健康监控 + SQLite持久化');
  log('  数据源: midou310.com + 500.com');
  log('════════════════════════════════════════');

  // 初始化 SQLite 数据库
  database.initDatabase();
  log('[init] SQLite 数据库后端: ' + (database.isAvailable() ? '可用' : 'JSON降级模式'));

  currentDate = new Date().toISOString().slice(0, 10);
  log('[init] 当前日期: ' + currentDate + ' 数据状态: ' + getTodayStatusSummary(currentDate));

  // ═══ 首次启动：如果已过12点 或 今天无数据，立即执行赛程+赔率同步 ═══
  const now = new Date();
  const noonToday = new Date(currentDate + 'T12:00:00+08:00');
  const needSync = now >= noonToday || !todayHasMatches(currentDate);

  if (needSync) {
    if (now >= noonToday) {
      log('[init] 当前已过12:00，立即执行赛程+赔率同步');
    } else {
      log('[init] 当前' + currentDate + '缺少比赛数据，提前触发赛程同步');
    }
    try {
      // ★ P1: 先尝试 SP 官方源（主数据源，轻量 HTTP）
      await syncGovScheduleWrap();
      await sleep(jitter(2000));

      // 再尝试 midou 补充（推荐数等字段）
      await syncMatchList();
      await sleep(jitter(2000));
      await sync500Odds(currentDate);
      await sleep(jitter(2000));
      sync500Shuju(currentDate);
      sync500ShujuSelenium(currentDate);
      // 延后5分钟合并数据
      setTimeout(
        () => {
          try {
            const { mergeShuju } = require('./merge_shuju');
            mergeShuju(currentDate);
            log('[init] 数据合并完成, ' + getTodayStatusSummary(currentDate));
          } catch (e) {}
        },
        5 * 60 * 1000,
      );
    } catch (e) {
      log('[init] 初始同步失败: ' + e.message);
    }
  } else {
    log('[init] 今日数据已存在，跳过赛程同步');
  }

  // ═══ 启动后检查昨天是否需要补同步（避免重启导致跳过） ═══
  try {
    const yd = fmtLocal(new Date(Date.now() - 86400000));
    // 检查昨天是否有比赛数据，若无则补同步
    if (!todayHasMatches(yd)) {
      log('[init] ⚠️ 检测到昨天 ' + yd + ' 缺少比赛数据，启动补同步...');
      syncMatchList(yd)
        .then(() => {
          log('[init] 昨天 ' + yd + ' 赛程补同步完成');
          // 补同步后也触发回填
          if (needBackfillCheck(yd)) {
            backfillResults(yd)
              .then(() => log('[init] 昨天 ' + yd + ' 回填完成'))
              .catch((e) => log('[init] 昨天回填失败: ' + e.message));
          }
        })
        .catch((e) => log('[init] 昨天补同步失败: ' + e.message));
    } else if (needBackfillCheck(yd)) {
      log('[init] 检测到昨天 ' + yd + ' 存在未回填比赛，启动回填...');
      backfillResults(yd)
        .then(() => {
          log('[init] 昨天 ' + yd + ' 回填完成');
        })
        .catch((e) => log('[init] 昨天回填失败: ' + e.message));
    }
  } catch (e) {}

  // ═══ 启动高频赛程检查器（6:00~12:00，每5分钟多源检查） ═══
  if (!todayHasMatches(currentDate)) {
    log('[init] ⚠️ 今日' + currentDate + '仍无赛程数据');
    startTodayScheduleWatcher();
  }

  // ═══ 循环1: 每2分钟 — 实时比分 (500.com 直播页，无需认证) ═══
  async function liveScoreLoop() {
    if (liveScoreRunning) return;
    liveScoreRunning = true;
    try {
      await fetchLive500(); // ★ 500.com 直播页 (比分/半场/状态)
    } catch (e) {
      log('[live_score] 500.com 失败: ' + e.message);
    }
    liveScoreRunning = false;
    setTimeout(liveScoreLoop, 120000);
  }

  // ═══ 循环2: 每20分钟 — 推荐方向 + 最后一场+3h检测 + 状态自动推断 ═══
  async function recommendLoop() {
    if (recommendRunning) return;
    recommendRunning = true;
    try {
      await syncRecommends();

      // ★ P1-1: 每次推荐同步后自动推断比赛状态
      autoInferStatus(currentDate);

      // 检测是否到达"最后一场+3h"时间
      if (!finalCheckDone) {
        const dayEndTime = getDayEndTime(currentDate);
        if (dayEndTime > 0 && Date.now() >= dayEndTime) {
          log('[scheduler] ⏰ 最后一场+3h，触发最终核对');
          finalCheckDone = true;
          await finalCheck(currentDate);
        }
      }
    } catch (e) {
      log('[loop] 推荐同步异常: ' + e.message);
    }
    recommendRunning = false;
    setTimeout(recommendLoop, 20 * 60 * 1000);
  }

  // ═══ 每日12:00定时：赔率+赛程 ═══
  function scheduleNoon() {
    const delay = getNextNoonDelay();
    log('[scheduler] 下次12:00定时: ' + Math.round(delay / 3600000) + ' 小时后');

    setTimeout(async () => {
      const today = new Date().toISOString().slice(0, 10);

      // 日期变更重置
      if (today !== currentDate) {
        log('[scheduler] 日期变更: ' + currentDate + ' → ' + today);
        currentDate = today;
        finalCheckDone = false;
        _ensureRetries = 0; // 重置重试计数
      }

      log('[scheduler] ⏰ 12:00 定时任务触发');
      try {
        // ★ SP官方全量同步: 赛程→详情(赔率+前瞻)→桥接
        log('[scheduler] 开始SP全量数据同步...');
        try {
          const { main: spFullSync } = require('./sync_sp_full');
          spFullSync().catch((e) => log('[sp] 全量同步异常: ' + e.message));
        } catch (e) {
          log('[sp] 全量同步启动失败: ' + e.message);
        }
        await sleep(jitter(3000));

        // SP 官方源赛程同步（HTTP快速检查）
        await syncGovScheduleWrap();
        await sleep(jitter(2000));

        await syncMatchList();
        await sleep(jitter(2000));
        await sync500Odds(today);
        await sleep(jitter(2000));

        // ★ P2: 预生成 shuju 数据（纯 Node.js，不依赖 Python）
        // shuju_map → fetchShujuData → mergeShuju → shuju_merged
        log('[scheduler] 开始预生成 shuju 数据...');
        try {
          await fetchShujuMap(today); // Step 1: shuju ID 映射
          await fetchShujuData(today); // Step 2: 抓取分析数据 (JS)
          mergeShuju(today); // Step 3: 合并输出
          log('[scheduler] shuju 预生成完成: ' + today + ' → AI 深度解析数据就绪');
        } catch (e) {
          log('[scheduler] shuju 预生成失败: ' + e.message);
        }

        // 旧 Python 路径保留（如环境支持则执行）
        sync500Shuju(today);
        sync500ShujuSelenium(today);
        // 延后 5 分钟合并数据
        setTimeout(
          () => {
            log('[shuju] 开始合并静态+Selenium数据...');
            try {
              const { mergeShuju } = require('./merge_shuju');
              mergeShuju(today);
              log('[shuju] 合并完成: ' + getTodayStatusSummary(today));
            } catch (e) {
              log('[shuju] 合并失败: ' + e.message);
            }
          },
          5 * 60 * 1000,
        );
      } catch (e) {
        log('[scheduler] 12:00 任务失败: ' + e.message);
        // 失败后启动重试
        if (!todayHasMatches(today)) {
          startTodayScheduleWatcher();
        }
      }

      scheduleNoon(); // 预约明天
    }, delay);
  }

  // 启动所有循环（错峰启动，避免同时发起请求）
  setTimeout(liveScoreLoop, 5000); // 5秒后开始比分
  setTimeout(recommendLoop, 30000); // 30秒后开始推荐
  scheduleNoon(); // 计算12:00定时

  // ═══ 每小时 AI 深度解析刷新（8:00~20:00） ═══
  async function aiRefreshLoop() {
    try {
      await refreshTodayAI();
    } catch (e) {}
    setTimeout(aiRefreshLoop, 60 * 60 * 1000);
  }
  setTimeout(aiRefreshLoop, 120000); // 2分钟后开始首次，之后每小时

  // ═══ 健康监控：每分钟检查 ═══
  let _lastBackfillCheck = 0;
  let _resultVerifyDoneToday = false; // P1 每日核实防重

  // ★ P1 Layer 2: 多源赛果核实 — 每日定时触发，缓存到 verified_results.json
  async function verifyYesterdayResults() {
    var yd = fmtLocal(new Date(Date.now() - 86400000));
    log('[verifier] 开始核实昨天 ' + yd + ' 赛果...');
    try {
      var verifier = require('./core/result-verifier');
      var dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      var vr = verifier.verifyDate(yd, { midouDataJson: dataJson });

      // 读取现有缓存，合并
      var cache = {};
      try {
        if (fs.existsSync(VERIFIED_RESULTS_FILE)) {
          cache = JSON.parse(fs.readFileSync(VERIFIED_RESULTS_FILE, 'utf8'));
        }
      } catch (e) {}

      cache[yd] = {
        time: new Date().toISOString(),
        totalMatches: vr.results.length,
        results: vr.results.map(function (r) {
          return { anchor: r.anchorName, score: r.verified.score, confidence: r.verified.confidence, sources: r.verified.sourceVotes };
        }),
      };
      fs.writeFileSync(VERIFIED_RESULTS_FILE, JSON.stringify(cache, null, 2));
      log('[verifier] ✓ 核实完成: ' + yd + ' ' + vr.results.length + ' 场');
    } catch (e) {
      log('[verifier] 核实失败: ' + e.message);
    }
  }
  setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== currentDate) {
      log('[scheduler] 日期变更: ' + currentDate + ' → ' + today);
      currentDate = today;
      finalCheckDone = false;
      _ensureRetries = 0;
      if (!todayHasMatches(today)) {
        startTodayScheduleWatcher();
      }
      // 日期变更时也检查昨天回填
      const yd = fmtLocal(new Date(Date.now() - 86400000));
      if (needBackfillCheck(yd)) {
        log('[health] 日期变更，触发昨天 ' + yd + ' 回填...');
        backfillResults(yd).catch((e) => log('[health] 昨天回填失败: ' + e.message));
      }
    }
    // 每20分钟检查一次昨天回填
    if (Date.now() - _lastBackfillCheck > 1200000) {
      _lastBackfillCheck = Date.now();
      const yd = fmtLocal(new Date(Date.now() - 86400000));
      if (needBackfillCheck(yd)) {
        log('[health] 定时检查：昨天 ' + yd + ' 存在未回填比赛，触发回填...');
        backfillResults(yd).catch((e) => log('[health] 昨天回填失败: ' + e.message));
      }
    }
    // 整点输出健康状态 + 记录每日统计
    if (new Date().getMinutes() === 0) {
      const yd = fmtLocal(new Date(Date.now() - 86400000));
      log('[health] ' + today + ' 数据状态: ' + getTodayStatusSummary(today) + ' | 昨天: ' + getTodayStatusSummary(yd));
      // ★ P1-1: 整点时自动推断最近3天比赛状态（防止比分格式异常导致状态滞后）
      autoInferStatus(today);
      autoInferStatus(yd);
      autoInferStatus(fmtLocal(new Date(Date.now() - 2 * 86400000)));
      // ★ P1 Layer 2: 每日 2:00 触发多源赛果核实（赛后数据稳定后）
      if (now.getHours() === 2 && !_resultVerifyDoneToday) {
        _resultVerifyDoneToday = true;
        verifyYesterdayResults().catch(function (e) {
          log('[verifier] 核实失败: ' + e.message);
        });
      }
      if (now.getHours() !== 2) _resultVerifyDoneToday = false;
      // ★ P2-1: 记录每日统计快照
      try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const { recordDailyStats } = require('./logger');
        recordDailyStats({
          date: today,
          matchesTotal: Object.keys(data.m || {}).length,
          recsTotal: Object.keys(data.r || {}).length,
          statusSummary: getTodayStatusSummary(today),
        });
      } catch (e) {}

      // ★ P2: auto_heal 自动补漏检查（每整点）
      try {
        autoHeal
          .checkAndHeal({ days: 7 })
          .then((result) => {
            if (result.gaps.match > 0 || result.gaps.odds > 0 || result.gaps.allplays > 0) {
              log(
                '[auto_heal] 缺口检查: 赛程' +
                  result.gaps.match +
                  ' 赔率' +
                  result.gaps.odds +
                  ' allplays' +
                  result.gaps.allplays,
              );
            }
          })
          .catch((e) => {
            log('[auto_heal] 检查异常: ' + e.message);
          });
      } catch (e) {}
    }
  }, 60000);
}

// 仅直接运行时启动，被 require 时不自动启动
if (require.main === module) {
  start().catch((e) => {
    log('FATAL: ' + e.message);
    alert.crawlFailed(e.message, 'data_sync 守护进程启动失败').then(() => {
      process.exit(1);
    });
  });
}

// ── 供外部调用的接口 ──
module.exports = {
  /** 触发 500.com 数据抓取（AI 解析发现缺失时调用） — P1: 纯 Node.js，不依赖 Python */
  triggerShujuFetch: async function (dateStr) {
    if (!dateStr) dateStr = fmtLocal(new Date());
    console.log('[data_sync] 外部触发 500.com 数据抓取: ' + dateStr);
    try {
      // Step 1: 生成 shuju_map (JS 原生)
      await fetchShujuMap(dateStr);
      // Step 2: 抓取分析数据 (JS 原生，替代 Python)
      await fetchShujuData(dateStr);
      // Step 3: 合并生成 shuju_merged
      mergeShuju(dateStr);
      console.log('[data_sync] shuju 数据抓取完成: ' + dateStr);
    } catch (e) {
      console.error('[data_sync] shuju 抓取失败: ' + e.message);
    }
  },
  backfillResults,
  syncMatchList,
  syncGovScheduleWrap,
  syncRecommends,
  sync500Odds,
  sync500OddsDelta,
  sync500Shuju,
  sync500ShujuSelenium,
  syncLiveScores,
  autoInferStatus,
  processBackfillQueue,
  getTodayStatusSummary,
};
