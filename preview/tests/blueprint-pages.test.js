/**
 * 蓝图测试: 前端页面 — 模块可导入性验证
 * 注: 渲染逻辑由浏览器端E2E验证(已通过)
 */
const fs = require('fs');
const path = require('path');

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

  it('profile 模块可被静态加载', () => {
    const p = require('../js/pages/profile.js');
    expect(typeof p.loadProfile).toBe('function');
  });

  it('profile 会员卡保留新版横向会员状态结构', () => {
    const profileSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'profile.js'), 'utf8');
    const cssSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
    expect(profileSource).toContain('profile-status-crown');
    expect(profileSource).toContain('未开通会员');
    expect(profileSource).toContain('立即开通');
    expect(profileSource).not.toContain('查看比赛后会自动生成历史记录');
    expect(cssSource).toContain('.profile-shell-v2 .profile-status-card');
    expect(cssSource).toContain('.profile-shell-v2 .profile-status-crown');
  });

  it('pricing 页面保留个人中心同款头部并移除顶部三枚标签', () => {
    const pricingSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'pricing.js'), 'utf8');
    const cssSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
    expect(pricingSource).toContain('member-hero-profilelike');
    expect(pricingSource).toContain('member-home-corner');
    expect(pricingSource).toContain('member-hero-eagle');
    expect(pricingSource).toContain("switchTab(\\'profile\\')");
    expect(pricingSource).not.toContain('AI 预测全量开放');
    expect(pricingSource).not.toContain('功守道 + 回测联动');
    expect(pricingSource).not.toContain('邀请好友享返利');
    expect(cssSource).toContain('.member-hero-profilelike');
    expect(cssSource).toContain('.member-home-corner');
  });

  it('subscription/referral/admin 页面顶部入口符合当前设计', () => {
    const subscriptionSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'subscription.js'), 'utf8');
    const referralSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'referral.js'), 'utf8');
    const adminSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'pages', 'admin.js'), 'utf8');
    const appCssSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');
    const adminCssSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'admin.css'), 'utf8');
    expect(subscriptionSource).toContain('member-hero-profilelike');
    expect(referralSource).toContain('member-hero-profilelike');
    expect(subscriptionSource).toContain('member-home-corner');
    expect(subscriptionSource).toContain("switchTab(\\'profile\\')");
    expect(referralSource).toContain('member-hero-referral-plain');
    expect(referralSource).toContain('member-home-corner');
    expect(referralSource).toContain('member-hero-eagle');
    expect(referralSource).toContain('<div class="member-hero-title">邀请返利</div>');
    expect(referralSource).toContain("switchTab(\\'profile\\')");
    expect(appCssSource).toContain('.member-shell-referral .member-hero-referral-plain');
    expect(adminSource).toContain('返回个人中心');
    expect(adminSource).toContain("switchTab(\\'profile\\')");
    expect(adminCssSource).toContain('.adm-profile-back');
  });
});
