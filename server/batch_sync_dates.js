/**
 * Batch sync: re-fetch matches, recs, odds for date range
 * Usage: node server/batch_sync_dates.js
 */
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_DIR = path.join(__dirname, 'odds_history');

const DATES = ['2026-05-20', '2026-05-21', '2026-05-22', '2026-05-23', '2026-05-24'];

function log(msg) {
  console.log('[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg);
}

const httpUtils = require('./http-utils');
const tokenMgr = require('./token_manager');
const fetch500Odds_module = require('./fetch_500odds');
const MIDOU_BASE = 'https://midou310.com/mdsj';

const weekMap = { 0: '周日', 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };

function getWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  return weekMap[d.getDay()];
}

function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, filePath);
}

async function syncMatchList(dateStr) {
  const week = getWeek(dateStr);
  log('[MATCH] ' + dateStr + ' ' + week);

  const token = await tokenMgr.getToken();
  const timestamp = new Date(dateStr + 'T00:00:00+08:00').getTime();

  const matchRes = await httpUtils.getWithRetry(
    MIDOU_BASE + '/score/footballDataList.do',
    { time: timestamp, order: 'status desc, start_datetime asc, data_id asc' },
    { Cookie: 'token=' + token },
  );

  if (matchRes.code !== 1 || !matchRes.data) {
    log('[MATCH] Failed: ' + (matchRes.msg || 'no data'));
    return [];
  }

  const periodMatches = (matchRes.data || []).filter(function (m) {
    if (!m.num || m.num.indexOf(week) !== 0) return false;
    const bd = (m.bDate || '').slice(0, 10);
    if (bd === dateStr) return true;
    return false;
  });

  log('[MATCH] ' + dateStr + ': ' + periodMatches.length + ' matches');

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  if (!data.m) data.m = {};
  if (!data.r) data.r = {};

  let newCount = 0,
    updateCount = 0;
  periodMatches.forEach(function (m) {
    const mid = String(m.matchId || m.dataId || '');
    const mkey = 'm_' + mid;
    const md = m.bDate && typeof m.bDate === 'string' && m.bDate.length >= 10 ? m.bDate.slice(0, 10) : dateStr;

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
  });

  atomicWrite(DATA_FILE, data);
  log('[MATCH] ' + dateStr + ': new=' + newCount + ' updated=' + updateCount);
  return periodMatches;
}

async function syncRecommends(dateStr, matches) {
  log('[RECS] ' + dateStr + ' ' + matches.length + ' matches');
  const token = await tokenMgr.getToken();

  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.r) data.r = {};

  let newRecs = 0,
    updatedRecs = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const mid = String(m.matchId || m.dataId || '');
    try {
      const recRes = await httpUtils.getWithUA(
        MIDOU_BASE + '/score/getExpertRecommData.do',
        { dataId: mid, type: 0 },
        { Cookie: 'token=' + token },
      );

      if (recRes.code === 1 && recRes.data && recRes.data.length) {
        const recs = recRes.data
          .filter(function (x) {
            return x && x.type && x.num > 0;
          })
          .map(function (x) {
            return { t: x.type, n: x.num, rs: x.result !== undefined ? x.result : null };
          });

        const rk = 'm_' + mid;
        if (!data.r[rk] || data.r[rk].length === 0) newRecs++;
        else updatedRecs++;
        data.r[rk] = recs;
      }
    } catch (e) {
      log('[RECS] ' + m.num + ' failed: ' + e.message);
    }
    await new Promise(function (r) {
      setTimeout(r, 300 + Math.random() * 500);
    });
  }

  atomicWrite(DATA_FILE, data);
  log('[RECS] ' + dateStr + ': new=' + newRecs + ' updated=' + updatedRecs);
}

async function syncOdds(dateStr) {
  log('[ODDS] ' + dateStr);
  const filePath = path.join(ODDS_DIR, dateStr + '.json');
  if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
    log('[ODDS] ' + dateStr + ' already exists');
    return;
  }
  try {
    const odds = await fetch500Odds_module.fetchOdds(dateStr);
    const matchNums = Object.keys(odds);
    if (matchNums.length === 0) {
      log('[ODDS] ' + dateStr + ' empty');
      fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, odds: {}, empty: true }));
      return;
    }
    fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, odds: odds }));
    log('[ODDS] ' + dateStr + ': ' + matchNums.length + ' matches');
  } catch (e) {
    log('[ODDS] ' + dateStr + ' failed: ' + e.message);
  }
}

(async function () {
  log('══════ Batch sync: ' + DATES.length + ' dates ══════');

  for (let i = 0; i < DATES.length; i++) {
    const d = DATES[i];
    log('\n--- ' + d + ' (' + (i + 1) + '/' + DATES.length + ') ---');
    try {
      const matches = await syncMatchList(d);
      if (matches.length > 0) {
        await new Promise(function (r) {
          setTimeout(r, 2000);
        });
        await syncRecommends(d, matches);
      }
      await new Promise(function (r) {
        setTimeout(r, 1000);
      });
      await syncOdds(d);
    } catch (e) {
      log('[ERROR] ' + d + ': ' + e.message);
    }
  }

  log('\n══════ Done ══════');
  process.exit(0);
})().catch(function (e) {
  log('FATAL: ' + e.message);
  process.exit(1);
});
