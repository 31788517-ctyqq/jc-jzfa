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
const { login, fetchRecommends } = require('./core/midou'); // ★ 方案A: 统一数据源
const { fetchOdds: fetch500Odds, fetchShujuMap } = require('./fetch_500odds');
const { fetchShujuData } = require('./fetch_shuju');
const { mergeShuju } = require('./merge_shuju');
const { execSync } = require('child_process');
const alert = require('./alert');
const { fetchLive500 } = require('./sync_live_500');
const logger = require('./logger').child('data_sync');
const database = require('./database');
const autoHeal = require('./auto_heal');
const matchDataPack = require('./core/match-data-pack');
const { getOddsHistory } = require('./core/cache');

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

/** Task 1C: Selenium 补充抓取 (已停用 — JS 抓取器已覆盖近6场数据) */
async function sync500ShujuSelenium(dateStr) {
  log('[500shuju-sel] JS 抓取器已覆盖近6场数据，Selenium 路径已停用: ' + dateStr);
  return;
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

    // 今日赛程已更新到 data.json 后，触发一次 AI 缓存计算
    await triggerAiRefreshWhenTodayScheduleReady(targetDate, 'match_list_sync');
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
      if (m && m.num) numIndex[((m.date || '').slice(0, 10) || '') + '|' + m.num] = k;
    });

    let cardUpdated = 0;
    (matchRes.data || []).forEach((m) => {
      const num = m.num || '';
      const md =
        m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10 ? m.bDate.slice(0, 10) : fmtLocal(new Date());
      const key = numIndex[md + '|' + num];
      if (!num || !key) return;

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

    // ★ 方案A: 使用 midou.js fetchRecommends（与详情页同一 auth，10min 缓存）
    for (let i = 0; i < dateMatches.length; i++) {
      const m = dateMatches[i];
      const mid = String(m.matchId || '');

      try {
        const recs = await fetchRecommends(mid);

        const rk = 'm_' + mid;
        const oldRecs = data.r[rk] || [];
        const oldLen = oldRecs.length;
        const oldResultCount = oldRecs.filter((r) => r.result !== null && r.result !== 2).length;

        // A1: 保护：filter 后为空但已有数据时跳过写入，防止数据漂移
        if (recs.length === 0 && oldRecs.length > 0) {
          log('[recommend] ' + mid + ' 过滤后为空，保留原有 ' + oldRecs.length + ' 条推荐数据');
          continue;
        }
        data.r[rk] = recs;
        // ★ 方案A: recommNum 使用 midou 实时数据（fetchRecommends 返回正确 num）
        if (data.m[rk]) {
          data.m[rk].recommNum = recs.reduce(function (s, r) {
            return s + (r.num || 0);
          }, 0);
        }
        if (recs.length !== oldLen) recChanged++;

        const newResultCount = recs.filter((r) => r.result !== null && r.result !== 2).length;
        if (newResultCount > oldResultCount) resultUpdated++;

        saveTrendSnapshot(mid, recs);
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
    const today = fmtLocal(new Date());

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

    // 构建 date|num→key 的索引，用于 matchId 不匹配时的回退查找，避免竞彩编号跨日期串写
    const numIndex = {};
    Object.keys(data.m).forEach((k) => {
      const m = data.m[k];
      if (m && m.num) numIndex[((m.date || '').slice(0, 10) || '') + '|' + m.num] = k;
    });

    let updated = 0;
    liveMatches.forEach((lm) => {
      // 优先用 matchId 匹配
      let key = 'm_' + lm.matchId;
      let old = data.m[key];
      // 回退：用竞彩编号 num 匹配
      if (!old && lm.num) {
        const dateKey = ((lm.date || '').slice(0, 10) || '') + '|' + lm.num;
        if (numIndex[dateKey]) {
          key = numIndex[dateKey];
          old = data.m[key];
        }
      }
      // ★ P0 Layer 1: 统一摄入门禁（替代分散过滤规则）
      const guard = require('./core/ingestion-guard');
      var v = guard.validateLiveMatch(old, lm);
      if (v.fields === null) {
        // 门禁裁定：跳过覆盖（保留旧数据）
        if (v.flags && v.flags.suspectHalftime) {
          logger.warn(
            '[guard] 疑似半场误判: ' + (lm.num || '') + ' dur=' + (lm.duration || '') + ' score=' + (lm.score || ''),
          );
        }
      } else {
        var mergedFields = v.fields;
        if (
          old.matchStatus !== mergedFields.matchStatus ||
          old.score !== mergedFields.score ||
          old.duration !== mergedFields.duration ||
          old.yellow !== mergedFields.yellow ||
          old.red !== mergedFields.red ||
          old.halfScore !== mergedFields.halfScore ||
          old.recommNum !== mergedFields.recommNum
        ) {
          updated++;
          data.m[key] = Object.assign({}, old, mergedFields);
          if (v.flags && v.flags.suspectHalftime) {
            logger.warn(
              '[guard] 半场误判已修正: ' + (lm.num || '') + ' ' + (lm.homeName || '') + ' vs ' + (lm.visitName || ''),
            );
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

        const rk2 = 'm_' + mid;
        const oldStale = (data.r[rk2] || []).filter((r) => r.result === null || r.result === 2).length;
        data.r[rk2] = newRecs;
        // ★ 同步更新 match.recommNum
        if (data.m[rk2]) {
          data.m[rk2].recommNum = newRecs.reduce(function (s, r) {
            return s + (r.num || 0);
          }, 0);
        }
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
          // ★ 同步更新 match.recommNum
          if (data.m[rk]) {
            data.m[rk].recommNum = newRecs.reduce(function (s, r) {
              return s + (r.num || 0);
            }, 0);
          }
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

    // ★ V12: matches 表 score/half/duration/yellow/red 回写
    let scoreSyncCount = 0;
    try {
      const adp = database.getAdapter();
      if (adp) {
        Object.keys(data.m).forEach(function (rk) {
          var m = data.m[rk];
          if (!m || !m.matchId || !m.date || m.date.slice(0, 10) !== dateStr) return;
          if (m.matchStatus < 2) return;
          if (m.score || m.halfScore || m.duration || m.yellow || m.red) {
            adp.execRun(
              `UPDATE matches SET score=?, halfScore=?, duration=?, yellow=?, red=?, matchStatus=2 WHERE matchId=?`,
              m.score || '', m.halfScore || '', m.duration || '', m.yellow || '', m.red || '', m.matchId,
            );
            scoreSyncCount++;
          }
        });
        if (scoreSyncCount > 0) {
          database.flushCriticalWrites(adp);
          log('[backfill] matches 表同步完成: ' + scoreSyncCount + ' 场赛果');
        }
      }
    } catch (e) {
      log('[backfill] matches 表同步失败: ' + e.message);
    }

    // ★ V12: 多源赛果校正 — sporttery + 500.com 结果页交叉对账
    try {
      var corrector = require('./core/score-corrector');
      var cr = await corrector.correctDate(dateStr, data.m);
      if (cr && cr.corrected > 0) {
        log('[backfill] 多源校正: ' + cr.corrected + ' 场 (sporttery:' + (cr.sourceCounts.sporttery||0) + ' 500res:' + (cr.sourceCounts['500results']||0) + ')');
        corrector.applyCorrections(cr);
        // 重载 data.json 以同步 corrector 的修改
        try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
      }
    } catch (e) {
      log('[backfill] 多源校正异常(不阻断): ' + e.message);
    }

    if (updated > 0 || (cr && cr.corrected > 0)) {
      atomicWrite(DATA_FILE, data);
      notifyReload();
      log('[backfill] 完成, 更新了 ' + updated + ' 场比赛' + (cr && cr.corrected ? ', 校正' + cr.corrected + '场' : ''));
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

// ═══ Task 5B: AI 深度解析刷新（改为“赛程就绪触发 + 13:00统一计算”） ═══
let aiRefreshRunning = false;
let _aiScheduleTriggeredDate = '';
let _aiScheduleTriggerRunning = false;
let _aiDaily13DoneDate = '';

async function refreshTodayAI(options) {
  options = options || {};
  if (aiRefreshRunning) return { ok: 0, skipped: 'running' };

  const now = new Date();
  const hour = now.getHours();
  const force = !!options.force;
  const targetDate = options.date || fmtLocal(now);
  const delayMs = options.delayMs !== undefined ? options.delayMs : 3000;

  // 仅在 8:00~19:59 之间执行（20:00 前截止），force 模式可跳过时间窗限制
  if (!force && (hour < 8 || hour >= 20)) return { ok: 0, skipped: 'time_window' };

  aiRefreshRunning = true;
  log('[ai_refresh] 开始刷新 ' + targetDate + ' AI 深度解析' + (force ? ' (force)' : '') + '...');

  let total = 0;
  let done = 0;
  let failed = 0;

  try {
    loadAIModules();
    if (!deepseek || !doubao || !aiMerger) {
      log('[ai_refresh] AI 模块未加载，跳过');
      return { ok: 0, skipped: 'ai_modules_not_ready' };
    }

    if (!fs.existsSync(DATA_FILE)) {
      return { ok: 0, skipped: 'no_data_file' };
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const mMap = data.m || {};

    // 找目标日期比赛
    const targetMatches = [];
    Object.keys(mMap).forEach((k) => {
      const m = mMap[k];
      if (m && (m.date || '').slice(0, 10) === targetDate) targetMatches.push(m);
    });

    if (targetMatches.length === 0) {
      log('[ai_refresh] ' + targetDate + ' 无比赛，跳过');
      return { ok: 0, skipped: 'no_matches' };
    }

    total = targetMatches.length;
    log('[ai_refresh] 共 ' + targetMatches.length + ' 场比赛，开始逐场分析...');

    const cacheFile = path.join(__dirname, 'ai_cache.json');
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
          if (m) {
            matchInfo = {
              matchId: mid,
              homeName: m.homeName,
              visitName: m.visitName,
              leagueName: m.leagueName,
              date: m.date,
              num: m.num,
            };
          }

          const merged = aiMerger.mergeAnalyses(
            { content: entry.sources.deepseek.content, confidence: entry.sources.deepseek.confidence || 70 },
            { content: entry.sources.doubao.content, confidence: entry.sources.doubao.confidence || 70 },
            matchInfo,
          );
          entry.content = merged.content;
          entry.confidence = merged.confidence;
          entry.merged = true;

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

    for (const m of targetMatches) {
      const mid = m.matchId;

      // P1-2: 增量更新 — 6小时内有效缓存直接跳过
      var cachedEntry = null;
      try {
        var rawCache = fs.readFileSync(cacheFile, 'utf8');
        var cacheObj = JSON.parse(rawCache);
        cachedEntry = cacheObj[mid];
      } catch (e) {}
      if (cachedEntry && cachedEntry.updatedAt) {
        var cacheAge = Date.now() - new Date(cachedEntry.updatedAt).getTime();
        if (cacheAge < 6 * 3600 * 1000 && cachedEntry.merged) {
          log('[ai_refresh] ' + mid + ' 6h内有效缓存，跳过');
          done++;
          continue;
        }
      }

      // P1-1: 按推荐数分级 A/B/C
      var recNum = Number(m.recommNum || 0);
      var level = recNum >= 100 ? 'A' : recNum >= 30 ? 'B' : 'C';
      log('[ai_refresh] ' + mid + ' 级别=' + level + ' (推荐数=' + recNum + ')');

      const pack = matchDataPack.getMatchDataPack({ match: m, date: targetDate }) || null;
      const matchInfo = {
        matchId: mid,
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        date: m.date || '',
        num: m.num || '',
        sourceSnapshot: pack ? pack.sourceSnapshot : null,
        coverage: pack ? pack.coverage : null,
        dataPack: pack,
      };

      let hasAny = false;

      // P2-1: A级双模型+C重试, B级单模型, C级仅豆包
      var aiOpts = { maxRetries: 1 }; // P2-2: 1次重试
      var dsPromise = null;
      var dbPromise = null;

      if (level === 'A' || level === 'B') {
        dsPromise = deepseek.generateAnalysis(matchInfo, aiOpts).catch(function (e) {
          log('[ai_refresh] DS ' + mid + ' 失败: ' + e.message.slice(0, 80));
          return null;
        });
      }
      dbPromise = doubao.generateAnalysis(matchInfo, level === 'C' ? aiOpts : { maxRetries: 0 }).catch(function (e) {
        log('[ai_refresh] DB ' + mid + ' 失败: ' + e.message.slice(0, 80));
        return null;
      });

      var promises = [dsPromise, dbPromise].filter(Boolean);
      var results = await Promise.all(promises);

      // 处理 DS 结果
      if (dsPromise) {
        var dsIdx = 0;
        var dsR = results[dsIdx];
        if (dsR) {
          var dsC = dsR.content || dsR;
          if (dsC) {
            saveAICache(mid, 'deepseek', dsC, dsC.confidence || 70);
            hasAny = true;
          }
        }
      }
      // 处理 DB 结果
      var dbIdx = dsPromise ? 1 : 0;
      var dbR = results[dbIdx];
      if (dbR) {
        var dbC = dbR.content || dbR;
        if (dbC) {
          saveAICache(mid, 'doubao', dbC, dbC.confidence || 70);
          hasAny = true;
        }
      }

      if (hasAny) done++;
      else failed++;

      log('[ai_refresh] ' + m.num + ' ' + m.homeName + ' vs ' + m.visitName + ' 完成 (级别=' + level + ')');
      if (delayMs > 0) await sleep(jitter(delayMs));
    }

    log('[ai_refresh] ' + targetDate + ' AI 刷新完成: done=' + done + '/' + total + ', failed=' + failed);
    return { ok: 1, total, done, failed, date: targetDate };
  } catch (e) {
    log('[ai_refresh] 异常: ' + e.message);
    return { ok: 0, error: e.message, date: targetDate };
  } finally {
    aiRefreshRunning = false;
  }
}

function isTodayDateStr(dateStr) {
  return String(dateStr || '').slice(0, 10) === fmtLocal(new Date());
}

async function triggerAiRefreshWhenTodayScheduleReady(dateStr, reason) {
  const targetDate = String(dateStr || '').slice(0, 10);
  const triggerReason = reason || 'schedule_ready';

  if (!targetDate || !isTodayDateStr(targetDate)) return { ok: 0, skipped: 'not_today' };
  if (_aiScheduleTriggeredDate === targetDate) return { ok: 0, skipped: 'already_triggered' };
  if (_aiScheduleTriggerRunning) return { ok: 0, skipped: 'running' };

  const matches = countTodayMatches(targetDate);
  if (matches <= 0) return { ok: 0, skipped: 'no_matches' };

  _aiScheduleTriggerRunning = true;
  log(
    '[ai_trigger] 今日赛程就绪，触发AI缓存计算 date=' + targetDate + ' reason=' + triggerReason + ' matches=' + matches,
  );
  try {
    const res = await refreshTodayAI({ force: true, date: targetDate, delayMs: 500 });
    if (res && res.ok === 1) _aiScheduleTriggeredDate = targetDate;
    return res || { ok: 0, skipped: 'no_result' };
  } catch (e) {
    log('[ai_trigger] 赛程就绪触发失败: ' + e.message);
    return { ok: 0, error: e.message, date: targetDate };
  } finally {
    _aiScheduleTriggerRunning = false;
  }
}

function getNext13Delay() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(13, 0, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

function scheduleDailyAiRefreshAt13() {
  const delay = getNext13Delay();
  log('[scheduler] 下次13:00 AI统一计算: ' + Math.round(delay / 60000) + ' 分钟后');

  setTimeout(async () => {
    const today = fmtLocal(new Date());
    if (_aiDaily13DoneDate === today) {
      scheduleDailyAiRefreshAt13();
      return;
    }

    log('[scheduler] ⏰ 13:00 AI统一计算触发: ' + today);
    try {
      const res = await refreshTodayAI({ force: true, date: today, delayMs: 500 });
      if (res && res.ok === 1) {
        _aiDaily13DoneDate = today;
      } else {
        log('[scheduler] 13:00 AI统一计算未完成: ' + JSON.stringify(res || {}));
      }
    } catch (e) {
      log('[scheduler] 13:00 AI统一计算失败: ' + e.message);
    }

    scheduleDailyAiRefreshAt13();
  }, delay);
}

// ═══ P0: SP 同步后模型补算闭环（GS → AI → PK） ═══
async function runModelClosure(dateStr, options) {
  options = options || {};
  const d = (dateStr || fmtLocal(new Date())).slice(0, 10);
  const reason = options.reason || 'sp_sync';

  const summary = {
    date: d,
    reason,
    gs: null,
    ai: null,
    pk: null,
    coverage: null,
  };

  log('[closure] 开始模型补算闭环 date=' + d + ' reason=' + reason);

  // 1) GS 强制刷新
  try {
    const gsEngine = require('./gongshoudao/index');
    const gsRes = await gsEngine.refreshCache({ forceRefresh: true, cacheTtlMs: 0 });
    summary.gs = { ok: 1, total: gsRes ? Object.keys(gsRes).length : 0 };
    log('[closure] GS 刷新完成: ' + JSON.stringify(summary.gs));
  } catch (e) {
    summary.gs = { ok: 0, error: e.message };
    log('[closure] GS 刷新失败: ' + e.message);
  }

  // 2) AI 刷新（force，允许非 8:00~20:00 时段手动触发）
  try {
    summary.ai = await refreshTodayAI({
      force: true,
      date: d,
      delayMs: options.aiDelayMs !== undefined ? options.aiDelayMs : 500,
    });
    log('[closure] AI 刷新完成: ' + JSON.stringify(summary.ai));
  } catch (e) {
    summary.ai = { ok: 0, error: e.message };
    log('[closure] AI 刷新失败: ' + e.message);
  }

  // 3) PK 重算入库
  try {
    const pk = require('./pk_scorer');
    const pkRes = await pk.computeAndSave(d);
    summary.pk = { ok: 1, result: pkRes };
    log('[closure] PK 重算完成: ' + JSON.stringify(pkRes));
  } catch (e) {
    summary.pk = { ok: 0, error: e.message };
    log('[closure] PK 重算失败: ' + e.message);
  }

  // 4) 覆盖率报告（P1 统一数据包）
  try {
    summary.coverage = matchDataPack.buildCoverageReport(d);
    log('[closure] 覆盖率: ' + JSON.stringify(summary.coverage));
  } catch (e) {
    summary.coverage = { error: e.message };
    log('[closure] 覆盖率统计失败: ' + e.message);
  }

  log('[closure] 结束 date=' + d + ' reason=' + reason);
  return summary;
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

  const now = new Date();
  const today = fmtLocal(now);
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
    await triggerAiRefreshWhenTodayScheduleReady(today, 'schedule_watcher_exists');
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
      await triggerAiRefreshWhenTodayScheduleReady(today, 'schedule_watcher_fetch');
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
  const today = fmtLocal(now);

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
    let inferredLive = 0;

    Object.keys(data.m).forEach((k) => {
      const m = data.m[k];
      if (!m || m.matchStatus >= 2) return; // 已结束，跳过

      // ★ P4: 跨日比赛推断 — 不仅匹配 date===dateStr，也匹配开赛时间在今天的跨日比赛
      var matchDateStr = m.date ? m.date.slice(0, 10) : '';
      var isTodayMatch = matchDateStr === dateStr;

      // 检查开赛时间是否在今天（处理 date=昨天, startTime=今天的跨日比赛）
      if (!isTodayMatch && m.startTime) {
        try {
          var raw2 = m.startTime.replace(/\//g, '-');
          var clean2 = raw2.replace(/\s+/g, '');
          var kickoffDt = new Date(
            year + '-' + clean2.slice(0, 2) + '-' + clean2.slice(3, 5) + 'T' + clean2.slice(5, 10) + ':00+08:00',
          );
          if (!isNaN(kickoffDt.getTime())) {
            var kickoffDateStr =
              kickoffDt.getFullYear() +
              '-' +
              String(kickoffDt.getMonth() + 1).padStart(2, '0') +
              '-' +
              String(kickoffDt.getDate()).padStart(2, '0');
            if (kickoffDateStr === dateStr) isTodayMatch = true;
          }
        } catch (e) {}
      }
      if (!isTodayMatch) return;

      // ★ P4: 先检测比分（优先级高于时间推演）— 有比分=比赛已结束
      var hasValidScore = m.score && /\d+[:\-]\d+/.test(String(m.score.trim()));
      if (hasValidScore) {
        // ★ P4-C: 过滤疑似日期字段污染的比分（如 "6-15" → 实际是 06-15 日期）
        var scoreParts = String(m.score.trim()).split(/[:\-]/);
        var s1 = parseInt(scoreParts[0]) || 0;
        var s2 = parseInt(scoreParts[1]) || 0;
        var isSuspiciousDate = s1 >= 1 && s1 <= 12 && s2 >= 1 && s2 <= 31 && s1 + s2 > 12;
        if (!isSuspiciousDate) {
          m.matchStatus = 2;
          fixed++;
          usedScoreMethod = true;
          return; // 比分已确认，无需继续检查
        }
      }

      // ★ P3-1: 时间推演进行中 — 无比分 + 开赛>10分钟仍status=0 → 自动标记为进行中
      if (m.matchStatus === 0 && m.startTime) {
        try {
          const raw = m.startTime.replace(/\//g, '-');
          const clean = raw.replace(/\s+/g, '');
          const dt = new Date(
            year + '-' + clean.slice(0, 2) + '-' + clean.slice(3, 5) + 'T' + clean.slice(5, 10) + ':00+08:00',
          );
          if (!isNaN(dt.getTime()) && now > dt.getTime() + 10 * 60 * 1000) {
            m.matchStatus = 1;
            m.duration = m.duration || '进行中';
            fixed++;
            inferredLive++;
            return; // 已更新为进行中
          }
        } catch (e) {}
      }

      let shouldFix = false;

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
      const parts = [];
      if (inferredLive > 0) parts.push(inferredLive + ' 场→进行中');
      const finishedCount = fixed - inferredLive;
      if (finishedCount > 0) {
        const methodTag = usedScoreMethod ? ' method:score' : '';
        parts.push(finishedCount + ' 场→已结束' + methodTag);
      }
      log('[auto_status] ' + dateStr + ' 自动推断: ' + parts.join(', '));
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

  currentDate = fmtLocal(new Date());
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

      // P0: 首次同步后触发模型补算闭环
      await runModelClosure(currentDate, { reason: 'init_sync', aiDelayMs: 500 });
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

  // ★ C: 启动时检查今日赔率文件，缺失则提前抓取（避免 noon 前无赔率可用）
  var oddsFile = path.join(ODDS_DIR, currentDate + '.json');
  if (!fs.existsSync(oddsFile) || (fs.existsSync(oddsFile) && fs.statSync(oddsFile).size < 100)) {
    log('[init] 今日赔率文件缺失/过小，提前触达 500.com 赔率抓取...');
    sync500Odds(currentDate).catch(function (e) {
      log('[init] 提前赔率抓取失败: ' + e.message);
    });
  }

  // ═══ 启动高频赛程检查器（6:00~12:00，每5分钟多源检查） ═══
  if (!todayHasMatches(currentDate)) {
    log('[init] ⚠️ 今日' + currentDate + '仍无赛程数据');
    startTodayScheduleWatcher();
  }

  // ★ 启动时强制刷新一次推荐数据（确保 plan-generator 基于最新数据）
  if (todayHasMatches(currentDate)) {
    log('[init] 启动时强制同步今日推荐数据...');
    syncRecommends(currentDate)
      .catch(function (e) {
        log('[init] 推荐同步失败: ' + e.message);
      })
      .then(function () {
        startPlanAutoRefresh();
      });
  } else {
    startPlanAutoRefresh();
  }

  // ═══ 循环1: 每2分钟 — 实时比分 (500.com 直播页，无需认证) ═══
  async function liveScoreLoop() {
    if (liveScoreRunning) return;
    liveScoreRunning = true;
    try {
      await fetchLive500(); // ★ 500.com 直播页 今天 (比分/半场/状态)

      // ★ 修复: 跨日比赛回查 — 竞彩编号归属昨日但实际今日开赛的比赛
      // 彩票编号如"周日009"在500.com归类于归属日（昨天），不抓昨天页面则比分永久丢失
      var yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      var yesterdayStr = fmtLocal(yesterday);
      try {
        var rawData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        var hasYesterdayMatches = Object.keys(rawData.m || {}).some(function (k) {
          var m = rawData.m[k];
          return m && (m.date || '').slice(0, 10) === yesterdayStr;
        });
        if (hasYesterdayMatches) {
          await fetchLive500(yesterdayStr);
        }
      } catch (e2) {
        log('[live_score] 昨日回查跳过: ' + e2.message);
      }
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

  // ═══ 方案自动刷新（每30分钟，至锁定时间） ═══
  var _planRefreshTimer = null;
  var _planLocked = false;
  var _planLockTime = 0;
  var _planEarliestKickoff = 0;

  function computeLockTime(dateStr) {
    try {
      var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      var mMap = data.m || {};
      var year = new Date().getFullYear();
      var earliestUnstarted = Infinity;

      Object.keys(mMap).forEach(function (k) {
        var m = mMap[k];
        if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
        if (m.matchStatus >= 1) return; // 已开赛或已结束，跳过
        if (!m.startTime) return;
        try {
          var raw = m.startTime.replace(/\//g, '-');
          var clean = raw.replace(/\s+/g, '');
          var dt = new Date(
            year + '-' + clean.slice(0, 2) + '-' + clean.slice(3, 5) + 'T' + clean.slice(5, 10) + ':00+08:00',
          );
          if (!isNaN(dt.getTime()) && dt.getTime() < earliestUnstarted) {
            earliestUnstarted = dt.getTime();
          }
        } catch (e) {}
      });

      if (earliestUnstarted === Infinity) {
        return { lockTime: Date.now(), earliestKickoff: 0, locked: true, reason: 'all_started' };
      }

      var lockTime = earliestUnstarted - 20 * 60 * 1000; // 首场开赛前20分钟
      if (lockTime <= Date.now()) {
        return { lockTime: Date.now(), earliestKickoff: earliestUnstarted, locked: true, reason: 'past_lock' };
      }
      return { lockTime: lockTime, earliestKickoff: earliestUnstarted, locked: false, reason: 'pending' };
    } catch (e) {
      return { lockTime: Date.now(), earliestKickoff: 0, locked: true, reason: 'error' };
    }
  }

  async function refreshPlanCache() {
    if (_planLocked) return;
    log('[plan-refresh] 开始刷新方案缓存...');

    // 计算锁定时间
    var lockInfo = computeLockTime(currentDate);
    _planLockTime = lockInfo.lockTime;
    _planEarliestKickoff = lockInfo.earliestKickoff;

    if (lockInfo.locked) {
      _planLocked = true;
      if (lockInfo.earliestKickoff > 0) {
        log('[plan-refresh] 方案已锁定 (reason=' + lockInfo.reason + ')，保存快照');
        // 锁定时刻：保存快照
        try {
          var PG = require('./core/plan-generator');
          var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
          var mMap = data.m || {};
          var rMap = data.r || {};
          var mList = [];
          Object.keys(mMap).forEach(function (k) {
            var m = mMap[k];
            if (m && (m.date || '').slice(0, 10) === currentDate) mList.push(m);
          });
          var matchDataMap = {};
          mList.forEach(function (mm) {
            var raw = rMap['m_' + mm.matchId] || rMap[String(mm.matchId)] || [];
            var recs = (raw || []).map(function (x) {
              var r = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
              return { type: x.t || x.type, num: x.n || x.num, result: r === 0 || r === 1 ? r : null };
            });
            var oddsEntry = getOddsHistory(currentDate);
            var num = mm.num || '';
            var oddsObj = null;
            if (oddsEntry && oddsEntry[num]) {
              var od = oddsEntry[num];
              oddsObj = {
                spf: od.spf || null,
                rqspf: od.rqspf || null,
                totalGoals: od.totalGoals || null,
                halfFull: od.halfFull || null,
                isSingleGame: od.isSingleGame || false,
              };
            }
            matchDataMap[mm.matchId] = { match: mm, recs: recs, odds: oddsObj };
          });
          var plans = PG.generateExpertPlans(mList, matchDataMap, currentDate);
          PG.savePlanSnapshot(currentDate, plans, new Date(_planEarliestKickoff).toISOString());
          log('[plan-refresh] 方案快照已保存: ' + plans.length + ' 个方案');
        } catch (e2) {
          log('[plan-refresh] 快照保存失败: ' + e2.message);
        }
        clearPlanRefreshTimer();
      } else {
        log('[plan-refresh] 方案已锁定 (全部已开赛)');
      }
    } else {
      var minUntilLock = Math.round((_planLockTime - Date.now()) / 60000);
      log('[plan-refresh] 缓存已刷新，距锁定还有 ' + minUntilLock + ' 分钟');
    }

    // 失效 index.js 缓存
    try {
      require('./core/plan-cache').bumpCache();
    } catch (e) {}
  }

  function clearPlanRefreshTimer() {
    if (_planRefreshTimer) {
      clearTimeout(_planRefreshTimer);
      _planRefreshTimer = null;
    }
  }

  function schedulePlanAutoRefresh() {
    clearPlanRefreshTimer();
    var now = Date.now();
    var nowDate = fmtLocal(new Date());

    // 当前不是"今天"，则等明天16:30
    if (nowDate !== currentDate) {
      var next1630 = new Date();
      next1630.setHours(16, 30, 0, 0);
      if (next1630.getTime() <= now) next1630.setDate(next1630.getDate() + 1);
      var delay = next1630.getTime() - now;
      log('[plan-refresh] 非当日，下次方案刷新在 ' + Math.round(delay / 3600000) + ' 小时后');
      _planRefreshTimer = setTimeout(function () {
        startPlanAutoRefresh();
      }, delay);
      return;
    }

    // 如果已锁定，不再调度
    if (_planLocked) return;

    // 如果在16:30之前，等到16:30
    var h = new Date().getHours();
    var m = new Date().getMinutes();
    if (h < 16 || (h === 16 && m < 30)) {
      var to1630 = new Date();
      to1630.setHours(16, 30, 0, 0);
      var d1630 = to1630.getTime() - now;
      log('[plan-refresh] 等待首次刷新(16:30)，' + Math.round(d1630 / 60000) + ' 分钟后');
      _planRefreshTimer = setTimeout(function () {
        startPlanAutoRefresh();
      }, d1630);
      return;
    }

    // 计算锁定时间
    var lockInfo = computeLockTime(currentDate);
    _planLockTime = lockInfo.lockTime;
    _planEarliestKickoff = lockInfo.earliestKickoff;
    _planLocked = lockInfo.locked;

    if (_planLocked) {
      log('[plan-refresh] 当前已是锁定状态: ' + lockInfo.reason);
      refreshPlanCache();
      return;
    }

    // 立即刷新一次
    refreshPlanCache();

    // 30分钟后再次刷新（如果未锁定）
    var nextMs = now + 30 * 60 * 1000;
    if (nextMs >= _planLockTime) {
      // 下次刷新会在锁定时间之后 → 调整为锁定时间
      nextMs = _planLockTime;
      log('[plan-refresh] 下次(锁定触发)，' + Math.round((nextMs - now) / 60000) + ' 分钟后');
    } else {
      log('[plan-refresh] 下次(30min)，' + Math.round((nextMs - now) / 60000) + ' 分钟后');
    }
    _planRefreshTimer = setTimeout(function () {
      startPlanAutoRefresh();
    }, nextMs - now);
  }

  function startPlanAutoRefresh() {
    _planLocked = false;
    _planLockTime = 0;
    _planEarliestKickoff = 0;
    clearPlanRefreshTimer();
    schedulePlanAutoRefresh();
  }

  // ═══ 每日12:00定时：赔率+赛程 ═══
  function scheduleNoon() {
    const delay = getNextNoonDelay();
    log('[scheduler] 下次12:00定时: ' + Math.round(delay / 3600000) + ' 小时后');

    setTimeout(async () => {
      const today = fmtLocal(new Date());

      // 日期变更重置
      if (today !== currentDate) {
        log('[scheduler] 日期变更: ' + currentDate + ' → ' + today);
        currentDate = today;
        finalCheckDone = false;
        _ensureRetries = 0; // 重置重试计数
        _aiScheduleTriggeredDate = '';
        _aiDaily13DoneDate = '';
        // ★ 方案刷新重置（新日期重新调度）
        startPlanAutoRefresh();
      }

      log('[scheduler] ⏰ 12:00 定时任务触发');
      try {
        // ★ SP官方全量同步: 赛程→详情(赔率+前瞻)→桥接（串行 await，避免竞态）
        log('[scheduler] 开始SP全量数据同步...');
        try {
          const { main: spFullSync } = require('./sync_sp_full');
          await spFullSync({ mode: 'full', date: today, forceSnapshot: true });
        } catch (e) {
          log('[sp] 全量同步失败: ' + e.message);
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

        // ★ 模型补算闭环已移至 ai_daemon 11:30/16:30 定时触发
        // （AI 完成后→GS刷新→PK计算更自然，不阻塞 SP 同步）

        // P0-2: 每日清理 data.json 旧推荐数据（轻量，不阻塞）
        trimOldRecommendData();
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

  // ═══ 循环3: 每15分钟 — SP动态赔率快照（赛程存在时执行） ═══
  let spOddsRunning = false;
  async function spOddsLoop() {
    if (spOddsRunning) {
      setTimeout(spOddsLoop, 15 * 60 * 1000);
      return;
    }
    spOddsRunning = true;
    try {
      const today = fmtLocal(new Date());
      if (todayHasMatches(today)) {
        const { main: spFullSync } = require('./sync_sp_full');
        await spFullSync({ mode: 'odds', date: today, forceSnapshot: true });
        log('[sp-odds] ✓ 动态赔率快照完成: ' + today);
      }
    } catch (e) {
      log('[sp-odds] 失败: ' + e.message);
    }
    spOddsRunning = false;
    setTimeout(spOddsLoop, 15 * 60 * 1000);
  }

  // 启动所有循环（错峰启动，避免同时发起请求）
  setTimeout(liveScoreLoop, 5000); // 5秒后开始比分
  setTimeout(recommendLoop, 30000); // 30秒后开始推荐
  setTimeout(spOddsLoop, 90000); // 90秒后开始 SP 动态赔率
  scheduleNoon(); // 计算12:00定时
  scheduleDailyAiRefreshAt13(); // 计算13:00 AI统一计算

  // 若进程在13:00后重启，且今日已有赛程，则补做一次13点统一计算
  try {
    const bootNow = new Date();
    const bootToday = fmtLocal(bootNow);
    if (bootNow.getHours() >= 13 && todayHasMatches(bootToday) && _aiDaily13DoneDate !== bootToday) {
      log('[scheduler] 启动补偿: 13点后重启，立即执行今日AI统一计算 ' + bootToday);
      const bootRes = await refreshTodayAI({ force: true, date: bootToday, delayMs: 500 });
      if (bootRes && bootRes.ok === 1) _aiDaily13DoneDate = bootToday;
    }
  } catch (e) {
    log('[scheduler] 启动补偿AI统一计算失败: ' + e.message);
  }

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
      var spSources = verifier.extractSportterySource(yd);
      var live500Sources = verifier.extractLive500Source(yd);
      var vr = verifier.verifyDate(yd, {
        midouDataJson: dataJson,
        extraSources: [].concat(spSources || [], live500Sources || []),
      });

      // 读取现有缓存，合并
      var cache = {};
      try {
        if (fs.existsSync(VERIFIED_RESULTS_FILE)) {
          cache = JSON.parse(fs.readFileSync(VERIFIED_RESULTS_FILE, 'utf8'));
        }
      } catch (e) {}

      var pendingSpVerify = 0;
      cache[yd] = {
        time: new Date().toISOString(),
        totalMatches: vr.results.length,
        sourceSummary: {
          sporttery: (spSources || []).length,
          live500: (live500Sources || []).length,
        },
        results: vr.results.map(function (r) {
          var sources = (r.verified && r.verified.sourceVotes) || [];
          var hasSp = sources.indexOf('sporttery') >= 0;
          var has500 = sources.indexOf('live500') >= 0;
          var pending = !hasSp && has500;
          if (pending) pendingSpVerify++;
          return {
            anchor: r.anchorName,
            score: r.verified.score,
            confidence: r.verified.confidence,
            sources: sources,
            pending_sp_verify: pending,
          };
        }),
        pendingSpVerify: pendingSpVerify,
      };
      fs.writeFileSync(VERIFIED_RESULTS_FILE, JSON.stringify(cache, null, 2));
      log('[verifier] ✓ 核实完成: ' + yd + ' ' + vr.results.length + ' 场');

      // ★ V12: 核实后自动纠正半场误判（halfScore===score 且非0-0）
      try {
        var guard = require('./core/ingestion-guard');
        var suspiciousMatches = [];
        Object.keys(dataJson.m || {}).forEach(function (rk) {
          var m = dataJson.m[rk];
          if (!m || !m.date || m.date.slice(0, 10) !== yd) return;
          if (m.matchStatus < 2 || !m.score) return;
          var audit = guard.postMatchAudit(m);
          audit.forEach(function (issue) {
            if (issue.type === 'half_equals_final_non_zero') {
              suspiciousMatches.push(m);
            }
          });
        });
        if (suspiciousMatches.length > 0) {
          log('[verifier] 发现 ' + suspiciousMatches.length + ' 场半场误判，触发多源校正...');
          var corrector = require('./core/score-corrector');
          var cr = await corrector.correctDate(yd, dataJson.m);
          if (cr && cr.corrected > 0) {
            corrector.applyCorrections(cr);
            log('[verifier] 半场误判已修正: ' + cr.corrected + ' 场');
          }
        }
      } catch (e) {
        log('[verifier] 半场校正异常(不阻断): ' + e.message);
      }
    } catch (e) {
      log('[verifier] 核实失败: ' + e.message);
    }
  }
  setInterval(() => {
    const now = new Date();
    const today = fmtLocal(now);
    if (today !== currentDate) {
      log('[scheduler] 日期变更: ' + currentDate + ' → ' + today);
      currentDate = today;
      finalCheckDone = false;
      _ensureRetries = 0;
      _aiScheduleTriggeredDate = '';
      _aiDaily13DoneDate = '';
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
  refreshTodayAI,
  runModelClosure,
};

// ★ P0-2: 每日分层归档 data.json 中 >14 天的旧推荐明细
// 策略：近期数据保留 data.json（热层），历史数据移至 recommends_archive/（冷层）
// 数据零丢失——仅分层存储，匹配实体 (data.m) 完全不受影响
function trimOldRecommendData() {
  try {
    const maxDays = 14;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - maxDays);
    const cutoffStr = fmtLocal(cutoff);
    const cutoffKey = cutoffStr.replace(/-/g, '');

    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const mMap = data.m || {};
    const rMap = data.r || {};
    const archive = {};
    let movedCount = 0;

    Object.keys(rMap).forEach(function (k) {
      const mid = k.replace('m_', '');
      const m = mMap[k] || mMap['m_' + mid] || mMap[mid];
      if (!m || !m.date) return;
      if (m.date.slice(0, 10) >= cutoffStr) return; // 近期保留
      // 移至归档（不删除）
      archive[k] = rMap[k];
      delete rMap[k];
      movedCount++;
    });

    if (movedCount > 0) {
      data.r = rMap;
      atomicWrite(DATA_FILE, data);

      // 归档写入
      const archiveDir = path.join(__dirname, 'recommends_archive');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const archiveFile = path.join(archiveDir, 'recommends_before_' + cutoffKey + '.json');
      let existing = {};
      if (fs.existsSync(archiveFile)) {
        try {
          existing = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
        } catch (e) {}
      }
      Object.assign(existing, archive);
      fs.writeFileSync(archiveFile, JSON.stringify(existing));

      log('[trim] 分层归档 ' + movedCount + ' 条 >14天推荐 → ' + archiveFile);
    }
  } catch (e) {
    log('[trim] 推荐分层失败: ' + e.message);
  }
}
