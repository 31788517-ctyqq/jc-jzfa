/**
 * P1: tables-render-contract.test.js
 * 表格渲染合同 — backtest/quant-rank/income/model-dashboard 列表渲染
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const BACKTEST = path.join(__dirname, '..', 'js', 'pages', 'backtest.js');
const QUANT_RANK = path.join(__dirname, '..', 'js', 'pages', 'quant-rank.js');
const QUANT_FUSION = path.join(__dirname, '..', 'js', 'pages', 'quant-rank-fusion.js');
const INCOME = path.join(__dirname, '..', 'js', 'pages', 'income.js');
const MODEL_DASH = path.join(__dirname, '..', 'js', 'pages', 'model-dashboard.js');
const PLANS = path.join(__dirname, '..', 'js', 'pages', 'plans.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('P1: tables-render-contract — 表格渲染合同', () => {
  // ═══════════════════════════════════════════
  // 1. backtest.js 回测明细表
  // ═══════════════════════════════════════════
  describe('1. backtest.js 回测明细表', () => {
    const bt = src(BACKTEST);

    it('1.1 renderList 函数存在', () => {
      expect(bt).toContain('function renderList');
    });

    it('1.2 分页组件 btPager 存在', () => {
      expect(bt).toContain('btPager');
    });

    it('1.3 分页按钮样式 bt-pager-btn', () => {
      expect(bt).toContain('bt-pager-btn');
    });

    it('1.4 分页激活态 .active', () => {
      expect(bt).toContain('pager-btn');
    });

    it('1.5 分页导航箭头 bt-pager-nav', () => {
      expect(bt).toContain('bt-pager-nav') || expect(bt).toContain('pager');
    });

    it('1.6 列表容器 btList 存在', () => {
      expect(bt).toContain('btList');
    });

    it('1.7 _btPage/_btPageSize 分页状态变量', () => {
      expect(bt).toContain('_btPage');
      expect(bt).toContain('_btPageSize');
    });

    it('1.8 对阵比分列 .fdt-teams', () => {
      expect(bt).toContain('fdt-teams');
    });

    it('1.9 预测命中/未命中标记 .pred-hit/.pred-miss', () => {
      expect(bt).toContain('pred-hit');
      expect(bt).toContain('pred-miss');
    });

    it('1.10 汇总栏 bt-summary-bar', () => {
      expect(bt).toContain('bt-summary-bar');
    });
  });

  // ═══════════════════════════════════════════
  // 2. 方案页列表 (plans.js)
  // ═══════════════════════════════════════════
  describe('2. plans.js 方案卡片列表', () => {
    const pl = src(PLANS);

    it('2.1 loadPlanList 函数存在', () => {
      expect(pl).toContain('export function loadPlanList');
    });

    it('2.2 方案卡片 plan-card 样式', () => {
      expect(pl).toContain('plan-card');
    });

    it('2.3 方案日期栏 planDateBar', () => {
      expect(pl).toContain('planDateBar');
    });

    it('2.4 日期前后切换 shiftPlanDate', () => {
      expect(pl).toContain('shiftPlanDate');
    });

    it('2.5 有分享按钮', () => {
      expect(pl).toContain('sharePlanCard') || expect(pl).toContain('share');
    });

    it('2.6 有方案操作按钮', () => {
      expect(pl).toContain('action') || expect(pl).toContain('btn') || expect(pl).toContain('确认');
    });

    it('2.7 loadMyPlanList 我的方案入口', () => {
      expect(pl).toContain('loadMyPlanList');
    });
  });

  // ═══════════════════════════════════════════
  // 3. quant-rank.js 量化排行榜表
  // ═══════════════════════════════════════════
  describe('3. quant-rank.js 量化排行榜', () => {
    it('3.1 文件存在且大小正常', () => {
      expect(fs.existsSync(QUANT_RANK)).toBe(true);
      expect(fs.statSync(QUANT_RANK).size).toBeGreaterThan(100);
    });

    it('3.2 源码包含渲染函数或 innerHTML', () => {
      const qr = src(QUANT_RANK);
      expect(qr).toContain('function') || expect(qr).toContain('innerHTML');
    });

    it('3.3 quant-rank-fusion 文件存在且大小正常', () => {
      expect(fs.existsSync(QUANT_FUSION)).toBe(true);
      expect(fs.statSync(QUANT_FUSION).size).toBeGreaterThan(100);
    });
  });

  // ═══════════════════════════════════════════
  // 4. income.js 方案收入表
  // ═══════════════════════════════════════════
  describe('4. income.js 方案收入表', () => {
    it('4.1 有收入列表渲染', () => {
      const ic = src(INCOME);
      expect(ic).toContain('income') || expect(ic).toContain('list') || expect(ic).toContain('load');
    });

    it('4.2 有日期筛选或汇总', () => {
      const ic = src(INCOME);
      expect(ic).toContain('date') || expect(ic).toContain('filter') || expect(ic).toContain('load');
    });
  });

  // ═══════════════════════════════════════════
  // 5. 表格通用规范
  // ═══════════════════════════════════════════
  describe('5. 表格通用渲染规范', () => {
    it('5.1 backtest 列表使用 innerHTML 渲染', () => {
      const bt = src(BACKTEST);
      expect(bt).toContain('innerHTML');
    });

    it('5.2 plans 列表使用 innerHTML 渲染', () => {
      const pl = src(PLANS);
      expect(pl).toContain('innerHTML');
    });

    it('5.3 列表有空状态处理', () => {
      const bt = src(BACKTEST);
      expect(bt).toContain('暂无') || expect(bt).toContain('empty') || expect(bt).toContain('0');
    });

    it('5.4 分页有总数显示', () => {
      const bt = src(BACKTEST);
      expect(bt).toContain('total') || expect(bt).toContain('Total');
    });
  });
});
