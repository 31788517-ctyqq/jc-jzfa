/**
 * server/core/data-quality.js
 * 数据质量监控 — 抓取成功率门禁、完整性检查、赔率异常检测
 *
 * 蓝图 §4.3-4.4：自动化质量门禁 + 告警矩阵
 * 独立监控模块，不拦截现有数据流
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════
// 质量门禁阈值
// ═══════════════════════════════════════════════════════

const THRESHOLDS = {
  FETCH_SUCCESS_RATE: 0.90,    // 抓取成功率 < 90% 触发告警
  COMPLETENESS_RATE: 0.85,     // 数据完整性 < 85% 触发告警
  ODDS_CHANGE_THRESHOLD: 0.30, // 赔率单次变化 > 30% 记录异常
  DB_SIZE_WARN_MB: 500,        // DB 体积 > 500MB 告警
};

class DataQualityMonitor {
  constructor() {
    this.alerts = [];
    this.stats = {
      fetch: {},
      completeness: {},
      anomalies: [],
    };
  }

  // ═══ 抓取成功率门禁 ═══
  /**
   * 检查数据源抓取成功率
   * @param {string} source - 数据源名称 ('500.com'/'midou'/'deepseek'/etc)
   * @param {number} total   - 预期抓取数
   * @param {number} success - 实际成功数
   * @returns {{ pass: boolean, rate: number, alert: string|null }}
   */
  checkFetchQuality(source, total, success) {
    if (total === 0) return { pass: true, rate: 1.0, alert: null };

    const rate = success / total;
    const pass = rate >= THRESHOLDS.FETCH_SUCCESS_RATE;

    this.stats.fetch[source] = { total, success, rate, timestamp: new Date().toISOString() };

    let alert = null;
    if (!pass) {
      alert = `[数据质量] ${source} 抓取成功率 ${(rate * 100).toFixed(1)}% < ${(THRESHOLDS.FETCH_SUCCESS_RATE * 100).toFixed(0)}% 门禁 (${success}/${total})`;
      this.alerts.push({ time: new Date().toISOString(), level: 'P1', source, message: alert });
      console.warn(alert);
    }

    return { pass, rate, alert };
  }

  // ═══ 完整性门禁 ═══
  /**
   * 检查某日期数据完整性
   * @param {string} date          - 日期 '2026-06-04'
   * @param {number} expectedCount - 预期比赛数
   * @param {number} actualCount   - 实际抓取数
   * @returns {{ pass: boolean, rate: number }}
   */
  checkCompleteness(date, expectedCount, actualCount) {
    if (expectedCount === 0) return { pass: true, rate: 1.0 };

    const rate = actualCount / expectedCount;
    const pass = rate >= THRESHOLDS.COMPLETENESS_RATE;

    this.stats.completeness[date] = { expectedCount, actualCount, rate, timestamp: new Date().toISOString() };

    if (!pass) {
      const alert = `[数据完整性] ${date} 实际抓取 ${actualCount}/${expectedCount} 场 (${(rate * 100).toFixed(1)}%) < ${(THRESHOLDS.COMPLETENESS_RATE * 100).toFixed(0)}%`;
      this.alerts.push({ time: new Date().toISOString(), level: 'P1', source: 'completeness', message: alert });
      console.warn(alert);
    }

    return { pass, rate };
  }

  // ═══ 赔率突变检测 ═══
  /**
   * 检测赔率异常变化
   * @param {string} matchNum  - 比赛编号 '周五001'
   * @param {number} oldOdds   - 旧赔率
   * @param {number} newOdds   - 新赔率
   * @returns {{ anomaly: boolean, changeRate: number }}
   */
  checkOddsAnomaly(matchNum, oldOdds, newOdds) {
    if (!oldOdds || !newOdds || oldOdds === 0) return { anomaly: false, changeRate: 0 };

    const changeRate = Math.abs((newOdds - oldOdds) / oldOdds);
    const anomaly = changeRate >= THRESHOLDS.ODDS_CHANGE_THRESHOLD;

    if (anomaly) {
      const entry = {
        time: new Date().toISOString(),
        matchNum,
        oldOdds,
        newOdds,
        changeRate: (changeRate * 100).toFixed(1) + '%',
      };
      this.stats.anomalies.push(entry);
      const msg = `[赔率异常] ${matchNum} 赔率 ${oldOdds} → ${newOdds} (${entry.changeRate})`;
      this.alerts.push({ time: new Date().toISOString(), level: 'P2', source: 'odds_anomaly', message: msg });
      console.warn(msg);
    }

    return { anomaly, changeRate };
  }

  // ═══ DB 体积检查 ═══
  /**
   * 检查 SQLite 数据库体积
   * @param {string} dbPath - 数据库路径
   * @returns {{ pass: boolean, sizeMB: number }}
   */
  checkDBSize(dbPath) {
    try {
      if (!fs.existsSync(dbPath)) return { pass: true, sizeMB: 0 };
      const stats = fs.statSync(dbPath);
      const sizeMB = stats.size / (1024 * 1024);
      const pass = sizeMB < THRESHOLDS.DB_SIZE_WARN_MB;

      if (!pass) {
        const alert = `[DB体积] 数据库大小 ${sizeMB.toFixed(1)}MB > ${THRESHOLDS.DB_SIZE_WARN_MB}MB 告警阈值`;
        this.alerts.push({ time: new Date().toISOString(), level: 'P1', source: 'db_size', message: alert });
      }

      return { pass, sizeMB };
    } catch (e) {
      return { pass: true, sizeMB: 0 };
    }
  }

  // ═══ 多源完整性综合检查 ═══
  /**
   * 综合检查某个日期的所有数据源完整性
   * @param {Object} db - 数据库适配器
   * @param {string} date - 日期
   * @returns {{ summary: Object, alerts: Object[] }}
   */
  checkDateCompleteness(db, date) {
    const results = {};
    const dateAlerts = [];

    try {
      // 检查 matches 表
      const matchCount = (db.execOne('SELECT COUNT(*) as cnt FROM matches WHERE date = ?', date) || {}).cnt || 0;
      results.matches = { count: matchCount };

      // 检查 recommends 表
      const recCount = (db.execOne(
        'SELECT COUNT(DISTINCT matchId) as cnt FROM recommends WHERE fetchDate = ?', date
      ) || {}).cnt || 0;
      results.recommends = { count: recCount };
      results.completeness = recCount > 0 && matchCount > 0 ? Math.round(recCount / matchCount * 100) / 100 : 0;

      if (matchCount > 0 && results.completeness < 0.85) {
        dateAlerts.push({
          date, level: 'P1',
          message: `[完整性] ${date} 推荐覆盖率 ${(results.completeness * 100).toFixed(1)}% < 85%`
        });
      }

      // 检查功守道 cache.json
      const gsPath = path.join(__dirname, '..', 'gongshoudao', 'cache.json');
      if (fs.existsSync(gsPath)) {
        try {
          const gsCache = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
          const globalData = gsCache['_global'] || {};
          const gsMatchCount = Object.keys(globalData).length;
          results.gongshoudao = { matchCount: gsMatchCount };
        } catch (e) {
          results.gongshoudao = { error: e.message };
        }
      }

    } catch (e) {
      results.error = e.message;
    }

    return { summary: results, alerts: dateAlerts };
  }

  // ═══ 获取告警汇总 ═══
  getAlerts(sinceMinutes = 60) {
    const cutoff = Date.now() - sinceMinutes * 60 * 1000;
    return this.alerts.filter(a => new Date(a.time).getTime() >= cutoff);
  }

  // ═══ 获取质量报告 ═══
  getReport() {
    return {
      timestamp: new Date().toISOString(),
      thresholds: THRESHOLDS,
      stats: this.stats,
      recentAlerts: this.getAlerts(60),
      totalAlerts: this.alerts.length,
    };
  }

  // ═══ 重置统计 ═══
  reset() {
    this.alerts = [];
    this.stats = { fetch: {}, completeness: {}, anomalies: [] };
  }
}

// 全局单例
const monitor = new DataQualityMonitor();

module.exports = {
  DataQualityMonitor,
  monitor,
  THRESHOLDS,
};
