/**
 * server/core/data-fusion.js
 * 三源数据融合层（V9.0）
 *
 * 将以下三个数据源交叉融合：
 *   1. 功守道自算数据（xs / xG / 共识 / 稳定性 / 比分矩阵）
 *   2. JczqBasic 全字段（基本面 / 亚指 / 大小球 / 北单 SP / 离散度）
 *   3. JczqChange / JczqYz（热度 / 支持率 / 欧指变化）
 *
 * 输出融合特征供 pk_scorer / plan-generator / feature-engine / goal / market 消费
 */

const database = require('../database');
const path = require('path');
const fs = require('fs');

// ★ P1-1 降级开关: DATA_FUSION_ENABLED=1 启用三源融合增强
const FUSION_ENABLED = String(process.env.DATA_FUSION_ENABLED || '0') === '1';

// ═══ 权重常量（可调参） ═══
const FUSION_WEIGHTS = {
  winPan: 0.5, // 赢盘率维度中外源权重（功守道自算:外源 = 1:1）
  scoreProb: 0.3, // 进球分布校准中的外源权重（7:3 加权）
  dxqThreshold: 1.0, // 大小球背离判定阈值（球）
  discreteShift: 0.1, // 离散度扩大阈值
};

// ═══ 数据加载 ═══

/**
 * 从 SQLite 加载 JczqBasic 全字段
 */
function loadBasic(dateStr, matchNum) {
  try {
    if (!database.isAvailable || !database.isAvailable()) return null;
    return database.getJczqBasic(dateStr, String(matchNum));
  } catch (e) {
    return null;
  }
}

/**
 * 加载 JczqChange 热度缓存（从 jczq_change_cache.json）
 */
function loadChangeCache(dateStr) {
  try {
    const cachePath = path.join(__dirname, '..', 'jczq_change_cache.json');
    if (!fs.existsSync(cachePath)) return {};
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    return cache && cache[dateStr] ? cache[dateStr] : {};
  } catch (e) {
    return {};
  }
}

/**
 * 获取某场比赛的 JczqChange 缓存条目
 */
function loadChangeEntry(dateStr, matchId) {
  const dateCache = loadChangeCache(dateStr);
  return dateCache[matchId] || null;
}

// ═══ 融合函数 ═══

/**
 * 1. 基本面融合：功守道 power vs JczqBasic 积分/赢盘率
 *
 * @param {Object} gs    功守道数据 { homePower, guestPower, homeWinPanRate, ... }
 * @param {Object} basic JczqBasic 全字段
 * @returns {Object} { winPanScore, powerCorrelation, homeJiFen, awayJiFen, ... }
 */
function fundamentalFusion(gs, basic) {
  const result = {
    winPanScore: 50,
    powerCorrelation: 0,
    homeJiFen: null,
    awayJiFen: null,
    homeEnterEff: null,
    guestEnterEff: null,
    homePreventEff: null,
    guestPreventEff: null,
    jiaoFenDesc: null,
  };

  if (!basic) return result;

  // 积分均值（主队总场均积分 + 客场积分）
  if (basic.homeJiFenHomeAll != null) result.homeJiFen = basic.homeJiFenHomeAll;
  if (basic.awayJiFenGuest != null) result.awayJiFen = basic.awayJiFenGuest;

  // 进攻/防守效率
  if (basic.homeEnterEfficiency != null) result.homeEnterEff = basic.homeEnterEfficiency;
  if (basic.guestEnterEfficiency != null) result.guestEnterEff = basic.guestEnterEfficiency;
  if (basic.homePreventEfficiency != null) result.homePreventEff = basic.homePreventEfficiency;
  if (basic.guestPreventEfficiency != null) result.guestPreventEff = basic.guestPreventEfficiency;

  // 历史交锋
  result.jiaoFenDesc = basic.jiaoFenDesc || null;

  // ★ 赢盘率维度：外源赢盘率 / 2 × 100 转换到 0~100 评分
  if (basic.homeWinPan != null) {
    const homeWinPanRate = basic.homeWinPan / 2; // 文档: 除以2近似赢盘率 (0~1)
    const gsWinPanRate = gs && gs.homeWinPanRate != null ? parseFloat(gs.homeWinPanRate) : homeWinPanRate;
    const blendedWinPan = gs
      ? (1 - FUSION_WEIGHTS.winPan) * gsWinPanRate + FUSION_WEIGHTS.winPan * homeWinPanRate
      : homeWinPanRate;
    result.winPanScore = Math.round(blendedWinPan * 100);
  } else if (gs && gs.homeWinPanRate != null) {
    result.winPanScore = Math.round(parseFloat(gs.homeWinPanRate) * 100);
  }

  // 实力相关性：功守道 homePower vs JczqBasic homePower 的 Pearson 近似
  if (gs && gs.homePower != null && basic.homePower != null) {
    const gsPower = parseFloat(gs.homePower) || 50;
    const basicPower = parseFloat(basic.homePower) || 50;
    // 若两者偏差 <10 则高度相关
    const powerDiff = Math.abs(gsPower - basicPower);
    result.powerCorrelation = powerDiff < 5 ? 1 : powerDiff < 10 ? 0.7 : powerDiff < 20 ? 0.3 : 0;
  }

  return result;
}

/**
 * 2. 大小球交叉验证：功守道 xG vs JczqBasic 大小球盘口
 *
 * @param {Object} gs    功守道 { xgHome, xgAway, totalGoalsExpect }
 * @param {Object} basic JczqBasic { dxqLastPan, dxqInitPan }
 * @returns {Object} { gsTotalExpect, marketDxqPan, deviation, flag }
 */
function crossValidateXg(gs, basic) {
  const result = {
    gsTotalExpect: null,
    marketDxqPan: null,
    deviation: null,
    flag: '无数据',
    flagLevel: 'none',
  };

  const gsTotal = gs && gs.totalGoalsExpect != null ? parseFloat(gs.totalGoalsExpect) : null;
  const marketPan = basic && basic.dxqLastPan != null ? parseFloat(basic.dxqLastPan) : null;

  result.gsTotalExpect = gsTotal;
  result.marketDxqPan = marketPan;

  if (gsTotal === null || marketPan === null) return result;

  const dev = gsTotal - marketPan;
  result.deviation = Math.round(dev * 100) / 100;

  if (Math.abs(dev) > FUSION_WEIGHTS.dxqThreshold) {
    result.flag = '大小球背离';
    result.flagLevel = 'warning';
  } else if (Math.abs(dev) > 0.5) {
    result.flag = '轻微偏离';
    result.flagLevel = 'caution';
  } else {
    result.flag = '一致';
    result.flagLevel = 'none';
  }

  return result;
}

/**
 * 3. 进球分布校准：比分方案概率 vs JczqBasic 进球分布
 *
 * @param {Object} scoreMatrix 功守道比分矩阵 { "1-0": 0.12, "2-0": 0.08, ... }
 * @param {Object} basic       JczqBasic { homeWinQiu_0/1/2, homeLoseQiu_0/1/2 }
 * @returns {Object} 校准后的比分概率映射
 */
function calibrateScoreProb(scoreMatrix, basic) {
  if (!scoreMatrix || Object.keys(scoreMatrix).length === 0) return {};

  const calibrated = {};
  const extWeight = FUSION_WEIGHTS.scoreProb; // 0.3
  const gsWeight = 1 - extWeight; // 0.7

  // 从 JczqBasic 构建进球分布比例
  const basicScoreDist = {};
  if (basic) {
    // 统计主/客队近10场进球分布
    const homeGoals = [
      { range: 0, count: basic.homeWinQiu_0 != null ? basic.homeWinQiu_0 : 0 },
      { range: 1, count: basic.homeWinQiu_1 != null ? basic.homeWinQiu_1 : 0 },
      { range: 2, count: basic.homeWinQiu_2 != null ? basic.homeWinQiu_2 : 0 },
    ];
    const homeLoses = [
      { range: 0, count: basic.homeLoseQiu_0 != null ? basic.homeLoseQiu_0 : 0 },
      { range: 1, count: basic.homeLoseQiu_1 != null ? basic.homeLoseQiu_1 : 0 },
      { range: 2, count: basic.homeLoseQiu_2 != null ? basic.homeLoseQiu_2 : 0 },
    ];

    const totalMatches = 10; // 近10场

    // 为每个可能的比分构建基础分布
    for (const score of Object.keys(scoreMatrix)) {
      const parts = score.split('-');
      if (parts.length !== 2) continue;
      const h = parseInt(parts[0]),
        a = parseInt(parts[1]);
      if (isNaN(h) || isNaN(a)) continue;

      // 找到对应进球范围
      const hIdx = Math.min(h, 2); // cap at 2+
      const aIdx = Math.min(a, 2);
      const homeCount = homeGoals[hIdx] ? homeGoals[hIdx].count : 0;
      const awayCount = homeGoals[aIdx] ? homeGoals[aIdx].count : 0;

      // JczqBasic 分布比例 = (主队进球某范围概率) × (客队进球某范围概率)
      const basicProb = totalMatches > 0 ? (homeCount / totalMatches) * (awayCount / totalMatches) : 0;
      basicScoreDist[score] = basicProb;
    }
  }

  // 加权融合
  const totalBasicProb = Object.values(basicScoreDist).reduce((s, v) => s + v, 0);

  for (const score of Object.keys(scoreMatrix)) {
    const gsProb = parseFloat(scoreMatrix[score]) || 0;
    const basicProb = basicScoreDist[score] || 0;

    if (totalBasicProb > 0.001) {
      // 归一化后加权
      const normalizedBasic = basicProb / totalBasicProb;
      calibrated[score] = round(gsProb * gsWeight + normalizedBasic * extWeight, 4);
    } else {
      calibrated[score] = gsProb;
    }
  }

  return calibrated;
}

/**
 * 4. SP 隐含概率：北单 SP → 市场隐含主/平/客概率
 *
 * @param {Object} basic JczqBasic { homeWinAward, drawAward, guestWinAward }
 * @returns {Object} { homeImplied, drawImplied, awayImplied, totalPayout }
 */
function spImpliedProb(basic) {
  const result = {
    homeImplied: null,
    drawImplied: null,
    awayImplied: null,
    totalPayout: null,
  };

  if (!basic) return result;

  const hAward = basic.homeWinAward;
  const dAward = basic.drawAward;
  const aAward = basic.guestWinAward;

  if (hAward == null || dAward == null || aAward == null) return result;
  if (hAward <= 0 || dAward <= 0 || aAward <= 0) return result;

  const hInv = 1 / hAward;
  const dInv = 1 / dAward;
  const aInv = 1 / aAward;
  const totalInv = hInv + dInv + aInv;

  if (totalInv === 0) return result;

  result.homeImplied = round(hInv / totalInv, 4);
  result.drawImplied = round(dInv / totalInv, 4);
  result.awayImplied = round(aInv / totalInv, 4);
  result.totalPayout = round(totalInv, 4);

  return result;
}

/**
 * 5. 离散度预警：初盘→临盘离散度变化
 *
 * @param {Object} changeEntry JczqChange 缓存条目 { heatIndex, ... }
 * @param {Object} basic       JczqBasic { initDiscreteDiff, lastDiscreteDiff }
 * @returns {Object} { initDiff, lastDiff, shift, flag }
 */
function discreteWarning(changeEntry, basic) {
  const result = {
    initDiff: null,
    lastDiff: null,
    shift: null,
    flag: '无数据',
    flagLevel: 'none',
  };

  if (!basic) return result;

  result.initDiff = basic.initDiscreteDiff;
  result.lastDiff = basic.lastDiscreteDiff;

  if (basic.initDiscreteDiff == null || basic.lastDiscreteDiff == null) return result;

  const shift = basic.lastDiscreteDiff - basic.initDiscreteDiff;
  result.shift = round(shift, 4);

  if (shift > FUSION_WEIGHTS.discreteShift) {
    result.flag = '离散度扩大（不确定性↑）';
    result.flagLevel = 'warning';
  } else if (shift > 0.05) {
    result.flag = '离散度轻微扩大';
    result.flagLevel = 'caution';
  } else {
    result.flag = '离散度稳定/收窄';
    result.flagLevel = 'none';
  }

  return result;
}

/**
 * 6. 亚指水位变化检测
 *
 * @param {Object} basic JczqBasic { initPan, lastPan, asiaInitAvgWinOdd, asiaLastAvgWinOdd, ... }
 * @returns {Object} { panShift, waterChange, signal }
 */
function asiaWaterChange(basic) {
  const result = {
    initPan: null,
    lastPan: null,
    panShift: null,
    waterChangeHome: null,
    waterChangeAway: null,
    signal: '无数据',
  };

  if (!basic) return result;

  result.initPan = basic.initPan;
  result.lastPan = basic.lastPan;

  if (basic.initPan != null && basic.lastPan != null) {
    result.panShift = round(basic.lastPan - basic.initPan, 2);
  }

  if (basic.asiaInitAvgWinOdd != null && basic.asiaLastAvgWinOdd != null) {
    result.waterChangeHome = round(basic.asiaLastAvgWinOdd - basic.asiaInitAvgWinOdd, 4);
  }

  if (basic.asiaInitAvgLoseOdd != null && basic.asiaLastAvgLoseOdd != null) {
    result.waterChangeAway = round(basic.asiaLastAvgLoseOdd - basic.asiaInitAvgLoseOdd, 4);
  }

  // 信号解读
  const signals = [];
  if (result.panShift != null && result.panShift !== 0) {
    signals.push(result.panShift > 0 ? '盘口↑升盘' : '盘口↓降盘');
  }
  if (result.waterChangeHome != null && Math.abs(result.waterChangeHome) > 0.05) {
    signals.push(result.waterChangeHome < 0 ? '主队降水' : '主队升水');
  }

  result.signal = signals.length > 0 ? signals.join('，') : '水位稳定';

  return result;
}

/**
 * 7. 全线融合（一次调用返回全部融合结果）
 *
 * @param {Object} params
 *   - dateStr  日期 "2026-05-26"
 *   - matchNum 场次编号（纯数字）
 *   - matchId  比赛 ID（用于查 change 缓存）
 *   - gs       功守道数据（可选，需包含 homePower/guestPower/totalGoalsExpect/scoreMatrix 等）
 * @returns {Object} 融合结果全集
 */
function fullFusion(params) {
  const { dateStr, matchNum, matchId, gs } = params || {};
  const result = {
    date: dateStr || null,
    matchNum: matchNum || null,
    basic: null,
    fundamental: {},
    xgValidation: {},
    scoreCalibration: {},
    spProb: {},
    discrete: {},
    asiaWater: {},
    ready: false,
  };

  if (!dateStr || !matchNum) return result;

  // 加载 JczqBasic 全字段
  const basic = loadBasic(dateStr, matchNum);
  result.basic = basic ? 'loaded' : 'missing';

  // 加载 Change 缓存
  const changeEntry = matchId ? loadChangeEntry(dateStr, matchId) : null;

  // 执行各融合维度
  result.fundamental = fundamentalFusion(gs, basic);
  result.xgValidation = crossValidateXg(gs, basic);
  result.spProb = spImpliedProb(basic);
  result.discrete = discreteWarning(changeEntry, basic);
  result.asiaWater = asiaWaterChange(basic);

  // 比分校准（仅当 gs 中包含 scores 时）
  if (gs && gs.scores && basic) {
    const scoreMap = {};
    gs.scores.forEach(function (s) {
      if (s && s.score && typeof s.percent !== 'undefined') {
        scoreMap[s.score] = s.percent;
      }
    });
    result.scoreCalibration = calibrateScoreProb(scoreMap, basic);
  }

  result.ready = basic !== null;

  return result;
}

// ═══ 辅助 ═══
function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

module.exports = {
  // 数据加载
  loadBasic,
  loadChangeCache,
  loadChangeEntry,

  // 融合函数
  fundamentalFusion,
  crossValidateXg,
  calibrateScoreProb,
  spImpliedProb,
  discreteWarning,
  asiaWaterChange,

  // 全线融合
  fullFusion,

  // 权重常量（供调参）
  FUSION_WEIGHTS,
};
