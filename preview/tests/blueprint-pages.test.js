/**
 * 蓝图测试: 前端页面 — 模块可导入性验证
 * 注: 渲染逻辑由浏览器端E2E验证(已通过)
 */
describe('frontend modules — 蓝图验证', () => {
  it('model-dashboard 模块可被静态加载', () => {
    const d = require('../js/pages/model-dashboard.js');
    expect(typeof d.loadDashboard).toBe('function');
  });

  it('data-health 模块可被静态加载', () => {
    // data-health.js 引用 window._dhRefresh，Node 环境需 mock
    global.window = global.window || {};
    const d = require('../js/pages/data-health.js');
    expect(typeof d.loadDataHealth).toBe('function');
  });
});
