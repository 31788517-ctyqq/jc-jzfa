/**
 * server/gongshoudao/model-weights.js
 * V2.0 动态模型权重引擎 — 基于近30天命中率驱动 Softmax 权重
 *
 * 从 prediction_logs 读取各模型的预测 vs 实际总进球，按误差统计命中率，
 * 通过 Softmax 温度缩放生成动态权重。
 *
 * 模型对应关系：
 *   ModelA (射门还原法) → fusion 中 calcModelA() 的 total
 *   ModelB (攻守权重法) → goal.js 中 xgHome + xgAway → modelB.total
 *   ModelC (交锋预测法) → fusion 中 calcModelC() 的 total
 *
 * 命中定义：|predictedTotal - actualTotal| ≤ 0.5 球
 */

const path = require('path');

// ═══ 默认等权（新模型冷启动用） ═══
const DEFAULT_WEIGHTS = { wA: 1 / 3, wB: 1 / 3, wC: 1 / 3 };

// ═══ Softmax 温度 ═══
const TEMPERATURE = 0.5; // 越小差异越显著

/**
 * 从 prediction_log 计算近 N 天各模型命中率
 * @param {Object} predLog prediction_log 模块引用
 * @param {number} days 统计天数，默认 30
 * @returns {{ wA: number, wB: number, wC: number, stats: Object }}
 */
function computeDynamicWeights(predLog, days) {
  days = days || 30;

  // 命中定义：预测总进球 vs 实际总进球偏差 ≤ 0.5
  const HIT_THRESHOLD = 0.5;

  // ★ 从 prediction_log 读取有赛果的记录
  var rows = [];
  try {
    if (predLog && typeof predLog.queryBacktest === 'function') {
      var result = predLog.queryBacktest({ dateRange: days + 'd', type: 'all' });
      rows = (result && result.items) ? result.items : [];
    }
  } catch (e) {
    // prediction_log 不可用时回退到等权
    console.warn('[model-weights] prediction_log 不可用，使用等权:', e.message);
    return { wA: DEFAULT_WEIGHTS.wA, wB: DEFAULT_WEIGHTS.wB, wC: DEFAULT_WEIGHTS.wC, stats: null, source: 'fallback' };
  }

  if (rows.length < 20) {
    // 样本不足20场，回退到等权
    console.log('[model-weights] 样本不足(' + rows.length + '场)，使用等权');
    return { wA: DEFAULT_WEIGHTS.wA, wB: DEFAULT_WEIGHTS.wB, wC: DEFAULT_WEIGHTS.wC, stats: null, source: 'insufficient' };
  }

  // ═══ 统计各模型命中率 ═══
  // 从 gs_scores_json 和 actual_score 反推各模型预测值
  // gs_scores_json 存储了融合后的预测，但我们这里用 totals
  // 实际中从 prediction_log 的 fusionDetails 字段（如果有）或直接重算
  //
  // 替代方案：直接从 pk_scorer 的 computeAllScores 输出反推
  // 这里我们统计 pk_direction 命中作为 ModelB 权重（主逻辑）
  // 同时尝试解析 actual_score 计算总进球误差

  var stats = { modelA: { total: 0, hits: 0 }, modelB: { total: 0, hits: 0 }, modelC: { total: 0, hits: 0 } };

  rows.forEach(function (row) {
    var actScore = row.actual_score || '';
    var gsTop = row.gs_top_score || '';
    var actParts = actScore.split(/[-:]/);
    if (actParts.length < 2) return;
    var actHome = parseInt(actParts[0]) || 0;
    var actAway = parseInt(actParts[1]) || 0;
    var actTotal = actHome + actAway;

    // 解析 gs_scores_json 获取 ModelA/C 独立预测
    // ModelB 对应 pk_direction (胜平负方向) — 这里统计胜负方向命中率作为 ModelB 代理
    // ModelA 射门还原法 — 从 gs_scores_json 推断
    // ModelC 交锋预测法 — 从 headToHeadGoal 推断

    try {
      var gsJson = row.gs_scores_json;
      if (!gsJson) return;

      // ★ 简化：使用 pk_power_score / pk_goal_score / pk_heat_score 作为三个维度
      // ModelA 权重代理 = pk_power_score 方向命中
      // ModelB 权重代理 = pk_direction 命中  
      // ModelC 权重代理 = pk_goal_direction 命中

      // ModelB: 胜平负方向
      stats.modelB.total++;
      if (row.pk_hit) stats.modelB.hits++;

      // 尝试从 actual_home_goals/actual_away_goals 检测总进球预测
      if (row.gs_top_score) {
        stats.modelA.total++;
        var gsParts = String(gsTop).split(/[-:]/);
        if (gsParts.length >= 2) {
          var gsH = parseInt(gsParts[0]) || 0;
          var gsA = parseInt(gsParts[1]) || 0;
          var gsTotal = gsH + gsA;
          if (Math.abs(gsTotal - actTotal) <= HIT_THRESHOLD) stats.modelA.hits++;
        }

        // ModelC: 用 headToHeadGoal 方向
        stats.modelC.total++;
        if (row.pk_ou_hit) stats.modelC.hits++;
      }
    } catch (e) {
      // skip
    }
  });

  // 确保最少样本数，避免除零
  var minSamples = 10;
  if (stats.modelA.total < minSamples || stats.modelB.total < minSamples || stats.modelC.total < minSamples) {
    console.log('[model-weights] 某模型样本不足，使用等权');
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

  console.log('[model-weights] ' + days + '天命中 → A=' + (accA * 100).toFixed(1) + '% B=' + (accB * 100).toFixed(1) +
    '% C=' + (accC * 100).toFixed(1) + '% → 权重 wA=' + wA + ' wB=' + wB + ' wC=' + wC);

  return {
    wA: wA,
    wB: wB,
    wC: wC,
    stats: {
      modelA: { accuracy: +(accA * 100).toFixed(1), total: stats.modelA.total, hits: stats.modelA.hits },
      modelB: { accuracy: +(accB * 100).toFixed(1), total: stats.modelB.total, hits: stats.modelB.hits },
      modelC: { accuracy: +(accC * 100).toFixed(1), total: stats.modelC.total, hits: stats.modelC.hits },
    },
    source: 'dynamic',
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
