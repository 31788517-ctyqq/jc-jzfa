/**
 * P1: market-overlay.test.js — 市场叠加证据系统 单元测试
 * 覆盖: buildEvidenceRow/parseScoreExplain/ensureScoreFields/hasOffFieldEvidence
 *       inferOverlayScores/aggregateScores/compareOverlayScore
 */
const {
  OVERLAY_SCORE_FIELDS, FIELD_LABELS, FIELD_CATEGORIES,
  buildEvidenceRow, parseScoreExplain, ensureScoreFields,
  hasOffFieldEvidence, inferOverlayScores, aggregateScores,
  compareOverlayScore, getCategoryLabel,
} = require('../core/market-overlay');

// ==================== 常量 ====================

describe('market-overlay — 常量', () => {
  it('OVERLAY_SCORE_FIELDS 有15个字段', () => {
    expect(OVERLAY_SCORE_FIELDS.length).toBe(15);
  });

  it('FIELD_LABELS 映射15个中文标签', () => {
    expect(Object.keys(FIELD_LABELS).length).toBe(15);
    expect(FIELD_LABELS.basic_lineup_strength).toBe('阵容强度');
  });

  it('FIELD_CATEGORIES 有5个分类', () => {
    expect(Object.keys(FIELD_CATEGORIES).length).toBe(5);
    expect(FIELD_CATEGORIES.basic.length).toBe(3);
    expect(FIELD_CATEGORIES.market.length).toBe(3);
  });

  it('getCategoryLabel 返回中文标签', () => {
    expect(getCategoryLabel('basic')).toBe('基础面');
    expect(getCategoryLabel('market')).toBe('市场面');
  });
});

// ==================== buildEvidenceRow ====================

describe('market-overlay — buildEvidenceRow 证据行构建', () => {
  it('source 为空 → 返回 null', () => {
    expect(buildEvidenceRow({ source: '' })).toBe(null);
    expect(buildEvidenceRow({ source: null })).toBe(null);
  });

  it('正常参数 → 构建完整证据行', () => {
    const row = buildEvidenceRow({
      source: 'offfield.injury',
      value: '主力前锋伤缺',
      capturedAt: '2026-06-04T12:00:00Z',
      requestId: 'req-001',
      ruleVersion: 'v1',
    });
    expect(row).not.toBe(null);
    expect(row.source).toBe('offfield.injury');
    expect(row.value).toBe('主力前锋伤缺');
    expect(row.source_hash).toBeDefined();
    expect(row.rule_version).toBe('v1');
  });

  it('value 超过160字符 → 截断', () => {
    const longVal = 'x'.repeat(200);
    const row = buildEvidenceRow({ source: 'test', value: longVal });
    expect(row.value.length).toBeLessThanOrEqual(160);
  });

  it('默认值填充', () => {
    const row = buildEvidenceRow({ source: 'ctx.default' });
    expect(row.rule_version).toBeDefined();
    expect(row.captured_at).toBeDefined();
    expect(row.request_id).toBeDefined();
    expect(row.source_hash).toBeDefined();
  });
});

// ==================== parseScoreExplain ====================

describe('market-overlay — parseScoreExplain 解析评分解释', () => {
  it('字符串 JSON → 解析成功', () => {
    const raw = JSON.stringify({
      basic_lineup_strength: {
        explain_text: '阵容完整',
        confidence: 0.85,
        evidence: [{ source: 'lineup.api', value: '主力全出' }],
      },
    });
    const result = parseScoreExplain(raw);
    expect(result.basic_lineup_strength).toBeDefined();
    expect(result.basic_lineup_strength.explain_text).toBe('阵容完整');
  });

  it('对象输入 → 直接解析', () => {
    const payload = {
      basic_coach_ability: {
        explainText: '经验丰富',
        confidence: 0.9,
      },
    };
    const result = parseScoreExplain(payload);
    expect(result.basic_coach_ability.explain_text).toBe('经验丰富');
  });

  it('非法 JSON → 空对象', () => {
    expect(parseScoreExplain('invalid')).toEqual({});
  });

  it('null 输入 → 空对象', () => {
    expect(parseScoreExplain(null)).toEqual({});
  });

  it('非对象输入 → 空对象', () => {
    expect(parseScoreExplain(42)).toEqual({});
  });
});

// ==================== ensureScoreFields ====================

describe('market-overlay — ensureScoreFields 确保15维字段', () => {
  it('空输入 → 补齐15个字段', () => {
    const result = ensureScoreFields({});
    expect(Object.keys(result).length).toBe(15);
    result && Object.values(result).forEach(function (entry) {
      expect(entry).toHaveProperty('explain_text');
      expect(entry).toHaveProperty('evidence');
      expect(entry).toHaveProperty('confidence');
      expect(entry).toHaveProperty('updated_by');
    });
  });

  it('部分字段已有值 → 保留', () => {
    const payload = {
      basic_lineup_strength: {
        explain_text: '阵容优势',
        confidence: 0.8,
        updated_by: 'analyst',
      },
    };
    const result = ensureScoreFields(payload);
    expect(result.basic_lineup_strength.explain_text).toBe('阵容优势');
    expect(result.basic_lineup_strength.confidence).toBe(0.8);
  });
});

// ==================== hasOffFieldEvidence ====================

describe('market-overlay — hasOffFieldEvidence', () => {
  it('无证据 → false', () => {
    expect(hasOffFieldEvidence(null)).toBe(false);
    expect(hasOffFieldEvidence({})).toBe(false);
  });

  it('有 offfield 证据 → true', () => {
    const entry = {
      evidence: [{ source: 'offfield.injury', value: '伤停' }],
    };
    expect(hasOffFieldEvidence(entry)).toBe(true);
  });

  it('非 offfield 证据 → false', () => {
    const entry = {
      evidence: [{ source: 'api.stats', value: '场均2球' }],
    };
    expect(hasOffFieldEvidence(entry)).toBe(false);
  });

  it('offfield 证据但 value 为 "-" → false', () => {
    const entry = {
      evidence: [{ source: 'offfield.news', value: '-' }],
    };
    expect(hasOffFieldEvidence(entry)).toBe(false);
  });
});

// ==================== inferOverlayScores ====================

describe('market-overlay — inferOverlayScores 评分推断', () => {
  it('空输入 → 返回默认评分', () => {
    const scores = inferOverlayScores({}, {});
    expect(Object.keys(scores).length).toBe(15);
    Object.values(scores).forEach(function (v) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(95);
    });
  });

  it('strong 共识 → 教练能力=75', () => {
    const scores = inferOverlayScores({ fusionConsensus: 'strong' }, {});
    expect(scores.basic_coach_ability).toBe(75);
  });

  it('weak 共识 → 教练能力=50', () => {
    const scores = inferOverlayScores({ fusionConsensus: 'weak' }, {});
    expect(scores.basic_coach_ability).toBe(50);
  });

  it('高 heatIndex → 陷阱风险较高', () => {
    const highHeat = inferOverlayScores({ heatIndex: 2.0 }, {});
    const lowHeat = inferOverlayScores({ heatIndex: 0.6 }, {});
    expect(highHeat.market_trap_risk).toBeGreaterThan(lowHeat.market_trap_risk);
  });

  it('pwScore 影响对阵面评分', () => {
    const strong = inferOverlayScores({ pwScore: 1.0 }, {});
    const neutral = inferOverlayScores({ pwScore: 0 }, {});
    expect(strong.matchup_tempo_control).toBeGreaterThanOrEqual(neutral.matchup_tempo_control);
  });
});

// ==================== aggregateScores ====================

describe('market-overlay — aggregateScores 综合评估', () => {
  function makeScores(base) {
    const s = {};
    OVERLAY_SCORE_FIELDS.forEach(function (f) { s[f] = base || 50; });
    return s;
  }

  it('所有50 → total=50', () => {
    const result = aggregateScores(makeScores(50));
    expect(result.total).toBe(50);
    expect(Object.keys(result.categories).length).toBe(5);
  });

  it('高基础面评分 → basic 分类高', () => {
    const scores = makeScores(50);
    scores.basic_lineup_strength = 90;
    scores.basic_tactics_maturity = 85;
    scores.basic_coach_ability = 80;
    const result = aggregateScores(scores);
    expect(result.categories.basic.score).toBeGreaterThan(50);
  });

  it('返回 fieldScores', () => {
    const result = aggregateScores(makeScores(60));
    expect(Object.keys(result.fieldScores).length).toBe(15);
  });

  it('返回 overlayVersion', () => {
    const result = aggregateScores(makeScores());
    expect(result.overlayVersion).toBeDefined();
  });
});

// ==================== compareOverlayScore ====================

describe('market-overlay — compareOverlayScore 主客对比', () => {
  function makeScores(base) {
    const s = {};
    OVERLAY_SCORE_FIELDS.forEach(function (f) { s[f] = base || 50; });
    return s;
  }

  it('主客相同 → overallAdvantage=neutral', () => {
    const result = compareOverlayScore(makeScores(50), makeScores(50));
    expect(result.overallAdvantage).toBe('neutral');
    expect(result.totalDiff).toBe(0);
  });

  it('主队优势 (diff>5) → overallAdvantage=home', () => {
    const home = makeScores(70);
    const away = makeScores(50);
    const result = compareOverlayScore(home, away);
    expect(result.overallAdvantage).toBe('home');
    expect(result.totalDiff).toBeGreaterThan(5);
  });

  it('客队优势 (diff<-5) → overallAdvantage=away', () => {
    const home = makeScores(40);
    const away = makeScores(60);
    const result = compareOverlayScore(home, away);
    expect(result.overallAdvantage).toBe('away');
    expect(result.totalDiff).toBeLessThan(-5);
  });

  it('返回逐字段对比', () => {
    const result = compareOverlayScore(makeScores(60), makeScores(45));
    expect(Object.keys(result.fieldComparison).length).toBe(15);
    expect(result.fieldComparison.basic_lineup_strength).toHaveProperty('home');
    expect(result.fieldComparison.basic_lineup_strength).toHaveProperty('away');
    expect(result.fieldComparison.basic_lineup_strength).toHaveProperty('diff');
    expect(result.fieldComparison.basic_lineup_strength).toHaveProperty('advantage');
  });

  it('包含聚合对象', () => {
    const result = compareOverlayScore(makeScores(55), makeScores(55));
    expect(result).toHaveProperty('homeAggregation');
    expect(result).toHaveProperty('awayAggregation');
    expect(result.homeAggregation).toHaveProperty('total');
    expect(result.awayAggregation).toHaveProperty('total');
  });
});
