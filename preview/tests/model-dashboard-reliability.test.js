const fs = require('fs');
const path = require('path');

const DASHBOARD = path.join(__dirname, '..', 'js', 'pages', 'model-dashboard.js');
const APP_CSS = path.join(__dirname, '..', 'css', 'app.css');

function src(file) {
  return fs.readFileSync(file, 'utf8');
}

describe('M6 模型仪表盘可靠性页面合同', () => {
  const code = src(DASHBOARD);
  const css = src(APP_CSS);

  it('页面包含可靠性摘要、可靠性排行、玩法矩阵和只读权重建议', () => {
    expect(code).toContain('buildReliabilitySummary');
    expect(code).toContain('可靠性排行');
    expect(code).toContain('玩法矩阵');
    expect(code).toContain('权重建议（只读）');
  });

  it('排行展示样本、ROI、稳定性和校准状态', () => {
    expect(code).toContain('reliabilityScore');
    expect(code).toContain('fmtROI');
    expect(code).toContain('stabilityScore');
    expect(code).toContain('calibrationStatus');
    expect(code).toContain('sampleStatus');
  });

  it('玩法矩阵包含 SPF、让球、大小球、比分', () => {
    expect(code).toContain("['spf', 'SPF']");
    expect(code).toContain("['handicap', '让球']");
    expect(code).toContain("['overUnder', '大小球']");
    expect(code).toContain("['score', '比分']");
  });

  it('样本不足和只读建议有明确文案', () => {
    expect(code).toContain('样本不足');
    expect(code).toContain('动态权重仅作只读建议，不自动覆盖生产规则');
    expect(code).toContain('样本不足时不生成生产权重');
  });

  it('新增样式存在且可靠性摘要不能使用深灰禁用态底色', () => {
    expect(css).toContain('.md-reliability-summary');
    expect(css).toContain('.md-play-matrix');
    expect(css).toContain('.md-weight-list');
    expect(css).toContain('.md-rank-row .md-rank-col-model em');
    expect(css).toContain('rgba(255, 255, 255, 0.78)');
    expect(css).not.toContain(
      '.md-reliability-summary {\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 8px;\n  margin: 0 0 12px;\n  padding: 10px;\n  border-radius: 16px;\n  background: rgba(7, 21, 38, 0.42);',
    );
  });
});
