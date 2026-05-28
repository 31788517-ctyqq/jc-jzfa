/**
 * 统一数据同步守护进程
 * 替代旧的 period_daemon.js + score_daemon.js + sync_scores.js
 *
 * 调度计划:
 *   - 12:00 每天:     500.com 赔率抓取 + 赛程信息同步（各一次）
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
const { execSync } = require('child_process');

// ═══ 配置常量 ═══
const DATA_FILE = path.join(__dirname, 'data.json');
const LIVE_FILE = path.join(__dirname, 'live_scores.json');
const TREND_FILE = path.join(__dirname, 'trends.json');
const ODDS_DIR = path.join(__dirname, 'odds_history');
const LOG_FILE = path.join(__dirname, '..', 'logs', 'data_sync.log');

const MIDOU_BASE = 'https://midou310.com/mdsj';

// 确保必要目录存在
if (!fs.existsSync(ODDS_DIR)) fs.mkdirSync(ODDS_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(LOG_FILE))) fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// ═══ 工具函数 ═══
function log(msg) {
  const line = '[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

function fmtLocal(dd) {
  return dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0');
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
    recs.forEach(r => { snap[r.type] = r.num; });
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

  // 已有有效数据跳过
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 100) {
      log('[500odds] ' + dateStr + ' 已有数据，跳过');
      return;
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

/** 对比 data.json 中的比赛编号，检查 500.com 赔率是否完整 */
async function validate500Odds(dateStr, odds) {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const expectedNums = [];

    Object.keys(data.m || {}).forEach(k => {
      const m = data.m[k];
      if (m && m.date && m.date.slice(0, 10) === dateStr && m.num) {
        expectedNums.push(m.num);
      }
    });

    const missing = expectedNums.filter(n => !odds[n]);
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
    var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.m) return;
    var changed = false;
    Object.keys(data.m).forEach(function(k) {
      var match = data.m[k];
      if (!match || !match.num || (match.date || '').slice(0, 10) !== dateStr) return;
      var num = match.num;
      // 500.com odds 里有队名
      var odd = odds[num];
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

  var shujuMapFile = path.join(__dirname, 'shuju_map_' + dateStr + '.json');
  var shujuDataFile = path.join(__dirname, 'shuju_data', 'shuju_' + dateStr + '.json');

  // 已有有效数据跳过
  if (fs.existsSync(shujuDataFile)) {
    var stat = fs.statSync(shujuDataFile);
    if (stat.size > 100) {
      log('[500shuju] ' + dateStr + ' 已有数据，跳过');
      return;
    }
  }

  try {
    // Step 1: 获取 shuju ID 映射
    var shujuMap = {};
    if (fs.existsSync(shujuMapFile)) {
      try { shujuMap = JSON.parse(fs.readFileSync(shujuMapFile, 'utf8')); } catch (e) {}
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
      var oddsFile = path.join(ODDS_DIR, dateStr + '.json');
      var oddsData = {};
      if (fs.existsSync(oddsFile)) {
        try { oddsData = JSON.parse(fs.readFileSync(oddsFile, 'utf8')); } catch (e) {}
      }
      enrichNamesFrom500(dateStr, (oddsData.odds || {}), shujuMap);
    } catch (e) {}

    // Step 2: 调用 Python 爬虫
    var pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    var scriptPath = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi.py');
    var pyResult = execSync(pythonCmd + ' "' + scriptPath + '" ' + dateStr, {
      cwd: path.join(__dirname, '..'),
      timeout: 300000,  // 5分钟超时（多场比赛需要串行抓取）
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (pyResult) log('[500shuju] ' + pyResult.trim().split('\n').slice(-3).join(' | '));

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

  var selFile = path.join(__dirname, 'shuju_data', 'shuju_selenium_' + dateStr + '.json');

  // 已有数据跳过
  if (fs.existsSync(selFile) && fs.statSync(selFile).size > 500) {
    log('[500shuju-sel] ' + dateStr + ' Selenium 数据已存在，跳过');
    return;
  }

  // 需要有 shuju_map 才执行
  var shujuMapFile = path.join(__dirname, 'shuju_map_' + dateStr + '.json');
  if (!fs.existsSync(shujuMapFile)) {
    log('[500shuju-sel] 无 shuju_map，跳过');
    return;
  }

  try {
    var pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    var scriptPath = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi_selenium.py');
    // Selenium 较慢, 给 10 分钟超时
    var pyResult = execSync(pythonCmd + ' "' + scriptPath + '" ' + dateStr, {
      cwd: path.join(__dirname, '..'),
      timeout: 600000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (pyResult) {
      var lines = pyResult.trim().split('\n');
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
    var pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    var scriptPath = path.join(__dirname, '..', 'scripts', 'fetch_league_standings.py');
    var pyResult = execSync(pythonCmd + ' "' + scriptPath + '" ' + dateStr, {
      cwd: path.join(__dirname, '..'),
      timeout: 300000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    if (pyResult) {
      var lines = pyResult.trim().split('\n').filter(l => l.includes('[OK]'));
      log('[500shuju-standings] ' + (lines[lines.length - 1] || 'done'));
    }
  } catch (e) {
    log('[500shuju-standings] 失败: ' + e.message);
  }
}

// ═══ Task 2: 赛程信息同步（每天 12:00，替换旧的 footballDataList 全量更新） ═══
async function syncMatchList() {
  const period = getCurrentPeriod();
  log('[match_list] 同步赛程: ' + period.date + ' ' + period.week);

  try {
    const token = await getToken();
    const timestamp = new Date(period.date + 'T00:00:00+08:00').getTime();

    const matchRes = await getWithRetry(
      MIDOU_BASE + '/score/footballDataList.do',
      { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
      { Cookie: 'token=' + token }
    );

    if (matchRes.code !== 1 || !matchRes.data) {
      log('[match_list] 获取失败: ' + (matchRes.msg || ''));
      return;
    }

    // 按竞彩期号前缀 + 日期双重过滤
    const periodMatches = (matchRes.data || []).filter(m => {
      if (!m.num || m.num.indexOf(period.week) !== 0) return false;
      const bd = (m.bDate || '').slice(0, 10);
      if (bd === period.date) return true;
      if (!bd && m.startTime && m.startTime.length >= 11) {
        const st = m.startTime.replace(/\//g, '-');
        const dt = new Date(new Date().getFullYear() + '-' + st.slice(0, 2) + '-' + st.slice(3, 5) + 'T' + st.slice(6, 11) + ':00+08:00');
        if (!isNaN(dt.getTime())) {
          if (dt.getHours() < 9) dt.setDate(dt.getDate() - 1);
          return fmtLocal(dt) === period.date;
        }
      }
      return false;
    });

    if (periodMatches.length === 0) {
      log('[match_list] ' + period.date + ' 无比赛');
      return;
    }

    // 更新 data.json
    let data = {};
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
    if (!data.m) data.m = {};
    if (!data.r) data.r = {};

    let newCount = 0, updateCount = 0;

    for (const m of periodMatches) {
      const mid = String(m.matchId || m.dataId || '');
      const mkey = 'm_' + mid;
      const md = (m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10)
        ? m.bDate.slice(0, 10) : period.date;

      const newMatch = {
        matchId: mid, num: m.num || '',
        homeName: m.homeName || '', visitName: m.visitName || '',
        leagueName: m.leagueName || '', startTime: m.startTime || '',
        matchStatus: m.matchStatus || 0, score: m.score || '',
        halfScore: m.halfScore || '', duration: m.duration || '',
        yellow: m.yellow || '', red: m.red || '',
        recommNum: m.recommNum || 0, date: md
      };

      if (data.m[mkey]) { updateCount++; } else { newCount++; }
      data.m[mkey] = newMatch;
    }

    // 从 500.com 赔率数据补充单关标识
    try {
      const oddsFile = path.join(ODDS_DIR, period.date + '.json');
      if (fs.existsSync(oddsFile)) {
        const oddsData = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
        const oddsMap = oddsData.odds || {};
        let singleCount = 0;
        Object.keys(data.m).forEach(k => {
          const match = data.m[k];
          if (!match || (match.date || '').slice(0, 10) !== period.date) return;
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
    notifyReload();

  } catch (e) {
    log('[match_list] 同步失败: ' + e.message);
    await refreshToken();
  }
}

// ═══ Task 3: 推荐方向同步（每 20 分钟） ═══
async function syncRecommends() {
  const period = getCurrentPeriod();

  try {
    const token = await getToken();

    // 加载 data.json
    let data = {};
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
    if (!data.m) data.m = {};
    if (!data.r) data.r = {};

    // 筛选今日比赛
    const todayMatches = [];
    Object.keys(data.m).forEach(k => {
      const m = data.m[k];
      if (m && m.date && m.date.slice(0, 10) === period.date) {
        todayMatches.push(m);
      }
    });

    if (todayMatches.length === 0) {
      log('[recommend] 今日无比赛');
      return;
    }

    let recChanged = 0, resultUpdated = 0;

    for (let i = 0; i < todayMatches.length; i++) {
      const m = todayMatches[i];
      const mid = String(m.matchId || '');

      try {
        const recRes = await getWithUA(
          MIDOU_BASE + '/score/getExpertRecommData.do',
          { dataId: mid, type: 0 },
          { Cookie: 'token=' + token }
        );

        if (recRes.code === 1 && recRes.data && recRes.data.length) {
          const recs = recRes.data
            .filter(x => x && x.type && x.num > 0)
            .map(x => ({
              type: x.type,
              num: x.num,
              result: x.result !== undefined ? x.result : null
            }));

          const rk = 'm_' + mid;
          const oldRecs = data.r[rk] || [];
          const oldLen = oldRecs.length;
          const oldResultCount = oldRecs.filter(r => r.result !== null && r.result !== 2).length;

          data.r[rk] = recs;
          if (recs.length !== oldLen) recChanged++;

          const newResultCount = recs.filter(r => r.result !== null && r.result !== 2).length;
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

    // 状态汇总
    const allDone = todayMatches.every(m => m.matchStatus >= 2);
    const summary = todayMatches.map(m =>
      (m.num || '') + ':' + (m.matchStatus === 0 ? '未' : m.matchStatus === 1 ? '赛中' : m.matchStatus === 2 ? '完' : '取消')
    ).join(',');
    log('[recommend] ' + todayMatches.length + '场 [' + summary + '] 推荐变更:' + recChanged + ' 命中更新:' + resultUpdated + (allDone ? ' ALL_DONE' : ''));

    // 如果有命中结果更新，通知 simple.js 重载
    if (resultUpdated > 0 || recChanged > 0) notifyReload();

  } catch (e) {
    log('[recommend] 同步失败: ' + e.message);
    await refreshToken();
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
      { Cookie: 'token=' + token }
    );

    if (matchRes.code !== 1 || !matchRes.data) return;

    const matches = (matchRes.data || []).map(m => {
      let md = '';
      if (m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10) md = m.bDate.slice(0, 10);
      if (!md) md = today;
      return {
        matchId: String(m.matchId || m.dataId || ''),
        num: m.num || '', homeName: m.homeName || '', visitName: m.visitName || '',
        leagueName: m.leagueName || '', startTime: m.startTime || '',
        matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
        score: m.score || '', halfScore: m.halfScore || '',
        duration: m.duration || '', yellow: m.yellow || '', red: m.red || '',
        homeScore: m.homeScore !== undefined ? m.homeScore : -1,
        visitScore: m.visitScore !== undefined ? m.visitScore : -1,
        recommNum: m.recommNum || 0, date: md
      };
    });

    // 写入 live_scores.json
    atomicWrite(LIVE_FILE, { date: today, matches, updated: new Date().toISOString() });

    // 同步到 data.json 的比分字段
    syncLiveToData(matches);

    const liveCount = matches.filter(m => m.matchStatus === 1).length;
    const finishedCount = matches.filter(m => m.matchStatus >= 2).length;
    log('[live_score] ' + matches.length + '场, 赛中:' + liveCount + ', 已结束:' + finishedCount);

  } catch (e) {
    // 比分同步失败不抛异常，静默跳过
  }
}

/** 把实时比分合并到 data.json（增加 num 回退匹配） */
function syncLiveToData(liveMatches) {
  try {
    let data = {};
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return; }
    if (!data.m) data.m = {};

    // 构建 num→key 的索引，用于 matchId 不匹配时的回退查找
    const numIndex = {};
    Object.keys(data.m).forEach(k => {
      const m = data.m[k];
      if (m && m.num) numIndex[m.num] = k;
    });

    let updated = 0;
    liveMatches.forEach(lm => {
      // 优先用 matchId 匹配
      let key = 'm_' + lm.matchId;
      let old = data.m[key];
      // 回退：用竞彩编号 num 匹配
      if (!old && lm.num && numIndex[lm.num]) {
        key = numIndex[lm.num];
        old = data.m[key];
      }
      if (old) {
        if (old.matchStatus !== lm.matchStatus || old.score !== lm.score ||
            old.duration !== lm.duration || old.yellow !== lm.yellow ||
            old.red !== lm.red || old.halfScore !== lm.halfScore) {
          updated++;
          data.m[key] = Object.assign({}, old, {
            matchStatus: lm.matchStatus, score: lm.score,
            halfScore: lm.halfScore, duration: lm.duration,
            yellow: lm.yellow, red: lm.red, recommNum: lm.recommNum
          });
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

// ═══ Task 5: 赛后回填专家命中结果 ═══
async function backfillResults(dateStr) {
  log('[backfill] 开始回填 ' + dateStr + ' 命中信息...');

  try {
    const token = await getToken();
    let data = {};
    try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
    if (!data.m) data.m = {}; if (!data.r) data.r = {};

    // 找已结束但 result 仍为 null/2 的比赛
    const needBackfill = [];
    Object.keys(data.r).forEach(rk => {
      const mid = rk.replace('m_', '');
      const match = data.m[rk] || data.m['m_' + mid];
      if (!match || !match.date || match.date.slice(0, 10) !== dateStr) return;
      if (match.matchStatus < 2) return;
      const recs = data.r[rk] || [];
      const staleCount = recs.filter(r => r.result === null || r.result === 2).length;
      if (staleCount > 0) {
        needBackfill.push({ mid, match, staleCount });
      }
    });

    if (needBackfill.length === 0) { log('[backfill] 无需回填'); return; }

    log('[backfill] ' + needBackfill.length + ' 场比赛需要回填');
    let updated = 0;

    for (const item of needBackfill) {
      try {
        const recRes = await getWithUA(
          MIDOU_BASE + '/score/getExpertRecommData.do',
          { dataId: item.mid, type: 0 },
          { Cookie: 'token=' + token }
        );
        if (recRes.code === 1 && recRes.data && recRes.data.length) {
          const newRecs = recRes.data
            .filter(x => x && x.type && x.num > 0)
            .map(x => ({ type: x.type, num: x.num, result: x.result !== undefined ? x.result : null }));

          const rk = 'm_' + item.mid;
          const oldStale = (data.r[rk] || []).filter(r => r.result === null || r.result === 2).length;
          data.r[rk] = newRecs;
          const newStale = newRecs.filter(r => r.result === null || r.result === 2).length;
          if (newStale < oldStale) {
            updated++;
            log('[backfill] ' + rk + ' (' + item.match.homeName + ' vs ' + item.match.visitName + ') stale:' + oldStale + '→' + newStale);
          }
        }
      } catch (e) {
        log('[backfill] ' + item.mid + ' 失败: ' + e.message);
      }
      await sleep(jitter(300));
    }

    if (updated > 0) {
      atomicWrite(DATA_FILE, data);
      notifyReload();
      log('[backfill] 完成, 更新了 ' + updated + ' 场比赛');
    } else {
      log('[backfill] 无新增命中');
    }
  } catch (e) {
    log('[backfill] 错误: ' + e.message);
  }
}

// ═══ Task 6: 计算出"最后一场+3h"的时间点 ═══
function getDayEndTime(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return 0;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

    let latestTime = 0;
    const year = new Date().getFullYear();

    Object.values(data.m || {}).forEach(m => {
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

/** 全量核对收尾：回填命中 + 赔率完整性 + 状态修正 */
async function finalCheck(dateStr) {
  log('══════ 最终核对 [' + dateStr + '] 开始 ══════');

  // 1. 回填所有命中结果
  await backfillResults(dateStr);

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
      Object.keys(data.m).forEach(k => {
        const m = data.m[k];
        if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
        if (m.matchStatus >= 2) return;
        const recs = (data.r['m_' + m.matchId] || data.r[m.matchId] || []);
        if (recs.some(r => r.result !== null && r.result !== 2)) {
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
  notifyReload();
}

// ═══ 辅助：确保当天比赛数据存在（启动后每30分钟重试，最多5次） ═══
let _ensureRetries = 0;
const _ensureMaxRetries = 5;
let _ensureTimer = null;

function startEnsureTodayMatches() {
  if (_ensureTimer) clearInterval(_ensureTimer);
  _ensureTimer = setInterval(async () => {
    if (_ensureRetries >= _ensureMaxRetries) {
      clearInterval(_ensureTimer);
      _ensureTimer = null;
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const hasData = todayHasMatches(today);
    if (hasData) {
      log('[ensure] ' + today + ' 已有 ' + countTodayMatches(today) + ' 场比赛数据，重试停止');
      clearInterval(_ensureTimer);
      _ensureTimer = null;
      _ensureRetries = 0;
      return;
    }
    _ensureRetries++;
    log('[ensure] ' + today + ' 无比赛数据，尝试同步 (第' + _ensureRetries + '/' + _ensureMaxRetries + '次)...');
    try {
      await syncMatchList();
      await sleep(jitter(2000));
      // 同步后立即检查
      if (todayHasMatches(today)) {
        log('[ensure] ✓ 赛程同步成功，' + countTodayMatches(today) + ' 场比赛已入库');
        clearInterval(_ensureTimer);
        _ensureTimer = null;
        _ensureRetries = 0;
        return;
      }
    } catch (e) {
      log('[ensure] 尝试失败: ' + e.message);
    }
  }, 30 * 60 * 1000);  // 30 分钟间隔

  // 立即执行一次
  _ensureTimer._onTimeout(); // Node.js 内部触发，用个简单的方式
}
// Python 式的简单实现
function kickEnsure() {
  if (!_ensureTimer) return;
  // 立即触发一次检查
  setTimeout(async () => {
    if (_ensureRetries >= _ensureMaxRetries) return;
    const today = new Date().toISOString().slice(0, 10);
    if (todayHasMatches(today)) return;
    _ensureRetries++;
    log('[ensure] 立即重试同步 (' + _ensureRetries + '/' + _ensureMaxRetries + ')...');
    try {
      await syncMatchList();
    } catch (e) { log('[ensure] 立即重试失败: ' + e.message); }
  }, 5000);
}

function todayHasMatches(dateStr) {
  return countTodayMatches(dateStr) > 0;
}

function countTodayMatches(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return 0;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let count = 0;
    Object.values(data.m || {}).forEach(m => {
      if (m && m.date && m.date.slice(0, 10) === dateStr) count++;
    });
    return count;
  } catch (e) { return 0; }
}

function getTodayStatusSummary(dateStr) {
  try {
    if (!fs.existsSync(DATA_FILE)) return '无数据';
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let total = 0, status0 = 0, status1 = 0, status2 = 0, other = 0;
    Object.values(data.m || {}).forEach(m => {
      if (!m || !m.date || m.date.slice(0, 10) !== dateStr) return;
      total++;
      if (m.matchStatus === 0) status0++;
      else if (m.matchStatus === 1) status1++;
      else if (m.matchStatus === 2) status2++;
      else other++;
    });
    return total + '场 [未:' + status0 + ' 赛中:' + status1 + ' 完:' + status2 + (other ? ' 其他:' + other : '') + ']';
  } catch (e) { return '?'; }
}

// ═══ 调度器 ═══
let currentDate = '';
let recommendRunning = false;
let liveScoreRunning = false;
let finalCheckDone = false;

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
  log('  增强: 启动重试 + num回退匹配 + 健康监控');
  log('  数据源: midou310.com + 500.com');
  log('════════════════════════════════════════');

  currentDate = new Date().toISOString().slice(0, 10);
  log('[init] 当前日期: ' + currentDate + ' 数据状态: ' + getTodayStatusSummary(currentDate));

  // ═══ 首次启动：如果已过12点 或 今天无数据，立即执行赛程+赔率同步 ═══
  const now = new Date();
  const noonToday = new Date(currentDate + 'T12:00:00+08:00');
  const needSync = (now >= noonToday) || !todayHasMatches(currentDate);

  if (needSync) {
    if (now >= noonToday) {
      log('[init] 当前已过12:00，立即执行赛程+赔率同步');
    } else {
      log('[init] 当前' + currentDate + '缺少比赛数据，提前触发赛程同步');
    }
    try {
      await syncMatchList();
      await sleep(jitter(2000));
      await sync500Odds(currentDate);
      await sleep(jitter(2000));
      sync500Shuju(currentDate);
      sync500ShujuSelenium(currentDate);
      // 延后5分钟合并数据
      setTimeout(() => {
        try {
          const { mergeShuju } = require('./merge_shuju');
          mergeShuju(currentDate);
          log('[init] 数据合并完成, ' + getTodayStatusSummary(currentDate));
        } catch (e) {}
      }, 5 * 60 * 1000);
    } catch (e) { log('[init] 初始同步失败: ' + e.message); }
  } else {
    log('[init] 今日数据已存在，跳过赛程同步');
  }

  // ═══ 启动重试保障：如果启动时就有数据缺失，启动 30 分钟重试 ═══
  if (!todayHasMatches(currentDate)) {
    log('[init] ⚠️ 今日仍无数据，启动重试机制（每30分钟，最多5次）');
    kickEnsure();
    startEnsureTodayMatches();
  }

  // ═══ 循环1: 每2分钟 — 实时比分 ═══
  async function liveScoreLoop() {
    if (liveScoreRunning) return;
    liveScoreRunning = true;
    try { await syncLiveScores(); } catch (e) {}
    liveScoreRunning = false;
    setTimeout(liveScoreLoop, 120000);
  }

  // ═══ 循环2: 每20分钟 — 推荐方向 + 最后一场+3h检测 ═══
  async function recommendLoop() {
    if (recommendRunning) return;
    recommendRunning = true;
    try {
      await syncRecommends();

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
        await syncMatchList();
        await sleep(jitter(2000));
        await sync500Odds(today);
        await sleep(jitter(2000));
        sync500Shuju(today); // 静态 HTML
        sync500ShujuSelenium(today); // Selenium JS 渲染
        // 延后 5 分钟合并数据 + 清理（等 Selenium 完成）
        setTimeout(() => {
          log('[shuju] 开始合并静态+Selenium数据...');
          try {
            const { mergeShuju } = require('./merge_shuju');
            mergeShuju(today);
            log('[shuju] 合并完成: ' + getTodayStatusSummary(today));
          } catch (e) { log('[shuju] 合并失败: ' + e.message); }
        }, 5 * 60 * 1000);
      } catch (e) {
        log('[scheduler] 12:00 任务失败: ' + e.message);
        // 失败后启动重试
        if (!todayHasMatches(today)) {
          kickEnsure();
          startEnsureTodayMatches();
        }
      }

      scheduleNoon(); // 预约明天
    }, delay);
  }

  // 启动所有循环（错峰启动，避免同时发起请求）
  setTimeout(liveScoreLoop, 5000);     // 5秒后开始比分
  setTimeout(recommendLoop, 30000);    // 30秒后开始推荐
  scheduleNoon();                       // 计算12:00定时

  // ═══ 健康监控：每10分钟检查数据状态 ═══
  setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== currentDate) {
      log('[scheduler] 日期变更: ' + currentDate + ' → ' + today);
      currentDate = today;
      finalCheckDone = false;
      _ensureRetries = 0;
      // 如果新的一天没数据，启动重试
      if (!todayHasMatches(today)) {
        kickEnsure();
        startEnsureTodayMatches();
      }
    }
    // 每小时输出一次完整健康状态
    if (new Date().getMinutes() === 0) {
      log('[health] ' + today + ' 数据状态: ' + getTodayStatusSummary(today));
    }
  }, 60000);
}

start().catch(e => {
  log('FATAL: ' + e.message);
  process.exit(1);
});
