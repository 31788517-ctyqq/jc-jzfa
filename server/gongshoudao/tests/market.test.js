/**
 * P2: market.test.js — 市场情报交叉验证 单元测试
 * 覆盖: loadMatchOdds/inferMarketXg/estimateOddsMovement/analyze
 *
 * ★ 使用 fs mock 模拟文件系统
 */
jest.mock('fs');
const fs = require('fs');

// ==================== inferMarketXg ====================

describe('market — inferMarketXg 市场xG反推', () => {
  const { inferMarketXg } = require('../market');

  it('无 totalGoals 数据 → valid=false', () => {
    const result = inferMarketXg({}, 0);
    expect(result.valid).toBe(false);
    expect(result.marketTotal).toBeDefined();
  });

  it('有效 totalGoals → valid=true, 返回市场xG', () => {
    const odds = {
      totalGoals: { 0: 13, 1: 5.25, 2: 3.5, 3: 3.0, 4: 5.3, 5: 10 },
    };
    const result = inferMarketXg(odds, 0.5);
    expect(result.valid).toBe(true);
    expect(typeof result.marketTotal).toBe('number');
    expect(typeof result.marketHome).toBe('number');
    expect(typeof result.marketAway).toBe('number');
    expect(result.marketTotal).toBeGreaterThan(0);
  });

  it('让球影响主客分配 (主让→主队占比高)', () => {
    const odds = {
      totalGoals: { 0: 13, 1: 5.25, 2: 3.5, 3: 3.0, 4: 5.3, 5: 10 },
    };
    const homeHandicap = inferMarketXg(odds, 1.5);
    const awayHandicap = inferMarketXg(odds, -1.5);
    expect(homeHandicap.marketHome).toBeGreaterThan(awayHandicap.marketHome);
  });

  it('赔率最低的进球数决定 overUnderLine', () => {
    // bestOdds 对应 key=3 (赔率3.00最低) → overUnderLine = 3.5
    const odds = {
      totalGoals: { 0: 13, 1: 6.0, 2: 4.0, 3: 2.5, 4: 5.0, 5: 10 },
    };
    const result = inferMarketXg(odds, 0);
    expect(result.overUnderLine).toBe(3.5);
  });
});

// ==================== loadMatchOdds + analyze ====================

describe('market — loadMatchOdds 赔率加载', () => {
  const { loadMatchOdds } = require('../market');

  beforeEach(function () {
    if (fs.resetMockFs) fs.resetMockFs();
  });

  // 需要 mock odds-movement
  jest.mock(
    '../core/odds-movement',
    function () {
      return {
        analyzeMovement: function () {
          return {
            direction: '盘口稳定',
            severity: 'none',
            penalty: 0,
            probShift: 0.01,
            waterChange: 0,
            openHomeWinProb: 0.42,
            liveHomeWinProb: 0.43,
          };
        },
        checkEuroAsiaConsistency: function () {
          return { consistent: true, detail: '欧亚一致', penalty: 0 };
        },
      };
    },
    { virtual: true },
  );

  // 注意: market.js 在顶部使用了 require('../core/odds-movement')
  // mock 必须在 require market 之前注册

  it('不存在的日期文件 → 返回 null', () => {
    const result = loadMatchOdds('2099-01-01', '周一001');
    expect(result).toBe(null);
  });

  it('参数 null → 返回 null', () => {
    expect(loadMatchOdds(null, '周一001')).toBe(null);
    expect(loadMatchOdds('2026-01-01', null)).toBe(null);
  });
});

// ==================== analyze 综合分析 ====================

describe('market — analyze 综合分析入口', () => {
  // 由于 analyze 依赖文件系统 (loadMatchOdds) 和 odds-movement，
  // 主要测试其参数处理
  const oddsMovement = require('../core/odds-movement');
  const { analyze } = require('../market');

  beforeEach(function () {
    if (fs.resetMockFs) fs.resetMockFs();
  });

  it('无赔率数据时返回默认 marketScore=50', function () {
    const vars = {};
    const matchInfo = { num: '周一099', date: '2099-12-31', handicap: 0, leagueName: '英超' };
    const gsContext = { totalAdvantageRaw: 0, xgHome: 1.5, xgAway: 0.8 };
    const result = analyze(vars, matchInfo, gsContext);
    // signalScore=50 落在 [45, 55) → '⚖️ 市场信号中性'
    expect(result.marketScore).toBe(50);
    expect(result.marketSignal).toBe('⚖️ 市场信号中性');
    expect(result.riskLevel).toBe('none');
  });

  it('返回完整结构', function () {
    const result = analyze({}, { num: '', date: '', handicap: 0 }, {});
    expect(result).toHaveProperty('movement');
    expect(result).toHaveProperty('euroAsia');
    expect(result).toHaveProperty('overlayMarket');
    expect(result).toHaveProperty('marketXg');
    expect(result).toHaveProperty('marketScore');
    expect(result).toHaveProperty('marketSignal');
    expect(result).toHaveProperty('riskLevel');
    expect(result).toHaveProperty('riskDetail');
    expect(result).toHaveProperty('signalFlags');
  });
});
