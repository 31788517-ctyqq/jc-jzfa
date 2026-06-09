jest.mock('../database', () => ({
  isAvailable: jest.fn(() => false),
  getJczqBasic: jest.fn(() => null),
}));

const {
  fundamentalFusion,
  crossValidateXg,
  calibrateScoreProb,
  spImpliedProb,
  discreteWarning,
  asiaWaterChange,
} = require('../core/data-fusion');

describe('data-fusion', () => {
  it('fundamentalFusion 在 basic 缺失时返回默认结构', () => {
    const result = fundamentalFusion({ homeWinPanRate: 0.6 }, null);

    expect(result.winPanScore).toBe(50);
    expect(result.powerCorrelation).toBe(0);
    expect(result.homeJiFen).toBeNull();
    expect(result.jiaoFenDesc).toBeNull();
  });

  it('fundamentalFusion 会融合赢盘率并计算实力相关性', () => {
    const result = fundamentalFusion(
      { homeWinPanRate: 0.8, homePower: 78 },
      {
        homeWinPan: 1.2,
        homePower: 74,
        homeJiFenHomeAll: 2.1,
        awayJiFenGuest: 1.3,
        jiaoFenDesc: '近3场主队占优',
      },
    );

    expect(result.winPanScore).toBe(70);
    expect(result.powerCorrelation).toBe(1);
    expect(result.homeJiFen).toBe(2.1);
    expect(result.awayJiFen).toBe(1.3);
    expect(result.jiaoFenDesc).toBe('近3场主队占优');
  });

  it('crossValidateXg 会区分背离等级', () => {
    expect(crossValidateXg({ totalGoalsExpect: 3.8 }, { dxqLastPan: 2.5 })).toMatchObject({
      deviation: 1.3,
      flag: '大小球背离',
      flagLevel: 'warning',
    });

    expect(crossValidateXg({ totalGoalsExpect: 3.1 }, { dxqLastPan: 2.5 })).toMatchObject({
      deviation: 0.6,
      flag: '轻微偏离',
      flagLevel: 'caution',
    });

    expect(crossValidateXg({ totalGoalsExpect: 2.7 }, { dxqLastPan: 2.5 })).toMatchObject({
      deviation: 0.2,
      flag: '一致',
      flagLevel: 'none',
    });
  });

  it('calibrateScoreProb 在无外部比分分布时保持原始概率', () => {
    const scoreMatrix = { '1-0': 0.4, '2-0': 0.35, '2-1': 0.25 };
    expect(calibrateScoreProb(scoreMatrix, null)).toEqual(scoreMatrix);
  });

  it('calibrateScoreProb 会按外部比分分布做加权校准', () => {
    const calibrated = calibrateScoreProb(
      { '1-0': 0.2, '2-0': 0.3, '0-0': 0.5 },
      {
        homeWinQiu_0: 2,
        homeWinQiu_1: 5,
        homeWinQiu_2: 3,
        homeLoseQiu_0: 6,
        homeLoseQiu_1: 3,
        homeLoseQiu_2: 1,
      },
    );

    expect(calibrated['1-0']).toBeCloseTo(0.29, 3);
    expect(calibrated['2-0']).toBeCloseTo(0.3, 3);
    expect(calibrated['0-0']).toBeCloseTo(0.41, 3);
  });

  it('spImpliedProb 会把 SP 转成隐含概率', () => {
    const result = spImpliedProb({
      homeWinAward: 2.0,
      drawAward: 3.2,
      guestWinAward: 4.0,
    });

    expect(result.homeImplied).toBeCloseTo(0.471, 3);
    expect(result.drawImplied).toBeCloseTo(0.294, 3);
    expect(result.awayImplied).toBeCloseTo(0.235, 3);
    expect(result.totalPayout).toBeCloseTo(1.0625, 4);
  });

  it('discreteWarning 会输出离散度风险等级', () => {
    expect(discreteWarning({}, { initDiscreteDiff: 0.1, lastDiscreteDiff: 0.25 })).toMatchObject({
      shift: 0.15,
      flag: '离散度扩大（不确定性↑）',
      flagLevel: 'warning',
    });

    expect(discreteWarning({}, { initDiscreteDiff: 0.2, lastDiscreteDiff: 0.22 })).toMatchObject({
      shift: 0.02,
      flag: '离散度稳定/收窄',
      flagLevel: 'none',
    });
  });

  it('asiaWaterChange 会组合盘口和水位信号', () => {
    const result = asiaWaterChange({
      initPan: -0.25,
      lastPan: 0.25,
      asiaInitAvgWinOdd: 0.96,
      asiaLastAvgWinOdd: 0.88,
      asiaInitAvgLoseOdd: 0.9,
      asiaLastAvgLoseOdd: 0.97,
    });

    expect(result.panShift).toBe(0.5);
    expect(result.waterChangeHome).toBe(-0.08);
    expect(result.waterChangeAway).toBe(0.07);
    expect(result.signal).toBe('盘口↑升盘，主队降水');
  });
});
