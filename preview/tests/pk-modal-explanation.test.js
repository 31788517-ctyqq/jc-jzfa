const fs = require('fs');
const path = require('path');

const PREVIEW_DIR = path.join(__dirname, '..');

function readPreview(file) {
  return fs.readFileSync(path.join(PREVIEW_DIR, file), 'utf8');
}

describe('M3 PK 弹窗解释区合同', () => {
  const fusionSource = readPreview('js/pages/match-pk-fusion.js');
  const appCss = readPreview('css/app.css');
  const modalsCss = readPreview('css/modals.css');

  it('PK 弹窗应包含裁判解释区和模型对比渲染函数', () => {
    expect(fusionSource).toContain('renderDecisionExplanationPanel');
    expect(fusionSource).toContain('renderSourceComparisonRows');
    expect(fusionSource).toContain('PK裁判解释');
    expect(fusionSource).toContain('pk3-decision-panel');
    expect(fusionSource).toContain('pk3-model-compare');
  });

  it('方向建议应输出 M2/M3 标准字段兜底', () => {
    expect(fusionSource).toContain('applyStandardDecisionFields');
    expect(fusionSource).toContain('decisionLevel');
    expect(fusionSource).toContain('riskTags');
    expect(fusionSource).toContain('degradeReasons');
    expect(fusionSource).toContain('decisionNarrative');
    expect(fusionSource).toContain('finalDecision');
  });

  it('弹窗应展示外部信号缺失不阻断的说明', () => {
    expect(fusionSource).toContain('专家数据未接入本弹窗，不阻断 PK 结论');
    expect(fusionSource).toContain('AI 风险未接入本弹窗，不阻断基础判断');
    expect(fusionSource).toContain('市场数据待补充');
  });

  it('M3 样式应同时存在于 app.css 与 modals.css，裁判卡不是深灰禁用态', () => {
    ['.pk3-decision-panel', '.pk3-decision-card', '.pk3-decision-narrative', '.pk3-model-row'].forEach(
      function (selector) {
        expect(appCss).toContain(selector);
        expect(modalsCss).toContain(selector);
      },
    );
    [appCss, modalsCss].forEach(function (code) {
      expect(code).toContain('rgba(255, 255, 255, 0.74)');
      expect(code).not.toContain('background: rgba(7, 21, 38, 0.42);');
    });
  });
});
