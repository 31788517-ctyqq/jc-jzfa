const fs = require('fs');
const path = require('path');

const MAIN_FUSION_FILE = path.join(__dirname, '..', 'js', 'main-fusion.js');
const PAGES_DIR = path.join(__dirname, '..', 'js', 'pages');

const ROUTES = [
  {
    id: 'confirm-scheme',
    pageFile: 'confirm-scheme.js',
    containerMarker: 'confirmContent',
    moduleId: 'confirm-scheme',
    loader: 'loadConfirmScheme',
    title: '确认方案',
  },
  {
    id: 'model-dashboard',
    pageFile: 'model-dashboard.js',
    containerMarker: 'model-dashboard-content',
    moduleId: 'model-dashboard',
    loader: 'loadDashboard',
    title: '模型表现仪表板',
  },
  {
    id: 'data-health',
    pageFile: 'data-health.js',
    containerMarker: 'data-health-content',
    moduleId: 'data-health',
    loader: 'loadDataHealth',
    title: '数据健康监控',
  },
];

function readSource(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function sliceBetween(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('main-fusion 页面路由合同', () => {
  const source = readSource(MAIN_FUSION_FILE);
  const ensurePageSection = sliceBetween(source, 'function _ensurePage(id) {', '// ── 标签切换 ──');
  const switchTabSection = sliceBetween(source, 'export function switchTab(tab) {', 'export function goBack() {');
  const switchTabLoadSection = sliceBetween(source, 'function switchTabLoad(tab) {', '// 命中率页面重试事件监听');

  it('新增页面模块文件必须存在', () => {
    ROUTES.forEach(function (route) {
      expect(fs.existsSync(path.join(PAGES_DIR, route.pageFile))).toBe(true);
    });
  });

  it.each(ROUTES)('$id 必须在 _ensurePage 中创建页面容器', (route) => {
    expect(ensurePageSection).toContain("else if (id === '" + route.id + "')");
    expect(ensurePageSection).toContain(route.containerMarker);
  });

  it.each(ROUTES)('$id 必须在 switchTab 中注册模块加载逻辑', (route) => {
    expect(switchTabSection).toContain("if (tab === '" + route.id + "')");
    expect(switchTabSection).toContain("_mod('" + route.moduleId + "')");
    expect(switchTabSection).toContain(route.loader + '()');
    expect(switchTabSection).toContain("'" + route.id + "': '" + route.title + "'");
  });

  it.each(ROUTES)('$id 必须在 switchTabLoad 中注册恢复逻辑', (route) => {
    expect(switchTabLoadSection).toContain("if (tab === '" + route.id + "')");
    expect(switchTabLoadSection).toContain("_mod('" + route.moduleId + "')");
    expect(switchTabLoadSection).toContain(route.loader + '()');
    expect(switchTabLoadSection).toContain("'" + route.id + "': '" + route.title + "'");
  });
});
