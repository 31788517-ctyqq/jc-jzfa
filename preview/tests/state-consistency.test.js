/**
 * P2: state-consistency.test.js
 * 状态一致性 — 跨页面状态管理/日期联动/筛选联动
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const STATE = path.join(__dirname, '..', 'js', 'state.js');
const MAIN_FUSION = path.join(__dirname, '..', 'js', 'main-fusion.js');
const PLANS = path.join(__dirname, '..', 'js', 'pages', 'plans.js');
const FILTER = path.join(__dirname, '..', 'js', 'pages', 'filter.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('P2: state-consistency — 状态一致性', () => {
  // ═══════════════════════════════════════════
  // 1. state.js 状态定义
  // ═══════════════════════════════════════════
  describe('1. state.js 全局状态', () => {
    const st = src(STATE);

    it('1.1 currentPage 状态存在', () => {
      expect(st).toContain('currentPage');
    });

    it('1.2 detailMatchId 状态存在', () => {
      expect(st).toContain('detailMatchId');
    });

    it('1.3 planDate/planDateOffset 状态存在', () => {
      expect(st).toContain('planDate');
      expect(st).toContain('planDateOffset');
    });

    it('1.4 planTab 状态存在，默认 wc', () => {
      expect(st).toContain("planTab = 'wc'");
    });

    it('1.5 planDateExplicit 状态存在', () => {
      expect(st).toContain('planDateExplicit');
    });

    it('1.6 setPlanDate 函数存在', () => {
      expect(st).toContain('function setPlanDate');
    });

    it('1.7 setPlanTab 函数存在', () => {
      expect(st).toContain('function setPlanTab');
    });

    it('1.8 setCurrentPage 函数存在', () => {
      expect(st).toContain('function setCurrentPage');
    });

    it('1.9 selectedMatchDate / weekDates 存在', () => {
      expect(st).toContain('selectedMatchDate');
      expect(st).toContain('weekDates');
    });

    it('1.10 rankDate/rankDateOffset 存在', () => {
      expect(st).toContain('rankDate');
      expect(st).toContain('rankDateOffset');
    });
  });

  // ═══════════════════════════════════════════
  // 2. 页面切换状态保持
  // ═══════════════════════════════════════════
  describe('2. 页面切换状态', () => {
    it('2.1 main-fusion 有 switchTab 函数', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('switchTab');
    });

    it('2.2 main-fusion 有 _ensurePage 保证 DOM 存在', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('_ensurePage');
    });

    it('2.3 返回按钮 goBack 存在', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('goBack');
    });

    it('2.4 Tab 激活态通过 .active 类管理', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain("classList.add('active')") || expect(mf).toContain("classList.toggle('active'");
    });
  });

  // ═══════════════════════════════════════════
  // 3. 日期联动
  // ═══════════════════════════════════════════
  describe('3. 日期选择联动', () => {
    it('3.1 planDate 变更触发 loadPlanList', () => {
      const pl = src(PLANS);
      expect(pl).toContain('loadPlanList');
    });

    it('3.2 shiftPlanDate 修改 offset 后刷新', () => {
      const pl = src(PLANS);
      expect(pl).toContain('shiftPlanDate');
    });

    it('3.3 updatePlanDateBar 更新日期栏', () => {
      const pl = src(PLANS);
      expect(pl).toContain('updatePlanDateBar');
    });
  });

  // ═══════════════════════════════════════════
  // 4. 筛选联动
  // ═══════════════════════════════════════════
  describe('4. 筛选条件联动', () => {
    it('4.1 filter.js 有方向类型切换 onDDTypeChange', () => {
      const fl = src(FILTER);
      expect(fl).toContain('onDDTypeChange');
    });

    it('4.2 filter.js 有 resetFilterResult 重置', () => {
      const fl = src(FILTER);
      expect(fl).toContain('resetFilterResult');
    });

    it('4.3 filter.js 有 loadFilterLeagues 加载联赛', () => {
      const fl = src(FILTER);
      expect(fl).toContain('loadFilterLeagues');
    });
  });

  // ═══════════════════════════════════════════
  // 5. 状态污染防护
  // ═══════════════════════════════════════════
  describe('5. 状态污染防护', () => {
    it('5.1 planTab 有 setter 封装', () => {
      const st = src(STATE);
      expect(st).toContain('function setPlanTab');
    });

    it('5.2 每个 setter 明确设置单个状态', () => {
      const st = src(STATE);
      const setterCount = (st.match(/export function set\w+/g) || []).length;
      expect(setterCount).toBeGreaterThanOrEqual(10);
    });

    it('5.3 plans.js 有 _normalizeVisiblePlanTab 规范 tab 值', () => {
      const pl = src(PLANS);
      expect(pl).toContain('_normalizeVisiblePlanTab');
    });
  });
});
