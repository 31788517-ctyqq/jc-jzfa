/**
 * 第七阶段：市场情报交叉验证（V7.0 新增）
 *
 * 将盘口位移检测 + 市场叠加评分注入功守道量化管道：
 *   1. 盘口位移检测：初盘→即时盘赔率变化方向 + 水位变化幅度
 *   2. 欧亚一致性检测：欧赔方向 vs 亚盘方向是否一致
 *   3. 市场与模型方向一致性：市场信号 vs 功守道模型方向的背离检测
 *   4. 市场叠加评分：15维评分中的 market 维度（热度偏差/盘口公平度/陷阱风险）
 *   5. Market_xG 反推：从大小球赔率反推市场隐含的总进球期望
 */

const fs = require('fs');
const path = require('path');
const oddsMovement = require('../core/odds-movement');
const marketOverlay = require('../core/market-overlay');

const ODDS_DIR = path.join(__dirname, '..', 'odds_history');
const F = 4;

function round(v, n) {
  const m = Math.pow(10, n);
  return Math.round(v * m) / m;
}

// ==================== 赔率数据加载 ====================

/**
 * 从 odds_history 加载指定日期+场次的赔率数据
 * @param {string} dateStr 日期 "2026-05-30"
 * @param {string} num 场次编号 "周五001"
 * @returns {{ spf: {}, rqspf: {}, totalGoals: {}, handicap: number } | null}
 */
function loadMatchOdds(dateStr, num) {
  if (!dateStr || !num) return null;
  try {
    const oddsFile = path.join(ODDS_DIR, dateStr + '.json');
    if (!fs.existsSync(oddsFile)) return null;
    const raw = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
    const odds = (raw && raw.odds) ? raw.odds : {};
    return odds[num] || null;
  } catch (e) {
    return null;
  }
}

// ==================== 初盘/即时盘近似检测 ====================

/**
 * 由于当前 odds_history 只存即时盘，使用启发式方法近似初盘：
 * - 如果 RQSPF 存在，视为即时盘
 * - 用 SPF 赔率的中性回归值作为"初盘"的近似
 *   实际使用：当日同联赛多数比赛的赔率均值作为市场基准
 *
 * @param {Object} odds 当前赔率数据
 * @param {Object} matchInfo 比赛信息（用于读取数据）
 * @returns {{ openOdds: {}, liveOdds: {} }}
 */
function estimateOddsMovement(odds, matchInfo) {
  if (!odds || !odds.spf) return null;

  const liveOdds = {
    home: parseFloat(odds.spf.home) || 0,
    draw: parseFloat(odds.spf.draw) || 0,
    away: parseFloat(odds.spf.away) || 0,
  };

  if (liveOdds.home <= 1.0) return null;

  // 基于即时赔率反推近似初盘：假设开盘方向偏向均衡
  // 如果即时盘 home < away → 已经偏向主队 → 初盘可能更均衡
  const margin = liveOdds.home < liveOdds.away ? 0.15 : -0.15;
  const openOdds = {
    home: round(liveOdds.home + margin, 2),
    draw: round(liveOdds.draw + (margin > 0 ? -0.1 : 0.1), 2),
    away: round(liveOdds.away - margin, 2),
  };

  return { openOdds, liveOdds };
}

// ==================== 市场 xG 反推（V7.0） ====================

/**
 * 从大小球赔率反推市场隐含的总进球期望 λ_market
 *
 * 算法：
 *   1. 从 totalGoals 赔率表提取隐含概率分布
 *   2. 找到市场最可能的盘口线 overUnderLine
 *   3. 通过二元搜索求解泊松 λ，使得 P(Poisson > overUnderLine) ≈ market_over_prob
 *   4. 按让球方向分配主客进球
 *
 * @param {Object} odds 赔率数据（含 totalGoals）
 * @param {number} handicap 让球数（>0=主让）
 * @returns {{ marketTotal: number, marketHome: number, marketAway: number, overUnderLine: number, overProb: number, valid: boolean }}
 */
function inferMarketXg(odds, handicap) {
  const result = { marketTotal: 2.5, marketHome: 1.3, marketAway: 1.2, overUnderLine: 2.5, overProb: 0.5, valid: false };

  if (!odds || !odds.totalGoals) return result;

  const tg = odds.totalGoals;
  // totalGoals 格式: { "0": 13, "1": 5.25, "2": 3.5, "3": 3, "4": 5.3, "5": 10 }
  // 找到赔率最低的进球数 → 即市场最可能的大小球盘口线

  let bestLine = 2.5;
  let bestOdds = Infinity;
  for (const k of Object.keys(tg)) {
    const v = parseFloat(tg[k]);
    if (v > 0 && v < bestOdds) {
      bestOdds = v;
      bestLine = parseInt(k);
    }
  }

  // 盘口线通常在最可能进球数附近（-0.5 或 +0.5）
  const overUnderLine = bestLine + 0.5;

  // 提取 over 赔付概率
  // 大球赔率 ≈ totalGoals[overUnderLine-0.5] 附近值的权重
  // 简化：用 bestLine 的赔率代表 over 倾向
  // over 概率 = 1/bestOdds / (1/bestOdds + 1/adjacentOdds)
  const lowerKey = String(bestLine - 1);
  const upperKey = String(bestLine + 1);
  const lowerOdds = tg[lowerKey] ? parseFloat(tg[lowerKey]) : bestOdds * 1.3;
  const upperOdds = tg[upperKey] ? parseFloat(tg[upperKey]) : bestOdds * 1.3;
  const overProb = (1 / bestOdds) / (1 / bestOdds + 1 / upperOdds);

  // 泊松 CDF 累计概率
  function poissonCDF(k, lambda) {
    let sum = 0;
    let term = Math.exp(-lambda);
    for (let i = 0; i <= k; i++) {
      sum += term;
      term *= lambda / (i + 1);
    }
    return Math.min(1, sum);
  }

  // 二元搜索反推 λ
  let lambda = overUnderLine;
  for (let iter = 0; iter < 30; iter++) {
    const probOver = 1 - poissonCDF(Math.floor(overUnderLine), lambda);
    const error = overProb - probOver;
    if (Math.abs(error) < 0.001) break;
    lambda += error * 3.0;
    lambda = Math.max(0.5, Math.min(7.0, lambda));
  }

  // 按让球方向分配
  const hdc = handicap || 0;
  const splitRatio = 0.5 + hdc * 0.08;
  const homeShare = Math.max(0.35, Math.min(0.65, splitRatio));

  result.marketTotal = round(lambda, 2);
  result.marketHome = round(lambda * homeShare, 2);
  result.marketAway = round(lambda * (1 - homeShare), 2);
  result.overUnderLine = overUnderLine;
  result.overProb = round(overProb, 4);
  result.valid = true;

  return result;
}

// ==================== 主分析入口 ====================

/**
 * 市场情报交叉验证
 * @param {Object} vars   parser 标准变量（含赔率）
 * @param {Object} matchInfo data.json 中的比赛信息 { matchId, num, date, handicap, leagueName }
 * @param {Object} gsContext 功守道已计算数据 { totalAdvantageRaw, xgHome, xgAway, fusionConsensusType }
 * @returns {Object} 市场情报结果
 */
function analyze(vars, matchInfo, gsContext) {
  const result = {
    // 盘口位移
    movement: null,
    // 欧亚一致性
    euroAsia: null,
    // 市场叠加评分（market 维度）
    overlayMarket: null,
    // 市场 xG 反推
    marketXg: null,
    // 综合市场信号评分
    marketScore: 50,
    marketSignal: '⚖️ 无明确市场信号',
    // 风险等级
    riskLevel: 'none', // 'none' | 'caution' | 'warning' | 'danger'
    riskDetail: '',
  };

  const num = matchInfo.num || '';
  const dateStr = (matchInfo.date || '').slice(0, 10);
  const handicap = matchInfo.handicap !== undefined ? Number(matchInfo.handicap) : (vars.rq || 0);

  // 1. 加载赔率数据
  const odds = loadMatchOdds(dateStr, num);

  // 2. 盘口位移检测
  if (odds && odds.spf) {
    const est = estimateOddsMovement(odds, matchInfo);
    if (est) {
      const pwScore = gsContext.totalAdvantageRaw || 0;
      const mov = oddsMovement.analyzeMovement(est.openOdds, est.liveOdds, pwScore);
      result.movement = {
        direction: mov.direction,
        severity: mov.severity,
        probShift: mov.probShift,
        waterChange: mov.waterChange,
        openHomeWinProb: mov.openHomeWinProb,
        liveHomeWinProb: mov.liveHomeWinProb,
        penalty: mov.penalty,
      };

      // 欧亚一致性
      const ea = oddsMovement.checkEuroAsiaConsistency(est.liveOdds, handicap, pwScore);
      result.euroAsia = {
        consistent: ea.consistent,
        detail: ea.detail,
        penalty: ea.penalty,
      };
    }
  }

  // 3. 市场 xG 反推
  if (odds && odds.totalGoals) {
    const mXg = inferMarketXg(odds, handicap);
    if (mXg.valid) {
      result.marketXg = {
        total: mXg.marketTotal,
        home: mXg.marketHome,
        away: mXg.marketAway,
        overUnderLine: mXg.overUnderLine,
        overProb: mXg.overProb,
      };
    }
  }

  // 4. 综合市场信号评分
  let signalScore = 50;
  let signalFlags = [];

  // ★ V9.0 离散度预警（从 JczqBasic 加载）
  try {
    const { discreteWarning: fusionDiscrete, loadBasic, asiaWaterChange } = require('../core/data-fusion');
    const basicData = loadBasic(dateStr, (num || '').replace(/^[^\\d]*/, ''));
    if (basicData) {
      const discrete = fusionDiscrete(null, basicData);
      if (discrete.flagLevel === 'warning') {
        signalScore -= 10;
        signalFlags.push('⚠️ 离散度扩大');
      } else if (discrete.flagLevel === 'caution') {
        signalScore -= 5;
        signalFlags.push('离散度轻微扩大');
      }

      // ★ V9.1 T-03: 亚指水位变化检测
      const asiaWater = asiaWaterChange(basicData);
      if (asiaWater.signal !== '无数据' && asiaWater.signal !== '水位稳定') {
        // 主队降水+盘口不变 → 市场真实看好
        if (asiaWater.waterChangeHome != null && asiaWater.waterChangeHome < -0.05 && !asiaWater.panShift) {
          signalScore += 5;
          signalFlags.push('主队降水(' + (asiaWater.waterChangeHome * -1).toFixed(2) + ')');
        } else if (asiaWater.waterChangeHome != null && asiaWater.waterChangeHome > 0.05) {
          signalScore -= 5;
          signalFlags.push('主队升水(' + asiaWater.waterChangeHome.toFixed(2) + ')');
        }
        if (asiaWater.panShift != null && asiaWater.panShift !== 0) {
          signalFlags.push(asiaWater.panShift > 0 ? '盘口↑升盘' : '盘口↓降盘');
        }
      }

      // ★ V9.1 T-03: 支持率背离检测
      if (basicData.winPercent != null && basicData.homeWinAward != null) {
        const winPct = parseFloat(basicData.winPercent) || 0;
        const hAward = parseFloat(basicData.homeWinAward);
        const dAward = parseFloat(basicData.drawAward);
        const aAward = parseFloat(basicData.guestWinAward);
        if (hAward > 0 && dAward > 0 && aAward > 0) {
          const totalInv = 1 / hAward + 1 / dAward + 1 / aAward;
          const spImpHome = (1 / hAward) / totalInv;
          // 支持率 > 60% 但 SP 隐含概率 < 0.4 → 热度陷阱
          if (winPct > 60 && spImpHome < 0.4) {
            signalScore -= 10;
            signalFlags.push('⚠️ 热度陷阱(支持率' + winPct + '% vs SP隐含' + (spImpHome * 100).toFixed(0) + '%)');
          }
        }
      }
    }
  } catch (e) { /* 静默 */ }

  // 盘口位移评分
  if (result.movement) {
    const m = result.movement;
    if (m.penalty >= 15) {
      signalScore -= 20;
      signalFlags.push('盘口与模型严重背离');
    } else if (m.penalty >= 8) {
      signalScore -= 10;
      signalFlags.push('盘口与模型轻微背离');
    }

    if (m.severity === 'significant' && m.penalty === 0) {
      signalScore += 10;
      signalFlags.push('盘口顺势大幅移动');
    }

    if (m.probShift > 0.05) {
      signalFlags.push('主胜降水(' + m.direction + ')');
    } else if (m.probShift < -0.05) {
      signalFlags.push('主胜升水(' + m.direction + ')');
    }
  }

  // 欧亚一致性
  if (result.euroAsia && !result.euroAsia.consistent) {
    signalScore -= 15;
    signalFlags.push('⚠️ 欧亚不一致');
  }

  // 市场 xG 与模型 xG 对比
  if (result.marketXg && gsContext.xgHome && gsContext.xgAway) {
    const modelTotal = gsContext.xgHome + gsContext.xgAway;
    const marketTotal = result.marketXg.total;
    const diff = Math.abs(modelTotal - marketTotal);

    if (diff > 1.0) {
      signalScore -= 10;
      signalFlags.push('模型与市场总进球分歧>1球');
    } else if (diff > 0.5) {
      signalScore -= 5;
      signalFlags.push('模型与市场总进球轻微分歧');
    } else {
      signalScore += 5;
      signalFlags.push('模型与市场总进球一致');
    }
  }

  signalScore = Math.max(10, Math.min(90, signalScore));
  result.marketScore = signalScore;

  // 信号解读
  if (signalScore >= 70) {
    result.marketSignal = '🔥 市场信号强烈支撑模型方向';
  } else if (signalScore >= 55) {
    result.marketSignal = '📊 市场信号偏多（弱支撑）';
  } else if (signalScore >= 45) {
    result.marketSignal = '⚖️ 市场信号中性';
  } else if (signalScore >= 30) {
    result.marketSignal = '⚠️ 市场信号偏空（需谨慎）';
  } else {
    result.marketSignal = '🚨 市场信号与模型严重背离';
  }

  // 风险等级
  if (signalScore < 35) {
    result.riskLevel = 'danger';
    result.riskDetail = '市场与模型方向严重不一致，建议观望';
  } else if (signalScore < 45) {
    result.riskLevel = 'warning';
    result.riskDetail = '市场信号偏空，注意风险控制';
  } else if (gsContext.fusionConsensusType === 'meltdown' && signalScore < 55) {
    result.riskLevel = 'caution';
    result.riskDetail = '模型熔断 + 市场信号中性，双重不确定性';
  }

  // 市场信号原因汇总
  result.signalFlags = signalFlags;

  return result;
}

module.exports = {
  analyze,
  loadMatchOdds,
  inferMarketXg,
};
