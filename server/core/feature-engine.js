/**
 * server/core/feature-engine.js
 * 特征工程引擎 — 统一计算、存储、检索比赛特征
 *
 * 蓝图 §5.1-5.3：19 个特征维度，来源涵盖 500.com/米斗/积分榜/交锋/AI
 * 特征存入 feature_store 表供预测模型和回测使用
 */

const database = require('../database');
const path = require('path');
const fs = require('fs');

class FeatureEngine {
  constructor() {
    this.featureVersion = 'v1.0';
  }

  // ═══════════════════════════════════════════════════════
  // 主入口：计算单场比赛的全部特征
  // ═══════════════════════════════════════════════════════

  /**
   * @param {Object} matchInfo - 比赛信息
   * @param {Object} context   - 上下文数据 {dataFile, shujuData, standings, h2h, odds}
   * @returns {Object} features 键值对
   */
  async computeFeatures(matchInfo, context = {}) {
    const features = {};
    const db = database.getAdapter();
    if (!db) return features;

    const matchNum = matchInfo.num || matchInfo.matchNum || '';
    const matchDate = matchInfo.date || matchInfo.matchDate || '';
    const homeName = matchInfo.homeName || '';
    const visitName = matchInfo.visitName || '';
    const matchId = matchInfo.matchId || '';

    // 批量计算（各维度独立，互不依赖）
    try {
      Object.assign(features, await this._getRecentForm(homeName, visitName, context));
      Object.assign(features, await this._getH2HFeatures(homeName, visitName, db));
      Object.assign(features, await this._getStandingsFeatures(homeName, visitName, db, matchDate));
      Object.assign(features, await this._getOddsFeatures(matchId, context));
      Object.assign(features, await this._getRecommendFeatures(matchId, context));
      Object.assign(features, await this._getContextFeatures(homeName, visitName, db, matchDate));
      Object.assign(features, await this._getBasicFeatures(matchNum, matchDate, db));
    } catch (e) {
      console.error('[FeatureEngine] computeFeatures 失败:', e.message);
    }

    // 存入 feature_store
    if (matchNum && matchDate) {
      await this._saveFeatures(matchNum, matchDate, features, db);
    }

    return features;
  }

  // ═══ 近期战绩特征 ═══
  async _getRecentForm(homeName, visitName, context) {
    const features = {};
    try {
      // 从 500.com shuju_data 获取最近战绩
      const shuju = context.shujuData || this._loadShujuData();

      if (shuju) {
        const homeData = shuju[homeName] || {};
        const awayData = shuju[visitName] || {};

        // 近6场战绩
        const homeRecent = this._parseRecentResults(homeData.recent || []);
        const awayRecent = this._parseRecentResults(awayData.recent || []);

        features.home_win_pct_6 = homeRecent.winRate;
        features.away_win_pct_6 = awayRecent.winRate;
        features.home_goal_avg_6 = homeRecent.avgGoals;
        features.away_goal_avg_6 = awayRecent.avgGoals;
        features.home_concede_avg_6 = homeRecent.avgConceded;
        features.away_concede_avg_6 = awayRecent.avgConceded;
        features.home_form_score_6 = homeRecent.formScore;
        features.away_form_score_6 = awayRecent.formScore;
      }
    } catch (e) {
      // 静默失败，该维度数据可能不可用
    }
    return features;
  }

  _parseRecentResults(recent) {
    if (!Array.isArray(recent) || recent.length === 0) {
      return { winRate: null, avgGoals: null, avgConceded: null, formScore: null };
    }

    const last6 = recent.slice(0, 6);
    let wins = 0,
      draws = 0,
      losses = 0,
      totalGoals = 0,
      totalConceded = 0,
      count = 0;

    for (const r of last6) {
      const result = r.result || '';
      if (result === 'win' || result === 'W') wins++;
      else if (result === 'draw' || result === 'D') draws++;
      else if (result === 'loss' || result === 'L') losses++;

      totalGoals += r.goalsFor || r.homeScore || 0;
      totalConceded += r.goalsAgainst || r.awayScore || 0;
      count++;
    }

    return {
      winRate: count > 0 ? wins / count : null,
      avgGoals: count > 0 ? totalGoals / count : null,
      avgConceded: count > 0 ? totalConceded / count : null,
      formScore: count > 0 ? (wins * 3 + draws) / (count * 3) : null,
    };
  }

  _loadShujuData() {
    try {
      const dir = path.join(__dirname, '..', 'shuju_data');
      if (!fs.existsSync(dir)) return null;

      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length === 0) return null;

      const latest = path.join(dir, files[0]);
      return JSON.parse(fs.readFileSync(latest, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  // ═══ 交锋历史特征 ═══
  async _getH2HFeatures(homeName, visitName, db) {
    const features = {};
    try {
      if (!db || !homeName || !visitName) return features;

      const h2hRows = db.execAll(
        `SELECT * FROM h2h_history
         WHERE (home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?)
         ORDER BY match_date DESC LIMIT 10`,
        homeName,
        visitName,
        visitName,
        homeName,
      );

      if (h2hRows.length === 0) return features;

      let homeWins = 0,
        totalGoals = 0,
        count = 0;
      const last5 = h2hRows.slice(0, 5);

      for (const row of last5) {
        if (
          (row.home_team === homeName && row.home_score > row.away_score) ||
          (row.away_team === homeName && row.away_score > row.home_score)
        ) {
          homeWins++;
        }
        totalGoals += (row.home_score || 0) + (row.away_score || 0);
        count++;
      }

      features.h2h_home_win_pct_5 = count > 0 ? homeWins / count : null;
      features.h2h_total_goals_avg = count > 0 ? totalGoals / count : null;
      features.h2h_match_count = h2hRows.length;
    } catch (e) {
      // 静默失败
    }
    return features;
  }

  // ═══ 联赛排名特征 ═══
  async _getStandingsFeatures(homeName, visitName, db, matchDate) {
    const features = {};
    try {
      if (!db || !homeName || !visitName) return features;

      // 获取最新的积分榜数据
      const homeRow = db.execOne(
        `SELECT * FROM league_standings WHERE team_name = ? ORDER BY fetch_date DESC LIMIT 1`,
        homeName,
      );
      const awayRow = db.execOne(
        `SELECT * FROM league_standings WHERE team_name = ? ORDER BY fetch_date DESC LIMIT 1`,
        visitName,
      );

      if (homeRow) {
        features.home_league_rank = homeRow.rank || null;
        features.home_points = homeRow.points || null;
        features.home_home_form_pts_5 = homeRow.home_played
          ? (homeRow.home_won * 3 + homeRow.home_drawn) / (homeRow.home_played * 3)
          : null;
        features.home_goal_diff = homeRow.goal_diff || null;
      }
      if (awayRow) {
        features.away_league_rank = awayRow.rank || null;
        features.away_points = awayRow.points || null;
        features.away_goal_diff = awayRow.goal_diff || null;
      }
      if (homeRow && awayRow && homeRow.rank && awayRow.rank) {
        features.rank_diff = homeRow.rank - awayRow.rank;
        // 战意评分：排名差越大比赛重要性越高
        features.importance_score = Math.min(Math.abs(features.rank_diff) / 10, 1.0);
      }
    } catch (e) {
      // 静默失败
    }
    return features;
  }

  // ═══ 赔率信号特征 ═══
  async _getOddsFeatures(matchId, context) {
    const features = {};
    try {
      const odds = context.odds || {};
      if (Object.keys(odds).length === 0) return features;

      // SPF 赔率
      if (odds.spf && Array.isArray(odds.spf) && odds.spf.length >= 3) {
        features.odds_home = odds.spf[0];
        features.odds_draw = odds.spf[1];
        features.odds_away = odds.spf[2];
        // 隐含概率（去水分）
        const totalProb = 1 / odds.spf[0] + 1 / odds.spf[1] + 1 / odds.spf[2];
        features.odds_home_implied_prob = totalProb > 0 ? 1 / odds.spf[0] / totalProb : null;
        features.odds_away_implied_prob = totalProb > 0 ? 1 / odds.spf[2] / totalProb : null;
        features.odds_margin = totalProb - 1; // 水分
      }

      // RQSPF 让球赔率
      if (odds.rqspf && Array.isArray(odds.rqspf) && odds.rqspf.length >= 3) {
        features.odds_rq_home = odds.rqspf[0];
        features.odds_rq_away = odds.rqspf[2];
      }
    } catch (e) {
      // 静默失败
    }
    return features;
  }

  // ═══ 推荐共识特征 ═══
  async _getRecommendFeatures(matchId, context) {
    const features = {};
    try {
      const dataFile = context.dataFile || {};
      const rMap = dataFile.r || {};

      const key = 'm_' + matchId;
      const recs = rMap[key] || rMap[String(matchId)] || [];
      if (recs.length === 0) return features;

      // 统计方向分布
      let homeCount = 0,
        drawCount = 0,
        awayCount = 0,
        totalCount = 0;
      let maxNum = 0;

      for (const r of recs) {
        const num = r.n || r.num || 1;
        totalCount += num;
        if (num > maxNum) maxNum = num;

        const type = r.t || r.type || '';
        if (['胜', '主胜'].includes(type)) homeCount += num;
        else if (['平', '平局'].includes(type)) drawCount += num;
        else if (['负', '客胜'].includes(type)) awayCount += num;
      }

      features.recomm_home_ratio = totalCount > 0 ? homeCount / totalCount : null;
      features.recomm_away_ratio = totalCount > 0 ? awayCount / totalCount : null;
      features.recomm_total_count = totalCount;
      features.recomm_max_num = maxNum;
      features.recomm_entropy = this._calcEntropy(homeCount, drawCount, awayCount, totalCount);
    } catch (e) {
      // 静默失败
    }
    return features;
  }

  _calcEntropy(home, draw, away, total) {
    if (total === 0) return null;
    const p = [home / total, draw / total, away / total].filter((x) => x > 0);
    return -p.reduce((sum, x) => sum + x * Math.log2(x), 0);
  }

  // ═══ 比赛上下文特征 ═══
  async _getContextFeatures(homeName, visitName, db, matchDate) {
    const features = {};
    try {
      // 休息天数（基于上一次该队的比赛日期）
      if (db) {
        const homeLastMatch = db.execOne(
          `SELECT date FROM matches WHERE (homeName = ? OR visitName = ?) AND date < ? ORDER BY date DESC LIMIT 1`,
          homeName,
          homeName,
          matchDate,
        );
        const awayLastMatch = db.execOne(
          `SELECT date FROM matches WHERE (homeName = ? OR visitName = ?) AND date < ? ORDER BY date DESC LIMIT 1`,
          visitName,
          visitName,
          matchDate,
        );

        if (homeLastMatch && homeLastMatch.date) {
          features.home_rest_days = this._daysBetween(homeLastMatch.date, matchDate);
        }
        if (awayLastMatch && awayLastMatch.date) {
          features.away_rest_days = this._daysBetween(awayLastMatch.date, matchDate);
        }
      }
    } catch (e) {
      // 静默失败
    }
    return features;
  }

  _daysBetween(date1, date2) {
    try {
      const d1 = new Date(date1);
      const d2 = new Date(date2);
      return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    } catch (e) {
      return null;
    }
  }

  // ═══ V9.0 JczqBasic 基本面特征 ═══
  async _getBasicFeatures(matchNum, matchDate, db) {
    const features = {};
    try {
      // 优先从 JczqBasic 缓存读取（data-fusion 写入）
      const { loadBasic, spImpliedProb, asiaWaterChange, discreteWarning } = require('./data-fusion');

      const basic = loadBasic(matchDate, matchNum);
      if (!basic) return features;

      // 积分均值
      if (basic.homeJiFenHomeAll != null) features.basic_home_points_avg = basic.homeJiFenHomeAll;
      if (basic.awayJiFenGuest != null) features.basic_away_points_away = basic.awayJiFenGuest;

      // 赢盘率
      if (basic.homeWinPan != null) features.basic_home_win_pan_rate = basic.homeWinPan / 2;
      if (basic.guestWinPan != null) features.basic_guest_win_pan_rate = basic.guestWinPan / 2;

      // 进攻/防守效率
      if (basic.homeEnterEfficiency != null) features.basic_home_attack_eff = basic.homeEnterEfficiency;
      if (basic.guestEnterEfficiency != null) features.basic_guest_attack_eff = basic.guestEnterEfficiency;
      if (basic.homePreventEfficiency != null) features.basic_home_defense_eff = basic.homePreventEfficiency;
      if (basic.guestPreventEfficiency != null) features.basic_guest_defense_eff = basic.guestPreventEfficiency;

      // 进球分布
      if (basic.homeWinQiu_0 != null) features.basic_home_goal_0_cnt = basic.homeWinQiu_0;
      if (basic.homeWinQiu_1 != null) features.basic_home_goal_1_cnt = basic.homeWinQiu_1;
      if (basic.homeWinQiu_2 != null) features.basic_home_goal_2_cnt = basic.homeWinQiu_2;
      if (basic.homeLoseQiu_0 != null) features.basic_home_concede_0_cnt = basic.homeLoseQiu_0;
      if (basic.homeLoseQiu_1 != null) features.basic_home_concede_1_cnt = basic.homeLoseQiu_1;
      if (basic.homeLoseQiu_2 != null) features.basic_home_concede_2_cnt = basic.homeLoseQiu_2;

      // SP 隐含概率
      const spProb = spImpliedProb(basic);
      if (spProb.homeImplied != null) features.basic_sp_home_implied = spProb.homeImplied;
      if (spProb.drawImplied != null) features.basic_sp_draw_implied = spProb.drawImplied;
      if (spProb.awayImplied != null) features.basic_sp_away_implied = spProb.awayImplied;

      // 亚指水位变化
      const asiaWater = asiaWaterChange(basic);
      if (asiaWater.panShift != null) features.basic_asia_pan_shift = asiaWater.panShift;
      if (asiaWater.waterChangeHome != null) features.basic_asia_water_home = asiaWater.waterChangeHome;
      if (asiaWater.waterChangeAway != null) features.basic_asia_water_away = asiaWater.waterChangeAway;

      // 离散度变化
      const discrete = discreteWarning(null, basic);
      if (discrete.shift != null) features.basic_discrete_shift = discrete.shift;
      if (discrete.initDiff != null) features.basic_discrete_init = discrete.initDiff;
      if (discrete.lastDiff != null) features.basic_discrete_last = discrete.lastDiff;

      // 大小球盘口
      if (basic.dxqInitPan != null) features.basic_dxq_init_pan = basic.dxqInitPan;
      if (basic.dxqLastPan != null) features.basic_dxq_last_pan = basic.dxqLastPan;

      // 实力对比
      if (basic.homePower != null && basic.guestPower != null) {
        features.basic_home_power = basic.homePower;
        features.basic_guest_power = basic.guestPower;
        features.basic_power_diff = basic.homePower - basic.guestPower;
      }
    } catch (e) {
      // 静默失败，该数据源可能不可用
    }
    return features;
  }

  // ═══════════════════════════════════════════════════════
  // 持久化
  // ═══════════════════════════════════════════════════════

  async _saveFeatures(matchNum, matchDate, features, db) {
    try {
      if (!db || Object.keys(features).length === 0) return;

      const now = new Date().toISOString();
      for (const [name, value] of Object.entries(features)) {
        if (value === null || value === undefined) continue;

        // 判断数据来源
        let source = 'computed';
        if (name.startsWith('odds_')) source = '500.com';
        else if (name.startsWith('h2h_')) source = '500.com';
        else if (name.startsWith('recomm_')) source = 'midou';
        else if (name.startsWith('home_league') || name.startsWith('away_league') || name === 'rank_diff')
          source = '500.com';
        else if (name.endsWith('_win_pct_6') || name.endsWith('_goal_avg_6')) source = '500.com';

        db.execRun(
          `INSERT OR REPLACE INTO feature_store
           (match_num, match_date, feature_version, feature_name, feature_value, feature_source, computed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          matchNum,
          matchDate,
          this.featureVersion,
          name,
          value,
          source,
          now,
        );
      }
    } catch (e) {
      console.error('[FeatureEngine] _saveFeatures 失败:', e.message);
    }
  }

  // ═══ 查询已存储的特征 ═══
  getFeatures(matchNum, matchDate, db) {
    if (!db) return {};
    try {
      const rows = db.execAll(
        `SELECT feature_name, feature_value FROM feature_store
         WHERE match_num = ? AND match_date = ? AND feature_version = ?`,
        matchNum,
        matchDate,
        this.featureVersion,
      );
      const features = {};
      for (const row of rows) {
        features[row.feature_name] = row.feature_value;
      }
      return features;
    } catch (e) {
      return {};
    }
  }
}

// 全局单例
const engine = new FeatureEngine();

module.exports = {
  FeatureEngine,
  engine,
};
