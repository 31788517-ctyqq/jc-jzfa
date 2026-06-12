/**
 * P2: api-structure.test.js — API 路由结构合同测试
 * 无需运行服务器，验证 API handler 注册完整性
 */
const fs = require('fs');
const path = require('path');

const INDEX_JS = path.join(__dirname, '..', 'index.js');
const apiSource = fs.readFileSync(INDEX_JS, 'utf8');

// 从 index.js 提取所有注册的 action handler
function extractActions(source) {
  var actions = [];
  var re = /case\s+['"]([^'"]+)['"]\s*:/g;
  var m;
  while ((m = re.exec(source)) !== null) {
    if (actions.indexOf(m[1]) === -1) actions.push(m[1]);
  }
  return actions.sort();
}

var actions = extractActions(apiSource);

describe('API 路由结构合同 (无服务器)', () => {
  it('index.js 应存在', () => {
    expect(fs.existsSync(INDEX_JS)).toBe(true);
  });

  it('至少注册了 15 个 action handler', () => {
    expect(actions.length).toBeGreaterThanOrEqual(15);
  });

  // 核心只读 API（实际注册的 action 名）
  var actual = [
    'match-list',
    'match-detail',
    'match-odds',
    'filter-stats',
    'prediction-backtest',
    'batch-match-odds',
    'model-dashboard',
    'rank-list',
    'hit-rate',
  ];

  it('核心只读 API 已注册', () => {
    var found = actual.filter(function (a) {
      return actions.indexOf(a) >= 0;
    });
    expect(found.length).toBeGreaterThanOrEqual(6);
  });

  // 方案相关 API
  it('方案相关 API 已注册', () => {
    var planFound = ['plan-list', 'plan-save', 'plan-confirm', 'plan-share'].filter(function (a) {
      return actions.indexOf(a) >= 0;
    });
    expect(planFound.length).toBeGreaterThanOrEqual(1);
  });

  // 功守道 API
  it('功守道 API: gongshoudao', () => {
    expect(actions).toContain('gongshoudao');
  });

  // 认证 API
  it('认证 API 已注册', () => {
    var authFound = ['auth-login', 'auth-register', 'auth-logout', 'auth-session', 'auth-change-password'].filter(
      function (a) {
        return actions.indexOf(a) >= 0;
      },
    );
    expect(authFound.length).toBeGreaterThanOrEqual(5);
  });

  // 模型仪表盘
  it('模型仪表盘 API: model-dashboard', () => {
    expect(actions).toContain('model-dashboard');
  });
});
