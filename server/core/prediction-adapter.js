/**
 * server/core/prediction-adapter.js
 * 多模型预测适配器 — 所有预测模型的标准接口层
 *
 * 蓝图 §6.2-6.3：每个模型只需实现 predict() 返回统一格式
 * 薄封装策略：只调用现有模块函数，不修改现有模块代码
 *
 * V9.1 更新（数据宜用尽用 Phase 0-2）:
 *   - Z-01: GongshoudaoAdapter 字段映射修复（directionAdvantage→crossSpf, goalLine→totalGoalsExpect）
 *   - Z-02: MarketSignalAdapter 接入 JczqBasic 多维市场信号
 *   - T-02: AI 适配器共享 JSON 解析（_parseAIOutput 基类方法）
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

  /**
   * ★ T-02: AI 输出共享解析 — 先尝试 JSON.parse，失败降级为关键词匹配
   * @param {string} content AI 输出文本
   * @param {Object} matchInfo 比赛信息
   * @returns {{ direction: string|null, confidence: number|null, score: {home:number,away:number}|null }}
   */
  _parseAIOutput(content, matchInfo) {
    if (!content) return { direction: null, confidence: null, score: null };
    const home = matchInfo.homeName || '';
    const away = matchInfo.visitName || '';

    // 尝试 JSON 解析
    let parsed = null;
    try {
      // 去除可能的 markdown 包裹
      let cleaned = content;
      const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) cleaned = jsonMatch[1];
      else {
        const braceMatch = content.match(/(\{[\s\S]*\})/);
        if (braceMatch) cleaned = braceMatch[1];
      }
      parsed = JSON.parse(cleaned.trim());
    } catch (e) {
      /* 降级为关键词匹配 */
    }

    // 从 JSON 提取方向
    if (parsed) {
      const predictions = parsed['预测建议'] || [];
      let spfDir = null;
      for (const p of predictions) {
        if (p['玩法'] === '胜平负' || p['建议方向']) {
          const dir = p['建议方向'] || '';
          if (dir.includes('主胜') || dir.includes(home)) spfDir = 'home';
          else if (dir.includes('客胜') || dir.includes(away)) spfDir = 'away';
          else if (dir.includes('平')) spfDir = 'draw';
        }
      }
      const confidence = parsed.confidence ? parseInt(parsed.confidence) / 100 : null;

      // 比分解析
      let score = null;
      for (const p of predictions) {
        if (p['玩法'] === '比分预测') {
          const s = (p['建议方向'] || '').match(/(\d+)[-:：](\d+)/);
          if (s) score = { home: parseInt(s[1]), away: parseInt(s[2]) };
        }
      }
      if (spfDir || confidence || score) {
        return { direction: spfDir, confidence, score };
      }
    }

    // 降级：关键词匹配
    const homeWinPatterns = [home + '胜', '主胜', '看好' + home, home + '不败'];
    const drawPatterns = ['平局', '握手言和', '和局', '双方战平'];
    const awayWinPatterns = [away + '胜', '客胜', '看好' + away, away + '不败'];

    let direction = null;
    for (const p of homeWinPatterns) {
      if (content.includes(p)) {
        direction = 'home';
        break;
      }
    }
    if (!direction) {
      for (const p of drawPatterns) {
        if (content.includes(p)) {
          direction = 'draw';
          break;
        }
      }
    }
    if (!direction) {
      for (const p of awayWinPatterns) {
        if (content.includes(p)) {
          direction = 'away';
          break;
        }
      }
    }

    // 置信度提取
    let confidence = null;
    const confMatch = content.match(/(?:置信度|信心|概率|把握)[：:\s]*(\d+)%/);
    if (confMatch) confidence = parseInt(confMatch[1]) / 100;

    // 比分提取
    let score = null;
    const scoreMatch = content.match(/(?:比分|预测|预计)[：:\s]*(\d+)[-:：](\d+)/);
    if (scoreMatch) score = { home: parseInt(scoreMatch[1]), away: parseInt(scoreMatch[2]) };

    return { direction, confidence, score };
  }
}

// ═══════════════════════════════════════════════════════
// 适配器 1：功守道 7段管道
// ═══════════════════════════════════════════════════════

class GongshoudaoAdapter extends PredictionModelAdapter {
  modelName = '功守道';
  modelVersion = 'v9.1';
  dimensions = ['direction', 'goal', 'score'];

  async predict(matchInfo, context) {
    try {
      const gsCache = context.gsCache || {};
      const cacheKey = matchInfo.matchId || matchInfo.num;
      const gsResult = gsCache[cacheKey];

      if (!gsResult) return null;

      // ★ Z-01 修复: 从功守道实际输出字段提取方向
      //   crossSpfWin/crossSpfDraw/crossSpfLose = SPF交叉分布概率
      const fusionConsensus = gsResult.fusionConsensusType || 'neutral';
      let direction = null;
      let directionConfidence = null;

      const spfWin = parseFloat(gsResult.crossSpfWin) || 0;
      const spfDraw = parseFloat(gsResult.crossSpfDraw) || 0;
      const spfLose = parseFloat(gsResult.crossSpfLose) || 0;

      if (spfWin + spfDraw + spfLose > 0) {
        const maxProb = Math.max(spfWin, spfDraw, spfLose);
        if (maxProb === spfWin) direction = 'home';
        else if (maxProb === spfDraw) direction = 'draw';
        else direction = 'away';
        directionConfidence = maxProb; // crossSpf 值已在 0~1 范围
      }

      // 方向置信度增强：若 totalAdvantageRaw 与 SPF 方向一致，提高置信度
      const totalAdv = parseFloat(gsResult.totalAdvantageRaw) || 0;
      if (direction === 'home' && totalAdv > 0) directionConfidence = Math.min(1, directionConfidence * 1.1);
      if (direction === 'away' && totalAdv < 0) directionConfidence = Math.min(1, directionConfidence * 1.1);

      // ★ Z-01 修复: 大小球 → 使用 totalGoalsExpect(实际存在) 代替 goalLine(不存在)
      let overUnder = null;
      let goalTotal = null;
      if (gsResult.totalGoalsExpect !== undefined && gsResult.totalGoalsExpect !== null) {
        goalTotal = parseFloat(gsResult.totalGoalsExpect);
        if (goalTotal > 2.5) overUnder = 'over';
        else if (goalTotal < 2.5) overUnder = 'under';
      }

      // ★ Z-01 修复: 比分 → 使用 scores[0].score(实际存在) 代替 predictedScore(不存在)
      let predictedScore = null;
      let scoreProbability = null;
      const scores = gsResult.scores || [];
      if (scores.length > 0 && scores[0].score && scores[0].score !== '--') {
        predictedScore = scores[0].score;
        scoreProbability = scores[0].percent ? parseFloat(scores[0].percent) / 100 : null;
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
            'SELECT * FROM ai_predictions WHERE matchId = ? ORDER BY updatedAt DESC LIMIT 1',
            matchInfo.matchId,
          );
        }
      } catch (e) {
        // deepseek.js 不可用，尝试从 context 获取
      }

      if (!aiPrediction && context.aiPrediction) {
        aiPrediction = context.aiPrediction;
      }

      if (!aiPrediction || !aiPrediction.content) return null;

      // ★ T-02: 使用共享 _parseAIOutput（先尝试 JSON.parse，失败降级关键词匹配）
      const content =
        typeof aiPrediction.content === 'string' ? aiPrediction.content : JSON.stringify(aiPrediction.content);
      const parsed = this._parseAIOutput(content, matchInfo);

      return this._buildPrediction(matchInfo, {
        direction: parsed.direction || null,
        directionConfidence: parsed.confidence || this._estimateConfidence(content),
        goalTotal: parsed.score ? parsed.score.home + parsed.score.away : null,
        predictedScore: parsed.score ? `${parsed.score.home}:${parsed.score.away}` : null,
        rawOutput: JSON.stringify(aiPrediction.content).slice(0, 5000),
      });
    } catch (e) {
      console.error('[DeepseekAdapter] predict 失败:', e.message);
      return null;
    }
  }

  _estimateConfidence(content) {
    if (!content) return null;
    const match = content.match(/(?:置信度|信心|概率|把握)[：:\s]*(\d+)%/);
    if (match) return parseInt(match[1]) / 100;
    return 0.52;
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

      // ★ T-02: 使用共享 _parseAIOutput 解析 ai_content
      if (row.ai_content) {
        const parsed = this._parseAIOutput(row.ai_content, matchInfo);
        direction = parsed.direction;
        directionConfidence = parsed.confidence;
        score = parsed.score;

        // 降级：若 _parseAIOutput 未返回方向，用旧版关键词匹配
        if (!direction) {
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
        }

        if (!directionConfidence) {
          const confMatch = row.ai_content.match(/(\d+)%/);
          if (confMatch) directionConfidence = parseInt(confMatch[1]) / 100;
        }
      }

      if (!direction) return null;

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence: directionConfidence || 0.5,
        goalTotal: score ? score.home + score.away : null,
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
  modelName = '专家共识';
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

        // SPF: 胜/主胜 → home, 平/平局 → draw, 负/客胜 → away
        if (type === '胜' || type === '主胜') dirCounts.home += num;
        else if (type === '平' || type === '平局') dirCounts.draw += num;
        else if (type === '负' || type === '客胜') dirCounts.away += num;
        // RQSPF: 让胜 → home, 让平 → draw, 让负 → away (midou310主力推荐类型)
        else if (type === '让胜') dirCounts.home += num;
        else if (type === '让平') dirCounts.draw += num;
        else if (type === '让负') dirCounts.away += num;
        // 组合类型: 胜平 → home+draw 均分, 平负 → draw+away 均分
        else if (type === '胜平') { dirCounts.home += num / 2; dirCounts.draw += num / 2; }
        else if (type === '平负') { dirCounts.draw += num / 2; dirCounts.away += num / 2; }
        // 总进球/比分等非方向型推荐不计入方向统计
        else totalNum -= num;  // 不计入总票数
      }

      if (totalNum <= 0) return null;

      // 找最大方向
      let topDir = 'home';
      let topCount = dirCounts.home;
      if (dirCounts.draw > topCount) {
        topDir = 'draw';
        topCount = dirCounts.draw;
      }
      if (dirCounts.away > topCount) {
        topDir = 'away';
        topCount = dirCounts.away;
      }

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
// 适配器 6：赔率信号分析（V9.1 升级：接入 JczqBasic 多维市场信号）
// ═══════════════════════════════════════════════════════

class MarketSignalAdapter extends PredictionModelAdapter {
  modelName = 'market_signal';
  modelVersion = 'v2.0';
  dimensions = ['direction'];

  async predict(matchInfo, context) {
    try {
      let direction = null;
      let confidence = 0.4;

      // ★ Z-02 升级: 优先使用 JczqBasic 多维市场信号
      try {
        const { loadBasic, spImpliedProb, discreteWarning, asiaWaterChange } = require('./data-fusion');

        const dateStr = (matchInfo.date || '').slice(0, 10);
        const matchNum = String(matchInfo.num || '').replace(/^[^\d]*/, '');
        if (dateStr && matchNum) {
          const basic = loadBasic(dateStr, matchNum);
          if (basic) {
            // 1) SP 隐含概率（北单市场真实定价）
            const spProb = spImpliedProb(basic);
            // 2) 离散度预警
            const discrete = discreteWarning(null, basic);
            // 3) 亚指水位变化
            const asiaWater = asiaWaterChange(basic);

            // 加权方向合成:
            //   SP隐含概率权重 0.5 + 亚指盘口方向 0.3 + 离散度调节 → 最终方向
            const spHome = spProb.homeImplied || 0;
            const spDraw = spProb.drawImplied || 0;
            const spAway = spProb.awayImplied || 0;

            // 亚指信号：升盘+主水位降 → 市场看主
            let asiaDirection = null;
            let asiaStrength = 0;
            if (asiaWater.panShift != null && asiaWater.waterChangeHome != null) {
              if (asiaWater.panShift > 0 && asiaWater.waterChangeHome < -0.02) {
                asiaDirection = 'home';
                asiaStrength = Math.min(0.3, Math.abs(asiaWater.panShift) * 0.5);
              } else if (asiaWater.panShift < 0 && asiaWater.waterChangeHome > 0.02) {
                asiaDirection = 'away';
                asiaStrength = Math.min(0.3, Math.abs(asiaWater.panShift) * 0.5);
              }
            }

            // 离散度调节因子
            let discreteFactor = 1.0;
            if (discrete.flagLevel === 'warning') discreteFactor = 0.7;
            else if (discrete.flagLevel === 'caution') discreteFactor = 0.85;

            // 加权融合方向
            const dirScores = { home: spHome * 0.5, draw: spDraw * 0.5, away: spAway * 0.5 };
            if (asiaDirection) {
              dirScores[asiaDirection] = (dirScores[asiaDirection] || 0) + asiaStrength;
            }

            const maxDir = Object.entries(dirScores).reduce((a, b) => (a[1] > b[1] ? a : b));
            if (maxDir[1] > 0.25) {
              direction = maxDir[0];
              confidence = Math.min(0.85, maxDir[1] * discreteFactor);
            }

            return this._buildPrediction(matchInfo, {
              direction,
              directionConfidence: confidence,
              rawOutput: JSON.stringify({
                spProb: {
                  home: +(spHome * 100).toFixed(1) + '%',
                  draw: +(spDraw * 100).toFixed(1) + '%',
                  away: +(spAway * 100).toFixed(1) + '%',
                },
                discrete: discrete.flag,
                asiaSignal: asiaWater.signal,
                discreteFactor,
              }).slice(0, 2000),
            });
          }
        }
      } catch (e) {
        // JczqBasic 不可用时降级到原有逻辑
      }

      // 降级：原有基础赔率逻辑
      const odds = context.odds || {};
      if (!odds.spf && !odds.rqspf) return null;

      const spf = odds.spf;
      if (spf && Array.isArray(spf) && spf.length >= 3) {
        const homeOdds = spf[0];
        const drawOdds = spf[1];
        const awayOdds = spf[2];

        if (homeOdds <= drawOdds && homeOdds <= awayOdds) {
          direction = 'home';
          confidence = 1 / homeOdds;
        } else if (drawOdds <= homeOdds && drawOdds <= awayOdds) {
          direction = 'draw';
          confidence = 1 / drawOdds;
        } else {
          direction = 'away';
          confidence = 1 / awayOdds;
        }

        confidence = Math.min(Math.max(confidence / 3, 0.1), 0.8);
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
// 适配器 7：数据融合适配器（V9.1 新增 — J-02）
// ═══════════════════════════════════════════════════════

class DataFusionAdapter extends PredictionModelAdapter {
  modelName = 'data_fusion';
  modelVersion = 'v1.0';
  dimensions = ['direction', 'goal'];

  async predict(matchInfo, context) {
    try {
      const { fullFusion } = require('./data-fusion');

      const gsCache = context.gsCache || {};
      const cacheKey = matchInfo.matchId || matchInfo.num;
      const gs = gsCache[cacheKey] || {};

      const dateStr = (matchInfo.date || '').slice(0, 10);
      const matchNum = String(matchInfo.num || '').replace(/^[^\d]*/, '');

      if (!dateStr || !matchNum) return null;

      const fusion = fullFusion({
        dateStr,
        matchNum,
        matchId: matchInfo.matchId,
        gs,
      });

      if (!fusion.ready) return null;

      // SP 隐含概率 → 方向
      const spProb = fusion.spProb;
      let direction = 'draw';
      let directionConfidence = 0.33;
      const hi = spProb.homeImplied || 0;
      const di = spProb.drawImplied || 0;
      const ai = spProb.awayImplied || 0;

      if (hi > di && hi > ai) {
        direction = 'home';
        directionConfidence = hi;
      } else if (ai > hi && ai > di) {
        direction = 'away';
        directionConfidence = ai;
      } else {
        direction = 'draw';
        directionConfidence = di;
      }

      // 离散度 → 置信度调整
      if (fusion.discrete && fusion.discrete.flagLevel === 'warning') {
        directionConfidence *= 0.7;
      } else if (fusion.discrete && fusion.discrete.flagLevel === 'caution') {
        directionConfidence *= 0.85;
      }

      // 大小球方向（从 xgValidation）
      let overUnder = null;
      let goalTotal = null;
      if (fusion.xgValidation && fusion.xgValidation.gsTotalExpect !== null) {
        goalTotal = fusion.xgValidation.gsTotalExpect;
        const marketPan = fusion.xgValidation.marketDxqPan;
        if (marketPan != null) {
          overUnder = goalTotal > marketPan ? 'over' : 'under';
        } else {
          overUnder = goalTotal > 2.5 ? 'over' : 'under';
        }
      }

      return this._buildPrediction(matchInfo, {
        direction,
        directionConfidence: Math.min(Math.max(directionConfidence, 0.1), 0.9),
        goalTotal,
        overUnder,
        rawOutput: JSON.stringify({
          spProb: {
            home: '+' + (hi * 100).toFixed(0) + '%',
            draw: '+' + (di * 100).toFixed(0) + '%',
            away: '+' + (ai * 100).toFixed(0) + '%',
          },
          discrete: fusion.discrete ? fusion.discrete.flag : '无数据',
          asiaWater: fusion.asiaWater ? fusion.asiaWater.signal : '无数据',
          xgDeviation: fusion.xgValidation ? fusion.xgValidation.deviation : null,
        }).slice(0, 2000),
      });
    } catch (e) {
      console.error('[DataFusionAdapter] predict 失败:', e.message);
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
  DataFusionAdapter,
};
