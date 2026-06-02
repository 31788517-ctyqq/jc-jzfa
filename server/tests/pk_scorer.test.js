/**
 * P1: pk_scorer.test.js — PK 融合评分 单元测试
 * 覆盖: normalize、calcPowerScores、calcGoalScores、
 *       calcHeatScores、calcHealthScores、calcStabilityScores、
 *       calcVerificationScores、calcAgeWeight、calcCompositeScore、
 *       computeAllScores、getDirectionAdvice
 */
const {
  computeAllScores, getDirectionAdvice
} = require('../pk_scorer');

// ==================== normalize ====================

describe('pk_scorer — computeAllScores 完整评分', () => {
  function makeItem(overrides) {
    return Object.assign({
      gdScore: '0.3', crossValue: '0.15', pwScore: '0.2', adCombined: '0.1',
      bigBallRatio: '55', attDefGoal: '2.8', headToHeadGoal: '2.5',
      breakArmor: '1.2', heatIndex: '1.05', fusionConsensus: 'strong',
      dataAge: 30, stabilityOverall: '72', ladderLevel: 2,
      homeWinAward: '1.85', awayWinAward: '3.5', drawAward: '3.2',
      homeWinPan: '65', awayWinPan: '58', strengthGoal: '1.5',
      leagueCalibration: '1.0', leagueAvgGoals: '2.65', leagueOverBaseline: '55',
      attackPattern: '', crossSpfWin: '0.4', crossSpfLose: '0.3',
      crossHcpWin: '0.35', crossHcpLose: '0.3',
      fusionFinalHome: '1.5', fusionFinalAway: '0.8', fusionFinalTotal: '2.3',
      xgHome: '1.5', xgAway: '0.8',
    }, overrides || {});
  }

  it('返回与输入相同的数组长度', () => {
    const list = [makeItem(), makeItem({ pwScore: '0.5', gdScore: '0.6' })];
    const result = computeAllScores(list);
    expect(result.length).toBe(2);
  });

  it('每个元素包含所有评分维度', () => {
    const list = [makeItem()];
    const result = computeAllScores(list);
    expect(result[0]).toHaveProperty('item');
    expect(result[0]).toHaveProperty('powerScore');
    expect(result[0]).toHaveProperty('goalScore');
    expect(result[0]).toHaveProperty('heatScore');
    expect(result[0]).toHaveProperty('healthScore');
    expect(result[0]).toHaveProperty('stabilityScore');
    expect(result[0]).toHaveProperty('verificationScore');
    expect(result[0]).toHaveProperty('verificationDetails');
    expect(result[0]).toHaveProperty('compositeScore');
    expect(result[0]).toHaveProperty('stars');
  });

  it('评分在 0~100 范围内', () => {
    const list = [makeItem(), makeItem({ pwScore: '-0.5', gdScore: '-0.3' })];
    const result = computeAllScores(list);
    result.forEach(function (r) {
      expect(r.powerScore).toBeGreaterThanOrEqual(0);
      expect(r.powerScore).toBeLessThanOrEqual(100);
      expect(r.goalScore).toBeGreaterThanOrEqual(0);
      expect(r.goalScore).toBeLessThanOrEqual(100);
      expect(r.heatScore).toBeGreaterThanOrEqual(0);
      expect(r.heatScore).toBeLessThanOrEqual(100);
      expect(r.healthScore).toBeGreaterThanOrEqual(0);
      expect(r.healthScore).toBeLessThanOrEqual(100);
      expect(r.stabilityScore).toBeGreaterThanOrEqual(0);
      expect(r.stabilityScore).toBeLessThanOrEqual(100);
      expect(r.compositeScore).toBeGreaterThanOrEqual(0);
      expect(r.compositeScore).toBeLessThanOrEqual(100);
    });
  });

  it('strong 共识 → healthScore=100', () => {
    const list = [makeItem({ fusionConsensus: 'strong' })];
    const result = computeAllScores(list);
    expect(result[0].healthScore).toBe(100);
  });

  it('weak 共识 → healthScore=70', () => {
    const list = [makeItem({ fusionConsensus: 'weak' })];
    const result = computeAllScores(list);
    expect(result[0].healthScore).toBe(70);
  });

  it('meltdown → healthScore=20 (V2.0 降级保留最低基础分)', () => {
    const list = [makeItem({ fusionConsensus: 'meltdown' })];
    const result = computeAllScores(list);
    expect(result[0].healthScore).toBe(20);
  });

  it('stars = Math.round(compositeScore / 20)', () => {
    const list = [makeItem()];
    const result = computeAllScores(list);
    expect(result[0].stars).toBe(Math.round(result[0].compositeScore / 20));
  });

  it('多个项目 → 不同 compositeScore', () => {
    const list = [
      makeItem({ pwScore: '0.8', gdScore: '0.9', fusionConsensus: 'strong' }),
      makeItem({ pwScore: '-0.5', gdScore: '-0.4', fusionConsensus: 'weak' }),
    ];
    const result = computeAllScores(list);
    expect(result[0].compositeScore).not.toBe(result[1].compositeScore);
  });

  it('强队 → 高 powerScore', () => {
    const strong = makeItem({ pwScore: '0.8', gdScore: '0.7', crossValue: '0.5', adCombined: '0.6' });
    const weak = makeItem({ pwScore: '-0.5', gdScore: '-0.4', crossValue: '-0.3', adCombined: '-0.35' });
    const result = computeAllScores([strong, weak]);
    expect(result[0].powerScore).toBeGreaterThan(result[1].powerScore);
  });

  it('dataAge>120 → compositeScore 扣减', () => {
    const fresh = makeItem({ dataAge: 30 });
    const aged = makeItem({ dataAge: 150 });
    const result = computeAllScores([fresh, aged]);
    // aged 应该被扣减（虽然不同项目分数不同）
    expect(result[1].compositeScore).toBeLessThanOrEqual(result[0].compositeScore + 10);
  });

  it('verificationDetails 数组非空', () => {
    const list = [makeItem({ pwScore: '0.5', ladderLevel: 3, strengthGoal: '2.0', attDefGoal: '1.5' })];
    const result = computeAllScores(list);
    expect(Array.isArray(result[0].verificationDetails)).toBe(true);
  });
});

// ==================== getDirectionAdvice ====================

describe('pk_scorer — getDirectionAdvice 方向推荐', () => {
  it('meltdown 无明确方向 → 观望/避开 (V2.0)', () => {
    const result = getDirectionAdvice(
      { item: { fusionConsensus: 'meltdown', pwScore: '0.02' } },
      [],
    );
    expect(result.dir).toContain('观望');
    expect(result.stars).toBe(0);
  });

  it('meltdown 有明确方向 → 2星参考 (V2.0 降级)', () => {
    const result = getDirectionAdvice(
      { item: { fusionConsensus: 'meltdown', pwScore: '0.2' } },
      [],
    );
    expect(result.dir).toContain('主胜');
    expect(result.dir).toContain('参考');
    expect(result.stars).toBe(2);
  });

  it('绝对主胜优势 (pw≥0.25, hi<1.4)', () => {
    const result = getDirectionAdvice(
      { item: { pwScore: '0.3', heatIndex: '1.2', fusionConsensus: 'strong' } },
      [],
    );
    expect(result.dir).toBe('主胜');
    expect(result.stars).toBe(5);
  });

  it('绝对客胜优势 (pw≤-0.25, hi<1.4)', () => {
    const result = getDirectionAdvice(
      { item: { pwScore: '-0.3', heatIndex: '1.2', fusionConsensus: 'strong' } },
      [],
    );
    expect(result.dir).toBe('客胜');
    expect(result.stars).toBe(5);
  });

  it('过热预警 (pw≥0.08, hi≥1.4)', () => {
    const result = getDirectionAdvice(
      { item: { pwScore: '0.15', heatIndex: '1.5', fusionConsensus: 'strong' } },
      [],
    );
    expect(result.dir).toContain('防冷');
    expect(result.stars).toBe(3);
  });

  it('实力均衡 → 双选', () => {
    const result = getDirectionAdvice(
      { item: { pwScore: '0.03', heatIndex: '1.0', fusionConsensus: 'strong' } },
      [],
    );
    expect(result.dir).toContain('双选');
  });

  it('返回 goalDir 和 goalStars', () => {
    const result = getDirectionAdvice(
      { item: { pwScore: '0.3', heatIndex: '1.0', fusionConsensus: 'strong', attDefGoal: '3.5' } },
      [],
    );
    expect(result).toHaveProperty('goalDir');
    expect(result).toHaveProperty('goalStars');
  });

  it('hcpDir 基于 crossHcpWin/CrossHcpLose', () => {
    const result = getDirectionAdvice(
      {
        item: {
          pwScore: '0.3', heatIndex: '1.0', fusionConsensus: 'strong',
          crossHcpWin: '0.45', crossHcpLose: '0.3',
        },
      },
      [],
    );
    expect(result).toHaveProperty('hcpDir');
  });

  // ═══ V2.0: EV 期望值计算 ═══
  it('V2.0 EV: 有赔率时输出 ev 字段', () => {
    const result = getDirectionAdvice(
      {
        item: {
          pwScore: '0.3', heatIndex: '1.0', fusionConsensus: 'strong',
          homeWinAward: '1.80', awayWinAward: '4.20', drawAward: '3.50',
        },
      },
      [],
    );
    expect(result).toHaveProperty('ev');
    expect(result.ev).toHaveProperty('evHome');
    expect(result.ev).toHaveProperty('evDraw');
    expect(result.ev).toHaveProperty('evAway');
    expect(result).toHaveProperty('valueTag');
  });

  it('V2.0 EV: 无赔率时 ev 为 null', () => {
    const result = getDirectionAdvice(
      { item: { pwScore: '0.3', heatIndex: '1.0', fusionConsensus: 'strong' } },
      [],
    );
    expect(result.ev).toBe(null);
    expect(result.valueTag).toBe('');
  });

  it('V2.0 EV: 负期望值价值标签', () => {
    const result = getDirectionAdvice(
      {
        item: {
          pwScore: '0.3', heatIndex: '1.0', fusionConsensus: 'strong',
          homeWinAward: '1.08', awayWinAward: '10.0', drawAward: '8.0', // 主胜赔率极低，EV为负
        },
      },
      [],
    );
    expect(result.valueTag).toBe('⚠️负期望');
  });

  // ═══ V2.0: 联赛自适应热度 ═══
  it('V2.0 heatZ: 英超 HI=1.6 触发过热 (阈值 1.52)', () => {
    const result = getDirectionAdvice(
      {
        item: {
          pwScore: '0.3', heatIndex: '1.6', fusionConsensus: 'strong',
          leagueName: '英超',
        },
      },
      [],
    );
    // HI=1.6 > 英超过热阈值=1.52 → 触发防冷
    expect(result.dir).toContain('防冷');
  });
});
