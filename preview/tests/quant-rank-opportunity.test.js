const fs = require('fs');
const path = require('path');

const FUSION_FILE = path.join(__dirname, '..', 'js', 'pages', 'quant-rank-fusion.js');
const LEGACY_FILE = path.join(__dirname, '..', 'js', 'pages', 'quant-rank.js');
const MAIN_FUSION = path.join(__dirname, '..', 'js', 'main-fusion.js');
const APP_CSS = path.join(__dirname, '..', 'css', 'app.css');
const MODALS_CSS = path.join(__dirname, '..', 'css', 'modals.css');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M4 量化排行榜机会分层合同', () => {
  const fusion = src(FUSION_FILE);
  const legacy = src(LEGACY_FILE);
  const mainFusion = src(MAIN_FUSION);
  const appCss = src(APP_CSS);
  const modalsCss = src(MODALS_CSS);

  it('fusion 与 legacy 都支持机会分层切换', () => {
    [fusion, legacy].forEach((code) => {
      expect(code).toContain('export function switchQuantOpportunity');
      expect(code).toContain('opportunityFilter');
      expect(code).toContain('q-opportunity-summary');
      expect(code).toContain('q-opportunity-tab');
    });
  });

  it('排行榜透出 PK 裁判标准字段', () => {
    [fusion, legacy].forEach((code) => {
      expect(code).toContain('decisionLevel');
      expect(code).toContain('finalDirection');
      expect(code).toContain('riskTags');
      expect(code).toContain('degradeReasons');
      expect(code).toContain('decisionNarrative');
    });
  });

  it('每行展示决策徽章和风险标签', () => {
    [fusion, legacy].forEach((code) => {
      expect(code).toContain('renderDecisionBadge');
      expect(code).toContain('renderRiskChips');
      expect(code).toContain('q-decision-badge');
      expect(code).toContain('q-risk-chips');
      expect(code).toContain('低风险');
    });
  });

  it('主入口注册 switchQuantOpportunity', () => {
    expect(mainFusion).toContain('window.switchQuantOpportunity');
  });

  it('样式覆盖 app.css 与 modals.css，机会摘要不是深灰禁用态', () => {
    [appCss, modalsCss].forEach((code) => {
      expect(code).toContain('.q-opportunity-summary');
      expect(code).toContain('.q-decision-badge');
      expect(code).toContain('.q-risk-chips');
      expect(code).toContain('.q-decision-watch');
      expect(code).toContain('rgba(255, 255, 255, 0.74)');
      expect(code).not.toContain('background: rgba(7, 21, 38, 0.44);');
    });
  });
});
