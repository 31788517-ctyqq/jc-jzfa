const fs = require('fs');
const path = require('path');

const PLANS_FILE = path.join(__dirname, '..', 'js', 'pages', 'plans.js');
const MY_PLAN_FILE = path.join(__dirname, '..', 'js', 'pages', 'my-plan.js');
const APP_CSS_FILE = path.join(__dirname, '..', 'css', 'app.css');
const MODALS_CSS_FILE = path.join(__dirname, '..', 'css', 'modals.css');

function readSource(filePath) {
  const buf = fs.readFileSync(filePath);
  const utf8 = buf.toString('utf8');

  // 兼容 UTF-16LE（历史文件编码），避免合同测试把样式误判为缺失
  if (utf8.includes('\u0000') || utf8.includes('�')) {
    const utf16 = buf.toString('utf16le');
    if (utf16.includes('.share-overlay') || utf16.includes('.share-modal') || utf16.includes('.share-btn-save')) {
      return utf16;
    }
  }

  return utf8;
}

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('今日方案页分享渲染合同', () => {
  const plansSource = readSource(PLANS_FILE);
  const myPlanSource = readSource(MY_PLAN_FILE);
  const appCssSource = readSource(APP_CSS_FILE);
  const modalsCssSource = readSource(MODALS_CSS_FILE);

  const expertSection = sliceBetween(plansSource, 'export function loadPlanList()', '// ========== 我的方案 ==========');
  const mySection = sliceBetween(plansSource, 'export function loadMyPlanList()', '// ═══ 自定义确认弹窗工厂 ═══');
  const scoreSection = sliceBetween(plansSource, 'export function loadScorePlanList()', '// ========== 量化方案 ==========');
  const quantSection = sliceBetween(plansSource, 'export function loadQuantPlanList()', '// =============================================================');

  it('专家 / 我的 / 比分 / 量化 方案分支都应渲染分享按钮', () => {
    [expertSection, mySection, scoreSection, quantSection].forEach(function (section) {
      expect(section).toContain('mp-share-btn');
      expect(section).toContain('sharePlanCard(');
      expect(section).toContain('mp-actions');
    });

    expect((plansSource.match(/mp-share-btn/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('plans.js 中的分享能力主链路函数不应缺失', () => {
    expect(plansSource).toContain('window.sharePlanCard = function (planId)');
    expect(plansSource).toContain('function _buildShareCard(cardEl)');
    expect(plansSource).toContain('function _showShareModal(planId, canvas, cardEl)');
    expect(plansSource).toContain('html2canvas');
  });

  it('独立我的方案页仍应保留 shareUserPlan 能力', () => {
    expect(myPlanSource).toContain('mp-share-btn');
    expect(myPlanSource).toContain('shareUserPlan(');
    expect(myPlanSource).toContain('window.shareUserPlan = function (planId)');
    expect(myPlanSource).toContain('function _showShareModal(planId, canvas, cardEl)');
  });

  it('分享弹窗与按钮样式依赖不应被误删', () => {
    expect(appCssSource).toContain('.mp-share-btn');
    expect(modalsCssSource).toContain('.share-overlay');
    expect(modalsCssSource).toContain('.share-modal');
    expect(modalsCssSource).toContain('.share-btn-copy');
    expect(modalsCssSource).toContain('.share-btn-save');
  });
});
