/**
 * P1: bet-scheme-filters.test.js — 投注方案多维度筛选 单元测试
 * 覆盖: safeFloat/safeInt/safeBool/listTokenSet/normalizeSelectionCode/selectionScore
 *       matchesBaseFilters/matchesValueGate/matchesCalibratedConfidence/matchesOddsRelation
 *       groupSelections/estimateScheme/applySchemeFilters
 */
const {
  safeFloat,
  safeInt,
  safeBool,
  listTokenSet,
  normalizeSelectionCode,
  selectionScore,
  matchesBaseFilters,
  matchesValueGate,
  matchesCalibratedConfidence,
  matchesOddsRelation,
  groupSelections,
  estimateScheme,
  applySchemeFilters,
  SELECTION_LABELS,
} = require('../core/bet-scheme-filters');

// ==================== 工具函数 ====================

describe('bet-scheme-filters — 工具函数', () => {
  it('safeFloat: 正常数字 → 返回数字', () => {
    expect(safeFloat('3.14')).toBe(3.14);
    expect(safeFloat(2.5)).toBe(2.5);
  });

  it('safeFloat: null/空字符串/非数字 → null', () => {
    expect(safeFloat(null)).toBe(null);
    expect(safeFloat('')).toBe(null);
    expect(safeFloat(undefined)).toBe(null);
    expect(safeFloat('abc')).toBe(null);
  });

  it('safeInt: 正常整数 → 返回整数', () => {
    expect(safeInt('42')).toBe(42);
    expect(safeInt(100)).toBe(100);
  });

  it('safeInt: 非法值 → null', () => {
    expect(safeInt(null)).toBe(null);
    expect(safeInt('abc')).toBe(null);
  });

  it('safeBool: true/1/yes/on → true', () => {
    expect(safeBool(true)).toBe(true);
    expect(safeBool('1')).toBe(true);
    expect(safeBool('true')).toBe(true);
    expect(safeBool('yes')).toBe(true);
    expect(safeBool('on')).toBe(true);
    expect(safeBool('ON')).toBe(true);
  });

  it('safeBool: 其他值 → false', () => {
    expect(safeBool(false)).toBe(false);
    expect(safeBool('0')).toBe(false);
    expect(safeBool('no')).toBe(false);
    expect(safeBool('')).toBe(false);
  });

  it('listTokenSet: 数组输入 → Set', () => {
    const s = listTokenSet(['英超', '西甲', '英冠']);
    expect(s.size).toBe(3);
    expect(s.has('英超')).toBe(true);
    expect(s.has('西甲')).toBe(true);
  });

  it('listTokenSet: 逗号分隔字符串 → Set', () => {
    const s = listTokenSet('英超,西甲, 德甲');
    expect(s.size).toBe(3);
    expect(s.has('德甲')).toBe(true);
  });

  it('listTokenSet: 空值 → 空 Set', () => {
    expect(listTokenSet(null).size).toBe(0);
    expect(listTokenSet('').size).toBe(0);
  });

  it('normalizeSelectionCode: home/draw/away → 对应值', () => {
    expect(normalizeSelectionCode('home')).toBe('home');
    expect(normalizeSelectionCode('draw')).toBe('draw');
    expect(normalizeSelectionCode('away')).toBe('away');
    expect(normalizeSelectionCode('HOME')).toBe('home');
  });

  it('normalizeSelectionCode: 非法值 → 空字符串', () => {
    expect(normalizeSelectionCode('')).toBe('');
    expect(normalizeSelectionCode('win')).toBe('');
  });

  it('selectionScore: 返回 [recommended, confidence, edge, odds]', () => {
    const sel = { recommended: true, confidence: 0.8, edgeValue: 0.15, edge_value: null, odds: 1.9 };
    const s = selectionScore(sel);
    expect(s[0]).toBe(1); // recommended → 1.0
    expect(s[1]).toBe(0.8);
    expect(s[2]).toBe(0.15);
    expect(s[3]).toBe(1.9);
  });
});

// ==================== matchesBaseFilters ====================

describe('bet-scheme-filters — matchesBaseFilters 基础阈值筛选', () => {
  function sel(overrides) {
    return Object.assign(
      {
        confidence: 0.8,
        edgeValue: 0.15,
        odds: 1.85,
        league: '英超',
        leagueName: '英超',
        recommended: true,
        context: {},
        contextJson: {},
      },
      overrides || {},
    );
  }

  it('所有条件通过 → 返回空数组', () => {
    const reasons = matchesBaseFilters(sel(), { confidenceMin: 0.5, edgeMin: 0.05 });
    expect(reasons).toEqual([]);
  });

  it('confidence 低于门槛 → confidence_below_min', () => {
    const reasons = matchesBaseFilters(sel({ confidence: 0.3 }), { confidenceMin: 0.6 });
    expect(reasons).toContain('confidence_below_min');
  });

  it('edge 低于门槛 → edge_below_min', () => {
    const reasons = matchesBaseFilters(sel({ edgeValue: 0.02 }), { edgeMin: 0.1 });
    expect(reasons).toContain('edge_below_min');
  });

  it('odds 低于最小赔率 → odds_below_min', () => {
    const reasons = matchesBaseFilters(sel({ odds: 1.2 }), { oddsMin: 1.5 });
    expect(reasons).toContain('odds_below_min');
  });

  it('odds 高于最大赔率 → odds_above_max', () => {
    const reasons = matchesBaseFilters(sel({ odds: 5.0 }), { oddsMax: 3.0 });
    expect(reasons).toContain('odds_above_max');
  });

  it('联赛白名单不匹配 → league_not_allowed', () => {
    const reasons = matchesBaseFilters(sel({ league: '法甲' }), { leagueWhitelist: '英超,西甲' });
    expect(reasons).toContain('league_not_allowed');
  });

  it('联赛黑名单匹配 → league_blocked', () => {
    const reasons = matchesBaseFilters(sel({ league: '德甲' }), { leagueBlacklist: '德甲,美职联' });
    expect(reasons).toContain('league_blocked');
  });

  it('排除回退结果 (excludeFallback + fallback=true) → fallback_selection', () => {
    const reasons = matchesBaseFilters(sel({ context: { fallback: true } }), { excludeFallback: true });
    expect(reasons).toContain('fallback_selection');
  });

  it('仅AI推荐 (onlyAiRecommended + recommended=false) → not_ai_recommended', () => {
    const reasons = matchesBaseFilters(sel({ recommended: false }), { onlyAiRecommended: true });
    expect(reasons).toContain('not_ai_recommended');
  });

  it('多个条件同时失败 → 返回多个原因', () => {
    const reasons = matchesBaseFilters(sel({ confidence: 0.2, odds: 1.2, league: '巴甲' }), {
      confidenceMin: 0.5,
      oddsMin: 1.5,
      leagueWhitelist: '英超,西甲',
    });
    expect(reasons.length).toBe(3);
  });
});

// ==================== matchesValueGate ====================

describe('bet-scheme-filters — matchesValueGate 价值门控', () => {
  function sel(overrides) {
    return Object.assign(
      {
        edgeValue: 0.15,
        odds: 1.85,
        context: { modelProbability: 0.62 },
        contextJson: {},
      },
      overrides || {},
    );
  }

  it('mode=off → 返回空数组', () => {
    const reasons = matchesValueGate(sel(), { valueGateMode: 'off' });
    expect(reasons).toEqual([]);
  });

  it('edge_only: edge 通过 → 返回空数组', () => {
    const reasons = matchesValueGate(sel(), { valueGateMode: 'edge_only', valueEdgeMin: 0.1 });
    expect(reasons).toEqual([]);
  });

  it('edge_only: edge 不通过 → edge_below_min', () => {
    const reasons = matchesValueGate(sel({ edgeValue: 0.02 }), { valueGateMode: 'edge_only', valueEdgeMin: 0.1 });
    expect(reasons).toContain('value_gate_edge_below_min');
  });

  it('ev_only: EV 通过 → 返回空数组', () => {
    // prob=0.62, odds=1.85 → EV = 0.62*1.85-1 = 0.147
    const reasons = matchesValueGate(sel(), { valueGateMode: 'ev_only', evMin: 0.1 });
    expect(reasons).toEqual([]);
  });

  it('ev_only: EV 不通过 → ev_below_min', () => {
    const reasons = matchesValueGate(sel({ odds: 1.5 }), { valueGateMode: 'ev_only', evMin: 0.2 });
    expect(reasons).toContain('value_gate_ev_below_min');
  });

  it('edge_or_ev: 任一通过 → 返回空数组', () => {
    // edge=0.15 ≥ 0.1 pass, ev maybe fail
    const reasons = matchesValueGate(
      sel({ odds: 1.2 }), // EV may fail but edge passes
      { valueGateMode: 'edge_or_ev', valueEdgeMin: 0.1, evMin: 0.3 },
    );
    expect(reasons).toEqual([]);
  });

  it('edge_and_ev: 两者都通过 → 返回空数组', () => {
    const reasons = matchesValueGate(sel(), { valueGateMode: 'edge_and_ev', valueEdgeMin: 0.1, evMin: 0.05 });
    expect(reasons).toEqual([]);
  });

  it('edge_and_ev: edge 失败 → edge_below_min', () => {
    const reasons = matchesValueGate(sel({ edgeValue: 0.02 }), {
      valueGateMode: 'edge_and_ev',
      valueEdgeMin: 0.1,
      evMin: 0.05,
    });
    expect(reasons).toContain('value_gate_edge_below_min');
  });
});

// ==================== matchesCalibratedConfidence ====================

describe('bet-scheme-filters — matchesCalibratedConfidence 校准置信度', () => {
  function sel(overrides) {
    return Object.assign(
      {
        confidence: 0.7,
        context: { confidenceCalibrated: 0.65 },
        contextJson: {},
      },
      overrides || {},
    );
  }

  it('threshold 为 null → 返回空数组', () => {
    expect(matchesCalibratedConfidence(sel(), {})).toEqual([]);
  });

  it('校准值 >= 门槛 → 返回空数组', () => {
    expect(matchesCalibratedConfidence(sel(), { confidenceCalibratedMin: 0.6 })).toEqual([]);
  });

  it('校准值 < 门槛 → confidence_calibrated_below_min', () => {
    const reasons = matchesCalibratedConfidence(sel({ context: { confidenceCalibrated: 0.3 } }), {
      confidenceCalibratedMin: 0.5,
    });
    expect(reasons).toContain('confidence_calibrated_below_min');
  });

  it('校准值缺失 strategy=keep → 返回空数组', () => {
    const reasons = matchesCalibratedConfidence(sel({ context: {} }), {
      confidenceCalibratedMin: 0.5,
      confidenceCalibratedMissingStrategy: 'keep',
    });
    expect(reasons).toEqual([]);
  });

  it('校准值缺失 strategy=drop → confidence_calibrated_missing', () => {
    const reasons = matchesCalibratedConfidence(sel({ context: {} }), {
      confidenceCalibratedMin: 0.5,
      confidenceCalibratedMissingStrategy: 'drop',
    });
    expect(reasons).toContain('confidence_calibrated_missing');
  });

  it('校准值缺失 strategy=fallback_confidence → 使用 selection.confidence', () => {
    // selection.confidence=0.70 ≥ 0.5 → 通过
    expect(
      matchesCalibratedConfidence(sel({ context: {} }), {
        confidenceCalibratedMin: 0.5,
        confidenceCalibratedMissingStrategy: 'fallback_confidence',
      }),
    ).toEqual([]);
  });
});

// ==================== matchesOddsRelation ====================

describe('bet-scheme-filters — matchesOddsRelation 首赔关系', () => {
  function sel(meta) {
    return {
      _matchOddsMeta: meta || {},
    };
  }

  it('无 _matchOddsMeta → odds_relation_context_missing', () => {
    const reasons = matchesOddsRelation({}, { firstSecondOddsRelation: 'first_only' });
    expect(reasons).toContain('odds_relation_context_missing');
  });

  it('relation=first_only, rank=1 → 通过', () => {
    expect(matchesOddsRelation(sel({ rank: 1, totalCount: 5 }), { firstSecondOddsRelation: 'first_only' })).toEqual([]);
  });

  it('relation=first_only, rank!=1 → odds_rank_not_first', () => {
    const reasons = matchesOddsRelation(sel({ rank: 2, totalCount: 5 }), { firstSecondOddsRelation: 'first_only' });
    expect(reasons).toContain('odds_rank_not_first');
  });

  it('relation=exclude_last, rank=totalCount → odds_rank_is_last', () => {
    const reasons = matchesOddsRelation(sel({ rank: 5, totalCount: 5 }), { firstSecondOddsRelation: 'exclude_last' });
    expect(reasons).toContain('odds_rank_is_last');
  });

  it('首赔和为/积范围检查', () => {
    const reasons = matchesOddsRelation(sel({ rank: 1, totalCount: 3, firstOddsSum: 3.5, firstOddsProduct: 6.0 }), {
      firstOddsSumMin: 4.0,
      firstOddsProductMax: 5.0,
    });
    expect(reasons).toContain('first_odds_sum_below_min');
    expect(reasons).toContain('first_odds_product_above_max');
  });
});

// ==================== groupSelections ====================

describe('bet-scheme-filters — groupSelections 分组', () => {
  it('按 matchId 分组', () => {
    const groups = groupSelections([
      { matchId: 'm1', selectionCode: 'home', odds: 1.8 },
      { matchId: 'm1', selectionCode: 'draw', odds: 3.5 },
      { matchId: 'm2', selectionCode: 'away', odds: 2.2 },
    ]);
    expect(Object.keys(groups).length).toBe(2);
    expect(groups['m1'].length).toBe(2);
    expect(groups['m2'].length).toBe(1);
  });

  it('忽略无 matchId 或无合法 selectionCode 的项', () => {
    const groups = groupSelections([
      { matchId: '', selectionCode: 'home' },
      { matchId: 'm1', selectionCode: '' },
      { matchId: 'm1', selectionCode: 'home', odds: 1.8 },
    ]);
    expect(Object.keys(groups).length).toBe(1);
    expect(groups['m1'].length).toBe(1);
  });
});

// ==================== estimateScheme ====================

describe('bet-scheme-filters — estimateScheme 方案估算', () => {
  it('单场比赛 单关 → ticketCount=1', () => {
    const sel = [{ matchId: 'm1', selectionCode: 'home', odds: 1.8 }];
    const est = estimateScheme(sel, ['single'], 1);
    expect(est.matchCount).toBe(1);
    expect(est.ticketCount).toBe(1);
    expect(est.amount).toBe(2); // 1 ticket × 2元 × 1倍
  });

  it('3场 3x1 → 正确计算', () => {
    // 3场比赛各1选，3x1过关，C(3,3)=1注
    const sel = [
      { matchId: 'm1', selectionCode: 'home', odds: 1.8 },
      { matchId: 'm2', selectionCode: 'home', odds: 1.9 },
      { matchId: 'm3', selectionCode: 'draw', odds: 3.2 },
    ];
    const est = estimateScheme(sel, ['3x1'], 2);
    expect(est.matchCount).toBe(3);
    // 3x1 = C(3,3) = 1 注（3场全选组成1注3串1）
    expect(est.ticketCount).toBe(1);
    expect(est.amount).toBe(4); // 1 ticket × 2元 × 2倍
    // maxBonus = 2 × multiplier × bestProduct = 2 × 2 × (1.9×1.8×3.2)
    expect(est.maxBonus).toBe(Math.round(2 * 2 * 1.9 * 1.8 * 3.2 * 100) / 100);
  });
});

// ==================== applySchemeFilters（集成） ====================

describe('bet-scheme-filters — applySchemeFilters 主入口', () => {
  function makeSelections(n) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const matchIdx = Math.floor(i / 3);
      const codes = ['home', 'draw', 'away'];
      list.push({
        matchId: 'm_' + String(matchIdx + 1).padStart(3, '0'),
        selectionId: 'sel_' + i,
        selectionCode: codes[i % 3],
        selectionName: { home: '主胜', draw: '平', away: '客胜' }[codes[i % 3]],
        matchNo: String(matchIdx + 1).padStart(3, '0'),
        odds: (1.6 + i * 0.2).toFixed(2),
        confidence: (0.9 - i * 0.08).toFixed(2),
        edgeValue: (0.2 - i * 0.03).toFixed(2),
        recommended: true,
        league: ['英超', '西甲', '德意', '法甲', '荷甲'][matchIdx % 5],
        leagueName: ['英超', '西甲', '德意', '法甲', '荷甲'][matchIdx % 5],
        context: { modelProbability: 0.6, fallback: false },
        contextJson: {},
      });
    }
    return list;
  }

  it('无筛选条件 → 保持所有选择', () => {
    const selections = makeSelections(9);
    const result = applySchemeFilters(selections, ['3x1'], {}, 1);
    expect(result.keptSelections.length).toBe(9);
    expect(result.droppedItems.length).toBe(0);
    expect(result.retentionRatio).toBe(1);
  });

  it('confidenceMin 过滤 → 丢弃低信度', () => {
    const selections = makeSelections(9);
    const result = applySchemeFilters(selections, ['3x1'], { confidenceMin: 0.7 }, 1);
    expect(result.keptSelections.length).toBeLessThan(9);
    expect(
      result.droppedItems.some(function (d) {
        return d.reasons.includes('confidence_below_min');
      }),
    ).toBe(true);
  });

  it('leagueWhitelist 过滤 → 仅保留指定联赛', () => {
    const selections = makeSelections(9);
    const result = applySchemeFilters(selections, ['single'], { leagueWhitelist: '英超,西甲' }, 1);
    result.keptSelections.forEach(function (s) {
      expect(['英超', '西甲']).toContain(s.league);
    });
  });

  it('maxSelectionPerMatch 限制 → 每场最多N选', () => {
    const selections = makeSelections(12); // 4场×3选
    const result = applySchemeFilters(selections, ['single'], { maxSelectionPerMatch: 2 }, 1);
    // 每场最多2选 → 4×2=8
    expect(result.keptSelections.length).toBeLessThanOrEqual(8);
  });

  it('maxTicketCount 限制 → 预算裁减', () => {
    const selections = makeSelections(9);
    const result = applySchemeFilters(selections, ['single'], { maxTicketCount: 4 }, 1);
    expect(result.afterSummary.ticketCount).toBeLessThanOrEqual(4);
  });

  it('maxAmount 限制 → 金额控制', () => {
    const selections = makeSelections(9);
    const result = applySchemeFilters(selections, ['single'], { maxAmount: 10 }, 1);
    expect(result.afterSummary.amount).toBeLessThanOrEqual(10);
  });

  it('value_gate 模式 → edge_only', () => {
    const selections = makeSelections(9);
    const result = applySchemeFilters(selections, ['single'], { valueGateMode: 'edge_only', valueEdgeMin: 0.15 }, 1);
    expect(
      result.ruleImpacts.some(function (r) {
        return r.rule === 'value_gate';
      }),
    ).toBe(true);
  });

  it('返回完整的筛选报告结构', () => {
    const selections = makeSelections(6);
    const result = applySchemeFilters(selections, ['2x1'], { confidenceMin: 0.5 }, 2);
    expect(result).toHaveProperty('filters');
    expect(result).toHaveProperty('beforeSummary');
    expect(result).toHaveProperty('afterSummary');
    expect(result).toHaveProperty('keptSelections');
    expect(result).toHaveProperty('droppedItems');
    expect(result).toHaveProperty('dropReasons');
    expect(result).toHaveProperty('retentionRatio');
    expect(result).toHaveProperty('ruleImpacts');
    expect(result).toHaveProperty('unknownFilters');
  });

  it('未知筛选字段 → 记录到 unknownFilters', () => {
    const selections = makeSelections(3);
    const result = applySchemeFilters(selections, ['single'], { unknownField: 'test', anotherUnknown: 42 }, 1);
    expect(result.unknownFilters).toContain('unknownField');
    expect(result.unknownFilters).toContain('anotherUnknown');
  });
});
