const fs = require('fs');
const path = require('path');

const PREVIEW_DIR = path.join(__dirname, '..');

function readPreview(file) {
  return fs.readFileSync(path.join(PREVIEW_DIR, file), 'utf8');
}

describe('首页最小增强方案 B 合同', () => {
  const indexHtml = readPreview('index.html');
  const homeJs = readPreview('js/pages/home.js');
  const appCss = readPreview('css/app.css');

  it('首页包含顶部轻量摘要且不出现老鹰智选字样', () => {
    expect(indexHtml).toContain('id="homeTodayBrief"');
    expect(indexHtml).toContain('今日 0 场｜机会 0');
    expect(indexHtml).not.toContain('老鹰智选');
  });

  it('最多推荐和最热场次模块保持原结构与点击逻辑', () => {
    expect(indexHtml).toContain('<div class="home-stat-title">最多推荐</div>');
    expect(indexHtml).toContain('<div class="home-stat-title">最热场次</div>');
    expect(indexHtml).toContain('onclick="switchTab(\'rank\')"');
    expect(indexHtml).toContain('onclick="goHomeHottestMatch()"');
    expect(indexHtml).toContain('id="homeMaxRank"');
    expect(indexHtml).toContain('id="homeHottest"');
  });

  it('首页摘要由 home.js 渲染今日场次、机会数和条件风险数', () => {
    expect(homeJs).toContain('function updateHomeTodayBrief');
    expect(homeJs).toContain("'今日 '");
    expect(homeJs).toContain("' 场｜机会 '");
    expect(homeJs).toContain("'｜风险 '");
    expect(homeJs).toContain('countHomeOpportunities');
    expect(homeJs).toContain('isExplicitRiskRankItem');
  });

  it('首页摘要样式为轻量单行样式，不替换原统计卡样式，且不是深灰禁用态', () => {
    expect(appCss).toContain('.home-today-brief');
    expect(appCss).toContain('.home-stats');
    expect(appCss).toContain('.home-stat-card');
    expect(appCss).toContain('rgba(255, 255, 255, 0.78)');
    expect(appCss).not.toContain('background: rgba(7, 21, 38, 0.68);');
  });
});
