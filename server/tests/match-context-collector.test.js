/**
 * P2: match-context-collector.test.js — 比赛上下文采集器单元测试
 */
const {
  parsePlayer,
  parsePlayers,
  parseLineup,
  lineupHasValues,
  calcInjuryScore,
  injuryHasValues,
  parseSchedule,
  scheduleHasValues,
  extractPartialContext,
  mergeContext,
  contextHasLineup,
  contextHasInjury,
  contextHasSchedule,
  toAIPrompt,
  SOURCE_IDS,
  SOURCE_LABELS,
} = require('../core/match-context-collector');

// ─── parsePlayer ───
describe('match-context-collector — parsePlayer', () => {
  it('正常球员解析', () => {
    const p = parsePlayer({ player_name: '梅西', role: '前锋', starter: true, importance: 1.5 });
    expect(p.player_name).toBe('梅西');
    expect(p.role).toBe('前锋');
    expect(p.starter).toBe(true);
    expect(p.importance).toBe(1.5);
  });

  it('空输入 → null', () => {
    expect(parsePlayer(null)).toBe(null);
    expect(parsePlayer({})).toBe(null);
  });

  it('没有 player_name → null', () => {
    expect(parsePlayer({ role: 'MF' })).toBe(null);
  });

  it('别名键兼容: playerName/name/player', () => {
    expect(parsePlayer({ playerName: 'C罗' }).player_name).toBe('C罗');
    expect(parsePlayer({ name: '姆巴佩' }).player_name).toBe('姆巴佩');
    expect(parsePlayer({ player: '内马尔' }).player_name).toBe('内马尔');
  });

  it('importance 限制在 [0, 1.5]', () => {
    expect(parsePlayer({ player_name: 'T', importance: 2.5 }).importance).toBe(1.5);
    expect(parsePlayer({ player_name: 'T', importance: -0.5 }).importance).toBe(0);
  });

  it('默认 status 为 available, starter 为 false', () => {
    const p = parsePlayer({ player_name: 'Test' });
    expect(p.status).toBe('available');
    expect(p.starter).toBe(false);
  });
});

// ─── parsePlayers ───
describe('match-context-collector — parsePlayers', () => {
  it('批量解析球员列表', () => {
    const items = [
      { player_name: 'A' },
      { player_name: 'B' },
      { player: 'C' },
    ];
    const result = parsePlayers(items);
    expect(result.length).toBe(3);
    expect(result[0].player_name).toBe('A');
  });

  it('非数组 → 空数组', () => {
    expect(parsePlayers(null)).toEqual([]);
    expect(parsePlayers('not-array')).toEqual([]);
  });

  it('包含非法项的列表 → 过滤掉', () => {
    const items = [{ player_name: 'A' }, null, {}, { player_name: 'D' }];
    expect(parsePlayers(items).length).toBe(2);
  });
});

// ─── parseLineup ───
describe('match-context-collector — parseLineup / lineupHasValues', () => {
  it('空输入 → {}', () => {
    expect(parseLineup(null)).toEqual({});
    expect(parseLineup({}).confirmed).toBe(false);
  });

  it('正常阵容解析', () => {
    const lineup = parseLineup({
      confirmed: true,
      formation: '4-3-3',
      confirmed_starters: [{ player_name: 'GK' }],
      bench: [{ player_name: 'SUB' }],
    });
    expect(lineup.confirmed).toBe(true);
    expect(lineup.formation).toBe('4-3-3');
    expect(lineup.confirmed_starters.length).toBe(1);
    expect(lineup.bench.length).toBe(1);
  });

  it('continuity_from_prev 限制在 [0, 1]', () => {
    const l1 = parseLineup({ continuity_from_prev: 1.5 });
    expect(l1.continuity_from_prev).toBe(1.0);
    const l2 = parseLineup({ continuity_from_prev: -0.3 });
    expect(l2.continuity_from_prev).toBe(0);
  });

  it('lineupHasValues: 有首发 → true', () => {
    expect(lineupHasValues({ confirmed_starters: [{ name: 'A' }] })).toBe(true);
  });

  it('lineupHasValues: 空对象 → false', () => {
    expect(lineupHasValues({})).toBe(false);
    expect(lineupHasValues(null)).toBe(false);
  });

  it('lineupHasValues: 仅有 formation → true', () => {
    expect(lineupHasValues({ formation: '4-4-2' })).toBe(true);
  });
});

// ─── calcInjuryScore ───
describe('match-context-collector — calcInjuryScore', () => {
  it('空伤病 → 0', () => {
    expect(calcInjuryScore([], 'home')).toBe(0);
    expect(calcInjuryScore(null, 'home')).toBe(0);
  });

  it('核心球员 out → 高影响', () => {
    const injuries = [{ player_name: 'M', status: 'out', importance: 1.5, starter: true }];
    const score = calcInjuryScore(injuries, 'home');
    expect(score).toBe(1.5); // factor=1.0 * clamp(1.5, 0.2) = 1.5
  });

  it('questionable 球员 → 中等影响', () => {
    const injuries = [{ player_name: 'X', status: 'questionable', importance: 1.0 }];
    const score = calcInjuryScore(injuries, 'home');
    expect(score).toBeCloseTo(0.65, 1); // factor=0.65 * 1.0
  });

  it('probable 球员 → 较低影响', () => {
    const injuries = [{ player_name: 'Y', status: 'probable', importance: 1.0 }];
    const score = calcInjuryScore(injuries, 'home');
    expect(score).toBeCloseTo(0.4, 1); // factor=0.4 * 1.0
  });

  it('上限为 6.0', () => {
    const injuries = Array.from({ length: 10 }, function (_, i) {
      return { player_name: 'P' + i, status: 'out', importance: 1.5 };
    });
    const score = calcInjuryScore(injuries, 'home');
    expect(score).toBeLessThanOrEqual(6.0);
    expect(score).toBe(6.0);
  });

  it('injuryHasValues: 有伤病 → true', () => {
    expect(injuryHasValues([{ name: 'A' }])).toBe(true);
  });

  it('injuryHasValues: 空 → false', () => {
    expect(injuryHasValues([])).toBe(false);
  });
});

// ─── parseSchedule ───
describe('match-context-collector — parseSchedule / scheduleHasValues', () => {
  it('正常赛程解析', () => {
    const s = parseSchedule({ rest_days_override: 3, travel_distance_km: 200, cross_border: true });
    expect(s.rest_days_override).toBe(3);
    expect(s.travel_distance_km).toBe(200);
    expect(s.cross_border).toBe(true);
  });

  it('空输入 → {}', () => {
    expect(parseSchedule(null)).toEqual({});
    expect(parseSchedule({})).toEqual({});
  });

  it('scheduleHasValues: 有数据 → true', () => {
    expect(scheduleHasValues({ rest_days_override: 2 })).toBe(true);
  });

  it('scheduleHasValues: 空 → false', () => {
    expect(scheduleHasValues({})).toBe(false);
    expect(scheduleHasValues(null)).toBe(false);
  });
});

// ─── mergeContext ───
describe('match-context-collector — mergeContext', () => {
  it('空合并 → 返回默认上下文', () => {
    const result = mergeContext(null, {}, { matchId: 'm1' });
    expect(result.matchId).toBe('m1');
    expect(result.sourceType).toBe('real');
  });

  it('partial 覆盖 existing', () => {
    const existing = { homeLineup: { formation: '4-3-3' }, notes: ['old'] };
    const partial = { home_lineup: { formation: '3-5-2' }, notes: ['new'] };
    const result = mergeContext(existing, partial, { matchId: 'm-123' });
    expect(result.home_lineup.formation).toBe('3-5-2');
    expect(result.notes).toEqual(['old', 'new']);
  });

  it('notes 上限 20', () => {
    const partial = { notes: Array.from({ length: 25 }, function (_, i) { return 'note' + i; }) };
    const result = mergeContext(null, partial, {});
    expect(result.notes.length).toBeLessThanOrEqual(20);
  });
});

// ─── contextHasXXX ───
describe('match-context-collector — contextHas 检查', () => {
  it('contextHasLineup: 空 → false', () => {
    expect(contextHasLineup(null)).toBe(false);
    expect(contextHasLineup({})).toBe(false);
  });

  it('contextHasInjury: 空 → false', () => {
    expect(contextHasInjury(null)).toBe(false);
  });

  it('contextHasSchedule: 空 → false', () => {
    expect(contextHasSchedule(null)).toBe(false);
    expect(contextHasSchedule({})).toBe(false);
  });
});

// ─── toAIPrompt ───
describe('match-context-collector — toAIPrompt AI 提示文本', () => {
  it('null → 空字符串', () => {
    expect(toAIPrompt(null)).toBe('');
  });

  it('空上下文 → 空字符串', () => {
    const ctx = { home_lineup: {}, away_lineup: {} };
    expect(toAIPrompt(ctx)).toBe('');
  });

  it('有阵容 → 包含"阵容信息"', () => {
    const ctx = {
      home_lineup: { formation: '4-3-3', confirmed_starters: [{ player_name: 'A' }, { player_name: 'B' }] },
      away_lineup: {},
    };
    const text = toAIPrompt(ctx);
    expect(text).toContain('阵容信息');
    expect(text).toContain('A');
    expect(text).toContain('B');
  });

  it('有伤病 → 包含"伤病情报"', () => {
    const ctx = {
      home_injuries: [{ player_name: 'X', status: 'out', importance: 1.0 }],
    };
    const text = toAIPrompt(ctx);
    expect(text).toContain('伤病情报');
    expect(text).toContain('X');
  });

  it('有赛程 → 包含"赛程上下文"', () => {
    const ctx = {
      home_schedule: { rest_days_override: 5 },
    };
    const text = toAIPrompt(ctx);
    expect(text).toContain('赛程上下文');
    expect(text).toContain('5');
  });
});

// ─── 常量 ───
describe('match-context-collector — 常量', () => {
  it('SOURCE_IDS 包含 lineup/injury/schedule', () => {
    expect(SOURCE_IDS).toContain('lineup');
    expect(SOURCE_IDS).toContain('injury');
    expect(SOURCE_IDS).toContain('schedule');
  });

  it('SOURCE_LABELS 有中文标签', () => {
    expect(SOURCE_LABELS.lineup).toBe('阵容信息');
    expect(SOURCE_LABELS.injury).toBe('伤病情报');
    expect(SOURCE_LABELS.schedule).toBe('赛程上下文');
  });
});
