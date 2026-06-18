/**
 * confirm-scheme 奖金优化回归测试
 * 目标：统一口径 + 金额敏感 + 预算闭环
 */
describe('confirm-scheme 奖金优化核心逻辑', function () {
  function calcEffectiveOdds(oddsArr) {
    var arr = (oddsArr || [])
      .map(function (x) {
        return Number(x) || 0;
      })
      .filter(function (x) {
        return x > 0;
      });
    if (arr.length === 0) return 0;
    if (arr.length === 1) return Math.round(arr[0] * 100) / 100;
    var invSum = 0;
    for (var i = 0; i < arr.length; i++) invSum += 1 / arr[i];
    return invSum > 0 ? Math.round((1 / invSum) * 100) / 100 : 0;
  }

  function calcMaxWin(selections, passTypes, multiplier, amount, betCount) {
    var matchGroups = {};
    (selections || []).forEach(function (s) {
      if (!matchGroups[s.matchId]) matchGroups[s.matchId] = [];
      matchGroups[s.matchId].push(Number(s.odds) || 1);
    });

    var matchIds = Object.keys(matchGroups);
    var passOdds = {};
    var bestProduct = 0;
    var bestProductK = 0;
    var singleBetAmount = 2 * (Number(multiplier) || 1);

    (passTypes || []).forEach(function (k) {
      if (k > matchIds.length || k < 1) return;
      var sorted = matchIds
        .map(function (mid) {
          return calcEffectiveOdds(matchGroups[mid]);
        })
        .filter(function (x) {
          return x > 0;
        })
        .sort(function (a, b) {
          return b - a;
        });
      if (sorted.length < k) return;

      var product = 1;
      for (var i = 0; i < k; i++) product *= sorted[i];
      product = Math.round(product * 100) / 100;
      passOdds[k] = { bestProduct: product, maxWinPerNote: Math.round(singleBetAmount * product * 100) / 100 };
      if (product > bestProduct) {
        bestProduct = product;
        bestProductK = k;
      }
    });

    var maxWinPerNote = singleBetAmount > 0 ? Math.round(singleBetAmount * bestProduct * 100) / 100 : 0;
    var safeBetCount = Number(betCount);
    if (!(safeBetCount > 0)) safeBetCount = 1;
    var safeAmount = Number(amount);
    if (!(safeAmount > 0)) safeAmount = safeBetCount * singleBetAmount;

    var baseAmount = safeBetCount * singleBetAmount;
    var budgetScale = baseAmount > 0 ? safeAmount / baseAmount : 1;
    if (!(budgetScale > 0)) budgetScale = 1;

    return {
      value: Math.round(maxWinPerNote * budgetScale * 100) / 100,
      _maxWinPerNote: maxWinPerNote,
      _budgetScale: budgetScale,
      _passOdds: passOdds,
      _bestProductK: bestProductK,
      _bestProduct: bestProduct,
    };
  }

  function normalizePlanAmountEven(val) {
    var n = Math.max(0, parseInt(val, 10) || 0);
    return n - (n % 2);
  }

  it('金额变化会线性影响预计最高奖金', function () {
    var selections = [
      { matchId: 'm1', odds: 2.0 },
      { matchId: 'm2', odds: 1.8 },
    ];
    var low = calcMaxWin(selections, [2], 2, 40, 10);
    var high = calcMaxWin(selections, [2], 2, 80, 10);

    expect(high.value).toBeGreaterThan(low.value);
    expect(high._budgetScale).toBeCloseTo(low._budgetScale * 2, 5);
  });

  it('返回对象包含分层赔率与最优关级', function () {
    var selections = [
      { matchId: 'm1', odds: 2.0 },
      { matchId: 'm2', odds: 3.0 },
      { matchId: 'm3', odds: 1.5 },
    ];
    var result = calcMaxWin(selections, [2, 3], 1, 100, 50);

    expect(result._passOdds['2']).toBeDefined();
    expect(result._passOdds['3']).toBeDefined();
    expect(result._bestProductK).toBeGreaterThan(0);
    expect(result._maxWinPerNote).toBeGreaterThan(0);
  });

  it('计划购买金额会被约束为偶数（2元粒度）', function () {
    expect(normalizePlanAmountEven(101)).toBe(100);
    expect(normalizePlanAmountEven(100)).toBe(100);
    expect(normalizePlanAmountEven(0)).toBe(0);
  });
});
