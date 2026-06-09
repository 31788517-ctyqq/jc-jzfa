/**
 * 蓝图测试: data-quality — 质量门禁
 * 覆盖: 抓取成功率、完整性、赔率异常、DB体积、告警矩阵
 */
const { DataQualityMonitor, THRESHOLDS } = require('../core/data-quality');

describe('DataQualityMonitor', () => {
  let monitor;

  beforeEach(() => {
    monitor = new DataQualityMonitor();
  });

  describe('checkFetchQuality — 抓取成功率', () => {
    it('100% 成功率应 pass', () => {
      const result = monitor.checkFetchQuality('500.com', 10, 10);
      expect(result.pass).toBe(true);
      expect(result.rate).toBe(1.0);
    });

    it('91% 成功率应 pass (>=90%)', () => {
      const result = monitor.checkFetchQuality('500.com', 100, 91);
      expect(result.pass).toBe(true);
    });

    it('89% 成功率应 fail (<90%)', () => {
      const result = monitor.checkFetchQuality('500.com', 100, 89);
      expect(result.pass).toBe(false);
      expect(result.alert).not.toBeNull();
    });

    it('0 场时应 pass', () => {
      const result = monitor.checkFetchQuality('deepseek', 0, 0);
      expect(result.pass).toBe(true);
      expect(result.rate).toBe(1.0);
    });
  });

  describe('checkCompleteness — 完整性', () => {
    it('100% 完整应 pass', () => {
      const result = monitor.checkCompleteness('2026-06-03', 10, 10);
      expect(result.pass).toBe(true);
    });

    it('84% 完整应 fail (<85%)', () => {
      const result = monitor.checkCompleteness('2026-06-03', 100, 84);
      expect(result.pass).toBe(false);
    });

    it('0 场时应 pass', () => {
      const result = monitor.checkCompleteness('2026-06-03', 0, 0);
      expect(result.pass).toBe(true);
    });
  });

  describe('checkOddsAnomaly — 赔率异常', () => {
    it('变化 10% 不应异常', () => {
      const result = monitor.checkOddsAnomaly('001', 2.0, 2.2);
      expect(result.anomaly).toBe(false);
    });

    it('变化 35% 应异常 (≥30%)', () => {
      const result = monitor.checkOddsAnomaly('001', 2.0, 2.7);
      expect(result.anomaly).toBe(true);
      expect(result.changeRate).toBeCloseTo(0.35, 2);
    });

    it('赔率为 0 时不报错', () => {
      const result = monitor.checkOddsAnomaly('001', 0, 0);
      expect(result.anomaly).toBe(false);
    });
  });

  describe('告警累积', () => {
    it('触发阈值后累积告警', () => {
      monitor.checkFetchQuality('test', 10, 8);
      monitor.checkCompleteness('2026-06-03', 10, 7);
      const alerts = monitor.getAlerts(60);
      expect(alerts.length).toBe(2);
    });

    it('无告警时返回空数组', () => {
      monitor.checkFetchQuality('test', 10, 10);
      const alerts = monitor.getAlerts(60);
      expect(alerts.length).toBe(0);
    });
  });

  describe('getReport — 质量报告', () => {
    it('返回完整报告结构', () => {
      monitor.checkFetchQuality('500.com', 10, 9);
      const report = monitor.getReport();
      expect(report).toHaveProperty('timestamp');
      expect(report).toHaveProperty('thresholds');
      expect(report).toHaveProperty('stats');
      expect(report).toHaveProperty('totalAlerts');
    });
  });

  describe('THRESHOLDS 常量', () => {
    it('抓取成功率门禁为 0.90', () => {
      expect(THRESHOLDS.FETCH_SUCCESS_RATE).toBe(0.9);
    });

    it('完整度门禁为 0.85', () => {
      expect(THRESHOLDS.COMPLETENESS_RATE).toBe(0.85);
    });

    it('赔率异常阈值为 0.30', () => {
      expect(THRESHOLDS.ODDS_CHANGE_THRESHOLD).toBe(0.3);
    });
  });
});
