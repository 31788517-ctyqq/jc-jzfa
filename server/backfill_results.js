/**
 * === 推荐结果兜底回填 ===
 * 查找已完赛但推荐结果为 null 的比赛，重新从 API 获取结果数据
 *
 * 触发方式：
 *   node backfill_results.js           → 手动执行
 *   POST /api { action: 'backfill-results' } → 通过 API 触发
 */
const database = require('./database');
const { get } = require('./http-utils');

const CONFIG = {
  MIDOU_BASE: 'https://midou310.com/mdsj',
  MOBILE: process.env.MIDOU_MOBILE,
  PASSWORD: process.env.MIDOU_PASSWORD
};

let token = null;

async function login() {
  if (token) return token;
  const res = await get(`${CONFIG.MIDOU_BASE}/gduser/login.do`, {
    mobile: CONFIG.MOBILE, password: CONFIG.PASSWORD
  });
  if (res.code === 1) { token = res.data.token; return token; }
  throw new Error('登录失败: ' + (res.msg || ''));
}

/**
 * 执行回填
 */
async function main() {
  console.log('[backfill] 开始查找需要回填的推荐数据...');

  // 1. 查找待回填记录
  const stale = database.getStaleRecommendations();
  if (!stale || stale.length === 0) {
    console.log('[backfill] 没有需要回填的数据，所有完赛推荐结果均已就绪');
    return { total: 0, updated: 0 };
  }

  // 去重 matchId（同一场比赛的多个方向一次性拉取）
  const matchIds = [...new Set(stale.map(r => r.matchId))];
  console.log(`[backfill] 发现 ${stale.length} 条 null 结果，涉及 ${matchIds.length} 场比赛`);

  // 2. 登录
  let tk;
  try {
    tk = await login();
  } catch (e) {
    return { total: stale.length, updated: 0, error: e.message };
  }

  // 3. 逐场重新拉取
  let updated = 0, failed = 0;
  for (let i = 0; i < matchIds.length; i++) {
    const mid = matchIds[i];
    const staleItems = stale.filter(r => r.matchId === mid);
    try {
      const res = await get(
        `${CONFIG.MIDOU_BASE}/score/getExpertRecommData.do`,
        { dataId: mid, type: 0 },
        { Cookie: `token=${tk}` }
      );

      if (res.code !== 1 || !res.data) { failed++; continue; }

      const recomms = res.data.filter(x => x && x.type && x.num > 0);
      let matchUpdated = 0;

      for (const staleRow of staleItems) {
        const apiItem = recomms.find(x => x.type === staleRow.type);
        if (apiItem && apiItem.result !== undefined && apiItem.result !== null) {
          database.updateRecommendResult(mid, staleRow.type, staleRow.fetchDate, apiItem.result);
          matchUpdated++;
          updated++;
        }
      }

      if (matchUpdated > 0) {
        console.log(`[backfill] matchId=${mid} 更新了 ${matchUpdated} 条结果`);
      }

      // 延迟避免限流
      await new Promise(r => setTimeout(r, 200));

    } catch (err) {
      failed++;
      console.error(`[backfill] matchId=${mid} 失败:`, err.message);
    }

    // 每 50 场输出进度
    if ((i + 1) % 50 === 0) {
      console.log(`[backfill] 进度 ${i+1}/${matchIds.length}，已更新 ${updated} 条，失败 ${failed} 场`);
    }
  }

  console.log(`\n[backfill] === 完成 ===`);
  console.log(`[backfill] 总待处理: ${stale.length} 条，已更新: ${updated} 条，失败比赛: ${failed} 场`);
  return { total: stale.length, updated, failed };
}

if (require.main === module) {
  database.initDatabase();
  main()
    .then(r => { console.log(JSON.stringify(r)); database.closeDatabase(); })
    .catch(e => { console.error('[backfill] 致命错误:', e.message); database.closeDatabase(); process.exit(1); });
}

module.exports = { main };
