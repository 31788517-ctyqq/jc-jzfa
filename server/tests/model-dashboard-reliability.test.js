const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.js');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M6 model-dashboard 可靠性排行合同', () => {
  const source = src(INDEX_FILE);

  it('服务端构建可靠性排行而不是单一命中率排行', () => {
    expect(source).toContain('function enrichModelReliability');
    expect(source).toContain('reliabilityScore');
    expect(source).toContain('stabilityScore');
    expect(source).toContain('calibrationStatus');
    expect(source).toContain('eligibleForRanking');
  });

  it('model-dashboard 响应包含玩法矩阵、可靠性摘要和只读权重建议', () => {
    expect(source).toContain('buildModelPlayMatrix');
    expect(source).toContain('buildModelReliabilitySummary');
    expect(source).toContain('buildReadOnlyWeightSuggestions');
    expect(source).toContain('playMatrix');
    expect(source).toContain('reliabilitySummary');
    expect(source).toContain('weightSuggestions');
  });

  it('样本不足模型必须明确标记', () => {
    expect(source).toContain('样本不足，仅供观察');
    expect(source).toContain('sampleStatus');
    expect(source).toContain('sample_insufficient');
  });

  it('权重建议必须为只读，不自动覆盖生产规则', () => {
    expect(source).toContain('只读建议：基于可靠性评分，不自动覆盖生产规则');
    expect(source).not.toContain('updateModelWeights(');
    expect(source).not.toContain('writeProductionWeights(');
  });
});
