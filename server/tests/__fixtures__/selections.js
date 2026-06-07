/**
 * selections.js — 投注选择 (selection) 测试数据工厂
 * 为 bet-scheme-filters、shadow-account 等模块提供标准 fixture
 */

/**
 * 创建单个选择项
 */
function makeSelection(overrides) {
  return Object.assign({
    matchId: 'm_001',
    selectionId: 'sel_001',
    selectionCode: 'home',
    selectionName: '主胜',
    matchNo: '001',
    num: '001',
    odds: 1.85,
    confidence: 0.72,
    edgeValue: 0.12,
    edge_value: null,
    recommended: true,
    league: '英超',
    leagueName: '英超',
    context: { modelProbability: 0.65, confidenceCalibrated: 0.58, fallback: false },
    contextJson: null,
    kickoffAt: '2026-06-04T19:30:00',
    startTime: '2026-06-04 19:30:00',
  }, overrides || {});
}

/**
 * 创建多场比赛的选择列表
 */
function makeSelectionList(count, options) {
  options = options || {};
  const leagues = ['英超', '西甲', '德甲', '意甲', '法甲'];
  const codes = ['home', 'draw', 'away'];
  const list = [];
  for (let i = 0; i < count; i++) {
    const matchIdx = Math.floor(i / 3);
    list.push(makeSelection({
      matchId: options.matchIdPrefix + '_' + String(matchIdx + 1).padStart(3, '0') || 'm_' + String(matchIdx + 1).padStart(3, '0'),
      selectionId: 'sel_' + String(i + 1).padStart(3, '0'),
      selectionCode: codes[i % 3],
      selectionName: { home: '主胜', draw: '平', away: '客胜' }[codes[i % 3]],
      matchNo: String(matchIdx + 1).padStart(3, '0'),
      odds: (1.5 + (i * 0.3)).toFixed(2),
      confidence: (0.8 - (i * 0.05)).toFixed(2),
      league: leagues[matchIdx % leagues.length],
      leagueName: leagues[matchIdx % leagues.length],
    }));
  }
  return list;
}

/**
 * 创建模拟投注方案 (scheme)
 */
function makeScheme(overrides) {
  return Object.assign({
    schemeId: 'scheme_test_001',
    matchCount: 3,
    selections: makeSelectionList(5),
    passway: '3x1',
    multiplier: 1,
    amount: 2,
    maxBonus: 150.00,
  }, overrides || {});
}

module.exports = {
  makeSelection,
  makeSelectionList,
  makeScheme,
};
