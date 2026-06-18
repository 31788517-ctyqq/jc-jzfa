/**
 * P2: payments-pipeline.test.js
 * 支付体系冒烟测试 — 模块导出 + 基本流程
 *
 * @jest-environment node
 */

// Mock 支付宝依赖
jest.mock('../payments/alipay', function () {
  return {
    createPayment: jest.fn().mockResolvedValue({ qrCode: 'mock-qr' }),
    queryPayment: jest.fn().mockResolvedValue({ status: 'success' }),
    verifyNotify: jest.fn().mockReturnValue(true),
  };
});

jest.mock('../database', function () {
  return {
    getAdapter: function () {
      return {
        execOne: function () { return undefined; },
        execAll: function () { return []; },
        execRun: function () { return { changes: 1 }; },
      };
    },
    isAvailable: function () { return false; },
  };
});

describe('P2: payments-pipeline — 支付管道', function () {

  describe('1. 模块加载', function () {
    var payments;
    beforeAll(function () {
      try {
        payments = require('../payments/index');
      } catch (e) {
        console.warn('[payments test] load failed:', e.message);
      }
    });

    it('1.1 支付模块可加载', function () {
      expect(payments).toBeDefined();
    });

    it('1.2 handleAction 已导出', function () {
      if (!payments) return;
      expect(typeof payments.handleAction).toBe('function');
    });

    it('1.3 handleSimulatePay 已导出', function () {
      if (!payments) return;
      expect(typeof payments.handleSimulatePay).toBe('function');
    });

    it('1.4 handleAlipayNotify 已导出', function () {
      if (!payments) return;
      expect(typeof payments.handleAlipayNotify).toBe('function');
    });

    it('1.5 initPayments 已导出', function () {
      if (!payments) return;
      expect(typeof payments.initPayments).toBe('function');
    });
  });

  describe('2. 子模块加载', function () {
    it('2.1 orders 模块', function () {
      var orders = require('../payments/orders');
      expect(orders).toBeDefined();
    });

    it('2.2 subscriptions 模块', function () {
      var subs = require('../payments/subscriptions');
      expect(subs).toBeDefined();
    });

    it('2.3 schema 模块', function () {
      var schema = require('../payments/schema');
      expect(schema).toBeDefined();
    });

    it('2.4 referral-account 模块', function () {
      var ref = require('../payments/referral-account');
      expect(ref).toBeDefined();
    });
  });
});
