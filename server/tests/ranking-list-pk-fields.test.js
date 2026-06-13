const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.js');
const PK_SCORER_FILE = path.join(__dirname, '..', 'pk_scorer.js');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M4 ranking-list PK 标准字段合同', () => {
  const indexSource = src(INDEX_FILE);
  const pkSource = src(PK_SCORER_FILE);

  it('ranking-list 构建并合并 PK 裁判字段', () => {
    expect(indexSource).toContain('function buildPKDecisionMapForMatches');
    expect(indexSource).toContain('const pkDecisionMap = buildPKDecisionMapForMatches(matches);');
    expect(indexSource).toContain('...pkDecision');
  });

  it('ranking-list 响应包含 M2 标准字段', () => {
    [
      'playType',
      'finalDirection',
      'decisionLevel',
      'riskLevel',
      'riskTags',
      'degradeReasons',
      'decisionNarrative',
      'finalDecision',
    ].forEach((field) => {
      expect(indexSource).toContain(field);
    });
  });

  it('PK GS 字段加载兼容 m_ 前缀与裸 matchId', () => {
    expect(pkSource).toContain("gsMap['m_' + cleanId]");
    expect(pkSource).toContain('gsMap[cleanId]');
  });
});
