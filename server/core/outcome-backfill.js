/**
 * server/core/outcome-backfill.js
 * 预测结果自动回填 — 比赛结束后自动判定各模型预测是否命中
 *
 * 蓝图 §6.5：检测 matchStatus >= 2 时自动执行
 * 回填 prediction_outcomes 表，供动态权重计算和模型排行榜使用
 */

const database = require('../database');

const INTERNAL_MODEL_NAMES = ['data_fusion', 'market_signal'];

function isInternalModelName(name) {
  return INTERNAL_MODEL_NAMES.includes(String(name || ''));
}

class OutcomeBackfill {
  constructor() {
    this.lastBackfillDate = null;
    this.backfillCount = 0;
  }

  // ═══════════════════════════════════════════════════════
  // 主入口：回填已完成比赛的所有模型预测
  // ═══════════════════════════════════════════════════════

  /**
   * @param {Object} db - 数据库适配器
   * @param {Object} options - { date, dryRun }
   * @returns {{ backfilled: number, skipped: number, errors: string[] }}
   */
  async backfill(db, options = {}) {
    if (!db) return { backfilled: 0, skipped: 0, errors: ['db unavailable'] };

    const results = { backfilled: 0, skipped: 0, errors: [] };
    const date = options.date || new Date().toISOString().slice(0, 10);

    try {
      // 1. 查找已完成比赛（去除LIMIT确保覆盖全部历史，已有去重机制防止重复写入）
      const limit = options.limit || 0; // 0=不限制, >0=最多N场
      const finishedMatches = db.execAll(
        `SELECT m.matchId, m.num, m.date, m.homeName, m.visitName, m.score, m.halfScore
         FROM matches m
         WHERE m.matchStatus >= 2
         ORDER BY m.date DESC` + (limit > 0 ? ` LIMIT ${limit}` : ''),
      );

      // 2. 对每场已完成比赛，查找对应的 unified_predictions
      for (const match of finishedMatches) {
        try {
          const predictions = db.execAll(
            `SELECT * FROM unified_predictions
             WHERE (match_num = ? AND match_date = ?) OR match_id = ?
             ORDER BY computed_at ASC`,
            match.num,
            match.date,
            match.matchId,
          );

          if (predictions.length === 0) continue;

          for (const pred of predictions) {
            // 检查是否已回填
            const existing = db.execOne(
              'SELECT id FROM prediction_outcomes WHERE prediction_id = ?',
              pred.prediction_id,
            );
            if (existing) {
              results.skipped++;
              continue;
            }

            // 判定命中
            const outcome = this._judgeOutcome(pred, match);

            if (!options.dryRun) {
              db.execRun(
                `INSERT OR REPLACE INTO prediction_outcomes
                 (prediction_id, match_num, match_date, model_name, model_version,
                  actual_home_score, actual_away_score, actual_result, actual_total_goals,
                  direction_hit, over_under_hit, score_hit)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                pred.prediction_id,
                pred.match_num || match.num,
                pred.match_date || match.date,
                pred.model_name,
                pred.model_version,
                outcome.actualHomeScore,
                outcome.actualAwayScore,
                outcome.actualResult,
                outcome.actualTotalGoals,
                outcome.directionHit,
                outcome.overUnderHit,
                outcome.scoreHit,
              );
            }

            results.backfilled++;
          }
        } catch (matchErr) {
          results.errors.push(`match ${match.matchId}: ${matchErr.message}`);
        }
      }

      this.lastBackfillDate = date;
      this.backfillCount += results.backfilled;

      if (results.backfilled > 0 || results.errors.length > 0) {
        console.log(
          `[OutcomeBackfill] ${date}: ${results.backfilled} filled, ${results.skipped} skipped, ${results.errors.length} errors`,
        );
      }
    } catch (e) {
      results.errors.push(`backfill failed: ${e.message}`);
      console.error('[OutcomeBackfill] 回填失败:', e.message);
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════
  // 命中判定逻辑
  // ═══════════════════════════════════════════════════════

  _judgeOutcome(prediction, match) {
    // 解析实际赛果
    const score = match.score || '';
    const scoreParts = score.split(':');
    const actualHomeScore = parseInt(scoreParts[0]) || 0;
    const actualAwayScore = parseInt(scoreParts[1]) || 0;
    const actualTotalGoals = actualHomeScore + actualAwayScore;

    // 胜平负结果
    let actualResult = 'pending';
    if (score) {
      if (actualHomeScore > actualAwayScore) actualResult = 'home';
      else if (actualHomeScore === actualAwayScore) actualResult = 'draw';
      else actualResult = 'away';
    }

    // 方向命中
    let directionHit = 0;
    if (prediction.direction && actualResult !== 'pending') {
      directionHit = prediction.direction === actualResult ? 1 : 0;
    }

    // 大小球命中（阈值 2.5）
    let overUnderHit = 0;
    if (prediction.over_under) {
      const actualOverUnder = actualTotalGoals > 2.5 ? 'over' : 'under';
      overUnderHit = prediction.over_under === actualOverUnder ? 1 : 0;
    }

    // 比分命中
    let scoreHit = 0;
    if (prediction.predicted_score && score) {
      scoreHit = prediction.predicted_score === score ? 1 : 0;
    }

    return {
      actualHomeScore,
      actualAwayScore,
      actualResult,
      actualTotalGoals,
      directionHit,
      overUnderHit,
      scoreHit,
    };
  }

  // ═══ 回填单场比赛 ═══
  async backfillSingle(db, matchId, match) {
    if (!db) return null;

    try {
      const predictions = db.execAll(
        `SELECT * FROM unified_predictions WHERE match_id = ? ORDER BY computed_at ASC`,
        matchId,
      );

      const outcomes = [];
      for (const pred of predictions) {
        const outcome = this._judgeOutcome(pred, match);

        db.execRun(
          `INSERT OR REPLACE INTO prediction_outcomes
           (prediction_id, match_num, match_date, model_name, model_version,
            actual_home_score, actual_away_score, actual_result, actual_total_goals,
            direction_hit, over_under_hit, score_hit)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          pred.prediction_id,
          pred.match_num,
          pred.match_date,
          pred.model_name,
          pred.model_version,
          outcome.actualHomeScore,
          outcome.actualAwayScore,
          outcome.actualResult,
          outcome.actualTotalGoals,
          outcome.directionHit,
          outcome.overUnderHit,
          outcome.scoreHit,
        );

        outcomes.push({ predictionId: pred.prediction_id, ...outcome });
      }
      return outcomes;
    } catch (e) {
      console.error('[OutcomeBackfill] backfillSingle 失败:', matchId, e.message);
      return null;
    }
  }

  // ═══ 获取模型命中率统计 ═══
  getModelHitRates(db, days = 30, options = {}) {
    if (!db) return [];

    try {
      const includeInternal = options.includeInternal === true;
      const excludeInternalSql = includeInternal
        ? ''
        : " AND model_name NOT IN ('" + INTERNAL_MODEL_NAMES.join("','") + "')";
      const rows = db.execAll(`
        SELECT model_name, model_version,
          COUNT(*) as total,
          SUM(direction_hit) as dir_hits,
          SUM(over_under_hit) as ou_hits,
          SUM(score_hit) as score_hits,
          ROUND(SUM(direction_hit) * 100.0 / COUNT(*), 1) as dir_rate,
          ROUND(SUM(over_under_hit) * 100.0 / COUNT(*), 1) as ou_rate,
          ROUND(SUM(score_hit) * 100.0 / COUNT(*), 1) as score_rate
        FROM prediction_outcomes
        WHERE match_date >= date('now', '-${days} days')${excludeInternalSql}
        GROUP BY model_name, model_version
        ORDER BY dir_rate DESC
      `);

      return rows
        .filter((r) => includeInternal || !isInternalModelName(r.model_name))
        .map((r) => ({
          modelName: r.model_name,
          modelVersion: r.model_version,
          total: r.total,
          directionHits: r.dir_hits,
          directionRate: r.dir_rate,
          overUnderRate: r.ou_rate,
          scoreRate: r.score_rate,
        }));
    } catch (e) {
      console.error('[OutcomeBackfill] getModelHitRates 失败:', e.message);
      return [];
    }
  }

  // ═══ 计算动态权重 ═══
  computeDynamicWeights(db, days = 30) {
    const hitRates = this.getModelHitRates(db, days, { includeInternal: true });

    if (hitRates.length === 0) return [];

    // Softmax 温度缩放
    const temperature = 0.5;
    const rates = hitRates.map((r) => r.directionRate);
    const expRates = rates.map((r) => Math.exp(r / 10 / temperature));
    const sumExp = expRates.reduce((a, b) => a + b, 0);

    return hitRates.map((r, i) => ({
      modelName: r.modelName,
      modelVersion: r.modelVersion,
      hitRate: r.directionRate,
      weight: sumExp > 0 ? expRates[i] / sumExp : 1 / hitRates.length,
      total: r.total,
    }));
  }
}

// 全局单例
const backfiller = new OutcomeBackfill();

module.exports = {
  OutcomeBackfill,
  backfiller,
  INTERNAL_MODEL_NAMES,
  isInternalModelName,
};
