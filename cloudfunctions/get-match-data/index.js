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

      /**
       * 命中率筛选 - 多条件叠加查询
       */
      case 'hit-rate-filter': {
        const { league = '', timeRange = 'all', directionType = '', direction = '', rankTop = 0 } = data;

        const classifyDirType = (type) => {
          if (!type) return '其他';
          if (['胜', '平', '负'].includes(type)) return '胜平负';
          if (type.startsWith('让')) return '让球';
          if (['胜胜', '负负'].includes(type) || type.startsWith('半全场')) return '半全场';
          if (/^[\d,]+$/.test(type)) return '进球数';
          if (/[平胜负让]/.test(type) && type.includes(',')) return '双选';
          return '其他';
        };

        const getDirectionsByType = (dt) => {
          const map = {
            '胜平负': ['胜', '平', '负'],
            '让球': ['让胜', '让平', '让负'],
            '进球数': ['1,2', '2,3', '3,4', '1,2,3', '2,3,4', '3,4,5'],
            '双选': ['平,让平', '让胜,让平', '让平,让负', '胜,平', '平,负'],
            '半全场': ['胜胜', '负负']
          };
          return map[dt] || [];
        };

        // 构建方向过滤集合
        let targetDirs = new Set();
        if (directionType) {
          if (direction) {
            targetDirs.add(direction);
          } else {
            getDirectionsByType(directionType).forEach(d => targetDirs.add(d));
          }
        }

        // 计算时间范围起始日期
        let dateLimit = null;
        if (timeRange !== 'all') {
          const now = new Date();
          now.setDate(now.getDate() - parseInt(timeRange, 10));
          dateLimit = now.toISOString().slice(0, 10);
        }

        // 获取所有比赛（分页）
        const MAX_MATCHES = 500;
        let matchRes = await db.collection('matches')
          .orderBy('date', 'desc')
          .limit(MAX_MATCHES)
          .get();
        let allMatches = matchRes.data || [];

        // 按联赛和日期过滤
        allMatches = allMatches.filter(m => {
          if (league && m.leagueName !== league) return false;
          if (dateLimit && m.date < dateLimit) return false;
          return true;
        });

        // 收集有结果的推荐数据
        const detailList = [];

        for (const match of allMatches) {
          const rRes = await db.collection('recommends')
            .where({ matchId: match._id })
            .orderBy('captureTimestamp', 'desc')
            .limit(1)
            .get();

          const latest = rRes.data.length > 0 ? rRes.data[0] : null;
          if (!latest) continue;

          const recomms = (latest.recommendations || []).filter(r => r.result !== null && r.result !== undefined);

          // 方向过滤
          let filtered = recomms;
          if (targetDirs.size > 0) {
            filtered = recomms.filter(r => targetDirs.has(r.type) || targetDirs.has(classifyDirType(r.type)));
          }

          if (filtered.length === 0) continue;

          // 排名筛选
          filtered.sort((a, b) => b.num - a.num);
          if (rankTop > 0) {
            filtered = filtered.slice(0, rankTop);
          }

          for (const rec of filtered) {
            detailList.push({
              matchId: match._id,
              num: match.num || '',
              homeName: match.homeName || '',
              visitName: match.visitName || '',
              leagueName: match.leagueName || '',
              date: match.date || '',
              direction: rec.type,
              expertCount: rec.num || 0,
              result: rec.result,
              rank: 0
            });
          }
        }

        // 按 match 重新计算 rank
        const matchRankMap = {};
        for (const item of detailList) {
          if (!matchRankMap[item.matchId]) matchRankMap[item.matchId] = [];
          matchRankMap[item.matchId].push(item);
        }
        for (const items of Object.values(matchRankMap)) {
          items.sort((a, b) => b.expertCount - a.expertCount);
          items.forEach((item, i) => { item.rank = i + 1; });
        }

        detailList.sort((a, b) => {
          if (a.date !== b.date) return b.date.localeCompare(a.date);
          return a.rank - b.rank;
        });

        const hitCount = detailList.filter(r => r.result === 1).length;
        const totalCount = detailList.length;
        const hitRate = totalCount > 0 ? Math.round(hitCount / totalCount * 1000) / 10 : 0;

        // 条件摘要
        const parts = [];
        if (league) parts.push(league);
        if (timeRange === '30') parts.push('近30天');
        else if (timeRange === '60') parts.push('近60天');
        else if (timeRange === '90') parts.push('近90天');
        if (direction && directionType) parts.push(direction);
        else if (directionType) parts.push(directionType);
        if (rankTop > 0) {
          const rankLabels = ['', '第一名', '前二名', '前三名', '前四名', '前五名', '前六名'];
          parts.push(rankLabels[rankTop] || (rankTop > 0 ? `前${rankTop}名` : ''));
        }
        const conditionSummary = parts.length > 0 ? parts.join(' | ') : '全部条件';

        return {
          code: 1,
          data: { hitCount, totalCount, hitRate, conditionSummary, detailList }
        };
      }

      case 'filter-leagues': {
        const MAX = 200;
        const res = await db.collection('matches')
          .orderBy('date', 'desc')
          .limit(MAX)
          .get();
        const leagueSet = new Set();
        (res.data || []).forEach(m => {
          if (m.leagueName) leagueSet.add(m.leagueName);
        });
        const leagues = Array.from(leagueSet).sort();
        return { code: 1, data: leagues };
      }

      default:
        return { code: 0, msg: `未知 action: ${action}` };
    }
  } catch (err) {
    console.error(`[get-match-data] action=${action}`, err.message);
    return { code: 0, msg: `操作失败: ${err.message}` };
  }
};
