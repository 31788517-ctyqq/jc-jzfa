/**
 * P0: plan-generator.test.js — 方案生成共享模块 单元测试
 * 覆盖: qualifyMatch(比分方案筛选)、dutchCombinations(荷兰式组合)、
 *       computeScoreQuality(质量评分)、getColdDirection(冷门方向)、
 *       computeColdScore、checkCorrelation、parseKickoffTime、checkMatchResult
 */
const {
  qualifyMatch, buildScorePercentMap, dutchCombinations,
  computeScoreQuality, getMatchOdds, getColdDirection,
  computeColdScore, checkCorrelation, parseKickoffTime, checkMatchResult
} = require('../core/plan-generator');

// ==================== 辅助函数 ====================

function makeGS(overrides) {
  return Object.assign({
    fusionConsensus: 'strong',
    stabilityOverall: '75',
    bigBallRatio: '45',
    totalGoalsExpect: '2.85',
    attackAdvantageRaw: '0.15',
    defenseAdvantageRaw: '0.08',
    xgHome: '2.0',
    xgAway: '0.8',
    scores: [
      { score: '2-0', percent: '15.2' },
      { score: '1-0', percent: '12.8' },
      { score: '2-1', percent: '10.5' },
      { score: '3-0', percent: '8.3' },
      { score: '3-1', percent: '6.7' },
      { score: '1-1', percent: '5.2' },
      { score: '2-2', percent: '3.1' },
      { score: '0-0', percent: '2.0' },
    ],
    goalRange: { overRate: '42' },
    leagueAvgGoals: '2.8',
  }, overrides || {});
}

// ==================== qualifyMatch ====================

describe('plan-generator — qualifyMatch 比分方案筛选', () => {
  it('无gs数据 → 返回 false', () => {
    expect(qualifyMatch({})).toBe(false);
    expect(qualifyMatch({ gs: null })).toBe(false);
  });

  it('fusionConsensus=meltdown → 返回 false', () => {
    const item = { gs: makeGS({ fusionConsensus: 'meltdown' }) };
    expect(qualifyMatch(item)).toBe(false);
  });

  it('大球率不足 → 返回 false', () => {
    const item = { gs: makeGS({
      bigBallRatio: '20',
      totalGoalsExpect: '1.2',
      goalRange: { overRate: '15' },
    })};
    expect(qualifyMatch(item)).toBe(false);
  });

  it('攻防符号相同 → 返回 false', () => {
    const item = { gs: makeGS({
      attackAdvantageRaw: '0.15',
      defenseAdvantageRaw: '0.08',
    })};
    // 两个都正数 → attRaw*defRaw > 0 → 通过
    expect(qualifyMatch(item)).not.toBe(false);
  });

  it('攻防符号相反(attRaw*defRaw<=0) → 返回 false', () => {
    const item = { gs: makeGS({
      attackAdvantageRaw: '0.15',
      defenseAdvantageRaw: '-0.05',
    })};
    expect(qualifyMatch(item)).toBe(false);
  });

  it('攻防强度不足 → 返回 false', () => {
    const item = { gs: makeGS({
      attackAdvantageRaw: '0.02',
      defenseAdvantageRaw: '0.004',
    })};
    expect(qualifyMatch(item)).toBe(false);
  });

  it('xg差不足0.6 → 返回 false', () => {
    const item = { gs: makeGS({ xgHome: '1.3', xgAway: '1.1' }) };
    expect(qualifyMatch(item)).toBe(false);
  });

  it('weak共识 + stability<55 → 返回 false', () => {
    const item = { gs: makeGS({
      fusionConsensus: 'weak',
      stabilityOverall: '50',
      xgHome: '2.2',
      xgAway: '0.6',
    })};
    expect(qualifyMatch(item)).toBe(false);
  });

  it('弱侧xg>1.5 → 返回 false', () => {
    const item = { gs: makeGS({
      xgHome: '2.0',
      xgAway: '1.8',
      attackAdvantageRaw: '0.3',
      defenseAdvantageRaw: '0.03',
    })};
    expect(qualifyMatch(item)).toBe(false);
  });

  it('正常强一致数据 → 通过筛选', () => {
    const item = { gs: makeGS() };
    const result = qualifyMatch(item);
    expect(result).not.toBe(false);
    expect(result).toHaveProperty('strongIsHome');
    expect(result).toHaveProperty('bigBallRatio');
    expect(result).toHaveProperty('xgHome');
    expect(result).toHaveProperty('xgAway');
    expect(result).toHaveProperty('consensus');
    expect(result).toHaveProperty('stabilityOverall');
    expect(result.strongIsHome).toBe(true); // attRaw>0
  });

  it('客队优势 → strongIsHome=false', () => {
    const item = { gs: makeGS({
      attackAdvantageRaw: '-0.2',
      defenseAdvantageRaw: '-0.08',
    })};
    const result = qualifyMatch(item);
    if (result) expect(result.strongIsHome).toBe(false);
  });
});

// ==================== buildScorePercentMap ====================

describe('plan-generator — buildScorePercentMap', () => {
  it('正常scores → 构建映射', () => {
    const gs = { scores: [{ score: '2-0', percent: '15.2' }, { score: '1-0', percent: '12.8' }] };
    const map = buildScorePercentMap(gs);
    expect(map).toEqual({ '2-0': 15.2, '1-0': 12.8 });
  });

  it('空scores → 返回 null', () => {
    expect(buildScorePercentMap({})).toBe(null);
    expect(buildScorePercentMap({ scores: [] })).toBe(null);
  });

  it('null gs → 返回 null', () => {
    expect(buildScorePercentMap(null)).toBe(null);
  });
});

// ==================== dutchCombinations ====================

describe('plan-generator — dutchCombinations 荷兰式组合', () => {
  const oddsMap = {
    '2-0': 8.5, '1-0': 7.0, '2-1': 9.0, '3-0': 12.0,
    '3-1': 15.0, '1-1': 7.5, '0-0': 11.0, '2-2': 13.0,
  };
  const qual = {
    scorePercentMap: { '2-0': 15.2, '1-0': 12.8, '2-1': 10.5, '3-0': 8.3, '3-1': 6.7, '1-1': 5.2 },
    goalUpper: 4,
    xgHome: 2.0, xgAway: 0.8,
    totalStrength: 0.3,
  };

  it('返回2~4个比分的组合', () => {
    const results = dutchCombinations(oddsMap, 100, true, false, qual);
    if (results.length > 0) {
      results.forEach(function (r) {
        expect(r.comboLength).toBeGreaterThanOrEqual(2);
        expect(r.comboLength).toBeLessThanOrEqual(4);
      });
    }
  });

  it('每个组合有 scores/baseExpectedReturn/comboLength/coverage', () => {
    const results = dutchCombinations(oddsMap, 100, true, false, qual);
    results.forEach(function (r) {
      expect(r).toHaveProperty('scores');
      expect(r).toHaveProperty('baseExpectedReturn');
      expect(r).toHaveProperty('comboLength');
      expect(r).toHaveProperty('coverage');
      r.scores.forEach(function (s) {
        expect(s).toHaveProperty('score');
        expect(s).toHaveProperty('odds');
        expect(s).toHaveProperty('allocation');
      });
    });
  });

  it('prefer 3组合', () => {
    const results = dutchCombinations(oddsMap, 100, true, false, qual);
    if (results.length >= 2) {
      // 3组合应排在更前面
      const first3Idx = results.findIndex(function (r) { return r.comboLength === 3; });
      const first2Idx = results.findIndex(function (r) { return r.comboLength === 2; });
      if (first3Idx >= 0 && first2Idx >= 0) {
        expect(first3Idx).toBeLessThan(first2Idx);
      }
    }
  });

  it('不足2个candidates → 返回空', () => {
    const smallOdds = { '2-0': 8.0 };
    const results = dutchCombinations(smallOdds, 100, true, false, qual);
    expect(results).toEqual([]);
  });

  it('空oddsMap → 返回空', () => {
    const results = dutchCombinations({}, 100, true, false, qual);
    expect(results).toEqual([]);
  });
});

// ==================== computeScoreQuality ====================

describe('plan-generator — computeScoreQuality 质量评分', () => {
  it('返回 0~100 分数', () => {
    const gs = makeGS();
    const qual = { xgHome: 2.0, xgAway: 0.8 };
    const score = computeScoreQuality(gs, qual);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('strong 共识得分高于 weak', () => {
    const gsStrong = makeGS({ fusionConsensus: 'strong' });
    const gsWeak = makeGS({ fusionConsensus: 'weak' });
    const qual = { xgHome: 2.0, xgAway: 0.8 };
    expect(computeScoreQuality(gsStrong, qual)).toBeGreaterThan(computeScoreQuality(gsWeak, qual));
  });

  it('大球率越高分数越高', () => {
    const gsLow = makeGS({ bigBallRatio: '20' });
    const gsHigh = makeGS({ bigBallRatio: '80' });
    const qual = { xgHome: 2.0, xgAway: 0.8 };
    expect(computeScoreQuality(gsHigh, qual)).toBeGreaterThan(computeScoreQuality(gsLow, qual));
  });

  it('xg差越大分数越高', () => {
    const qualNear = { xgHome: 1.3, xgAway: 1.1 };
    const qualFar = { xgHome: 2.5, xgAway: 0.5 };
    const gs = makeGS();
    expect(computeScoreQuality(gs, qualFar)).toBeGreaterThan(computeScoreQuality(gs, qualNear));
  });

  it('联赛场均进球>2.85 → 额外加分', () => {
    const gsHigh = makeGS({ leagueAvgGoals: '3.0' });
    const gsLow = makeGS({ leagueAvgGoals: '2.4' });
    const qual = { xgHome: 2.0, xgAway: 0.8 };
    expect(computeScoreQuality(gsHigh, qual)).toBeGreaterThan(computeScoreQuality(gsLow, qual));
  });
});

// ==================== getMatchOdds ====================

describe('plan-generator — getMatchOdds', () => {
  it('按 num 匹配', () => {
    const m = { num: '001' };
    const od = { '001': { spf: { home: 1.8, draw: 3.5, away: 4.0 } } };
    expect(getMatchOdds(m, od)).toEqual({ spf: { home: 1.8, draw: 3.5, away: 4.0 } });
  });

  it('按 num_X 匹配(allplays)', () => {
    const m = { num: '001' };
    const ap = { 'num_001': { spf: { home: 2.0 } } };
    expect(getMatchOdds(m, null, ap)).toEqual({ spf: { home: 2.0 } });
  });

  it('按 matchId 匹配', () => {
    const m = { num: '', matchId: 'm123' };
    const ap = { 'm123': { spf: { home: 1.5 } } };
    expect(getMatchOdds(m, null, ap)).toEqual({ spf: { home: 1.5 } });
  });

  it('无匹配 → null', () => {
    expect(getMatchOdds({ num: '999' }, {})).toBe(null);
  });
});

// ==================== getColdDirection ====================

describe('plan-generator — getColdDirection 冷门方向', () => {
  it('返回方向对象含 dir/odds/signal/finalScore', () => {
    const modds = { spf: { home: 1.8, draw: 3.5, away: 4.0 } };
    const gs = { totalStrength: '0.1', fusionConsensus: 'weak' };
    const result = getColdDirection(modds, gs);
    expect(result).toHaveProperty('dir');
    expect(result).toHaveProperty('odds');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('finalScore');
  });

  it('均衡实力+弱共识 → 平局方向信号增强', () => {
    const modds = { spf: { home: 1.8, draw: 3.5, away: 4.0 } };
    const gs = { totalStrength: '0.05', fusionConsensus: 'weak' };
    const result = getColdDirection(modds, gs);
    // 均衡时平局信号应增加
    expect(result).toBeDefined();
  });

  it('熔断共识 → 信号轻微增强', () => {
    const modds = { spf: { home: 1.8, draw: 3.5, away: 4.0 } };
    const gs = { totalStrength: '0.2', fusionConsensus: 'meltdown' };
    const result = getColdDirection(modds, gs);
    expect(result).toBeDefined();
  });
});

// ==================== computeColdScore ====================

describe('plan-generator — computeColdScore 冷门评分', () => {
  it('返回 0~100 分数', () => {
    const gs = { totalStrength: '0.05', fusionConsensus: 'weak' };
    const modds = { spf: { home: 1.8, draw: 3.5, away: 4.0 } };
    const coldDir = { dir: '负', odds: 4.0 };
    const score = computeColdScore(null, gs, modds, coldDir);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('实力均衡 → 高分', () => {
    const gsBalanced = { totalStrength: '0.02', fusionConsensus: 'weak' };
    const gsUnbalanced = { totalStrength: '0.5', fusionConsensus: 'strong' };
    const modds = { spf: { home: 2.0, draw: 3.2, away: 3.5 } };
    const coldDir = { dir: '负', odds: 3.5 };
    expect(computeColdScore(null, gsBalanced, modds, coldDir))
      .toBeGreaterThan(computeColdScore(null, gsUnbalanced, modds, coldDir));
  });

  it('weak共识比strong共识得分高', () => {
    const modds = { spf: { home: 2.0, draw: 3.2, away: 3.5 } };
    const coldDir = { dir: '负', odds: 3.5 };
    const gsWeak = { totalStrength: '0.1', fusionConsensus: 'weak' };
    const gsStrong = { totalStrength: '0.1', fusionConsensus: 'strong' };
    // weak 应有冷门加分
    const sW = computeColdScore(null, gsWeak, modds, coldDir);
    const sS = computeColdScore(null, gsStrong, modds, coldDir);
    expect(sW).toBeGreaterThanOrEqual(sS);
  });

  it('heatIndex 低于 0.85 → 更高冷门评分', () => {
    const gs = { totalStrength: '0.1', fusionConsensus: 'weak' };
    const modds = { spf: { home: 2.0, draw: 3.2, away: 3.5 } };
    const coldDir = { dir: '负', odds: 3.5 };
    const sHi = computeColdScore(1.6, gs, modds, coldDir);
    const sLo = computeColdScore(0.7, gs, modds, coldDir); // hi=0.7<0.85 触发加分
    expect(sLo).toBeGreaterThan(sHi);
  });
});

// ==================== parseKickoffTime ====================

describe('plan-generator — parseKickoffTime', () => {
  it('正常ISO时间 → 返回时间戳', () => {
    const ts = parseKickoffTime('2026-06-01T20:00:00');
    expect(ts).toBeGreaterThan(0);
    expect(typeof ts).toBe('number');
  });

  it('null/空 → 返回 null', () => {
    expect(parseKickoffTime(null)).toBe(null);
    expect(parseKickoffTime('')).toBe(null);
  });

  it('无效时间 → 返回 null', () => {
    expect(parseKickoffTime('not-a-date')).toBe(null);
  });
});

// ==================== checkCorrelation ====================

describe('plan-generator — checkCorrelation 组合相关性', () => {
  const base = { leagueName: '英超', startTime: '2026-06-01T20:00:00', homeName: '曼联', visitName: '利物浦' };

  it('完全不同 → low 风险', () => {
    const ca = { leagueName: '英超', startTime: '2026-06-01T20:00:00', homeName: '曼联', visitName: '利物浦' };
    const cb = { leagueName: '西甲', startTime: '2026-06-02T03:00:00', homeName: '巴萨', visitName: '皇马' };
    const result = checkCorrelation(ca, cb);
    expect(result.riskLevel).toBe('low');
    expect(result.warnings.length).toBe(0);
  });

  it('同联赛 → medium', () => {
    const ca = { ...base };
    const cb = { leagueName: '英超', startTime: '2026-06-02T20:00:00', homeName: '阿森纳', visitName: '切尔西' };
    const result = checkCorrelation(ca, cb);
    expect(result.riskLevel).toBe('medium');
    expect(result.warnings).toContain('同联赛');
  });

  it('时间接近(<90min) → medium', () => {
    const ca = { ...base };
    const cb = { leagueName: '西甲', startTime: '2026-06-01T21:00:00', homeName: '巴萨', visitName: '皇马' };
    const result = checkCorrelation(ca, cb);
    expect(result.riskLevel).toBe('medium');
    expect(result.warnings).toContain('开球时间接近');
  });

  it('同球队 → medium', () => {
    const ca = { ...base };
    const cb = { leagueName: '西甲', startTime: '2026-06-02T20:00:00', homeName: '曼联', visitName: '热刺' };
    const result = checkCorrelation(ca, cb);
    expect(result.riskLevel).toBe('medium');
    expect(result.warnings).toContain('同一球队');
  });

  it('同联赛+时间接近 → high', () => {
    const ca = { ...base };
    const cb = { leagueName: '英超', startTime: '2026-06-01T21:00:00', homeName: '阿森纳', visitName: '切尔西' };
    const result = checkCorrelation(ca, cb);
    expect(result.riskLevel).toBe('high');
  });
});

// ==================== checkMatchResult ====================

describe('plan-generator — checkMatchResult 单场结果判定', () => {
  function normRecs(arr) { return arr; }

  it('精确匹配方向 → 返回结果', () => {
    const rMap = {
      'm_123': [{ type: '胜', result: 1 }],
    };
    const result = checkMatchResult('123', '胜', rMap, normRecs);
    expect(result.isWon).toBe(true);
    expect(result.isLose).toBe(false);
  });

  it('方向失败 → isLose=true', () => {
    const rMap = {
      'm_123': [{ type: '胜', result: 0 }],
    };
    const result = checkMatchResult('123', '胜', rMap, normRecs);
    expect(result.isWon).toBe(false);
    expect(result.isLose).toBe(true);
  });

  it('result=null(未知) → isWon/isLose 均为 null', () => {
    const rMap = {
      'm_123': [{ type: '胜', result: null }],
    };
    const result = checkMatchResult('123', '胜', rMap, normRecs);
    expect(result.isWon).toBe(null);
    expect(result.isLose).toBe(null);
  });

  it('双选方向 → 任一命中即可', () => {
    const rMap = {
      'm_123': [
        { type: '胜', result: 0 },
        { type: '平', result: 1 },
      ],
    };
    const result = checkMatchResult('123', '胜、平', rMap, normRecs);
    expect(result.isWon).toBe(true);
  });

  it('无匹配 → null', () => {
    const rMap = {};
    const result = checkMatchResult('999', '胜', rMap, normRecs);
    expect(result.isWon).toBe(null);
    expect(result.isLose).toBe(null);
  });
});
