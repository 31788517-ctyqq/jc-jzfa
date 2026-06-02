// ============================================================
// 测试 Fixtures — 比赛/球队数据工厂
// 用法: const { createMatch, createMatchBatch } = require('../__fixtures__/matches');
// ============================================================

/**
 * 创建单场比赛数据
 * @param {Object} overrides - 可覆盖的字段
 * @returns {Object} 标准比赛对象
 */
function createMatch(overrides = {}) {
  const defaults = {
    matchId: 'm-test-001',
    date: '2026-05-31',
    homeName: '测试主队',
    visitName: '测试客队',
    leagueName: '测试联赛',
    matchNum: '001',
    status: 'scheduled',
    homeScore: null,
    visitScore: null,
    odds: {
      spf: { w: 2.1, d: 3.2, l: 3.5 },
      rqspf: { w: 4.0, d: 3.8, l: 1.6 },
    },
    recommends: {},
  };

  return deepMerge(defaults, overrides);
}

/**
 * 批量创建比赛数据
 * @param {number} count - 数量 (默认 10)
 * @param {Function} customizer - 每场比赛的自定义函数 (index, match) => overrides
 * @returns {Array} 比赛对象数组
 */
function createMatchBatch(count = 10, customizer = null) {
  return Array.from({ length: count }, (_, i) => {
    const match = createMatch({
      matchId: `m-test-${String(i + 1).padStart(3, '0')}`,
      matchNum: String(i + 1).padStart(3, '0'),
    });
    if (customizer) {
      const overrides = customizer(i, match);
      return { ...match, ...overrides };
    }
    return match;
  });
}

/**
 * 创建已完场的比赛（含比分）
 */
function createFinishedMatch(overrides = {}) {
  return createMatch({
    status: 'finished',
    homeScore: 2,
    visitScore: 1,
    result: 'w', // spf 胜
    rqResult: 'd', // rqspf 平
    ...overrides,
  });
}

/**
 * 创建推荐数据
 */
function createRecommend(overrides = {}) {
  const defaults = {
    matchId: 'm-recmd-001',
    date: '2026-05-31',
    spfRecommend: 'w',
    rqspfRecommend: 'w',
    recommendScore: 85,
    sportteryRecommend: 'w',
    status: 'pending',
  };
  return deepMerge(defaults, overrides);
}

/**
 * 创建联赛数据
 */
function createLeague(overrides = {}) {
  const defaults = {
    leagueId: 'l-test-001',
    leagueName: '测试联赛',
    shortName: 'TST',
    region: '测试区',
  };
  return deepMerge(defaults, overrides);
}

// ── 辅助 ──

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

module.exports = {
  createMatch,
  createMatchBatch,
  createFinishedMatch,
  createRecommend,
  createLeague,
};
