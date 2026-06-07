/**
 * server/gongshoudao/model-weights.js
 * V3.0 动态模型权重引擎 — 基于真实模型预测值驱动 Softmax 权重
 *
 * V3.0 变更（P0 修复）：
 *   - 改用 gs_modelA_total/gs_modelB_total/gs_modelC_total（储存在 prediction_log）
 *   - 对比 actual_home_goals + actual_away_goals，|误差| ≤ 0.5 球 = 命中
 *   - 不再使用 pk_hit / pk_ou_hit 等不相关代理指标
 *
 * 模型对应关系：
 *   ModelA (射门还原法) → gs_modelA_total
 *   ModelB (攻守权重法) → gs_modelB_total
 *   ModelC (交锋预测法) → gs_modelC_total
 *
 * 命中定义：|predictedTotal - actualTotal| ≤ 0.5 球
 */

const path = require('path');

// ═══ 默认等权（新模型冷启动用） ═══
const DEFAULT_WEIGHTS = { wA: 1 / 3, wB: 1 / 3, wC: 1 / 3 };

// ═══ Softmax 温度 ═══
const TEMPERATURE = 0.5; // 越小差异越显著

/**
 * 从 prediction_log 计算近 N 天各模型命中率（V3.0: 使用真实模型预测值）
 * @param {Object} predLog prediction_log 模块引用
 * @param {number} days 统计天数，默认 30
 * @returns {{ wA: number, wB: number, wC: number, stats: Object }}
 */
function computeDynamicWeights(predLog, days) {
  days = days || 30;

  // 命中定义：预测总进球 vs 实际总进球偏差 ≤ 0.5
  const HIT_THRESHOLD = 0.5;

  // ★ 从 prediction_log 读取有赛果且含模型预测值的记录
  var rows = [];
  try {
    if (predLog && typeof predLog.queryBacktest === 'function') {
      var result = predLog.queryBacktest({ dateRange: days + 'd', type: 'all' });
      rows = (result && result.items) ? result.items : [];
    }
  } catch (e) {
    console.warn('[model-weights] prediction_log 不可用，使用等权:', e.message);
    return { wA: DEFAULT_WEIGHTS.wA, wB: DEFAULT_WEIGHTS.wB, wC: DEFAULT_WEIGHTS.wC, stats: null, source: 'fallback' };
  }

  if (rows.length < 20) {
    console.log('[model-weights] 样本不足(' + rows.length + '场)，使用等权');
    return { wA: DEFAULT_WEIGHTS.wA, wB: DEFAULT_WEIGHTS.wB, wC: DEFAULT_WEIGHTS.wC, stats: null, source: 'insufficient' };
  }

  // ═══ V3.0: 使用真实模型预测值统计命中率 ═══
  var stats = { modelA: { total: 0, hits: 0 }, modelB: { total: 0, hits: 0 }, modelC: { total: 0, hits: 0 } };

  rows.forEach(function (row) {
    // 计算实际总进球
    var actHome = row.actual_home_goals;
    var actAway = row.actual_away_goals;
    if (actHome == null || actAway == null || isNaN(actHome) || isNaN(actAway)) return;
    var actTotal = actHome + actAway;

    // ModelA: 射门还原法预测总进球
    var modelATotal = row.gs_modelA_total;
    if (modelATotal != null && !isNaN(modelATotal)) {
      stats.modelA.total++;
      if (Math.abs(modelATotal - actTotal) <= HIT_THRESHOLD) stats.modelA.hits++;
    }

    // ModelB: 攻守权重法预测总进球
    var modelBTotal = row.gs_modelB_total;
    if (modelBTotal != null && !isNaN(modelBTotal)) {
      stats.modelB.total++;
      if (Math.abs(modelBTotal - actTotal) <= HIT_THRESHOLD) stats.modelB.hits++;
    }

    // ModelC: 交锋预测法预测总进球
    var modelCTotal = row.gs_modelC_total;
    if (modelCTotal != null && !isNaN(modelCTotal)) {
      stats.modelC.total++;
      if (Math.abs(modelCTotal - actTotal) <= HIT_THRESHOLD) stats.modelC.hits++;
    }
  });

  // 确保最少样本数，避免除零
  var minSamples = 10;
  if (stats.modelA.total < minSamples || stats.modelB.total < minSamples || stats.modelC.total < minSamples) {
    console.log('[model-weights] 某模型样本不足(A=' + stats.modelA.total + ' B=' + stats.modelB.total + ' C=' + stats.modelC.total + ')，使用等权');
    return { wA: DEFAULT_WEIGHTS.wA, wB: DEFAULT_WEIGHTS.wB, wC: DEFAULT_WEIGHTS.wC, stats: stats, source: 'partial' };
  }

  // Softmax 计算权重
  var accA = stats.modelA.total > 0 ? stats.modelA.hits / stats.modelA.total : 0.5;
  var accB = stats.modelB.total > 0 ? stats.modelB.hits / stats.modelB.total : 0.5;
  var accC = stats.modelC.total > 0 ? stats.modelC.hits / stats.modelC.total : 0.5;

  // 缩尾：命中率控制在 [0.3, 0.7]，避免极端权重
  accA = Math.max(0.3, Math.min(0.7, accA));
  accB = Math.max(0.3, Math.min(0.7, accB));
  accC = Math.max(0.3, Math.min(0.7, accC));

  var T = TEMPERATURE;
  var sA = Math.exp(accA / T);
  var sB = Math.exp(accB / T);
  var sC = Math.exp(accC / T);
  var sum = sA + sB + sC;

  var wA = +(sA / sum).toFixed(4);
  var wB = +(sB / sum).toFixed(4);
  var wC = +(sC / sum).toFixed(4);

  console.log('[model-weights] V3.0 ' + days + '天真实模型命中 → A=' + (accA * 100).toFixed(1) + '%(' + stats.modelA.total + '场) B=' + (accB * 100).toFixed(1) + '%(' + stats.modelB.total + '场) C=' + (accC * 100).toFixed(1) + '%(' + stats.modelC.total + '场) → 权重 wA=' + wA + ' wB=' + wB + ' wC=' + wC);

  return {
    wA: wA,
    wB: wB,
    wC: wC,
    stats: {
      modelA: { accuracy: +(accA * 100).toFixed(1), total: stats.modelA.total, hits: stats.modelA.hits },
      modelB: { accuracy: +(accB * 100).toFixed(1), total: stats.modelB.total, hits: stats.modelB.hits },
      modelC: { accuracy: +(accC * 100).toFixed(1), total: stats.modelC.total, hits: stats.modelC.hits },
    },
    source: 'dynamic_v3',
  };
}

/**
 * 带缓存的权重获取（避免每次计算都查数据库）
 */
var _cachedWeights = null;
var _cacheTime = 0;
var CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟

function getWeights(predLog, forceRefresh) {
  var now = Date.now();
  if (!forceRefresh && _cachedWeights && (now - _cacheTime) < CACHE_TTL_MS) {
    return _cachedWeights;
  }
  try {
    _cachedWeights = computeDynamicWeights(predLog);
    _cacheTime = now;
  } catch (e) {
    console.error('[model-weights] 计算失败，使用上次缓存:', e.message);
    if (!_cachedWeights) {
      _cachedWeights = { wA: DEFAULT_WEIGHTS.wA, wB: DEFAULT_WEIGHTS.wB, wC: DEFAULT_WEIGHTS.wC, source: 'error' };
    }
  }
  return _cachedWeights;
}

module.exports = { computeDynamicWeights, getWeights, DEFAULT_WEIGHTS };
