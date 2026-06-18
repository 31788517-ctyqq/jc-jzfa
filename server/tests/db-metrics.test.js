/**
 * P0: db-metrics.test.js
 * DB 写入成功率监控 — 计数器单元测试
 *
 * @jest-environment node
 */

// 清除自动 setInterval，避免干扰
jest.useFakeTimers();

var metrics = require('../core/db-metrics');

describe('P0: db-metrics — DB 写入指标', function () {

  beforeEach(function () {
    metrics.reset();
    jest.clearAllTimers();
  });

  afterAll(function () {
    jest.useRealTimers();
  });

  describe('1. recordWrite — 写入成功', function () {
    it('1.1 单次成功写入', function () {
      metrics.recordWrite();
      var snap = metrics.snapshot();
      expect(snap.totalWrites).toBe(1);
      expect(snap.successWrites).toBe(1);
      expect(snap.errorWrites).toBe(0);
      expect(snap.status).toBe('ok');
    });

    it('1.2 多次成功写入', function () {
      for (var i = 0; i < 100; i++) metrics.recordWrite();
      var snap = metrics.snapshot();
      expect(snap.totalWrites).toBe(100);
      expect(snap.successWrites).toBe(100);
      expect(snap.errorWrites).toBe(0);
      expect(snap.writeSuccessRate).toBe('100%');
      expect(snap.status).toBe('ok');
    });

    it('1.3 成功写入重置连续错误计数', function () {
      metrics.recordError('err1');
      metrics.recordError('err2');
      metrics.recordWrite(); // 应重置 consecutiveErrors
      metrics.recordWrite();
      var snap = metrics.snapshot();
      expect(snap.consecutiveErrors).toBe(0);
    });
  });

  describe('2. recordError — 写入失败', function () {
    it('2.1 单次错误记录', function () {
      metrics.recordError('disk I/O error');
      var snap = metrics.snapshot();
      expect(snap.totalWrites).toBe(1);
      expect(snap.successWrites).toBe(0);
      expect(snap.errorWrites).toBe(1);
      expect(snap.lastError).toBe('disk I/O error');
      expect(snap.lastErrorTime).toBeDefined();
    });

    it('2.2 错误消息截断 200 字符', function () {
      var longErr = 'x'.repeat(300);
      metrics.recordError(longErr);
      var snap = metrics.snapshot();
      expect(snap.lastError.length).toBeLessThanOrEqual(200);
    });

    it('2.3 连续错误累计', function () {
      for (var i = 0; i < 5; i++) metrics.recordError('err' + i);
      var snap = metrics.snapshot();
      expect(snap.consecutiveErrors).toBe(5);
      expect(snap.errorWrites).toBe(5);
    });
  });

  describe('3. getConsecutiveErrors', function () {
    it('3.1 初始为 0', function () {
      expect(metrics.getConsecutiveErrors()).toBe(0);
    });

    it('3.2 错误后递增', function () {
      metrics.recordError('e');
      metrics.recordError('e');
      expect(metrics.getConsecutiveErrors()).toBe(2);
    });
  });

  describe('4. snapshot — 综合快照', function () {
    it('4.1 初始快照', function () {
      metrics.reset();
      var snap = metrics.snapshot();
      expect(snap.status).toBe('ok');
      expect(snap.totalWrites).toBe(0);
      // 无写入时 consecutiveErrors 可能为 undefined（getWriteRate 边界行为）
      expect(snap.uptimeMinutes).toBeGreaterThanOrEqual(0);
    });

    it('4.2 status=ok 当成功率 >= 95%', function () {
      for (var i = 0; i < 95; i++) metrics.recordWrite();
      for (var j = 0; j < 5; j++) metrics.recordError('e');
      expect(metrics.snapshot().status).toBe('ok');
    });

    it('4.3 status=warn 当成功率 80-95%', function () {
      for (var i = 0; i < 80; i++) metrics.recordWrite();
      for (var j = 0; j < 20; j++) metrics.recordError('e');
      expect(metrics.snapshot().status).toBe('warn');
    });

    it('4.4 status=error 当成功率 < 80%', function () {
      for (var i = 0; i < 50; i++) metrics.recordWrite();
      for (var j = 0; j < 50; j++) metrics.recordError('e');
      expect(metrics.snapshot().status).toBe('error');
    });

    it('4.5 无写入时 successRate 显示正确', function () {
      var snap = metrics.snapshot();
      expect(snap.writeSuccessRate).toBe('100%');
      expect(snap.status).toBe('ok');
    });
  });

  describe('5. getWriteRate — 速率', function () {
    it('5.1 50% 成功率', function () {
      metrics.recordWrite();
      metrics.recordError('e');
      var r = metrics.getWriteRate();
      expect(r.rate).toBeCloseTo(0.5, 1);
      expect(r.success).toBe(1);
      expect(r.error).toBe(1);
    });
  });

  describe('6. reset — 重置', function () {
    it('6.1 reset 清空所有计数', function () {
      metrics.recordWrite();
      metrics.recordWrite();
      metrics.recordError('e');
      metrics.reset();
      var snap = metrics.snapshot();
      expect(snap.totalWrites).toBe(0);
      expect(snap.successWrites).toBe(0);
      expect(snap.errorWrites).toBe(0);
      expect(snap.lastError).toBeNull();
    });
  });
});
