/**
 * 一次性同步脚本：拉取今日比赛、推荐、赔率
 * 用法: node server/oneshot_sync.js [date]
 */
const fs = require('fs');
const path = require('path');
const { getWithUA, getWithRetry, jitter, sleep } = require('./http-utils');
const { getToken, refreshToken } = require('./token_manager');
const { fetchOdds: fetch500Odds } = require('./fetch_500odds');

const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_DIR = path.join(__dirname, 'odds_history');
const MIDOU_BASE = 'https://midou310.com/mdsj';

const targetDate = process.argv[2] || new Date().toISOString().slice(0, 10);
const weekMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
const week = weekMap[new Date(targetDate).getDay()];

function log(msg) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log('[' + ts + '] ' + msg);
}

function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, filePath);
}

// ─── Step 1: 赛程同步 ───
async function syncMatchList() {
  log('[Step 1/3] 同步赛程: ' + targetDate + ' ' + week);

  const token = await getToken();
  const timestamp = new Date(targetDate + 'T00:00:00+08:00').getTime();

  const matchRes = await getWithRetry(
    MIDOU_BASE + '/score/footballDataList.do',
    { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
    { Cookie: 'token=' + token }
  );

  if (matchRes.code !== 1 || !matchRes.data) {
    log('[Step 1/3] 获取失败: ' + (matchRes.msg || ''));
    return false;
  }

  const periodMatches = (matchRes.data || []).filter(m => {
    if (!m.num || m.num.indexOf(week) !== 0) return false;
    const bd = (m.bDate || '').slice(0, 10);
    if (bd === targetDate) return true;
    if (!bd && m.startTime && m.startTime.length >= 11) {
      const st = m.startTime.replace(/\//g, '-');
      const dt = new Date(new Date().getFullYear() + '-' + st.slice(0, 2) + '-' + st.slice(3, 5) + 'T' + st.slice(6, 11) + ':00+08:00');
      if (!isNaN(dt.getTime())) {
        if (dt.getHours() < 9) dt.setDate(dt.getDate() - 1);
        return dt.toISOString().slice(0, 10) === targetDate;
      }
    }
    return false;
  });

  if (periodMatches.length === 0) {
    log('[Step 1/3] ' + targetDate + ' 无比赛');
    return false;
  }

  let data = {};
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  if (!data.m) data.m = {};
  if (!data.r) data.r = {};

  let newCount = 0, updateCount = 0;
  for (const m of periodMatches) {
    const mid = String(m.matchId || m.dataId || '');
    const mkey = 'm_' + mid;
    const md = (m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10)
      ? m.bDate.slice(0, 10) : targetDate;

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

  atomicWrite(DATA_FILE, data);
  log('[Step 1/3] 赛程同步完成: 新增' + newCount + '场 更新' + updateCount + '场');
  return true;
}

// ─── Step 2: 推荐方向同步 ───
async function syncRecommends() {
  log('[Step 2/3] 同步推荐方向...');

  const token = await getToken();
  let data = {};
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  if (!data.m) data.m = {};
  if (!data.r) data.r = {};

  const todayMatches = [];
  Object.keys(data.m).forEach(k => {
    const m = data.m[k];
    if (m && m.date && m.date.slice(0, 10) === targetDate) {
      todayMatches.push(m);
    }
  });

  if (todayMatches.length === 0) {
    log('[Step 2/3] 今日无比赛，跳过推荐同步');
    return false;
  }

  let newRecs = 0, updatedRecs = 0;
  for (const m of todayMatches) {
    try {
      const recRes = await getWithUA(
        MIDOU_BASE + '/score/getExpertRecommData.do',
        { dataId: m.matchId, type: 0 },
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

        const rk = 'm_' + m.matchId;
        const oldRecs = data.r[rk] || [];
        if (oldRecs.length === 0) newRecs++; else updatedRecs++;
        data.r[rk] = recs;
      }
    } catch (e) {
      log('[Step 2/3] ' + m.num + ' 推荐获取失败: ' + e.message);
    }
    await sleep(jitter(300));
  }

  atomicWrite(DATA_FILE, data);
  log('[Step 2/3] 推荐同步完成: 新增推荐' + newRecs + '场 更新' + updatedRecs + '场');
  return true;
}

// ─── Step 3: 500.com 赔率抓取 ───
async function syncOdds() {
  log('[Step 3/3] 抓取500.com赔率: ' + targetDate);

  const filePath = path.join(ODDS_DIR, targetDate + '.json');
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
    log('[Step 3/3] 已有赔率数据，跳过');
    return true;
  }

  try {
    const odds = await fetch500Odds(targetDate);
    const matchNums = Object.keys(odds);

    if (matchNums.length === 0) {
      log('[Step 3/3] 无赔率数据（可能500.com尚未开售）');
      fs.writeFileSync(filePath, JSON.stringify({ date: targetDate, odds: {}, empty: true }));
      return false;
    }

    fs.writeFileSync(filePath, JSON.stringify({ date: targetDate, odds }));
    log('[Step 3/3] 赔率抓取完成: ' + matchNums.length + ' 场比赛');
    return true;
  } catch (e) {
    log('[Step 3/3] 抓取失败: ' + e.message);
    return false;
  }
}

// ─── Main ───
(async () => {
  log('══════ 一次性同步开始 ══════');
  log('目标日期: ' + targetDate + ' ' + week);

  // Step 1
  const hasMatches = await syncMatchList();
  if (!hasMatches) {
    log('⚠ 今日无比赛数据，流程终止');
    log('原因可能: 1) midou310未发布今日赛程 2) 今日非竞彩开售日');
    process.exit(0);
  }

  await sleep(jitter(2000));

  // Step 2
  await syncRecommends();

  await sleep(jitter(2000));

  // Step 3
  await syncOdds();

  log('══════ 同步完成 ══════');

  // 验证
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const todayCount = Object.keys(data.m || {}).filter(k =>
      data.m[k] && data.m[k].date && data.m[k].date.slice(0, 10) === targetDate
    ).length;
    const oddsFile = path.join(ODDS_DIR, targetDate + '.json');
    const hasOdds = fs.existsSync(oddsFile) && fs.statSync(oddsFile).size > 100;

    log('验证: 今日比赛 ' + todayCount + ' 场, 赔率文件 ' + (hasOdds ? '已生成' : '缺失'));
  } catch (e) {}

  process.exit(0);
})();
