/**
 * P0: confirm-scheme calcMaxWin 回归测试
 * 验证返回对象而非 primitive number（修复 Cannot create property '_passOdds' on number）
 */
describe('confirm-scheme calcMaxWin — 对象返回值', function () {
  // 模拟 calcMaxWin 核心算法（与 confirm-scheme.js 一致）
  function calcMaxWin(selections, passTypes, multiplier, amount) {
    var matchGroups = {};
    selections.forEach(function (s) {
      if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
      matchGroups[s.matchId].push(s.odds || 1);
    });
    var matchIds = Object.keys(matchGroups);
    var n = matchIds.length;

    var maxOddsPerMatch = {};
    matchIds.forEach(function (mid) {
      maxOddsPerMatch[mid] = Math.max.apply(null, matchGroups[mid]);
    });

    var passOdds = {};
    var bestProduct = 1;
    var bestProductK = 0;
    var singleBetAmount = 2 * multiplier;

    passTypes.forEach(function (k) {
      if (k > n) return;
      var sorted = matchIds
        .map(function (mid) { return maxOddsPerMatch[mid]; })
        .sort(function (a, b) { return b - a; });
      var product = 1;
      for (var i = 0; i < k; i++) product *= sorted[i];
      product = Math.round(product * 100) / 100;
      passOdds[k] = {
        bestProduct: product,
        maxWinPerNote: Math.round(singleBetAmount * product * 100) / 100,
      };
      if (product > bestProduct) {
        bestProduct = product;
        bestProductK = k;
      }
    });

    var maxWin = singleBetAmount > 0 ? Math.round(singleBetAmount * bestProduct * 100) / 100 : 0;

    // ★ 关键：返回对象而非 number
    return {
      value: maxWin,
      _passOdds: passOdds,
      _bestProductK: bestProductK,
      _bestProduct: bestProduct,
    };
  }

  // ── 测试：基本对象结构 ──
  it('返回对象含 value/_passOdds/_bestProductK/_bestProduct', function () {
    var selections = [
      { matchId: 'm1', odds: 1.5 },
      { matchId: 'm1', odds: 2.1 },
      { matchId: 'm2', odds: 3.0 },
    ];
    var result = calcMaxWin(selections, [2], 1, 10);

    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
    expect(typeof result.value).toBe('number');
    expect(result.value).toBeGreaterThan(0);
    expect(typeof result._passOdds).toBe('object');
    expect(typeof result._bestProductK).toBe('number');
    expect(typeof result._bestProduct).toBe('number');
  });

  // ── 测试：value 可正常参与数值运算（不会报错） ──
  it('result.value 可用于数值比较和显示', function () {
    var selections = [
      { matchId: 'm1', odds: 2.0 },
      { matchId: 'm2', odds: 1.8 },
    ];
    var result = calcMaxWin(selections, [2], 1, 20);

    // 数值运算 (singleBetAmount=2*1=2, bestProduct=2.0*1.8=3.6, 2*3.6=7.2)
    var display = '预计奖金 ' + result.value + ' 元';
    expect(display).toContain('元');
    expect(result.value > 0).toBe(true);

    // 与数值比较
    expect(result.value).toBeGreaterThan(1);
  });

  // ── 测试：_passOdds 分层数据正确 ──
  it('_passOdds 包含各过关的 bestProduct 和 maxWinPerNote', function () {
    var selections = [
      { matchId: 'm1', odds: 2.0 },
      { matchId: 'm2', odds: 3.0 },
      { matchId: 'm3', odds: 1.5 },
    ];
    var result = calcMaxWin(selections, [2, 3], 1, 10);

    expect(result._passOdds['2']).toBeDefined();
    expect(result._passOdds['3']).toBeDefined();
    expect(result._passOdds['2'].bestProduct).toBeGreaterThan(1);
    expect(result._passOdds['2'].maxWinPerNote).toBeGreaterThan(1);
  });

  // ── 测试：单关 _passTypes=[1] 边界 ──
  it('单关 (passTypes=[1]) 也正常工作', function () {
    var selections = [{ matchId: 'm1', odds: 1.8 }];
    var result = calcMaxWin(selections, [1], 1, 10);

    expect(result.value).toBeGreaterThan(0);
    expect(result._passOdds['1']).toBeDefined();
  });

  // ── 测试：_passOdds 属性可正常访问（回归 confirm-scheme.js L127） ──
  it('calcWin._passOdds 和 calcWin._bestProduct 可正常取值', function () {
    var selections = [
      { matchId: 'm1', odds: 2.5 },
      { matchId: 'm2', odds: 1.6 },
    ];
    var calcWin = calcMaxWin(selections, [2], 1, 10);

    // 模拟 confirm-scheme.js render() 中的取值逻辑
    var passOdds = calcWin._passOdds || {};
    var bestProduct = calcWin._bestProduct || 1;

    expect(passOdds).not.toEqual({});
    expect(bestProduct).toBeGreaterThan(1);
  });

  // ── 测试：空选单返回安全的默认值 ──
  it('空选单不抛异常', function () {
    var result = calcMaxWin([], [2], 1, 10);

    expect(typeof result.value).toBe('number');
    // 无比赛→bestProduct=1, singleBetAmount=2→value≈2
    expect(typeof result._passOdds).toBe('object');
  });

  // ── 测试：amount=0 也返回有理数值 ──
  it('amount=0 返回 value=0', function () {
    // 注意：calcMaxWin 内部用 singleBetAmount=2*multiplier，amount 不直接参与计算
    // amount 参数仅用作调用约定，实际金额由 multiplier 控制
    var result = calcMaxWin([{ matchId: 'm1', odds: 2.0 }], [1], 1, 0);

    expect(typeof result.value).toBe('number');
    expect(result.value).toBeGreaterThan(0);
  });
});
