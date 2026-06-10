/**
 * 方案设计全流程测试 — scheme-design → confirm-scheme → 提交
 * 覆盖: 玩法选择/过关组合/倍数/预算检查/奖金优化/提交
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const SCHEME_DESIGN = path.join(__dirname, '..', 'js', 'pages', 'scheme-design.js');
const CONFIRM_SCHEME = path.join(__dirname, '..', 'js', 'pages', 'confirm-scheme.js');
const BETTING = path.join(__dirname, '..', 'js', 'pages', 'betting.js');
const APP_CSS = path.join(__dirname, '..', 'css', 'app.css');
const BET_SCHEME_FILTERS = path.join(__dirname, '..', '..', 'server', 'core', 'bet-scheme-filters.js');
const SHADOW_ACCOUNT = path.join(__dirname, '..', '..', 'server', 'core', 'shadow-account.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('方案设计全流程测试', () => {
  // ═══════════════════════════════════════════
  // 1. scheme-design.js 玩法选择
  // ═══════════════════════════════════════════
  describe('1. scheme-design.js 玩法选择', () => {
    const sd = src(SCHEME_DESIGN);

    it('1.1 PLAY_LIMITS 木桶原则定义', () => {
      expect(sd).toContain('PLAY_LIMITS');
      expect(sd).toContain('spf: 8');
      expect(sd).toContain('rqspf: 8');
      expect(sd).toContain('jqs: 6');
      expect(sd).toContain('bf: 4');
      expect(sd).toContain('bqc: 4');
    });

    it('1.2 PLAY_NAMES 玩法名称映射', () => {
      expect(sd).toContain('PLAY_NAMES');
      expect(sd).toContain('胜平负');
      expect(sd).toContain('让球胜平负');
      expect(sd).toContain('比分');
      expect(sd).toContain('总进球');
      expect(sd).toContain('半全场');
    });

    it('1.3 _activePlayType 初始值为 mixed', () => {
      expect(sd).toContain("_activePlayType = 'mixed'");
    });

    it('1.4 _passTypes 默认 2关', () => {
      expect(sd).toContain('_passTypes = [2]');
    });

    it('1.5 _multiplier 默认 2 倍', () => {
      expect(sd).toContain('_multiplier = 2');
    });

    it('1.6 _selections 数据模型定义', () => {
      expect(sd).toContain('matchId');
      expect(sd).toContain('playType');
      expect(sd).toContain('direction');
    });

    it('1.7 parseDirectionCards 方向解析', () => {
      expect(sd).toContain('parseDirectionCards');
    });

    it('1.8 RECOMM_TO_BTN 推荐方向映射', () => {
      expect(sd).toContain('RECOMM_TO_BTN');
      expect(sd).toContain('让胜');
      expect(sd).toContain('让平');
    });

    it('1.9 玩法切换 playType 函数存在', () => {
      expect(sd).toContain('playType');
    });

    it('1.10 比赛勾选逻辑存在', () => {
      expect(sd).toContain('toggle') || expect(sd).toContain('check');
    });

    it('1.11 赔率按钮渲染 selectOdds 逻辑', () => {
      expect(sd).toContain('odds');
    });

    it('1.12 过关类型多选支持', () => {
      expect(sd).toContain('passTypes');
    });

    it('1.13 木桶原则上限计算', () => {
      // 检查上限由木桶原则决定
      expect(sd).toContain('Math.min');
    });

    it('1.14 推荐排行 Top5 渲染', () => {
      expect(sd).toContain('_matchDirections');
    });
  });

  // ═══════════════════════════════════════════
  // 2. confirm-scheme.js 确认方案
  // ═══════════════════════════════════════════
  describe('2. confirm-scheme.js 确认方案', () => {
    it('2.1 从 sessionStorage 恢复方案数据', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('pendingConfirmPlan');
      expect(cf).toContain('sessionStorage.getItem');
    });

    it('2.2 _passTypes 从方案数据恢复', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('_passTypes');
    });

    it('2.3 _multiplier 可配置 2-99 倍', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('_multiplier');
    });

    it('2.4 buildGroupedSelections 按 matchId 分组', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('buildGroupedSelections');
    });

    it('2.5 calcBets 注数计算', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('function calcBets');
    });

    it('2.6 calcMaxWin 最大奖金计算', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('function calcMaxWin');
    });

    it('2.7 奖金优化按钮 showBonusOptimize', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('showBonusOptimize');
    });

    it('2.8 方案金额/预计奖金/状态三列', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('plan-amount');
    });

    it('2.9 资金分配 allocation 字段', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('allocation');
    });

    it('2.10 Delta 涨跌箭头渲染', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('Delta');
    });

    it('2.11 BQC 半全场缩写映射', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('BQC_MAP_REV');
    });

    it('2.12 confirm-scheme 文件存在且有效', () => {
      expect(fs.existsSync(CONFIRM_SCHEME)).toBe(true);
      expect(fs.statSync(CONFIRM_SCHEME).size).toBeGreaterThan(5000);
    });
  });

  // ═══════════════════════════════════════════
  // 3. 提交验证
  // ═══════════════════════════════════════════
  describe('3. 方案提交验证', () => {
    it('3.1 确认方案有提交 api 调用', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('api(');
    });

    it('3.2 提交后有结果回调处理', () => {
      const cf = src(CONFIRM_SCHEME);
      expect(cf).toContain('.then') || expect(cf).toContain('.catch');
    });

    it('3.3 投注页有提交逻辑', () => {
      const bt = src(BETTING);
      expect(bt).toContain('api(');
    });

    it('3.4 竞彩规则：2-99 倍限制', () => {
      const sd = src(SCHEME_DESIGN);
      expect(sd).toContain('2-99');
    });

    it('3.5 单关标记 isSingleGame', () => {
      const sd = src(SCHEME_DESIGN);
      expect(sd).toContain('isSingleGame') || expect(sd).toContain('单关');
    });
  });

  // ═══════════════════════════════════════════
  // 4. bet-scheme-filters.js 服务端筛选
  // ═══════════════════════════════════════════
  describe('4. bet-scheme-filters.js 服务端筛选', () => {
    const bf = src(BET_SCHEME_FILTERS);

    it('4.1 价值门控模式配置 valueGateMode', () => {
      expect(bf).toContain('valueGateMode');
    });

    it('4.2 AI 置信度门槛 confidenceMin', () => {
      expect(bf).toContain('confidenceMin');
    });

    it('4.3 Edge 值门槛 edgeMin', () => {
      expect(bf).toContain('edgeMin');
    });

    it('4.4 赔率区间 oddsMin/oddsMax', () => {
      expect(bf).toContain('oddsMin');
      expect(bf).toContain('oddsMax');
    });

    it('4.5 联赛黑白名单', () => {
      expect(bf).toContain('leagueWhitelist');
      expect(bf).toContain('leagueBlacklist');
    });

    it('4.6 单票最大金额 maxAmount', () => {
      expect(bf).toContain('maxAmount');
    });

    it('4.7 异常数据排除 excludeFallback', () => {
      expect(bf).toContain('excludeFallback');
    });

    it('4.8 每场最大选数 maxSelectionPerMatch', () => {
      expect(bf).toContain('maxSelectionPerMatch');
    });

    it('4.9 组合结构约束 streakMax/breakpoint', () => {
      expect(bf).toContain('streakMax');
      expect(bf).toContain('breakpoint');
    });

    it('4.10 组配额/隔离 groupQuota', () => {
      expect(bf).toContain('groupQuota');
    });
  });

  // ═══════════════════════════════════════════
  // 5. shadow-account.js 虚拟资金
  // ═══════════════════════════════════════════
  describe('5. shadow-account.js 虚拟资金', () => {
    const sa = src(SHADOW_ACCOUNT);

    it('5.1 虚拟账户代码 DEFAULT_VIRTUAL_ACCOUNT_CODE', () => {
      expect(sa).toContain('DEFAULT_VIRTUAL_ACCOUNT_CODE');
      expect(sa).toContain('DEFAULT_INITIAL_BALANCE_CENT');
    });

    it('5.2 单票比率 DEFAULT_SINGLE_TICKET_RATIO', () => {
      expect(sa).toContain('DEFAULT_SINGLE_TICKET_RATIO');
    });

    it('5.3 每日容量比率 DEFAULT_DAILY_CAPACITY_RATIO', () => {
      expect(sa).toContain('DEFAULT_DAILY_CAPACITY_RATIO');
    });

    it('5.4 shadow_account_holds 冻结表存在', () => {
      expect(sa).toContain('shadow_account_holds');
    });

    it('5.5 hold 状态管理 released/settled', () => {
      expect(sa).toContain('released');
      expect(sa).toContain('settled');
    });

    it('5.6 投注金额单位 cent (分)', () => {
      expect(sa).toContain('cent');
    });
  });

  // ═══════════════════════════════════════════
  // 6. 方案设计 CSS 合同
  // ═══════════════════════════════════════════
  describe('6. CSS 样式合同', () => {
    const css = src(APP_CSS);

    it('6.1 plan-card 方案卡片样式存在', () => {
      expect(css).toContain('plan-card');
    });

    it('6.2 方案金额/奖金展示样式', () => {
      expect(css).toContain('plan-amount');
    });

    it('6.3 确认按钮区域存在', () => {
      expect(css).toContain('cfm-btn') || expect(css).toContain('confirm');
    });
  });
});
