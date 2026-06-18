/**
 * P1: alert-monitor.test.js
 * 运维告警监控 — 告警推送/查询/读写
 *
 * @jest-environment node
 */

jest.mock('../core/email-alerter', function () {
  return { send: jest.fn().mockResolvedValue(true) };
});

var alertMonitor = require('../core/alert-monitor');

describe('P1: alert-monitor — 告警监控', function () {

  describe('1. 模块导出', function () {
    it('1.1 核心函数已导出', function () {
      expect(alertMonitor).toBeDefined();
      var fns = ['checkPM2Status', 'checkHealth', 'checkLoginFailed', 'checkLoginSuccess',
        'checkRecSyncStagnant', 'checkEmptyPlans', 'checkBackfillFailed',
        'getUnreadAlerts', 'markRead', 'markAllRead', 'getAlertSummary', 'pushAlert'];
      fns.forEach(function (fn) {
        expect(typeof alertMonitor[fn]).toBe('function');
      });
    });
  });

  describe('2. 告警推送', function () {
    it('2.1 pushAlert 不抛异常', function () {
      expect(function () {
        alertMonitor.pushAlert('test', 'test-alert', 'test message');
      }).not.toThrow();
    });

    it('2.2 pushAlert 不同级别不抛异常', function () {
      expect(function () {
        alertMonitor.pushAlert('info', 'info-test', 'info msg');
        alertMonitor.pushAlert('warn', 'warn-test', 'warn msg');
        alertMonitor.pushAlert('error', 'error-test', 'error msg');
      }).not.toThrow();
    });

    it('2.3 getAlertSummary 返回结构', function () {
      var summary = alertMonitor.getAlertSummary();
      expect(summary).toBeDefined();
      expect(typeof summary.total).toBe('number');
    });
  });

  describe('3. 检查函数不抛异常', function () {
    it('3.1 checkPM2Status 不抛异常', function () {
      expect(function () { alertMonitor.checkPM2Status(); }).not.toThrow();
    });

    it('3.2 checkLoginFailed 不抛异常', function () {
      expect(function () { alertMonitor.checkLoginFailed(); }).not.toThrow();
    });

    it('3.3 checkLoginSuccess 不抛异常', function () {
      expect(function () { alertMonitor.checkLoginSuccess(); }).not.toThrow();
    });

    it('3.4 checkRecSyncStagnant 不抛异常', function () {
      expect(function () { alertMonitor.checkRecSyncStagnant(); }).not.toThrow();
    });

    it('3.5 checkEmptyPlans 不抛异常', function () {
      expect(function () { alertMonitor.checkEmptyPlans(); }).not.toThrow();
    });

    it('3.6 checkBackfillFailed 不抛异常', function () {
      expect(function () { alertMonitor.checkBackfillFailed(); }).not.toThrow();
    });
  });

  describe('4. 读写操作', function () {
    it('4.1 markRead 不抛异常', function () {
      alertMonitor.pushAlert('info', 'read-test', 'to be read');
      expect(function () { alertMonitor.markRead('test-id'); }).not.toThrow();
    });

    it('4.2 markAllRead 不抛异常', function () {
      alertMonitor.pushAlert('info', 'bulk-a', 'msg a');
      expect(function () { alertMonitor.markAllRead(); }).not.toThrow();
    });
  });
});
