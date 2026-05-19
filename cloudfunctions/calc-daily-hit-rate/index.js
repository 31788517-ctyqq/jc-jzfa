const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 每日凌晨计算命中率 - Cron: 0 0 2 * * * *
 * 1. 遍历最近30天
 * 2. 获取每天已完成比赛
 * 3. 获取最后一次抓取的推荐数据
 * 4. 按方向汇总命中/未中
 * 5. 写入 hit_rates 集合
 */
exports.main = async (event, context) => {
  const db = cloud.database();
  const _ = db.command;
  const today = new Date();
  const results = [];

  console.log('[calc-daily-hit-rate] 开始计算命中率');

  for (let i = 0; i < 30; i++) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const dateStr = day.toISOString().slice(0, 10);

    try {
      const matchRes = await db.collection('matches')
        .where({ date: dateStr, matchStatus: _.gte(2) })
        .get();

      const completedMatches = matchRes.data || [];
      if (completedMatches.length === 0) continue;

      const directionMap = {};

      for (const match of completedMatches) {
        const recommRes = await db.collection('recommends')
          .where({ matchId: match._id })
          .orderBy('captureTimestamp', 'desc')
          .limit(1)
          .get();

        if (recommRes.data.length === 0) continue;
        const lastRecomm = recommRes.data[0];

        for (const r of lastRecomm.recommendations) {
          if (!directionMap[r.type]) {
            directionMap[r.type] = { total: 0, hit: 0, miss: 0 };
          }
          if (r.num > 0 && r.result !== null && r.result !== undefined) {
            directionMap[r.type].total += r.num;
            if (r.result === 1) directionMap[r.type].hit += r.num;
            else if (r.result === 0) directionMap[r.type].miss += r.num;
          }
        }
      }

      if (Object.keys(directionMap).length > 0) {
        const directionStats = Object.entries(directionMap).map(([direction, stats]) => ({
          direction,
          totalRecommends: stats.total,
          hitCount: stats.hit,
          missCount: stats.miss,
          hitRate: stats.total > 0 ? Number((stats.hit / stats.total * 100).toFixed(2)) : 0
        }));

        results.push({
          _id: dateStr,
          statDate: dateStr,
          completedMatches: completedMatches.length,
          lastCalcTime: new Date().toISOString(),
          directionStats
        });
      }
    } catch (err) {
      console.error(`[calc-daily-hit-rate] ${dateStr} 计算失败:`, err.message);
    }
  }

  for (const doc of results) {
    try {
      await db.collection('hit_rates').doc(doc._id).set({ data: doc });
    } catch (err) {
      console.error(`[calc-daily-hit-rate] 写入 ${doc._id} 失败:`, err.message);
    }
  }

  console.log(`[calc-daily-hit-rate] 完成, 共计算 ${results.length} 天`);
  return { code: 1, data: { daysCalculated: results.length } };
};
