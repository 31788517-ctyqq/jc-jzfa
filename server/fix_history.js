/**
 * 修复历史比赛数据：
 * 1. 根据推荐结果修正 matchStatus（有命中/未中结果 → matchStatus=2）
 * 2. 回填 5/18-5/19 的未知结果（rs=2 → 从API重新抓取）
 *
 * 用法: node server/fix_history.js
 */

const fs = require('fs');
const path = require('path');
const { getWithUA, sleep, jitter } = require('./http-utils');
const { getToken, refreshToken } = require('./token_manager');

const DATA_FILE = path.join(__dirname, 'data.json');
const MIDOU_BASE = 'https://midou310.com/mdsj';

function log(msg) {
  console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg);
}

function atomicWrite(filePath, obj) {
  fs.writeFileSync(filePath + '.tmp', JSON.stringify(obj));
  fs.renameSync(filePath + '.tmp', filePath);
}

async function main() {
  log('历史数据修复启动');

  let data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!data.r) data.r = {};
  const mMap = data.m || {};
  const rMap = data.r || {};

  // Step 1: 修复 matchStatus — 有已知结果（0或1）的比赛标记为已结束
  let statusFixed = 0;
  for (const k of Object.keys(mMap)) {
    const m = mMap[k];
    if (!m || !m.matchId) continue;
    if (m.matchStatus >= 2) continue; // already finished
    const mid = String(m.matchId);
    const recs = rMap['m_' + mid] || rMap[mid] || [];
    const hasKnownResult = recs.some(r => {
      const rs = r.rs !== undefined ? r.rs : r.result;
      return rs === 0 || rs === 1;
    });
    if (hasKnownResult) {
      m.matchStatus = 2;
      statusFixed++;
    }
  }
  log('Step 1: matchStatus 修正 ' + statusFixed + ' 场');

  // Step 2: 回填 result=2 的比赛（5/18-5/19）
  const toBackfill = [];
  for (const k of Object.keys(mMap)) {
    const m = mMap[k];
    if (!m || !m.matchId) continue;
    const mid = String(m.matchId);
    const recs = rMap['m_' + mid] || rMap[mid] || [];
    if (recs.length === 0) continue;
    const allUnknown = recs.every(r => {
      const rs = r.rs !== undefined ? r.rs : r.result;
      return rs === 2 || rs === null || rs === undefined;
    });
    if (allUnknown && recs.length > 0) {
      toBackfill.push({ mid, rk: 'm_' + mid, match: m });
    }
  }

  log('Step 2: 需回填 ' + toBackfill.length + ' 场比赛 (result=2)');

  if (toBackfill.length > 0) {
    let token;
    try { token = await getToken(); } catch (e) { log('Token失败: ' + e.message); process.exit(1); }

    let updated = 0;
    for (const item of toBackfill) {
      try {
        const recRes = await getWithUA(
          MIDOU_BASE + '/score/getExpertRecommData.do',
          { dataId: item.mid, type: 0 },
          { Cookie: 'token=' + token }
        );
        if (recRes.code === 1 && recRes.data && recRes.data.length > 0) {
          const newRecs = recRes.data
            .filter(x => x && x.type && x.num > 0)
            .map(x => ({
              type: x.type,
              num: x.num,
              result: x.result !== undefined ? x.result : null
            }));
          const hasNewResults = newRecs.some(r => r.result === 0 || r.result === 1);
          if (hasNewResults) {
            data.r[item.rk] = newRecs;
            // Also update matchStatus
            const mkey = Object.keys(mMap).find(k => mMap[k] && String(mMap[k].matchId) === item.mid);
            if (mkey && mMap[mkey]) mMap[mkey].matchStatus = 2;
            const hitCount = newRecs.filter(r => r.result === 1).length;
            log('  OK ' + item.match.date + ' ' + item.match.num + ' ' + item.match.homeName + ' vs ' + item.match.visitName + ' -> hit:' + hitCount);
            updated++;
          }
        } else if (recRes.code === -1) {
          try { token = await refreshToken(); } catch (e) {}
        }
      } catch (e) {
        log('  FAIL ' + item.mid + ': ' + e.message);
      }
      await sleep(jitter(400));
    }
    log('Step 2: 回填完成, 更新 ' + updated + ' 场');
  }

  // 保存
  atomicWrite(DATA_FILE, data);
  log('全部完成! statusFixed=' + statusFixed + ' backfilled=' + toBackfill.length);
}

main().catch(e => { console.error(e); process.exit(1); });
