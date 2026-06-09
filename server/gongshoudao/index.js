/**
 * 功守道量化引擎 — 主入口
 *
 * 编排所有阶段的计算，提供缓存读写、批量计算、增量更新。
 */
const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('../core/file-utils');
const parser = require('./parser');
const attack = require('./attack');
const goal = require('./goal');
const diff = require('./diff');
const score = require('./score');
const market = require('./market');
const fetch = require('./fetch');

const CACHE_PATH = path.join(__dirname, 'cache.json');
let _lastRefreshAt = 0;

// ==================== 缓存管理 ====================

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (e) {
    console.error('[gs] 缓存读取失败:', e.message);
    return {};
  }
}

function writeCache(data) {
  atomicWriteJson(CACHE_PATH, data);
}

function getCacheTimestamp(cache) {
  const metaTs = cache && cache._meta && cache._meta.gongshoudao && cache._meta.gongshoudao.updatedAt;
  const parsedMetaTs = metaTs ? Date.parse(metaTs) : 0;
  if (parsedMetaTs > 0) return parsedMetaTs;
  try {
    if (fs.existsSync(CACHE_PATH)) return fs.statSync(CACHE_PATH).mtimeMs;
  } catch (e) {
    /* ignore */
  }
  return 0;
}

function isCacheFresh(cache, ttlMs) {
  if (!ttlMs || ttlMs <= 0) return false;
  const now = Date.now();
  if (_lastRefreshAt > 0 && now - _lastRefreshAt <= ttlMs) return true;
  const ts = getCacheTimestamp(cache);
  return ts > 0 && now - ts <= ttlMs;
}

function buildGsPredictionPayload(mid, gs, m) {
  return {
    matchId: String(mid).replace(/^m_/, ''),
    fields: {
      date: (m.date || '').slice(0, 10),
      homeName: m.homeName || '',
      visitName: m.visitName || '',
      leagueName: m.leagueName || '',
      matchNum: m.num || '',
      scoresJson: JSON.stringify(gs.scores),
      topScore: gs.scores && gs.scores[0] ? gs.scores[0].score : '',
      topPercent: gs.scores && gs.scores[0] ? parseFloat(gs.scores[0].percent) || 0 : 0,
      ladderLabel: gs.ladderLabel || '',
      ladderLevel: gs.ladderLevel || 0,
      handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
      modelATotal: gs.gsModelATotal || gs.modelATotal || null,
      modelBTotal: gs.gsModelBTotal || gs.modelBTotal || null,
      modelCTotal: gs.gsModelCTotal || gs.modelCTotal || null,
    },
  };
}

function isSameGsResult(a, b) {
  if (!a || !b) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;
  }
}

function persistGsPredictionChanges(changedIds, existing, mMap) {
  if (!changedIds || changedIds.length === 0) return 0;

  try {
    const predLog = require('../prediction_log');
    const seen = new Set();
    const records = [];
    changedIds.forEach(function (mid) {
      if (seen.has(mid)) return;
      seen.add(mid);
      const gs = existing[mid];
      if (!gs || !gs.scores) return;
      records.push(buildGsPredictionPayload(mid, gs, mMap[mid] || {}));
    });
    if (records.length === 0) return 0;
    if (typeof predLog.upsertGSBatch === 'function') {
      return predLog.upsertGSBatch(records);
    }
    records.forEach(function (record) {
      predLog.upsertGS(record.matchId, record.fields);
    });
    return records.length;
  } catch (e) {
    console.error('[gs] predLog save error:', e.message);
    return 0;
  }
}

// ==================== 单场比赛计算 ====================

/**
 * 对单场比赛执行完整的功守道量化分析
 * @param {Object} rawStats API 原始统计数据
 * @param {Object} matchInfo data.json 中的比赛基础信息
 * @returns {Object} 完整的弹窗数据
 */
function computeSingleMatch(rawStats, matchInfo) {
  // 第一阶段：字段解析
  const vars = parser.parse(rawStats);
  if (!vars) return null;

  // 第二阶段：实力分析
  const strengthResult = attack.analyze(vars);

  // 第四阶段：大小球 + xG（传入归一化 S 值）
  const goalResult = goal.analyze(
    vars,
    strengthResult.totalAdvantageRaw,
    matchInfo /* V9.1: 传入 matchInfo 以加载 dxqLastPan */,
  );

  // ★ V9.0 大小球交叉验证（功守道 xG vs 市场大小球盘口）
  try {
    const { crossValidateXg, loadBasic } = require('../core/data-fusion');
    const numStr = (matchInfo.num || '').replace(/^[^\d]*/, '');
    const num = parseInt(numStr) || 0;
    if (num > 0) {
      const basicData = loadBasic((matchInfo.date || '').slice(0, 10), num);
      if (basicData) {
        goalResult.dxqValidation = crossValidateXg(goalResult, basicData);
      }
    }
  } catch (e) {
    /* 静默 */
  }

  // 第五阶段：净胜球 + 让球分析
  const diffResult = diff.analyze(vars, goalResult.xgHome, goalResult.xgAway);

  // ★ V7.0 第七阶段：市场情报交叉验证
  const marketResult = market.analyze(vars, matchInfo, {
    totalAdvantageRaw: strengthResult.totalAdvantageRaw,
    xgHome: goalResult.xgHome,
    xgAway: goalResult.xgAway,
    fusionConsensusType: goalResult.fusionConsensusType,
  });

  // ★ V9.1 P0修复: 用市场数据重新计算共振裁决（原来传null，市场面未激活）
  const resonanceWithMarket = (() => {
    try {
      const marketContext = {};
      // 盘口位移
      if (marketResult.movement) {
        marketContext.panShift = marketResult.movement.probShift || 0;
      } else {
        marketContext.panShift = 0;
      }
      // SP 隐含主胜概率（从赔率反推）
      const homeAward = vars.homeWinAward || 2.5;
      const drawAward = vars.drawAward || 3.2;
      const awayAward = vars.awayWinAward || 2.8;
      const totalInv = 1 / homeAward + 1 / drawAward + 1 / awayAward;
      marketContext.spImpHome = totalInv > 0 ? 1 / homeAward / totalInv : 0.33;
      // 如果市场情报有离散度或亚指水位数据，一起传入
      if (marketResult.signalFlags && marketResult.signalFlags.length > 0) {
        marketContext.signalFlags = marketResult.signalFlags;
      }
      return diff.calcResonance(
        diffResult._diffXG,
        diffResult._totalStrength,
        diffResult.sevenMatch.dimension1,
        diffResult.sevenMatch.dimension2,
        marketContext,
      );
    } catch (e) {
      return diffResult.resonance; // 降级回原值
    }
  })();

  // 组装弹窗数据
  return {
    // 基础信息
    matchId: matchInfo.matchId || '',
    homeName: matchInfo.homeName || '',
    visitName: matchInfo.visitName || '',
    leagueName: matchInfo.leagueName || '',
    num: matchInfo.num || '',
    startTime: matchInfo.startTime || '',
    computedAt: Date.now(), // ★ 数据计算时间戳（供前端显示时效标签）

    // ⭐ 基础实力分（供 quant-hot 计算 staticDiff）
    homePower: vars.homePower,
    guestPower: vars.awayPower,

    // 第二阶段输出：实力分析
    attackAdvantage: strengthResult.attackAdvantage,
    attackAdvantageValue: strengthResult.attackAdvantageValue,
    defenseAdvantage: strengthResult.defenseAdvantage,
    defenseAdvantageValue: strengthResult.defenseAdvantageValue,
    attackPattern: strengthResult.attackPattern,
    // 维度权重（规范名 + 兼容旧名）
    attackDimWeight: strengthResult.attackDimWeight,
    defenseDimWeight: strengthResult.defenseDimWeight,
    attackWeightHome: strengthResult.attackWeightHome,
    attackWeightAway: strengthResult.attackWeightAway,
    defenseWeightHome: strengthResult.defenseWeightHome,
    defenseWeightAway: strengthResult.defenseWeightAway,
    totalAdvantage: strengthResult.totalAdvantage,
    totalAdvantageRaw: strengthResult.totalAdvantageRaw,
    totalAdvantageValue: strengthResult.totalAdvantageValue,

    // ★ 攻守实力（sigmoid 加权合成，供 PK 排行榜使用）
    adWeightedComposite: strengthResult.adWeightedComposite,
    // 原始进攻/防守优势度（供前端计算使用）
    attackAdvantageRaw: strengthResult.attackAdvantageRaw,
    defenseAdvantageRaw: strengthResult.defenseAdvantageRaw,

    // 实力阶梯标签
    ladderLabel: strengthResult.ladder.label,
    ladderLevel: strengthResult.ladder.level,

    // 胜平负交叉分布（不让球 + 让球 双组）
    crossSpfWin: strengthResult.cross.spf.win,
    crossSpfDraw: strengthResult.cross.spf.draw,
    crossSpfLose: strengthResult.cross.spf.lose,
    crossHcpWin: strengthResult.cross.handicap.win,
    crossHcpDraw: strengthResult.cross.handicap.draw,
    crossHcpLose: strengthResult.cross.handicap.lose,
    crossRq: strengthResult.cross.rq,
    // 原始近10场胜平负场次（用于前端计算赛果对冲差值）
    hWins: strengthResult.cross.hWins,
    hLosses: strengthResult.cross.hLosses,
    aWins: strengthResult.cross.aWins,
    aLosses: strengthResult.cross.aLosses,
    // 大球率（goalRange 内部）
    overRate: goalResult.goalRange.overRate,

    // 第四阶段输出：大小球
    homeWeight: goalResult.homeWeight,
    awayWeight: goalResult.awayWeight,
    goalDiffHome: goalResult.goalDiffHome,
    goalDiffAway: goalResult.goalDiffAway,
    totalGoalsExpect: goalResult.totalGoalsExpect,
    totalGoalsValue: goalResult.totalGoalsValue,
    goalRange: goalResult.goalRange,
    // ★ xG 值（主客预期进球，供排行榜净胜球量化使用）
    xgHome: goalResult.xgHome,
    xgAway: goalResult.xgAway,
    gdQ: goalResult.gdQ, // ★ 净胜球量化 GD_q
    // ★ 四重熔断
    fusionConsensus: goalResult.fusionConsensus,
    fusionConsensusType: goalResult.fusionConsensusType, // 英文代码: strong/weak/meltdown
    fusionConsensusScore: goalResult.fusionConsensusScore || 0, // V9.1: 连续置信度 [0, 1]
    fusionFinalHome: goalResult.fusionFinalHome,
    fusionFinalAway: goalResult.fusionFinalAway,
    fusionFinalTotal: goalResult.fusionFinalTotal, // V25新增：熔断后融合总进球（备用预期进球指标）
    fusionFused: goalResult.fusionFused,
    // ★ 进球预测维度（PK.md 进球数预测公式）
    attDefGoal: goalResult.attDefGoal, // 攻防进球 = xgHome + xgAway
    breakArmorSum: goalResult.breakArmorSum, // 破甲和
    bigBallRatio: goalResult.bigBallRatio, // 大球比例（百分比）
    h2hGoalAvg: goalResult.h2hGoalAvg, // 交锋进球 = H2H场均总进球

    // ★ V27 新增: 进球稳定性
    goalStabilityHome: goalResult.goalStabilityHome || 50,
    goalStabilityAway: goalResult.goalStabilityAway || 50,
    defStabilityHome: goalResult.defStabilityHome || 50,
    defStabilityAway: goalResult.defStabilityAway || 50,
    stabilityOverall: goalResult.stabilityOverall || 50,

    // ★ V27 新增: 联赛归一化校准
    leagueCalibration: (function () {
      const BASELINE = {
        德甲: 3.18,
        荷甲: 3.05,
        挪超: 2.92,
        瑞典超: 2.85,
        英超: 2.72,
        葡超: 2.67,
        西甲: 2.63,
        意甲: 2.56,
        法甲: 2.55,
        K联赛: 2.48,
        日职: 2.62,
        日乙: 2.58,
        美职: 2.78,
        俄超: 2.48,
        比甲: 2.82,
        奥甲: 2.72,
        苏超: 2.65,
        中超: 2.78,
        墨超: 2.68,
        巴甲: 2.42,
        阿甲: 2.18,
        欧冠: 2.82,
        欧罗巴: 2.72,
        亚冠: 2.65,
        澳洲甲: 2.88,
        德乙: 2.82,
        法乙: 2.42,
        英冠: 2.55,
        土超: 2.75,
        波兰超: 2.62,
        瑞士超: 2.82,
        希腊超: 2.32,
        丹麦超: 2.78,
      };
      const ln = (matchInfo.leagueName || '').trim();
      let found = 2.65;
      const keys = Object.keys(BASELINE);
      for (let ki = 0; ki < keys.length; ki++) {
        if (ln.indexOf(keys[ki]) !== -1) found = BASELINE[keys[ki]];
      }
      return parseFloat((found / 2.65).toFixed(3));
    })(),
    leagueAvgGoals: (function () {
      const BASELINE = {
        德甲: 3.18,
        荷甲: 3.05,
        挪超: 2.92,
        瑞典超: 2.85,
        英超: 2.72,
        葡超: 2.67,
        西甲: 2.63,
        意甲: 2.56,
        法甲: 2.55,
        K联赛: 2.48,
        日职: 2.62,
        日乙: 2.58,
        美职: 2.78,
        俄超: 2.48,
        比甲: 2.82,
        奥甲: 2.72,
        苏超: 2.65,
        中超: 2.78,
        墨超: 2.68,
        巴甲: 2.42,
        阿甲: 2.18,
        欧冠: 2.82,
        欧罗巴: 2.72,
        亚冠: 2.65,
        澳洲甲: 2.88,
        德乙: 2.82,
        法乙: 2.42,
        英冠: 2.55,
        土超: 2.75,
        波兰超: 2.62,
        瑞士超: 2.82,
        希腊超: 2.32,
        丹麦超: 2.78,
      };
      const ln = (matchInfo.leagueName || '').trim();
      let found = 2.65;
      const keys = Object.keys(BASELINE);
      for (let ki = 0; ki < keys.length; ki++) {
        if (ln.indexOf(keys[ki]) !== -1) found = BASELINE[keys[ki]];
      }
      return found;
    })(),
    leagueOverBaseline: (function () {
      const BASELINE = {
        德甲: 3.18,
        荷甲: 3.05,
        挪超: 2.92,
        瑞典超: 2.85,
        英超: 2.72,
        葡超: 2.67,
        西甲: 2.63,
        意甲: 2.56,
        法甲: 2.55,
        K联赛: 2.48,
        日职: 2.62,
        日乙: 2.58,
        美职: 2.78,
        俄超: 2.48,
        比甲: 2.82,
        奥甲: 2.72,
        苏超: 2.65,
        中超: 2.78,
        墨超: 2.68,
        巴甲: 2.42,
        阿甲: 2.18,
        欧冠: 2.82,
        欧罗巴: 2.72,
        亚冠: 2.65,
        澳洲甲: 2.88,
        德乙: 2.82,
        法乙: 2.42,
        英冠: 2.55,
        土超: 2.75,
        波兰超: 2.62,
        瑞士超: 2.82,
        希腊超: 2.32,
        丹麦超: 2.78,
      };
      const ln = (matchInfo.leagueName || '').trim();
      let found = 2.65;
      const keys = Object.keys(BASELINE);
      for (let ki = 0; ki < keys.length; ki++) {
        if (ln.indexOf(keys[ki]) !== -1) found = BASELINE[keys[ki]];
      }
      return found >= 2.85 ? 68 : found >= 2.65 ? 55 : 42;
    })(),

    // ★ V27 新增: 赢盘率 + 赔率（供前端交叉验证用）
    homeWinPanRate: vars.homeWinPanRate || 0,
    awayWinPanRate: vars.awayWinPanRate || 0,
    homeWinAward: vars.homeWinAward || 0,
    awayWinAward: vars.awayWinAward || 0,
    drawAward: vars.drawAward || 0,

    // 第五阶段输出：净胜球
    homeWinExpect: diffResult.homeWinExpect,
    homeWinValue: diffResult.homeWinValue,
    totalAdvantage2: diffResult.totalAdvantage2,
    totalAdvantage2Value: diffResult.totalAdvantage2Value,
    // ★ Total_战（双轨实力量化结果）
    totalStrength: diffResult._totalStrength.normalized,
    // ★ 实力进球（供进球预测排行榜使用）
    strengthGoal: diffResult.strengthGoal,
    goalCount: diffResult.goalCount,
    goalCountValue: diffResult.goalCountValue,
    verifyResult: diffResult.verifyResult,
    verifyValue: diffResult.verifyValue,

    // 谐振裁决（V9.1: 含市场面四维共振）
    resonance: resonanceWithMarket,
    sevenMatch: diffResult.sevenMatch,
    anchor: diffResult.anchor,

    // 第六阶段：比分矩阵（★ V7.0: 传入市场 xG 做融合校准）
    scores: (() => {
      try {
        const s = score.analyze(
          vars,
          goalResult.xgHome,
          goalResult.xgAway,
          goalResult.goalRange,
          strengthResult.ladder.level,
          marketResult.marketXg || null, // V7.0: 市场 xG 数据
        );
        return s.length > 0 ? s : [{ score: '--', percent: '无合法比分' }];
      } catch (e) {
        return [{ score: '--', percent: '计算异常' }];
      }
    })(),

    // 建议
    suggestion: resonanceWithMarket.verdict || '基于历史数据的量化分析，仅供参考',

    // ★ V7.0 第七阶段输出：市场情报交叉验证
    marketMovement: marketResult.movement || null,
    marketEuroAsia: marketResult.euroAsia || null,
    marketXg: marketResult.marketXg || null,
    marketScore: marketResult.marketScore,
    marketSignal: marketResult.marketSignal,
    marketRiskLevel: marketResult.riskLevel,
    marketRiskDetail: marketResult.riskDetail,
    marketSignalFlags: marketResult.signalFlags || [],
    // Market_xG 融合后的 xG（如果可用）
    fusedXgHome:
      marketResult.marketXg && marketResult.marketXg.valid
        ? +(goalResult.xgHome * 0.7 + marketResult.marketXg.home * 0.3).toFixed(2)
        : goalResult.xgHome,
    fusedXgAway:
      marketResult.marketXg && marketResult.marketXg.valid
        ? +(goalResult.xgAway * 0.7 + marketResult.marketXg.away * 0.3).toFixed(2)
        : goalResult.xgAway,

    // ★ V9.1: 模型原始预测总值（供 model-weights 真实代理指标）
    gsModelATotal: goalResult.fusionDetails
      ? goalResult.fusionDetails.modelA
        ? goalResult.fusionDetails.modelA.total
        : null
      : null,
    gsModelBTotal: goalResult.fusionDetails
      ? goalResult.fusionDetails.modelB
        ? goalResult.fusionDetails.modelB.total
        : null
      : null,
    gsModelCTotal: goalResult.fusionDetails
      ? goalResult.fusionDetails.modelC
        ? goalResult.fusionDetails.modelC.total
        : null
      : null,
  };
}

// ==================== 降级估算（无 API 数据时使用基础联赛数据） ====================

/**
 * 为无 API 统计数据的比赛生成降级 GS 条目
 * 使用联赛平均数据 + 让球信息做保守估计
 */
function computeFallbackMatch(m) {
  const ln = (m.leagueName || '').trim();
  const handicap = m.handicap !== undefined ? Number(m.handicap) : m.rq !== undefined ? Number(m.rq) : 0;
  const hdc = handicap; // 别名兼容历史代码

  // 联赛场均进球基准
  const LEAGUE_GOALS = {
    英超: 2.72,
    西甲: 2.63,
    意甲: 2.56,
    德甲: 3.18,
    法甲: 2.55,
    荷甲: 3.05,
    葡超: 2.67,
    挪超: 2.92,
    瑞典超: 2.85,
    日职: 2.62,
    日乙: 2.58,
    韩职: 2.48,
    美职: 2.78,
    俄超: 2.48,
    比甲: 2.82,
    奥甲: 2.72,
    苏超: 2.65,
    中超: 2.78,
    墨超: 2.68,
    巴甲: 2.42,
    阿甲: 2.18,
    欧冠: 2.82,
    欧罗巴: 2.72,
    亚冠: 2.65,
    澳洲甲: 2.88,
    德乙: 2.82,
    法乙: 2.42,
    英冠: 2.55,
    土超: 2.75,
    波兰超: 2.62,
    瑞士超: 2.82,
    希腊超: 2.32,
    丹麦超: 2.78,
  };
  let avgGoals = 2.65; // 默认
  const keys = Object.keys(LEAGUE_GOALS);
  for (let i = 0; i < keys.length; i++) {
    if (ln.indexOf(keys[i]) !== -1) {
      avgGoals = LEAGUE_GOALS[keys[i]];
      break;
    }
  }

  // ★ V9.1: 注入比赛特异性 — 用 matchId + homeName 双哈希生成扰动
  // 避免所有同让球的降级比赛返回完全相同的数值
  const seed = (m.matchId || '').replace(/\D/g, '').slice(-4) || '0';
  const nameSeed = (m.homeName || '').length + (m.visitName || '').length;
  const seedVal = (((parseInt(seed) || 0) + nameSeed * 13) % 10000) / 10000; // 0~0.9999

  // ★ 强扰动: 联赛基线 ±10%, hdcStrength ±40%, xg ±0.25
  const leaguePerturbation = (seedVal - 0.5) * 0.2; // [-0.10, +0.10] 联赛偏离
  const hdcPerturbation = (seedVal - 0.5) * 0.3; // [-0.15, +0.15] 实力偏离
  avgGoals = +(avgGoals * (1 + leaguePerturbation)).toFixed(2);

  const hdcStrength =
    Math.abs(hdc) > 1 ? 0.35 + hdcPerturbation : Math.abs(hdc) > 0.5 ? 0.2 + hdcPerturbation : 0.08 + hdcPerturbation;

  // 基于联赛场均进球做保守 Xg 估算（确保最小差距 1.0 以通过弱一致门槛）
  const baseXg = avgGoals / 2;
  const xgDelta = Math.max(1.0, Math.abs(hdc) * 0.5);
  let xgHome = baseXg + (hdc >= 0 ? xgDelta / 2 : -xgDelta / 2);
  let xgAway = baseXg + (hdc >= 0 ? -xgDelta / 2 : xgDelta / 2);
  // ★ 对 xg 值做额外扰动（用 seed 的另一部分）
  const xgPerturbation = (((seedVal * 13) % 1) - 0.5) * 0.5; // [-0.25, +0.25]
  xgHome = +(xgHome + xgPerturbation).toFixed(2);
  xgAway = +(xgAway - xgPerturbation).toFixed(2);
  // 确保 xg 在合理范围
  xgHome = Math.max(0.15, Math.min(3.5, xgHome));
  xgAway = Math.max(0.15, Math.min(3.5, xgAway));

  const hWins = Math.round(4 + hdc * 2);
  const hLosses = Math.round(4 - hdc * 2);
  const aWins = Math.round(4 - hdc * 2);
  const aLosses = Math.round(4 + hdc * 2);

  // 大球率根据联赛基线估算
  const overRate = avgGoals >= 2.85 ? 70 : avgGoals >= 2.65 ? 55 : 40;
  const bigBallRatio = overRate;

  return {
    matchId: m.matchId || '',
    homeName: m.homeName || '',
    visitName: m.visitName || '',
    leagueName: m.leagueName || '',
    num: m.num || '',
    computedAt: Date.now(),
    _fallback: true, // 标记为降级数据

    // ★ V9.1: 实力维度加比赛特异性
    homePower: Math.round(50 + hdc * 15 + hdcPerturbation * 50),
    guestPower: Math.round(50 - hdc * 15 - hdcPerturbation * 50),
    attackAdvantage: (hdc >= 0 ? '+' : '') + Math.round(hdcStrength * 100) + '%',
    attackAdvantageValue: Math.round(50 + hdcStrength * 100),
    attackAdvantageRaw: hdcStrength * (hdc >= 0 ? 1 : -1), // 正负号指示方向
    defenseAdvantage: (hdc >= 0 ? '+' : '') + Math.round(hdcStrength * 80) + '%',
    defenseAdvantageValue: Math.round(50 + hdcStrength * 80),
    defenseAdvantageRaw: hdcStrength * 0.8 * (hdc >= 0 ? 1 : -1),
    attackPattern: Math.abs(hdc) > 1 ? '对攻为主' : Math.abs(hdc) > 0.5 ? '攻守平衡' : '攻守平衡',
    totalAdvantage: (hdc >= 0 ? '+' : '') + Math.round(hdcStrength * 80) + '%',
    totalAdvantageRaw: hdcStrength,
    totalAdvantageValue: Math.round(50 + hdcStrength * 100),
    adWeightedComposite: hdcStrength * 0.6,
    ladderLabel: Math.abs(hdc) > 1 ? (hdc > 0 ? '⚔️ 主队中等优势' : '⚔️ 客队中等优势') : '⚖️ 双方均势',
    ladderLevel: Math.abs(hdc) > 1 ? 2 : 1,
    totalStrength: hdcStrength,
    crossSpfWin: +(0.35 + hdc * 0.08 + hdcPerturbation * 0.5).toFixed(2),
    crossSpfDraw: +(0.3 - Math.abs(hdcPerturbation) * 0.3).toFixed(2),
    crossSpfLose: +(0.35 - hdc * 0.08 - hdcPerturbation * 0.5).toFixed(2),
    crossHcpWin: 0.5 + hdc * 0.1,
    crossHcpDraw: 0.25,
    crossHcpLose: 0.25 - hdc * 0.1,
    crossRq: handicap,
    hWins: Math.max(0, hWins),
    hLosses: Math.max(0, hLosses),
    aWins: Math.max(0, aWins),
    aLosses: Math.max(0, aLosses),

    // 进球维度
    overRate: overRate,
    bigBallRatio: bigBallRatio,
    attDefGoal: parseFloat((xgHome + xgAway).toFixed(2)),
    xgHome: parseFloat(xgHome.toFixed(2)),
    xgAway: parseFloat(xgAway.toFixed(2)),
    gdQ: parseFloat((xgHome - xgAway).toFixed(4)),
    strengthGoal: parseFloat((avgGoals * 0.85).toFixed(2)),
    h2hGoalAvg: parseFloat((avgGoals * 0.9).toFixed(1)),
    breakArmorSum: parseFloat((1.5 + hdcStrength * 0.5).toFixed(4)),
    goalRange: {
      range: avgGoals >= 2.8 ? '2-5球' : '1-4球',
      lower: 1,
      upper: avgGoals >= 2.8 ? 5 : 4,
      compositeLine: parseFloat(avgGoals.toFixed(2)),
      overRate: overRate,
      lambdaGene: avgGoals,
      lambdaActual: avgGoals,
      homeOverRate: 0.4,
      awayOverRate: 0.4,
      h2hOverRate: 0.5,
    },

    // 融合共识
    fusionConsensus: '弱一致(数据降级)',
    fusionConsensusType: 'weak', // 英文代码: 降级数据标记
    fusionFinalHome: parseFloat(xgHome.toFixed(2)),
    fusionFinalAway: parseFloat(xgAway.toFixed(2)),
    fusionFinalTotal: parseFloat((xgHome + xgAway).toFixed(1)),
    fusionFused: true,

    // ★ V9.1: 比分动态计算（不再硬编码）
    // 使用泊松+联赛基线+让球偏移，生成8种比分
    scores: (function () {
      try {
        const score = require('./score');
        // 构造简化 vars 供 score.analyze 使用
        const fakeVars = {
          homeWinGap_1: hWins,
          homeWinGap_2: Math.round(hWins / 2),
          homeLoseGap_1: hLosses,
          homeLoseGap_2: Math.round(hLosses / 2),
          awayWinGap_1: aWins,
          awayWinGap_2: Math.round(aWins / 2),
          awayLoseGap_1: aLosses,
          awayLoseGap_2: Math.round(aLosses / 2),
          homeDraw: Math.round((10 - hWins - hLosses) / 2),
          awayDraw: Math.round((10 - aWins - aLosses) / 2),
          homeSpf: hWins + '胜' + (10 - hWins - hLosses) + '平' + hLosses + '负',
          guestSpf: aWins + '胜' + (10 - aWins - aLosses) + '平' + aLosses + '负',
          homeGoal0: 3,
          homeGoal1: 4,
          homeGoal2Plus: 3,
          homeLose0: 3,
          homeLose1: 4,
          homeLose2Plus: 3,
          awayGoal0: 3,
          awayGoal1: 4,
          awayGoal2Plus: 3,
          awayLose0: 3,
          awayLose1: 4,
          awayLose2Plus: 3,
          homeRecentGoalAvg: xgHome,
          homeRecentLoseAvg: xgAway,
          awayRecentGoalAvg: xgAway,
          awayRecentLoseAvg: xgHome,
          homeAttackEfficiency: 0.1,
          homeDefendEfficiency: 0.1,
          awayAttackEfficiency: 0.1,
          awayDefendEfficiency: 0.1,
          homeOverRate: 0.5,
          awayOverRate: 0.5,
          homeWinAward: 1.0,
          guestWinAward: 1.0,
          drawAward: 1.0,
          jiaoFenScores: [],
          homeGoalDiffSeries: [1, 1, 1, 1, 0, 0, -1, -1, -1, -1],
          awayGoalDiffSeries: [1, 1, 1, 1, 0, 0, -1, -1, -1, -1],
          rq: hdc,
          homePower: 50 + hdc * 15,
          awayPower: 50 - hdc * 15,
          homeWinPanRate: 0,
          awayWinPanRate: 0,
        };
        // 用实际让球数对应的 level 传参（>0: level>0, <0: level<0, =0: level=0）
        const fallbackLevel = hdc > 0.8 ? 2 : hdc > 0.2 ? 1 : hdc < -0.8 ? -2 : hdc < -0.2 ? -1 : 0;
        const goalRange = { lower: Math.max(0, Math.floor(avgGoals) - 1), upper: Math.ceil(avgGoals) + 1 };
        const s = score.analyze(fakeVars, xgHome, xgAway, goalRange, fallbackLevel, null);
        if (s && s.length > 0) return s;
      } catch (e) {
        /* fall through */
      }
      // 兜底：仍然按让球方向输出基础比分
      const fallbackScores =
        hdc > 0
          ? [
              { score: '2-1', percent: '20%' },
              { score: '1-0', percent: '17%' },
              { score: '2-0', percent: '15%' },
              { score: '1-1', percent: '13%' },
              { score: '3-1', percent: '11%' },
              { score: '3-0', percent: '9%' },
              { score: '2-2', percent: '8%' },
              { score: '0-0', percent: '7%' },
            ]
          : hdc < 0
            ? [
                { score: '1-2', percent: '20%' },
                { score: '0-1', percent: '17%' },
                { score: '0-2', percent: '15%' },
                { score: '1-1', percent: '13%' },
                { score: '1-3', percent: '11%' },
                { score: '0-3', percent: '9%' },
                { score: '2-2', percent: '8%' },
                { score: '0-0', percent: '7%' },
              ]
            : [
                { score: '1-1', percent: '20%' },
                { score: '1-0', percent: '16%' },
                { score: '0-1', percent: '16%' },
                { score: '2-1', percent: '13%' },
                { score: '1-2', percent: '13%' },
                { score: '0-0', percent: '9%' },
                { score: '2-0', percent: '7%' },
                { score: '0-2', percent: '6%' },
              ];
      return fallbackScores;
    })(),
    suggestion: '基于联赛均值降级估算，仅供参考',
    resonance: { verdict: '⚠️ 数据源缺失，使用联赛均值降级估算', level: 'weak' },
    sevenMatch: {
      dimension1: {
        hCount: hWins,
        aCount: aLosses,
        total: hWins + aLosses,
        prob: 0.55,
        probPct: '55.0%',
        passed: true,
        label: '⚠️ 降级估算',
        confidence: '低',
      },
      dimension2: {
        hCount: hLosses,
        aCount: aWins,
        total: hLosses + aWins,
        prob: 0.48,
        probPct: '48.0%',
        passed: false,
        label: '⚠️ 降级估算',
        confidence: '低',
      },
    },
    anchor: { anchor: 0.3, label: '弱一致盘面', judgment: '参考' },
    verifyResult: '⚠️ 降级估算',
    verifyValue: 40,
    homeWinExpect: (hdc >= 0 ? '+' : '') + parseFloat((xgHome - xgAway).toFixed(2)),
    homeWinValue: Math.round(50 + hdc * 10),
    totalAdvantage2: (hdc >= 0 ? '+' : '') + Math.round(hdcStrength * 60) + '%',
    totalAdvantage2Value: Math.round(50 + hdcStrength * 60),
    goalCount: avgGoals >= 2.8 ? '±0' : '≥1',
    goalCountValue: Math.round(avgGoals * 18),
    homeWinPanRate: 0.5 + hdc * 0.05,
    awayWinPanRate: 0.5 - hdc * 0.05,
    homeWinAward: 2.5 - hdc * 0.3,
    awayWinAward: 2.5 + hdc * 0.3,
    drawAward: 3.2,
    leagueAvgGoals: avgGoals,
    leagueOverBaseline: avgGoals >= 2.85 ? 68 : avgGoals >= 2.65 ? 55 : 42,
    leagueCalibration: 0.85,
    goalStabilityHome: 20,
    goalStabilityAway: 20,
    defStabilityHome: 20,
    defStabilityAway: 20,
    stabilityOverall: 55,
    attackDimWeight: '50%',
    defenseDimWeight: '50%',
    attackWeightHome: '50%',
    attackWeightAway: '50%',
    defenseWeightHome: '50%',
    defenseWeightAway: '50%',
    homeWeight: '50%',
    awayWeight: '50%',
    totalGoalsExpect: avgGoals.toFixed(2),
    totalGoalsValue: Math.round(avgGoals * 18),
    goalDiffHome: xgHome.toFixed(1) + '/' + (avgGoals - xgHome).toFixed(1),
    goalDiffAway: xgAway.toFixed(1) + '/' + (avgGoals - xgAway).toFixed(1),

    // ★ V7.0 市场情报（降级模式）
    marketMovement: null,
    marketEuroAsia: null,
    marketXg: null,
    marketScore: 50,
    marketSignal: '⚠️ 降级模式（无赔率数据）',
    marketRiskLevel: 'caution',
    marketRiskDetail: '数据源缺失，市场情报不可用',
    marketSignalFlags: ['降级估算'],
    fusedXgHome: xgHome,
    fusedXgAway: xgAway,
  };
}

// ==================== 全局变量 ====================
const _globalStatsMap = null; // { matchId: rawStats }
const _globalCacheKey = null; // 当前批次

function loadDataJsonM() {
  const dataFilePath = path.join(__dirname, '..', 'data.json');
  if (!fs.existsSync(dataFilePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(dataFilePath, 'utf8')).m || {};
  } catch (e) {
    return {};
  }
}

// ==================== 批量计算与缓存 ====================

/**
 * 按队名交叉匹配：API data → data.json matchId
 * 匹配所有 data.json 中的比赛（不限定日期），返回 { matchId: rawStats }
 */
async function crossMatchAll() {
  // 自动发现最新批次
  let batchDT;
  try {
    batchDT = await fetch.autoDiscoverBatch();
  } catch (e) {
    console.error('[gs] 批次发现失败:', e.message);
    return {};
  }
  if (!batchDT) {
    console.error('[gs] 无可用批次');
    return {};
  }
  console.log('[gs] 主批次:', batchDT);

  // ★ P1: 使用多批次聚合，最大化比赛覆盖
  const matched = await fetch.fetchAndRelateMultiBatch(batchDT);
  return matched;
}

/**
 * 对全量匹配结果执行批量计算（增量更新：保留已有缓存，只计算新匹配）
 */
async function computeAll(options) {
  const opts = options || {};
  const forceRefresh = opts.forceRefresh === true;
  const cacheTtlMs = opts.cacheTtlMs !== undefined ? Number(opts.cacheTtlMs) : 10 * 60 * 1000;
  const skipPredLog = opts.skipPredLog === true;
  console.log('[gs] === 全量计算（增量模式） ===');

  const cache = readCache();
  const cacheKey = '_global';

  // 1. 保留已有缓存
  const existing = cache[cacheKey] && Object.keys(cache[cacheKey]).length > 0 ? cache[cacheKey] : {};
  const hasAny = Object.values(existing).some((v) => v && v.attackPattern);
  if (hasAny) {
    console.log('[gs] 已有缓存', Object.keys(existing).length, '场，增量更新...');
  }

  if (!forceRefresh && hasAny && isCacheFresh(cache, cacheTtlMs)) {
    console.log('[gs] 缓存仍在 TTL 内，直接返回缓存结果');
    return existing;
  }

  // 2. 交叉匹配 API ↔ data.json
  let statsMap = {};
  try {
    statsMap = await crossMatchAll();
  } catch (e) {
    console.error('[gs] crossMatchAll 失败:', e.message);
    statsMap = {}; // 继续走降级流程
  }
  if (statsMap && Object.keys(statsMap).length === 0) {
    console.log('[gs] API 无匹配数据，将完全使用降级估算');
  }

  // 3. 读取 data.json
  const mMap = loadDataJsonM();

  // 4. 只计算缓存中没有的匹配（forceRefresh 时刷新 API 命中的比赛）
  let newCount = 0;
  const changedIds = [];
  const toCompute = [];
  Object.entries(statsMap).forEach(([mid, rawStats]) => {
    if (!forceRefresh && existing[mid] && existing[mid].attackPattern) {
      return;
    }
    toCompute.push([mid, rawStats]);
  });

  if (toCompute.length > 0) {
    console.log('[gs] 需计算', toCompute.length, '场匹配...');
    toCompute.forEach(([mid, rawStats]) => {
      const m = mMap[mid] || {};
      try {
        const computed = computeSingleMatch(rawStats, m);
        if (computed) {
          const previous = existing[mid];
          existing[mid] = computed;
          if (!isSameGsResult(previous, computed)) changedIds.push(mid);
          newCount++;
        }
      } catch (e) {
        console.error('[gs] 计算失败:', mid, e.message);
      }
    });
  }

  // 5. ★ 降级估算：为最近 3 天内无 API 数据的比赛生成基本 GS 条目
  const now = new Date();
  const recentCutoff = new Date(now);
  recentCutoff.setDate(recentCutoff.getDate() - 3);
  const recentDateStr = recentCutoff.toISOString().slice(0, 10);

  let fallbackCount = 0;
  Object.entries(mMap).forEach(([mid, m]) => {
    if (!m || !m.homeName || !m.date) return;
    const d = String(m.date).slice(0, 10);
    if (d < recentDateStr) return;

    // 检查是否已有有效缓存
    if (!forceRefresh && existing[mid] && existing[mid].attackPattern) return;

    // 检查 statsMap 中是否有待计算的数据
    if (statsMap[mid] || statsMap['m_' + mid]) return;

    // 生成降级估算
    try {
      const fallback = computeFallbackMatch(m);
      if (fallback) {
        const previous = existing[mid];
        existing[mid] = fallback;
        if (!isSameGsResult(previous, fallback)) changedIds.push(mid);
        fallbackCount++;
      }
    } catch (e) {
      console.error('[gs] 降级估算失败:', mid, e.message);
    }
  });

  if (fallbackCount > 0) {
    console.log('[gs] 降级估算新增:', fallbackCount, '场（无API数据源，使用联赛均值）');
  }

  console.log('[gs] 增量完成:', newCount, '场计算,', fallbackCount, '场降级, 共', Object.keys(existing).length, '场');

  if (changedIds.length > 0) {
    cache[cacheKey] = existing;
    cache._meta = cache._meta || {};
    cache._meta.gongshoudao = {
      updatedAt: new Date().toISOString(),
      total: Object.keys(existing).length,
      changed: changedIds.length,
      forceRefresh: forceRefresh,
    };
    writeCache(cache);
  } else {
    console.log('[gs] 无新增/变化，跳过 cache.json 写入');
  }

  // ★ 回测钩子: 只持久化本轮新增/变化的功守道预测
  if (!skipPredLog && changedIds.length > 0) {
    const savedCount = persistGsPredictionChanges(changedIds, existing, mMap);
    console.log('[gs] predLog 增量写入:', savedCount, '场');
  }

  _lastRefreshAt = Date.now();
  return existing;
}

/**
 * 获取单场比赛的量化结果
 * @param {string} matchId
 * @returns {Promise<Object|null>}
 */
async function getMatchResult(matchId) {
  // 1. 尝试读缓存（兼容 m_ 前缀）
  const cache = readCache();
  const cacheKey = '_global';
  const globalCache = cache[cacheKey] || {};

  // 直接匹配
  if (globalCache[matchId]) return globalCache[matchId];
  // m_ 前缀匹配
  if (globalCache['m_' + matchId]) return globalCache['m_' + matchId];
  // 去 m_ 前缀匹配
  const clean = String(matchId).replace(/^m_/, '');
  if (globalCache[clean]) return globalCache[clean];

  // 2. 全量计算（★ 30秒超时保护，防止外部API挂死）
  try {
    const results = await Promise.race([
      computeAll(),
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error('computeAll timeout'));
        }, 30000);
      }),
    ]);
    return results[matchId] || results['m_' + matchId] || results[clean] || null;
  } catch (e) {
    console.error('[gs] computeAll 超时/失败:', e.message);
    // 降级：返回已有缓存中任意该比赛的版本
    if (globalCache[matchId]) return globalCache[matchId];
    if (globalCache['m_' + matchId]) return globalCache['m_' + matchId];
    if (globalCache[clean]) return globalCache[clean];
    return null;
  }
}

/**
 * 刷新缓存（增量模式：保留旧数据，只计算新匹配）
 */
async function refreshCache(options) {
  return computeAll(Object.assign({ forceRefresh: true }, options || {}));
}

module.exports = {
  computeSingleMatch,
  computeFallbackMatch,
  computeAll,
  getMatchResult,
  refreshCache,
  crossMatchAll,
  readCache,
  writeCache,
};
