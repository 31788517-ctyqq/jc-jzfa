const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 定时抓取主流程 - Cron: 0 */30 11-23 * * * *
 * 1. 获取当日比赛列表
 * 2. 存储到 matches 集合
 * 3. 遍历获取每场推荐详情
 * 4. 存储到 recommends 集合
 * 5. 记录抓取日志
 */
exports.main = async (event, context) => {
  const startTime = Date.now();
  const db = cloud.database();
  const _ = db.command;
  const dateStr = new Date().toISOString().slice(0, 10);

  try {
    console.log(`[scheduled-crawl] 开始执行, 日期: ${dateStr}`);

    const matchListRes = await cloud.callFunction({ name: 'fetch-match-list', data: { date: dateStr } });
    if (matchListRes.result.code !== 1) {
      throw new Error(matchListRes.result.msg);
    }
    const matches = matchListRes.result.data;
    console.log(`[scheduled-crawl] 获取到 ${matches.length} 场比赛`);

    const batch = db.collection('matches');
    await batch.where({ date: dateStr }).remove();

    const matchIds = [];
    for (const match of matches) {
      await batch.add({ data: { _id: match.matchId, ...match } });
      matchIds.push(match.matchId);
    }

    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const matchId of matchIds) {
      try {
        const recommRes = await cloud.callFunction({ name: 'fetch-recommend', data: { matchId } });
        if (recommRes.result.code === 1) {
          const doc = {
            _id: `${matchId}_${dateStr}_${Date.now()}`,
            matchId,
            date: dateStr,
            matchStatus: (matches.find(m => m.matchId === matchId) || {}).matchStatus || 0,
            captureTime: new Date().toISOString(),
            captureTimestamp: Date.now(),
            recommendations: recommRes.result.data.recommendations
          };
          await db.collection('recommends').add({ data: doc });
          successCount++;
        } else {
          failCount++;
          errors.push({ matchId, error: recommRes.result.msg });
        }
      } catch (err) {
        failCount++;
        errors.push({ matchId, error: err.message });
      }
    }

    const duration = Date.now() - startTime;
    await db.collection('crawl_logs').add({
      data: {
        captureTime: new Date().toISOString(),
        captureTimestamp: Date.now(),
        matchCount: matches.length,
        successCount,
        failCount,
        errors: errors.slice(0, 20),
        duration
      }
    });

    console.log(`[scheduled-crawl] 完成: 成功=${successCount}, 失败=${failCount}, 耗时=${duration}ms`);

    return {
      code: 1,
      data: { matchCount: matches.length, successCount, failCount, duration }
    };
  } catch (err) {
    console.error('[scheduled-crawl]', err.message);
    return { code: 0, msg: `定时抓取失败: ${err.message}` };
  }
};
