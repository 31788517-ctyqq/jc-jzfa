const fs = require('fs');
const path = require('path');

const PREDICTION_LOG = path.join(__dirname, '..', 'prediction_log.js');
const INDEX_FILE = path.join(__dirname, '..', 'index.js');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M5 prediction-backtest PK 裁判验证合同', () => {
  const predictionLog = src(PREDICTION_LOG);
  const indexSource = src(INDEX_FILE);

  it('queryBacktest 支持决策等级、风险等级、EV 筛选', () => {
    expect(predictionLog).toContain('filters.decisionLevel');
    expect(predictionLog).toContain('filters.riskLevel');
    expect(predictionLog).toContain('filters.evRange');
    expect(indexSource).toContain('decisionLevel: data.decisionLevel');
    expect(indexSource).toContain('riskLevel: data.riskLevel');
    expect(indexSource).toContain('evRange: data.evRange');
  });

  it('回测行补齐 PK 裁判复盘字段', () => {
    [
      'pk_final_direction',
      'pk_decision_level',
      'pk_risk_level',
      'pk_risk_tags',
      'pk_degrade_reasons',
      'pk_decision_narrative',
      'pk_selected_ev',
      'pk_judge_hit',
      'pk_unit_roi',
    ].forEach((field) => expect(predictionLog).toContain(field));
  });

  it('stats.pk.judge 包含决策等级、正 EV、观望避坑、降级规则', () => {
    expect(predictionLog).toContain('function _buildPKJudgeStats');
    expect(predictionLog).toContain('byDecisionLevel');
    expect(predictionLog).toContain('positiveEV');
    expect(predictionLog).toContain('watchAvoidance');
    expect(predictionLog).toContain('degrade');
    expect(predictionLog).toContain('judge: _buildPKJudgeStats(list)');
  });

  it('prediction-backtest 缓存 key 包含新增筛选项', () => {
    expect(indexSource).toContain("(data.decisionLevel || 'all')");
    expect(indexSource).toContain("(data.riskLevel || 'all')");
    expect(indexSource).toContain("(data.evRange || 'all')");
  });
});
