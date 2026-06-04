/**
 * server/core/prediction-fusion.js
 * 多模型预测融合引擎 — 并行收集、加权合成、共识判定
 *
 * 蓝图 §6.4：核心融合管道
 *  1. 并行调用所有适配器 → 收集预测
 *  2. 加载动态权重 (基于各模型近期命中率)
 *  3. 维度级加权合成 → 融合结论
 *  4. 一致性判定 → strong/weak/meltdown
 *  5. 存入 unified_predictions 表
 */

const database = require('../database');
const {
  GongshoudaoAdapter,
  PKScorerAdapter,
  DeepseekAdapter,
  DoubaoAdapter,
  ExpertConsensusAdapter,
  MarketSignalAdapter,
  DataFusionAdapter,
} = require('./prediction-adapter');
const { backfiller } = require('./outcome-backfill');

class PredictionFusionEngine {
  constructor() {
    /** @type {Map<string, PredictionModelAdapter>} */
    this.adapters = new Map();
    this._initialized = false;
  }

  // ═══ 初始化：注册所有模型 ═══
  init() {
    if (this._initialized) return;

    this.register(new GongshoudaoAdapter());
    this.register(new PKScorerAdapter());
    this.register(new DeepseekAdapter());
    this.register(new DoubaoAdapter());
    this.register(new ExpertConsensusAdapter());
    this.register(new MarketSignalAdapter());
    this.register(new DataFusionAdapter());

    this._initialized = true;
    console.log(`[PredictionFusion] 初始化完成，已注册 ${this.adapters.size} 个模型`);
  }

  /** 注册新模型（一行接入） */
  register(adapter) {
    this.adapters.set(adapter.modelName, adapter);
  }

  /** 获取已注册模型列表 */
  getModels() {
    return [...this.adapters.values()].map(a => ({
      modelName: a.modelName,
      modelVersion: a.modelVersion,
      dimensions: a.dimensions,
    }));
  }

  // ═══════════════════════════════════════════════════════
  // 主入口：单场比赛融合预测
  // ═══════════════════════════════════════════════════════

  /**
   * 融合所有模型对单场比赛的预测
   * @param {Object} matchInfo - 比赛基本信息
   * @param {Object} context   - 上下文 {features, gsCache, odds, dataFile, predictionLogRow}
   * @returns {Object} { matchInfo, modelPredictions, fusion, consensus }
   */
  async fuseForMatch(matchInfo, context = {}) {
    if (!this._initialized) this.init();

    const db = database.getAdapter();
    const predictions = [];

    // 1. 并行调用所有适配器
    const tasks = [...this.adapters.values()].map(async (adapter) => {
      try {
        const pred = await adapter.predict(matchInfo, context);
        if (pred) {
          predictions.push(pred);
          // 2. 持久化到 unified_predictions 表
          if (db) {
            this._savePrediction(pred, db);
          }
        }
      } catch (e) {
        console.error(`[PredictionFusion] ${adapter.modelName} 失败:`, e.message);
      }
    });
    await Promise.all(tasks);

    if (predictions.length === 0) {
      return { matchInfo, modelPredictions: [], fusion: null, consensus: { level: 'unknown', agreeCount: 0 } };
    }

    // 3. 加载动态权重
    const weights = this._getDynamicWeights(db);

    // 4. 维度级加权合成
    const fusion = this._fuseDimension(predictions, weights);

    // 5. 一致性判定
    const consensus = this._assessConsensus(predictions);

    return {
      matchInfo: {
        matchId: matchInfo.matchId || '',
        num: matchInfo.num || '',
        date: matchInfo.date || '',
        homeName: matchInfo.homeName || '',
        visitName: matchInfo.visitName || '',
      },
      modelPredictions: predictions,
      fusion,
      consensus,
    };
  }

  // ═══ 批量融合（多场比赛） ═══
  async fuseBatch(matches, context = {}) {
    const results = [];
    for (const match of matches) {
      const result = await this.fuseForMatch(match, context);
      results.push(result);
    }
    return results;
  }

  // ═══════════════════════════════════════════════════════
  // 融合算法
  // ═══════════════════════════════════════════════════════

  /**
   * 维度级加权合成（V9.1: 使用 directionConfidence 参与权重）
   * @param {Prediction[]} predictions
   * @param {Object} weights - { modelName: weight }
   */
  _fuseDimension(predictions, weights) {
    const result = { direction: null, confidence: 0, goalTotal: null, overUnder: null, score: null };

    // ── 方向融合（V9.1: w × confidence 替代纯 w） ──
    const dirVotes = { home: 0, draw: 0, away: 0 };
    let dirTotalWeight = 0;

    for (const pred of predictions) {
      if (!pred.direction) continue;
      const baseW = weights[pred.modelName] || (1 / predictions.length);
      // ★ ZQ-04: 加权融合使用 confidence
      const confAdjust = typeof pred.directionConfidence === 'number' ? Math.max(0.1, pred.directionConfidence) : 0.5;
      const w = baseW * confAdjust;
      dirVotes[pred.direction] = (dirVotes[pred.direction] || 0) + w;
      dirTotalWeight += w;
    }

    if (dirTotalWeight > 0) {
      const maxDir = Object.entries(dirVotes).reduce((a, b) => a[1] > b[1] ? a : b);
      result.direction = maxDir[0];
      result.confidence = maxDir[1] / dirTotalWeight;
    }

    // ── 大小球融合 ──
    const overUnderVotes = { over: 0, under: 0 };
    let ouCount = 0;

    for (const pred of predictions) {
      if (!pred.overUnder && pred.goalTotal === null) continue;

      // 有 overUnder 直接投票
      if (pred.overUnder) {
        overUnderVotes[pred.overUnder] = (overUnderVotes[pred.overUnder] || 0) + 1;
        ouCount++;
      } else if (pred.goalTotal !== null) {
        // 有 goalTotal 则根据阈值推断
        const inferred = pred.goalTotal > 2.5 ? 'over' : 'under';
        overUnderVotes[inferred] = (overUnderVotes[inferred] || 0) + 1;
        ouCount++;
      }
    }

    if (ouCount > 0) {
      result.overUnder = overUnderVotes.over >= overUnderVotes.under ? 'over' : 'under';
      result.ouConfidence = Math.max(overUnderVotes.over, overUnderVotes.under) / ouCount;
    }

    // ── 比分融合（取众数） ──
    const scoreCounts = {};
    for (const pred of predictions) {
      if (pred.predictedScore) {
        scoreCounts[pred.predictedScore] = (scoreCounts[pred.predictedScore] || 0) + 1;
      }
    }
    const scores = Object.entries(scoreCounts).sort((a, b) => b[1] - a[1]);
    if (scores.length > 0) {
      result.score = scores[0][0];
      result.scoreConfidence = scores[0][1] / predictions.filter(p => p.predictedScore).length || 0;
    }

    // ── 总进球加权平均 ──
    let goalSum = 0, goalCount = 0;
    for (const pred of predictions) {
      if (pred.goalTotal !== null && pred.goalTotal !== undefined) {
        const w = weights[pred.modelName] || (1 / predictions.length);
        goalSum += pred.goalTotal * w;
        goalCount += w;
      }
    }
    if (goalCount > 0) {
      result.goalTotal = Math.round(goalSum / goalCount * 10) / 10;
    }

    return result;
  }

  /**
   * 一致性判定（V9.1: 加权版 — 票数 × confidence 替代纯票数）
   * @param {Prediction[]} predictions
   * @returns {{ level: string, agreeCount: number, totalCount: number, agreeModels: string[], dissentModels: string[] }}
   */
  _assessConsensus(predictions) {
    const dirPreds = predictions.filter(p => p.direction);
    if (dirPreds.length === 0) {
      return { level: 'unknown', agreeCount: 0, totalCount: predictions.length, agreeModels: [], dissentModels: [] };
    }

    // ★ ZQ-04: 加权方向分布（confidence 作为权重）
    const dirMap = {};   // { direction: { models: [...], weightedSum: number } }
    const dirCount = {}; // 纯票数（兼容旧字段）
    for (const p of dirPreds) {
      if (!dirMap[p.direction]) {
        dirMap[p.direction] = { models: [], weightedSum: 0 };
      }
      const conf = typeof p.directionConfidence === 'number' ? Math.max(0.1, p.directionConfidence) : 0.5;
      dirMap[p.direction].models.push(p.modelName);
      dirMap[p.direction].weightedSum += conf;
      dirCount[p.direction] = (dirCount[p.direction] || 0) + 1;
    }

    // 加权排序
    const sortedDirs = Object.entries(dirMap).sort((a, b) => b[1].weightedSum - a[1].weightedSum);
    const [mainDir, mainData] = sortedDirs[0];
    const totalWeighted = Object.values(dirMap).reduce((s, d) => s + d.weightedSum, 0);
    const weightedRatio = totalWeighted > 0 ? mainData.weightedSum / totalWeighted : 0;

    // 纯票数统计（保留兼容）
    const agreeCount = dirCount[mainDir];
    const totalCount = dirPreds.length;
    const pureRatio = agreeCount / totalCount;

    // ★ 共识等级：综合考虑加权比例和纯票数
    let level = 'neutral';
    const effectiveRatio = Math.min(weightedRatio, pureRatio + 0.05); // 加权不会超过纯票数太多

    if (effectiveRatio >= 0.8) {
      level = 'strong';
    } else if (effectiveRatio >= 0.6) {
      level = 'weak';
    } else if (effectiveRatio <= 0.4) {
      level = 'meltdown';
    }

    // 收集一致/分歧模型
    const agreeModels = mainData.models;
    const dissentModels = [];
    for (const [dir, data] of sortedDirs.slice(1)) {
      dissentModels.push(...data.models.map(m => m + '(' + dir + ')'));
    }

    return {
      level,
      mainDirection: mainDir,
      agreeCount,
      totalCount,
      agreeRatio: pureRatio,
      weightedRatio: +weightedRatio.toFixed(3),
      agreeModels,
      dissentModels,
    };
  }

  // ═══════════════════════════════════════════════════════
  // 动态权重
  // ═══════════════════════════════════════════════════════

  _getDynamicWeights(db) {
    try {
      if (!db) {
        // 无数据库时返回等权
        const models = [...this.adapters.keys()];
        const equalWeight = 1 / models.length;
        const weights = {};
        for (const m of models) weights[m] = equalWeight;
        return weights;
      }

      const weighted = backfiller.computeDynamicWeights(db, 30);
      if (weighted.length === 0) {
        const models = [...this.adapters.keys()];
        const equalWeight = 1 / models.length;
        const weights = {};
        for (const m of models) weights[m] = equalWeight;
        return weights;
      }

      const weights = {};
      for (const w of weighted) {
        weights[w.modelName] = w.weight;
      }
      return weights;
    } catch (e) {
      // fallback: 等权
      const models = [...this.adapters.keys()];
      const equalWeight = 1 / models.length;
      const weights = {};
      for (const m of models) weights[m] = equalWeight;
      return weights;
    }
  }

  // ═══════════════════════════════════════════════════════
  // 持久化
  // ═══════════════════════════════════════════════════════

  _savePrediction(prediction, db) {
    try {
      const batchId = new Date().toISOString().slice(0, 13).replace('T', '_');

      db.execRun(
        `INSERT OR REPLACE INTO unified_predictions
         (match_num, match_date, match_id, model_name, model_version, prediction_id,
          direction, direction_confidence, goal_total, goal_range, over_under,
          predicted_score, score_probability,
          features_json, raw_output_json, consensus_tag, fetch_batch_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        prediction.matchNum,
        prediction.matchDate,
        prediction.matchId,
        prediction.modelName,
        prediction.modelVersion,
        prediction.predictionId,
        prediction.direction,
        prediction.directionConfidence,
        prediction.goalTotal,
        prediction.goalRange,
        prediction.overUnder,
        prediction.predictedScore,
        prediction.scoreProbability,
        prediction.featuresSnapshot ? JSON.stringify(prediction.featuresSnapshot) : null,
        prediction.rawOutput ? prediction.rawOutput.slice(0, 5000) : null,
        prediction.consensusTag,
        batchId
      );
    } catch (e) {
      console.error(`[PredictionFusion] _savePrediction 失败: ${prediction.modelName}`, e.message);
    }
  }

  // ═══ 查询某场比赛的所有模型预测 ═══
  getPredictionsForMatch(matchNum, matchDate, db) {
    if (!db) return [];
    return db.execAll(
      `SELECT * FROM unified_predictions
       WHERE match_num = ? AND match_date = ?
       ORDER BY model_name`,
      matchNum, matchDate
    );
  }
}

// 全局单例
const engine = new PredictionFusionEngine();

module.exports = {
  PredictionFusionEngine,
  engine,
};
