/**
 * P1: odds-tracker.test.js — 赔率变化追踪 单元测试
 * 覆盖: detectChanges/appendDeltaLog/getDeltaHistory/getAllDeltaLogs/cleanupOldDeltas
 *
 * ★ 使用 fs mock (__mocks__/fs.js) 模拟文件系统
 */
jest.mock('fs');
const fs = require('fs');

// 辅助：创建赔率快照
function makeOdds(overrides) {
  return Object.assign(
    {
      spf: { home: 2.1, draw: 3.3, away: 3.2 },
      rqspf: { home: 4.5, draw: 3.8, away: 1.6 },
      halfFull: {
        hh: 2.8,
        hd: 5.5,
        ha: 15.0,
        dh: 4.2,
        dd: 4.8,
        da: 5.0,
        ah: 25.0,
        ad: 12.0,
        aa: 7.0,
      },
      totalGoals: { 0: 13, 1: 5.25, 2: 3.5, 3: 3.0, 4: 5.3, 5: 10, 6: 25, 7: 50 },
      scores: {
        '1:0': 7.0,
        '2:0': 8.0,
        '2:1': 8.5,
        '0:0': 10,
        '1:1': 6.5,
        '0:1': 12,
        '0:2': 25,
        '1:2': 20,
      },
    },
    overrides || {},
  );
}

// ═══ 在每个测试前重置 fs mock ═══

describe('odds-tracker — detectChanges 变化检测', () => {
  const { detectChanges } = require('../core/odds-tracker');

  it('完全相同的赔率 → 返回 null', () => {
    const odds = makeOdds();
    const result = detectChanges(odds, odds, '周一001');
    expect(result).toBe(null);
  });

  it('SPF 赔率变化 → 返回变化记录', () => {
    const oldOdds = makeOdds();
    const newOdds = makeOdds({ spf: { home: 2.0, draw: 3.5, away: 3.5 } });
    const result = detectChanges(oldOdds, newOdds, '周一001');
    expect(result).not.toBe(null);
    // key 包含点号，使用直接属性访问
    expect(result['spf.home']).toBeDefined();
  });

  it('totalGoals 变化 → 检测到', () => {
    const oldOdds = makeOdds();
    const newOdds = makeOdds({ totalGoals: { 0: 15, 1: 5.5, 2: 3.3, 3: 3.1, 4: 5.3, 5: 10, 6: 25, 7: 50 } });
    const result = detectChanges(oldOdds, newOdds, '周一002');
    expect(result).not.toBe(null);
    // 变化超过 0.001 的字段至少有一个
    expect(Object.keys(result).length).toBeGreaterThan(0);
  });

  it('halfFull 比分赔率变化 → 检测到', () => {
    const oldOdds = makeOdds();
    const newOdds = makeOdds({ halfFull: Object.assign({}, oldOdds.halfFull, { hh: 3.5 }) });
    const result = detectChanges(oldOdds, newOdds, '周一003');
    expect(result).not.toBe(null);
    expect(result['halfFull.hh']).toBeDefined();
  });

  it('scores 比分变化 → 检测到', () => {
    const oldOdds = makeOdds();
    const newOdds = makeOdds({
      scores: Object.assign({}, oldOdds.scores, { '1:0': 6.0, '2:0': 7.0 }),
    });
    const result = detectChanges(oldOdds, newOdds, '周一004');
    expect(result).not.toBe(null);
    // scores 包含冒号键名，直接属性访问
    expect(result['scores.1:0']).toBeDefined();
  });

  it('oldOdds 为 null → 返回 null', () => {
    const result = detectChanges(null, makeOdds(), '周一005');
    expect(result).toBe(null);
  });

  it('变化值记录格式为 "旧值→新值"', () => {
    const oldOdds = makeOdds();
    const newOdds = makeOdds({ spf: { home: 2.0, draw: 3.3, away: 3.2 } });
    const result = detectChanges(oldOdds, newOdds, '周一006');
    const val = result['spf.home'];
    expect(val).toContain('→');
    expect(val).toContain('2.10');
    expect(val).toContain('2.00');
  });
});

describe('odds-tracker — appendDeltaLog / getDeltaHistory', () => {
  const { appendDeltaLog, getDeltaHistory, getAllDeltaLogs } = require('../core/odds-tracker');

  // 重置 mock fs
  beforeEach(function () {
    if (fs.resetMockFs) fs.resetMockFs();
  });

  const oddsDir = '/mock/odds_history';

  it('appendDeltaLog → 写入 JSONL 文件', () => {
    appendDeltaLog(oddsDir, '2026-06-01', '周一001', { 'spf.home': '2.10→2.00' });
    const history = getDeltaHistory(oddsDir, '2026-06-01', '周一001');
    expect(history.length).toBe(1);
    expect(history[0].num).toBe('周一001');
    expect(history[0].changes['spf.home']).toBeDefined();
  });

  it('appendDeltaLog → 多次追加', () => {
    appendDeltaLog(oddsDir, '2026-06-01', '周一001', { 'spf.home': '2.10→2.00' });
    appendDeltaLog(oddsDir, '2026-06-01', '周一001', { 'spf.home': '2.00→1.90' });
    const history = getDeltaHistory(oddsDir, '2026-06-01', '周一001');
    expect(history.length).toBe(2);
  });

  it('getDeltaHistory → 不存在的文件 → 空数组', () => {
    const history = getDeltaHistory(oddsDir, '2026-06-02', '周一002');
    expect(history).toEqual([]);
  });

  it('getDeltaHistory → 仅返回匹配的 matchNum', () => {
    appendDeltaLog(oddsDir, '2026-06-03', '周一001', { 'spf.home': '2.10→2.00' });
    appendDeltaLog(oddsDir, '2026-06-03', '周一002', { 'spf.home': '1.80→1.70' });
    const history = getDeltaHistory(oddsDir, '2026-06-03', '周一001');
    expect(history.length).toBe(1);
    expect(history[0].num).toBe('周一001');
  });

  it('getAllDeltaLogs → 返回所有记录', () => {
    appendDeltaLog(oddsDir, '2026-06-04', '周一001', { 'spf.home': '2.00→1.90' });
    appendDeltaLog(oddsDir, '2026-06-04', '周一002', { 'spf.draw': '3.50→3.40' });
    const all = getAllDeltaLogs(oddsDir, '2026-06-04');
    expect(all.length).toBe(2);
  });
});

describe('odds-tracker — cleanupOldDeltas 清理过期日志', () => {
  const { appendDeltaLog, cleanupOldDeltas } = require('../core/odds-tracker');

  beforeEach(function () {
    if (fs.resetMockFs) fs.resetMockFs();
  });

  const oddsDir = '/mock/odds_history';

  it('无 delta 文件 → 返回 0', () => {
    const result = cleanupOldDeltas(oddsDir);
    expect(result).toBe(0);
  });

  it('新文件 → 不清理', () => {
    const today = new Date().toISOString().slice(0, 10);
    appendDeltaLog(oddsDir, today, '周一001', { 'spf.home': '2.10→2.00' });
    const result = cleanupOldDeltas(oddsDir, 30);
    expect(result).toBe(0);
  });
});
