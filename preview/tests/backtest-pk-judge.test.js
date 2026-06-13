const fs = require('fs');
const path = require('path');

const BACKTEST = path.join(__dirname, '..', 'js', 'pages', 'backtest.js');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M5 回测页 PK 裁判验证合同', () => {
  const code = src(BACKTEST);

  it('PK 页签升级为 PK 裁判验证', () => {
    expect(code).toContain('PK裁判验证');
    expect(code).toContain('btPKJudgePanel');
  });

  it('筛选项包含决策等级、风险等级、EV 区间', () => {
    expect(code).toContain('dd-btDecision');
    expect(code).toContain('dd-btRisk');
    expect(code).toContain('dd-btEV');
    expect(code).toContain('decisionLevel: f.decisionLevel');
    expect(code).toContain('riskLevel: f.riskLevel');
    expect(code).toContain('evRange: f.evRange');
  });

  it('PK 统计包含主推 ROI、正 EV 和观望避坑，且卡片不是深灰禁用态', () => {
    expect(code).toContain('pkMainROI');
    expect(code).toContain('pkPositiveEVROI');
    expect(code).toContain('pkWatchAvoid');
    expect(code).toContain('renderPKJudgeOverview');
    expect(code).toContain('positiveEV');
    expect(code).toContain('watchAvoidance');
    expect(code).toContain('rgba(255,255,255,.72)');
    expect(code).not.toContain('background:rgba(7,21,38,.42)');
  });

  it('PK 明细展示赛前裁判快照和赛后结果', () => {
    expect(code).toContain('renderPKSnapshot');
    expect(code).toContain('赛前裁判');
    expect(code).toContain('赛后结果');
    expect(code).toContain('pk_decision_narrative');
    expect(code).toContain('pk_degrade_reasons');
    expect(code).toContain('pk_risk_tags');
  });

  it('图表包含决策等级命中率和 ROI', () => {
    expect(code).toContain('pkDecisionOption');
    expect(code).toContain('决策等级');
    expect(code).toContain("legend: { data: ['命中率', 'ROI'] }");
  });
});
