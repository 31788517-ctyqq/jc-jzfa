// ============================================================
// 测试 Fixtures — 功守道数据工厂
// 用法: const { createGsMatch, createGsBatch } = require('../__fixtures__/gongshoudao');
// ============================================================

/**
 * 创建功守道比赛分析数据
 * @param {Object} overrides - 可覆盖字段
 * @returns {Object}
 */
function createGsMatch(overrides = {}) {
  const defaults = {
    // 比赛基础信息
    matchId: 'gs-m-001',
    homeName: '主队',
    visitName: '客队',
    leagueName: '测试联赛',
    date: '2026-05-31',
    matchNum: '001',

    // 攻防数据
    homeAttack: 1.5,
    homeDefense: 0.8,
    visitAttack: 1.2,
    visitDefense: 1.0,

    // 进球预期
    homeGoal: 1.6,
    visitGoal: 1.1,
    totalGoal: 2.7,

    // 差值计算
    attackDiff: 0.3,
    defenseDiff: 0.2,
    goalDiff: 0.5,

    // 赔率
    odds: {
      spfW: 2.5,
      spfD: 3.3,
      spfL: 2.8,
      rqspfW: 4.5,
      rqspfD: 4.0,
      rqspfL: 1.6,
    },
  };
  return { ...defaults, ...overrides };
}

/**
 * 批量创建功守道比赛（模拟全量比赛日）
 * @param {number} count - 比赛数量
 * @returns {Array}
 */
function createGsBatch(count = 14) {
  return Array.from({ length: count }, (_, i) => {
    const idx = String(i + 1).padStart(3, '0');
    return createGsMatch({
      matchId: `gs-m-${idx}`,
      matchNum: idx,
      homeName: `主队${i + 1}`,
      visitName: `客队${i + 1}`,
      leagueName: i % 3 === 0 ? '英超' : i % 3 === 1 ? '西甲' : '意甲',
    });
  });
}

/**
 * 创建功守道排行数据
 */
function createGsRanking(overrides = {}) {
  const defaults = {
    rank: 1,
    matchId: 'gs-r-001',
    totalScore: 92.5,
    attackScore: 85.0,
    defenseScore: 78.0,
    goalDiffScore: 90.0,
    value: 0.85,
    description: '测试排行项',
  };
  return { ...defaults, ...overrides };
}

module.exports = {
  createGsMatch,
  createGsBatch,
  createGsRanking,
};
