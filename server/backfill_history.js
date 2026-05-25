/**
 * 历史推荐数据回填脚本
 * 为 data.json 中所有缺少推荐数据的比赛抓取专家推荐方向及命中结果
 *
 * 用法: node server/backfill_history.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { getWithUA, sleep, jitter } = require('./http-utils');
const { getToken, refreshToken } = require('./token_manager');

const DATA_FILE = path.join(__dirname, 'data.json');
const MIDOU_BASE = 'https://midou310.com/mdsj';
const BATCH_SAVE_INTERVAL = 20;
const REQUEST_DELAY_MS = 400;

const dryRun = process.argv.includes('--dry-run');

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log('[' + ts + '] ' + msg);
}

function atomicWrite(filePath, obj) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, filePath);
}

async function main() {
  log('历史推荐数据回填启动' + (dryRun ? ' [DRY RUN]' : ''));

  if (!fs.existsSync(DATA_FILE)) {
    log('ERROR: data.json 不存在');
    process.exit(1);
  }
  let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.r) data.r = {};
  const mMap = data.m || {};

  // 找出所有需要回填的比赛
  const toFetch = [];
  Object.keys(mMap).forEach(k => {
    const m = mMap[k];
    if (!m || !m.matchId) return;
    const mid = String(m.matchId);
    const rk = 'm_' + mid;
    const existingRecs = data.r[rk] || data.r[mid] || [];
    const hasStale = existingRecs.length > 0 && existingRecs.some(r => r.result === null || r.result === 2);
    const noRecs = existingRecs.length === 0;

    if (noRecs || hasStale) {
      toFetch.push({
        mid, rk: 'm_' + mid,
        date: m.date || '', num: m.num || '',
        home: m.homeName || '', visit: m.visitName || '',
        matchStatus: m.matchStatus || 0,
        existingCount: existingRecs.length,
        staleCount: existingRecs.filter(r => r.result === null || r.result === 2).length
      });
    }
  });

  toFetch.sort((a, b) => b.date.localeCompare(a.date));

  log('共 ' + toFetch.length + ' 场比赛需要回填');
  if (toFetch.length === 0) { log('无需回填，退出'); process.exit(0); }

  // 日期分布
  const dateDist = {};
  toFetch.forEach(t => {
    if (!dateDist[t.date]) dateDist[t.date] = 0;
    dateDist[t.date]++;
  });
  log('覆盖 ' + Object.keys(dateDist).length + ' 个日期');

  if (dryRun) { log('DRY RUN 完成，退出'); process.exit(0); }

  // 获取 token
  let token;
  try {
    token = await getToken();
    log('Token 获取成功');
  } catch (e) {
    log('ERROR: Token 获取失败: ' + e.message);
    process.exit(1);
  }

  // 逐场抓取
  let success = 0, fail = 0, skipped = 0, batchCount = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const item = toFetch[i];
    const progress = '[' + (i + 1) + '/' + toFetch.length + ']';

    try {
      const recRes = await getWithUA(
        MIDOU_BASE + '/score/getExpertRecommData.do',
        { dataId: item.mid, type: 0 },
        { Cookie: 'token=' + token }
      );

      if (recRes.code === 1 && recRes.data && recRes.data.length > 0) {
        const recs = recRes.data
          .filter(x => x && x.type && x.num > 0)
          .map(x => ({ type: x.type, num: x.num, result: x.result !== undefined ? x.result : null }));

        if (recs.length > 0) {
          data.r[item.rk] = recs;
          const hitCount = recs.filter(r => r.result === 1).length;
          log(progress + ' OK ' + item.date + ' ' + item.num + ' ' + item.home + ' vs ' + item.visit + ' -> ' + recs.length + ' recs (hit:' + hitCount + ')');
          success++; batchCount++;
        } else {
          skipped++;
        }
      } else if (recRes.code === -1) {
        log(progress + ' Token expired, refreshing...');
        try { token = await refreshToken(); } catch (e) {}
        i--;
        await sleep(2000);
        continue;
      } else {
        skipped++;
      }
    } catch (e) {
      log(progress + ' FAIL ' + item.date + ' ' + item.num + ': ' + e.message);
      fail++;
    }

    if (batchCount >= BATCH_SAVE_INTERVAL) {
      atomicWrite(DATA_FILE, data);
      log('  [saved] success:' + success + ' fail:' + fail + ' skip:' + skipped);
      batchCount = 0;
    }

    await sleep(jitter(REQUEST_DELAY_MS));

    if ((i + 1) % 100 === 0) {
      try { token = await refreshToken(); log('  [token refreshed]'); } catch (e) {}
    }
  }

  atomicWrite(DATA_FILE, data);
  log('');
  log('=== DONE ===');
  log('success: ' + success + ' fail: ' + fail + ' skip: ' + skipped);
}

main().catch(e => {
  log('FATAL: ' + e.message);
  console.error(e);
  process.exit(1);
});
