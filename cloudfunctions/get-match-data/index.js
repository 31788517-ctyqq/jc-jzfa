const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

/**
 * 小程序前端 HTTP API 统一入口
 * action 列表: match-list, recommend-trend, hit-rate-stats, ranking-list, match-detail
 */
exports.main = async (event, context) => {
  const db = cloud.database();
  const _ = db.command;
  const { action, data = {} } = event;

  try {
    switch (action) {

      case 'match-list': {
        const date = data.date || new Date().toISOString().slice(0, 10);
        const res = await db.collection('matches')
          .where({ date })
          .orderBy('num', 'asc')
          .get();
        return { code: 1, data: res.data || [] };
      }

      case 'recommend-trend': {
        const { matchId } = data;
        if (!matchId) return { code: 0, msg: '缺少 matchId' };
        const res = await db.collection('recommends')
          .where({ matchId })
          .orderBy('captureTimestamp', 'asc')
          .get();

        const trendData = (res.data || []).map(doc => ({
          captureTime: doc.captureTime,
          captureTimestamp: doc.captureTimestamp,
          recommendations: doc.recommendations || [],
          matchStatus: doc.matchStatus
        }));

        const allDirections = new Set();
        trendData.forEach(t => {
          (t.recommendations || []).forEach(r => {
            if (r.num > 0) allDirections.add(r.type);
          });
        });

        const directions = Array.from(allDirections);
        const series = directions.map(dir => ({
          name: dir,
          type: 'line',
          smooth: true,
          data: trendData.map(t => {
            const found = (t.recommendations || []).find(r => r.type === dir);
            return found ? found.num : 0;
          })
        }));

        const lastItem = trendData.length > 0 ? trendData[trendData.length - 1] : null;
        return {
          code: 1,
          data: {
            matchId,
            timeLabels: trendData.map(t => (t.captureTime || '').slice(11, 16)),
            series,
            lastResult: lastItem ? lastItem.recommendations : []
          }
        };
      }

      case 'hit-rate-stats': {
        const days = data.days || 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startStr = startDate.toISOString().slice(0, 10);
        const endStr = endDate.toISOString().slice(0, 10);

        const res = await db.collection('hit_rates')
          .where({ _id: _.gte(startStr).and(_.lte(endStr)) })
          .orderBy('statDate', 'desc')
          .limit(days)
          .get();

        const directionAgg = {};
        const dailyTrend = [];

        for (const doc of res.data || []) {
          dailyTrend.push({
            date: doc.statDate,
            totalMatches: doc.completedMatches || 0,
            directions: doc.directionStats || []
          });

          for (const ds of doc.directionStats || []) {
            if (!directionAgg[ds.direction]) {
              directionAgg[ds.direction] = { total: 0, hit: 0, miss: 0 };
            }
            directionAgg[ds.direction].total += ds.totalRecommends || 0;
            directionAgg[ds.direction].hit += ds.hitCount || 0;
            directionAgg[ds.direction].miss += ds.missCount || 0;
          }
        }

        const directionStats = Object.entries(directionAgg).map(([direction, stats]) => ({
          direction,
          totalRecommends: stats.total,
          hitCount: stats.hit,
          missCount: stats.miss,
          hitRate: stats.total > 0 ? Number((stats.hit / stats.total * 100).toFixed(2)) : 0
        }));

        directionStats.sort((a, b) => b.hitRate - a.hitRate);

        return {
          code: 1,
          data: {
            totalDays: dailyTrend.length,
            directionStats,
            dailyTrend: dailyTrend.reverse()
          }
        };
      }

      case 'ranking-list': {
        const rankingDate = data.date || new Date().toISOString().slice(0, 10);
        const filterDirection = data.direction || null;
        const filterCategory = data.category || null;
        const matchRes = await db.collection('matches').where({ date: rankingDate }).get();
        const matches = matchRes.data || [];
        const rankingList = [];

        const classifyType = (type) => {
          if (!type) return '其他';
          if (type.indexOf('半全场') === 0) return '半全场';
          if (type.indexOf('总进球') === 0) return '进球数';
          if (type.indexOf('、') !== -1) return '双选';
          if (type.indexOf('让') === 0) return '让球';
          if (['胜', '平', '负'].includes(type)) return '胜平负';
          return '其他';
        };

        for (const match of matches) {
          const r = await db.collection('recommends')
            .where({ matchId: match._id })
            .orderBy('captureTimestamp', 'desc')
            .limit(1)
            .get();
          if (r.data.length === 0) continue;
          const latest = r.data[0];
          const recommendations = latest.recommendations || [];

          if (filterDirection) {
            const found = recommendations.find(x => x.type === filterDirection);
            if (found && found.num > 0) {
              rankingList.push({
                matchId: match._id,
                homeName: match.homeName,
                visitName: match.visitName,
                leagueName: match.leagueName,
                num: match.num,
                date: match.date,
                direction: filterDirection,
                expertCount: found.num,
                matchStatus: match.matchStatus
              });
            }
          } else {
            const pool = filterCategory
              ? recommendations.filter(x => classifyType(x.type) === filterCategory && x.num > 0)
              : recommendations;
            const maxDir = pool.reduce((a, b) => {
              return (b.num || 0) > ((a && a.num) || 0) ? b : a;
            }, null);
            if (maxDir && maxDir.num > 0) {
              rankingList.push({
                matchId: match._id,
                homeName: match.homeName,
                visitName: match.visitName,
                leagueName: match.leagueName,
                num: match.num,
                date: match.date,
                direction: maxDir.type,
                expertCount: maxDir.num,
                matchStatus: match.matchStatus
              });
            }
          }
        }

        rankingList.sort((a, b) => b.expertCount - a.expertCount);
        const result = rankingList.map((item, i) => ({ rank: i + 1, ...item }));

        const allDirs = new Set();
        for (const match of matches) {
          const r2 = await db.collection('recommends')
            .where({ matchId: match._id })
            .orderBy('captureTimestamp', 'desc')
            .limit(1)
            .get();
          if (r2.data.length > 0) {
            (r2.data[0].recommendations || []).forEach(x => {
              if (x.num > 0) allDirs.add(x.type);
            });
          }
        }

        return {
          code: 1,
          data: {
            date: rankingDate,
            filterDirection,
            filterCategory,
            totalMatches: result.length,
            availableDirections: Array.from(allDirs).sort(),
            ranking: result
          }
        };
      }

      case 'match-detail': {
        const { matchId: detailId } = data;
        if (!detailId) return { code: 0, msg: '缺少 matchId' };
        const mRes = await db.collection('matches').doc(detailId).get();
        const matchInfo = mRes.data || {};
        return { code: 1, data: matchInfo };
      }

      default:
        return { code: 0, msg: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error(`[get-match-data] action=${action}`, err.message);
    return { code: 0, msg: `操作失败: ${err.message}` };
  }
};
