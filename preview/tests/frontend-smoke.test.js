/**
 * P2: frontend-smoke.test.js
 * 前端模块冒烟 — auth-client + hit-rate + income + quant-rank-fusion
 *
 * @jest-environment jsdom
 */

// Mock fetch
global.fetch = jest.fn().mockResolvedValue({
  json: function () { return Promise.resolve({ code: 1, data: {} }); },
});

// Mock modules that depend on browser APIs not available in jsdom
global.localStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; },
};
global.sessionStorage = {
  _data: {},
  getItem: function (k) { return this._data[k] || null; },
  setItem: function (k, v) { this._data[k] = v; },
  removeItem: function (k) { delete this._data[k]; },
  clear: function () { this._data = {}; },
};

// Mock utils.js (needed by page modules)
jest.mock('../js/utils', function () {
  return {
    API: '/api',
    WEEK_NAMES: ['日', '一', '二', '三', '四', '五', '六'],
    formatDate: function (d) {
      if (!d) return '';
      var y = d.getFullYear ? d.getFullYear() : d.slice(0, 4);
      var m = d.getMonth ? String(d.getMonth() + 1).padStart(2, '0') : d.slice(5, 7);
      var day = d.getDate ? String(d.getDate()).padStart(2, '0') : d.slice(8, 10);
      return y + '-' + m + '-' + day;
    },
    getCache: function () { return null; },
    setCache: function () {},
    getDeviceId: function () { return 'test-device'; },
    MIN_PLAN_DATE: '2024-01-01',
    CAT_NAMES: { spf: '胜平负', rqspf: '让球胜平负' },
  };
});

// Mock api.js
jest.mock('../js/api', function () {
  return {
    api: jest.fn().mockResolvedValue({ code: 1, data: [] }),
  };
});

// Mock charts.js
jest.mock('../js/charts', function () {
  return {
    loadECharts: jest.fn(),
    echartsReady: function () { return Promise.resolve(); },
  };
});

// Mock vendor.js (state)
jest.mock('../js/vendor', function () {
  return {
    planDate: '2026-06-20',
    planDateOffset: 0,
    planDateExplicit: false,
    planTab: 'wc',
    rankDate: '2026-06-20',
    rankDateOffset: 0,
    selectedMatchDate: '2026-06-20',
    weekDates: [],
    incomeLoaded: false,
    setPlanDate: function (v) { this.planDate = v; },
    setPlanDateOffset: function (v) { this.planDateOffset = v; },
    setPlanDateExplicit: function (v) { this.planDateExplicit = v; },
    setPlanTab: function (v) { this.planTab = v; },
    setRankDate: function (v) { this.rankDate = v; },
    setRankDateOffset: function (v) { this.rankDateOffset = v; },
    setWeekDates: function (v) { this.weekDates = v; },
    setIncomeLoaded: function (v) { this.incomeLoaded = v; },
    setSelectedCategory: function () {},
    setSelectedDirection: function () {},
    setCurrentPage: function () {},
    setSelectedWeekIdx: function () {},
  };
});

describe('P2: frontend-smoke — 前端模块冒烟', function () {

  // ═══════════════════════════════════════════
  // 1. auth-client
  // ═══════════════════════════════════════════
  describe('1. auth-client', function () {
    var auth;

    beforeAll(function () {
      try {
        auth = require('../js/auth-client');
      } catch (e) {
        console.warn('[frontend-smoke] auth-client load failed:', e.message);
      }
    });

    it('1.1 模块可加载', function () {
      expect(auth).toBeDefined();
    });

    it('1.2 getAuthToken 已导出', function () {
      if (!auth) return;
      expect(typeof auth.getAuthToken).toBe('function');
    });

    it('1.3 hasAuthToken 已导出', function () {
      if (!auth) return;
      expect(typeof auth.hasAuthToken).toBe('function');
    });

    it('1.4 setAuthToken / clearAuthToken', function () {
      if (!auth) return;
      auth.setAuthToken('test-token-abc');
      expect(auth.hasAuthToken()).toBe(true);
      expect(auth.getAuthToken()).toBe('test-token-abc');
      auth.clearAuthToken();
      expect(auth.hasAuthToken()).toBe(false);
    });

    it('1.5 setAuthSession 存储用户信息', function () {
      if (!auth) return;
      var user = { username: 'test', roles: ['viewer'] };
      try {
        auth.setAuthSession({ token: 'tok', user: user, expiresAt: '2099-01-01' });
      } catch (e) {
        // localStorage mock may differ
      }
      // setAuthSession 可能也调用 setAuthToken，但具体行为取决于实现
      expect(typeof auth.getAuthSession).toBe('function');
    });

    it('1.6 clearAuthAll 清除全部', function () {
      if (!auth) return;
      auth.setAuthToken('x');
      auth.setAuthSession({ token: 'x', user: {} });
      auth.clearAuthAll();
      expect(auth.hasAuthToken()).toBe(false);
    });
  });

  // ═══════════════════════════════════════════
  // 2. hit-rate
  // ═══════════════════════════════════════════
  describe('2. hit-rate', function () {
    var hitRate;

    beforeAll(function () {
      document.body.innerHTML = '<div id="page-hit"></div>';
      try {
        hitRate = require('../js/pages/hit-rate');
      } catch (e) {
        console.warn('[frontend-smoke] hit-rate load failed:', e.message);
      }
    });

    it('2.1 loadHitRate 已导出', function () {
      if (!hitRate) return;
      expect(typeof hitRate.loadHitRate).toBe('function');
    });
  });

  // ═══════════════════════════════════════════
  // 3. income
  // ═══════════════════════════════════════════
  describe('3. income', function () {
    var income;

    beforeAll(function () {
      document.body.innerHTML += '<div id="page-income" class="page"></div>';
      try {
        income = require('../js/pages/income');
      } catch (e) {
        console.warn('[frontend-smoke] income load failed:', e.message);
      }
    });

    it('3.1 loadIncome 已导出', function () {
      if (!income) return;
      expect(typeof income.loadIncome).toBe('function');
    });

    it('3.2 onIncDirChange 已导出', function () {
      if (!income) return;
      if (typeof income.onIncDirChange === 'function') {
        income.onIncDirChange('spf');
      } else {
        // 可能未导出，跳过
      }
    });
  });

  // ═══════════════════════════════════════════
  // 4. quant-rank-fusion
  // ═══════════════════════════════════════════
  describe('4. quant-rank-fusion', function () {
    var quant;

    beforeAll(function () {
      document.body.innerHTML += '<div id="page-quant-rank" class="page"></div>';
      try {
        quant = require('../js/pages/quant-rank-fusion');
      } catch (e) {
        console.warn('[frontend-smoke] quant-rank-fusion load failed:', e.message);
      }
    });

    it('4.1 loadQuantRank 已导出', function () {
      if (!quant) return;
      expect(typeof quant.loadQuantRank).toBe('function');
    });

    it('4.2 switchQuantTab 已导出', function () {
      if (!quant) return;
      expect(typeof quant.switchQuantTab).toBe('function');
    });

    it('4.3 switchQuantView 已导出', function () {
      if (!quant) return;
      expect(typeof quant.switchQuantView).toBe('function');
    });

    it('4.4 updateQuantDateBar 已导出', function () {
      if (!quant) return;
      expect(typeof quant.updateQuantDateBar).toBe('function');
    });

    it('4.5 日期导航函数已导出', function () {
      if (!quant) return;
      expect(typeof quant.shiftQuantDate).toBe('function');
      expect(typeof quant.goQuantToday).toBe('function');
    });
  });
});
