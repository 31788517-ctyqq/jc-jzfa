/**
 * server/core/league-heat-profile.js
 * V2.0 联赛自适应热度阈值 — 基于 Z-Score 替代固定 1.4 阈值
 *
 * 不同联赛天然热度不同：英超高、挪超低
 * 使用 Z-Score（偏离该联赛均值的标准差倍数）替代全局固定阈值
 */

// ═══ 联赛热度基准表 ═══
// mean: 该联赛历史 HI 均值
// std: 该联赛历史 HI 标准差
// overheatZ: 超过多少倍标准差判定为过热（默认 1.5）
const LEAGUE_HEAT_BASELINE = {
  '英超': { mean: 1.25, std: 0.18, overheatZ: 1.5 },
  '西甲': { mean: 1.22, std: 0.17, overheatZ: 1.5 },
  '德甲': { mean: 1.20, std: 0.16, overheatZ: 1.5 },
  '意甲': { mean: 1.18, std: 0.16, overheatZ: 1.5 },
  '法甲': { mean: 1.15, std: 0.15, overheatZ: 1.5 },
  '荷甲': { mean: 1.12, std: 0.15, overheatZ: 1.5 },
  '葡超': { mean: 1.10, std: 0.14, overheatZ: 1.5 },
  '日职': { mean: 1.10, std: 0.14, overheatZ: 1.5 },
  '日乙': { mean: 1.05, std: 0.13, overheatZ: 1.5 },
  '韩职': { mean: 1.08, std: 0.14, overheatZ: 1.5 },
  'K联赛': { mean: 1.08, std: 0.14, overheatZ: 1.5 },
  '澳洲甲': { mean: 1.10, std: 0.15, overheatZ: 1.5 },
  '中超': { mean: 1.05, std: 0.14, overheatZ: 1.5 },
  '美职': { mean: 1.12, std: 0.15, overheatZ: 1.5 },
  '巴甲': { mean: 1.05, std: 0.13, overheatZ: 1.5 },
  '阿甲': { mean: 1.00, std: 0.12, overheatZ: 1.5 },
  '挪超': { mean: 0.92, std: 0.12, overheatZ: 1.5 },
  '瑞典超': { mean: 0.95, std: 0.12, overheatZ: 1.5 },
  '俄超': { mean: 1.05, std: 0.13, overheatZ: 1.5 },
  '比甲': { mean: 1.05, std: 0.13, overheatZ: 1.5 },
  '奥甲': { mean: 1.02, std: 0.13, overheatZ: 1.5 },
  '苏超': { mean: 1.08, std: 0.14, overheatZ: 1.5 },
  '墨超': { mean: 1.08, std: 0.14, overheatZ: 1.5 },
  '欧冠': { mean: 1.30, std: 0.20, overheatZ: 1.5 },
  '欧罗巴': { mean: 1.20, std: 0.17, overheatZ: 1.5 },
  '亚冠': { mean: 1.15, std: 0.15, overheatZ: 1.5 },
  '德乙': { mean: 1.05, std: 0.13, overheatZ: 1.5 },
  '法乙': { mean: 0.95, std: 0.12, overheatZ: 1.5 },
  '英冠': { mean: 1.12, std: 0.15, overheatZ: 1.5 },
  '土超': { mean: 1.08, std: 0.14, overheatZ: 1.5 },
  '波兰超': { mean: 1.00, std: 0.13, overheatZ: 1.5 },
  '瑞士超': { mean: 1.05, std: 0.13, overheatZ: 1.5 },
  '希腊超': { mean: 0.98, std: 0.12, overheatZ: 1.5 },
  '丹麦超': { mean: 1.05, std: 0.13, overheatZ: 1.5 },

  // default: 通用阈值
  'default': { mean: 1.05, std: 0.15, overheatZ: 1.5 },
};

// ═══ 辅助函数 ═══

/**
 * 根据联赛名模糊匹配热度基准
 * @param {string} leagueName
 * @returns {{ mean: number, std: number, overheatZ: number }}
 */
function getProfile(leagueName) {
  var ln = (leagueName || '').trim();
  var keys = Object.keys(LEAGUE_HEAT_BASELINE);
  for (var i = 0; i < keys.length; i++) {
    if (ln.indexOf(keys[i]) !== -1) return LEAGUE_HEAT_BASELINE[keys[i]];
  }
  return LEAGUE_HEAT_BASELINE['default'];
}

/**
 * 获取联赛自适应过热阈值（HI超过此值判定为过热）
 * @param {string} leagueName
 * @returns {number}
 */
function getOverheatThreshold(leagueName) {
  var profile = getProfile(leagueName);
  return +(profile.mean + profile.overheatZ * profile.std).toFixed(2);
}

/**
 * 获取联赛自适应过冷阈值（HI低于此值判定为过冷/冷门潜质）
 * @param {string} leagueName
 * @returns {number}
 */
function getColdThreshold(leagueName) {
  var profile = getProfile(leagueName);
  return +(profile.mean - profile.overheatZ * profile.std).toFixed(2);
}

/**
 * 计算 HI 的 Z-Score（偏离该联赛均值的标准差倍数）
 * @param {number} hi 热度指数
 * @param {string} leagueName
 * @returns {{ zScore: number, isOverheat: boolean, isCold: boolean, threshold: number }}
 */
function computeHeatZScore(hi, leagueName) {
  var profile = getProfile(leagueName);
  var overheatThreshold = +(profile.mean + profile.overheatZ * profile.std).toFixed(2);
  var coldThreshold = +(profile.mean - profile.overheatZ * profile.std).toFixed(2);

  if (profile.std < 0.01) {
    return { zScore: 0, isOverheat: hi >= 1.4, isCold: hi <= 0.85, threshold: 1.4 };
  }

  var zScore = +((hi - profile.mean) / profile.std).toFixed(2);
  return {
    zScore: zScore,
    isOverheat: hi >= overheatThreshold,
    isCold: hi <= coldThreshold && hi > 0,
    threshold: overheatThreshold,
    coldThreshold: coldThreshold,
    leagueMean: profile.mean,
    leagueStd: profile.std,
  };
}

module.exports = {
  LEAGUE_HEAT_BASELINE,
  getProfile,
  getOverheatThreshold,
  getColdThreshold,
  computeHeatZScore,
};
