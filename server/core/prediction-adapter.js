/**
 * server/core/prediction-adapter.js
 * 多模型预测适配器 — 所有预测模型的标准接口层
 *
 * 蓝图 §6.2-6.3：每个模型只需实现 predict() 返回统一格式
 * 薄封装策略：只调用现有模块函数，不修改现有模块代码
 */

const database = require('../database');

// ═══════════════════════════════════════════════════════
// 基类：PredictionModelAdapter
// ═══════════════════════════════════════════════════════

class PredictionModelAdapter {
  /** @type {string} 模型唯一标识 */
  modelName = '';
  /** @type {string} 版本号 */
  modelVersion = '';
  /** @type {string[]} 覆盖维度 */
  dimensions = [];

  /**
   * 预测接口
   * @param {Object} matchInfo - 比赛基本信息
   * @param {Object} context   - 上下文 {features, gsCache, odds, shujuData, aiPrediction}
   * @returns {Prediction|null}
   */
  async predict(matchInfo, context) {
    throw new Error(`[${this.modelName}] predict() 未实现`);
  }

  /** 生成幂等 prediction_id */
  _id(matchInfo) {
    const mid = matchInfo.matchId || matchInfo.num || 'unknown';
    const date = matchInfo.date || matchInfo.matchDate || 'unknown';
    return `${this.modelName}_${this.modelVersion}_${mid}_${date}`;
  }

  /** 构建标准 Prediction 对象 */
  _buildPrediction(matchInfo, opts = {}) {
    return {
      matchId: matchInfo.matchId || '',
      matchNum: matchInfo.num || matchInfo.matchNum || '',
      matchDate: matchInfo.date || matchInfo.matchDate || '',
      modelName: this.modelName,
      modelVersion: this.modelVersion,
      predictionId: opts.predictionId || this._id(matchInfo),
      direction: opts.direction || null,
      directionConfidence: opts.directionConfidence || null,
      goalTotal: opts.goalTotal || null,
      goalRange: opts.goalRange || null,
      overUnder: opts.overUnder || null,
      predictedScore: opts.predictedScore || null,
      scoreProbability: opts.scoreProbability || null,
      rawOutput: opts.rawOutput || null,
      featuresSnapshot: opts.features || null,
      consensusTag: opts.consensusTag || null,
      computedAt: new Date().toISOString(),
    };
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 1：功守道 7段管道
// ═══════════════════════════════════════════════════════

class GongshoudaoAdapter extends PredictionModelAdapter {
  modelName = 'gongshoudao';
  modelVersion = 'v7.0';
  dimensions = ['direction', 'goal', 'score'];

  async predict(matchInfo, context) {
    try {
      const gsCache = context.gsCache || {};
      const cacheKey = matchInfo.matchId || matchInfo.num;
      const gsResult = gsCache[cacheKey];

      if (!gsResult) return null;

      // 从功守道结果提取方向
      const fusionConsensus = gsResult.fusionConsensusType || 'neutral';
      let direction = null;
      let directionConfidence = null;

      if (gsResult.directionAdvantage && gsResult.directionAdvantage.direction) {
        direction = gsResult.directionAdvantage.direction; // 'home'/'draw'/'away'
        directionConfidence = (gsResult.directionAdvantage.confidence || 50) / 100;
      }

      // 大小球
      let overUnder = null;
      let goalTotal = null;
      if (gsResult.goalLine !== undefined) {
        goalTotal = gsResult.goalLine;
        if (goalTotal > 2.5) overUnder = 'over';
        else if (goalTotal < 2.5) overUnder = 'under';
      }

      // 比分
      let predictedScore = null;
      let scoreProbability = null;
      if (gsResult.predictedScore) {
        predictedScore = gsResult.predictedScore;
        scoreProbability = gsResult.scoreProbability || null;
      }

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence,
        goalTotal,
        goalRange: goalTotal ? (goalTotal >= 3 ? '3+' : goalTotal >= 2 ? '2-3' : '0-1') : null,
        overUnder,
        predictedScore,
        scoreProbability,
        consensusTag: fusionConsensus,
        rawOutput: JSON.stringify(gsResult).slice(0, 5000),
      });
    } catch (e) {
      console.error('[GongshoudaoAdapter] predict 失败:', e.message);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 2：PK 评分器
// ═══════════════════════════════════════════════════════

class PKScorerAdapter extends PredictionModelAdapter {
  modelName = 'pk_scorer';
  modelVersion = 'v2.0';
  dimensions = ['direction', 'goal'];

  async predict(matchInfo, context) {
    try {
      const pkCache = context.pkCache || {};
      const cacheKey = matchInfo.matchId;

      // 尝试从 prediction_logs 获取 PK 评分数据
      let direction = null;
      let directionConfidence = null;

      // 优先使用 prediction_log 中的 PK 数据
      if (context.predictionLogRow) {
        const row = context.predictionLogRow;
        if (row.pk_direction) {
          direction = row.pk_direction;
        }
        if (row.pk_composite_score) {
          directionConfidence = Math.min(row.pk_composite_score / 100, 1.0);
        }
      }

      if (!direction) return null;

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence: directionConfidence || 0.5,
        overUnder: null, // PK 当前不预测大小球
      });
    } catch (e) {
      console.error('[PKScorerAdapter] predict 失败:', e.message);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 3：DeepSeek AI
// ═══════════════════════════════════════════════════════

class DeepseekAdapter extends PredictionModelAdapter {
  modelName = 'deepseek';
  modelVersion = 'v4-pro';
  dimensions = ['direction', 'goal'];

  async predict(matchInfo, context) {
    try {
      // 尝试加载 deepseek.js 模块
      let aiPrediction = null;
      try {
        const deepseek = require('../deepseek');
        const adp = database.getAdapter();
        if (adp) {
          aiPrediction = adp.execOne(
            "SELECT * FROM ai_predictions WHERE matchId = ? ORDER BY updatedAt DESC LIMIT 1",
            matchInfo.matchId
          );
        }
      } catch (e) {
        // deepseek.js 不可用，尝试从 context 获取
      }

      if (!aiPrediction && context.aiPrediction) {
        aiPrediction = context.aiPrediction;
      }

      if (!aiPrediction || !aiPrediction.content) return null;

      // 从 AI 文本内容中解析方向
      const content = aiPrediction.content || '';
      const direction = this._parseDirection(content, matchInfo);
      const confidence = aiPrediction.confidence || this._estimateConfidence(content);
      const score = this._parseScore(content);

      return this._buildPrediction(matchInfo, {
        direction: direction || null,
        directionConfidence: confidence,
        goalTotal: score ? (score.home + score.away) : null,
        predictedScore: score ? `${score.home}:${score.away}` : null,
        rawOutput: content.slice(0, 5000),
      });
    } catch (e) {
      console.error('[DeepseekAdapter] predict 失败:', e.message);
      return null;
    }
  }

  _parseDirection(content, matchInfo) {
    const home = matchInfo.homeName || '';
    const away = matchInfo.visitName || '';
    if (!home || !content) return null;

    // 简单关键词匹配（更多维度解析待蓝图 §10.2 对接 deepseek.js 原文解析逻辑）
    const homeWinPatterns = [home + '胜', '主胜', '看好' + home, home + '不败'];
    const drawPatterns = ['平局', '握手言和', '和局', '双方战平'];
    const awayWinPatterns = [away + '胜', '客胜', '看好' + away, away + '不败'];

    for (const p of homeWinPatterns) {
      if (content.includes(p)) return 'home';
    }
    for (const p of drawPatterns) {
      if (content.includes(p)) return 'draw';
    }
    for (const p of awayWinPatterns) {
      if (content.includes(p)) return 'away';
    }

    return null;
  }

  _estimateConfidence(content) {
    if (!content) return null;
    // 搜索置信度/概率关键词
    const match = content.match(/(?:置信度|信心|概率|把握)[：:\s]*(\d+)%/);
    if (match) return parseInt(match[1]) / 100;
    return 0.52; // 默认中等置信度
  }

  _parseScore(content) {
    if (!content) return null;
    const match = content.match(/(?:比分|预测|预计)[：:\s]*(\d+)[-:：](\d+)/);
    if (match) return { home: parseInt(match[1]), away: parseInt(match[2]) };
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 4：豆包 AI
// ═══════════════════════════════════════════════════════

class DoubaoAdapter extends PredictionModelAdapter {
  modelName = 'doubao';
  modelVersion = 'v2';
  dimensions = ['direction', 'goal'];

  async predict(matchInfo, context) {
    try {
      // 尝试从 prediction_log 获取豆包预测
      if (!context.predictionLogRow) return null;
      const row = context.predictionLogRow;

      let direction = null;
      let directionConfidence = null;
      let score = null;

      // 解析 ai_content 字段
      if (row.ai_content) {
        const content = row.ai_content;
        const home = matchInfo.homeName || '';
        const away = matchInfo.visitName || '';

        if (content.includes(home + '胜') || content.includes('主胜') || content.includes('看好主队')) {
          direction = 'home';
        } else if (content.includes(away + '胜') || content.includes('客胜') || content.includes('看好客队')) {
          direction = 'away';
        } else if (content.includes('平') || content.includes('和')) {
          direction = 'draw';
        }

        const confMatch = content.match(/(\d+)%/);
        if (confMatch) directionConfidence = parseInt(confMatch[1]) / 100;

        const scoreMatch = content.match(/(\d+)[-:：](\d+)/);
        if (scoreMatch) score = { home: parseInt(scoreMatch[1]), away: parseInt(scoreMatch[2]) };
      }

      if (!direction) return null;

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence: directionConfidence || 0.5,
        goalTotal: score ? (score.home + score.away) : null,
        predictedScore: score ? `${score.home}:${score.away}` : null,
      });
    } catch (e) {
      console.error('[DoubaoAdapter] predict 失败:', e.message);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 5：专家推荐共识
// ═══════════════════════════════════════════════════════

class ExpertConsensusAdapter extends PredictionModelAdapter {
  modelName = 'expert_consensus';
  modelVersion = 'v1.0';
  dimensions = ['direction'];

  async predict(matchInfo, context) {
    try {
      const recommends = matchInfo.recommends || context.recommends || [];
      if (recommends.length === 0) return null;

      // 聚合推荐方向
      const dirCounts = { home: 0, draw: 0, away: 0 };
      let totalNum = 0;

      for (const rec of recommends) {
        const type = rec.type || '';
        const num = rec.num || 1;
        totalNum += num;

        if (['胜', '主胜'].includes(type)) dirCounts.home += num;
        else if (['平', '平局'].includes(type)) dirCounts.draw += num;
        else if (['负', '客胜'].includes(type)) dirCounts.away += num;
      }

      if (totalNum === 0) return null;

      // 找最大方向
      let topDir = 'home';
      let topCount = dirCounts.home;
      if (dirCounts.draw > topCount) { topDir = 'draw'; topCount = dirCounts.draw; }
      if (dirCounts.away > topCount) { topDir = 'away'; topCount = dirCounts.away; }

      const direction = topDir === 'home' ? 'home' : topDir === 'draw' ? 'draw' : 'away';
      const confidence = topCount / totalNum;

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence: Math.min(confidence, 1.0),
        consensusTag: confidence >= 0.6 ? 'strong' : confidence >= 0.4 ? 'weak' : 'neutral',
      });
    } catch (e) {
      console.error('[ExpertConsensusAdapter] predict 失败:', e.message);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 6：赔率信号分析
// ═══════════════════════════════════════════════════════

class MarketSignalAdapter extends PredictionModelAdapter {
  modelName = 'market_signal';
  modelVersion = 'v1.0';
  dimensions = ['direction'];

  async predict(matchInfo, context) {
    try {
      const odds = context.odds || {};
      if (!odds.spf && !odds.rqspf) return null;

      let direction = null;
      let confidence = 0.4;

      // 简化版赔率方向（蓝图第三阶段接入赔率分析引擎）
      const spf = odds.spf;
      if (spf && Array.isArray(spf) && spf.length >= 3) {
        const homeOdds = spf[0];
        const drawOdds = spf[1];
        const awayOdds = spf[2];

        // 赔率最低的方向 = 最被看好的方向
        if (homeOdds <= drawOdds && homeOdds <= awayOdds) {
          direction = 'home';
          confidence = 1 / homeOdds; // 简单反比（需归一化）
        } else if (drawOdds <= homeOdds && drawOdds <= awayOdds) {
          direction = 'draw';
          confidence = 1 / drawOdds;
        } else {
          direction = 'away';
          confidence = 1 / awayOdds;
        }

        confidence = Math.min(Math.max(confidence / 3, 0.1), 0.8); // 缩放至 [0.1, 0.8]
      }

      if (!direction) return null;

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence: confidence,
        rawOutput: JSON.stringify(odds).slice(0, 2000),
      });
    } catch (e) {
      console.error('[MarketSignalAdapter] predict 失败:', e.message);
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════

module.exports = {
  PredictionModelAdapter,
  GongshoudaoAdapter,
  PKScorerAdapter,
  DeepseekAdapter,
  DoubaoAdapter,
  ExpertConsensusAdapter,
  MarketSignalAdapter,
};
