/**
 * P2: filter-interaction.test.js
 * 筛选控件交互测试 — dropdown/Portal/日期选择器/Tab切换
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const FILTER = path.join(__dirname, '..', 'js', 'pages', 'filter.js');
const BACKTEST = path.join(__dirname, '..', 'js', 'pages', 'backtest.js');
const PLANS = path.join(__dirname, '..', 'js', 'pages', 'plans.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

function countMatches(s, p) { return (s.match(new RegExp(p, 'g')) || []).length; }

describe('P2: filter-interaction — 筛选控件交互', () => {
  // ═══════════════════════════════════════════
  // 1. filter.js Dropdown
  // ═══════════════════════════════════════════
  describe('1. filter.js Dropdown 机制', () => {
    const fl = src(FILTER);

    it('1.1 toggleDD 函数存在', () => {
      expect(fl).toContain('export function toggleDD');
    });

    it('1.2 selectDD 函数存在', () => {
      expect(fl).toContain('export function selectDD');
    });

    it('1.3 getDDVal 函数存在', () => {
      expect(fl).toContain('export function getDDVal');
    });

    it('1.4 closeAllDD 函数存在', () => {
      expect(fl).toContain('export function closeAllDD');
    });

    it('1.5 Dropdown 打开时添加 .open 类', () => {
      expect(fl).toContain("classList.add('open')");
    });

    it('1.6 选项选择后添加 .selected 类', () => {
      expect(fl).toContain("classList.toggle('selected'");
    });

    it('1.7 Portal 机制存在（脱离父级 stacking context）', () => {
      expect(fl).toContain('filter-dd-portal');
      expect(fl).toContain('document.body.appendChild');
    });

    it('1.8 Portal z-index = 2147483647', () => {
      expect(fl).toContain('2147483647');
    });

    it('1.9 窗口边缘适配（left 不超出视口）', () => {
      expect(fl).toContain('Math.max');
      expect(fl).toContain('Math.min');
    });

    it('1.10 handleDocClose 全局点击关闭', () => {
      expect(fl).toContain('export function handleDocClose');
    });

    it('1.11 filterDirMap 方向映射配置存在', () => {
      expect(fl).toContain('filterDirMap');
      expect(fl).toContain('胜平负');
      expect(fl).toContain('让球');
      expect(fl).toContain('进球数');
    });

    it('1.12 Portal 关闭时正确清理', () => {
      expect(fl).toContain('p.remove()');
    });
  });

  // ═══════════════════════════════════════════
  // 2. backtest.js 筛选器
  // ═══════════════════════════════════════════
  describe('2. backtest.js 筛选器', () => {
    const bt = src(BACKTEST);

    it('2.1 renderFilterCard 函数存在', () => {
      expect(bt).toContain('function renderFilterCard');
    });

    it('2.2 时间范围 dropdown (dd-btRange)', () => {
      expect(bt).toContain('dd-btRange');
    });

    it('2.3 联赛 dropdown (dd-btLeague)', () => {
      expect(bt).toContain('dd-btLeague');
    });

    it('2.4 模型 dropdown (dd-btModel)', () => {
      expect(bt).toContain('dd-btModel');
    });

    it('2.5 查询按钮 doBTQuery', () => {
      expect(bt).toContain('doBTQuery');
    });

    it('2.6 filterDD 辅助函数存在', () => {
      expect(bt).toContain('function filterDD');
    });

    it('2.7 btSwitchTab 切换函数存在', () => {
      expect(bt).toContain('btSwitchTab');
    });

    it('2.8 4 个 Tab (gs/ai/pk/experiment)', () => {
      const source = src(BACKTEST);
      expect(source).toContain('data-tab="gs"');
      expect(source).toContain('data-tab="ai"');
      expect(source).toContain('data-tab="pk"');
      expect(source).toContain('data-tab="experiment"');
    });

    it('2.9 Tab 切换用 filter-tag 样式', () => {
      expect(bt).toContain('filter-tag');
    });
  });

  // ═══════════════════════════════════════════
  // 3. plans.js 日期选择器
  // ═══════════════════════════════════════════
  describe('3. plans.js 日期选择器', () => {
    const pl = src(PLANS);

    it('3.1 shiftPlanDate 函数存在', () => {
      expect(pl).toContain('export function shiftPlanDate');
    });

    it('3.2 goPlanToday 函数存在', () => {
      expect(pl).toContain('export function goPlanToday');
    });

    it('3.3 switchPlanTab 函数存在', () => {
      expect(pl).toContain('export function switchPlanTab');
    });

    it('3.4 前向限制（不超今天）', () => {
      expect(pl).toContain('newDate > todayStr');
    });

    it('3.5 后向限制（不早于最早日期）', () => {
      expect(pl).toContain('MIN_PLAN_DATE');
    });

    it('3.6 今天标记逻辑', () => {
      expect(pl).toContain('今天');
    });

    it('3.7 _autoSetBestDate 智能日期停靠', () => {
      expect(pl).toContain('_autoSetBestDate');
    });
  });
});
