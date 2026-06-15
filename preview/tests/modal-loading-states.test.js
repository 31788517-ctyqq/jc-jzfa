/**
 * P0: modal-loading-states.test.js
 * 弹窗加载状态测试 — loading / success / error / empty / timeout 五态
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const MATCH_DETAIL = path.join(__dirname, '..', 'js', 'pages', 'match-detail.js');
const GONGSHOUDAO = path.join(__dirname, '..', 'js', 'pages', 'gongshoudao.js');
const PLANS = path.join(__dirname, '..', 'js', 'pages', 'plans.js');
const BACKTEST = path.join(__dirname, '..', 'js', 'pages', 'backtest.js');
const MODEL_DASH = path.join(__dirname, '..', 'js', 'pages', 'model-dashboard.js');
const CONFIRM_SCHEME = path.join(__dirname, '..', 'js', 'pages', 'confirm-scheme.js');

function src(f) {
  let s = fs.readFileSync(f, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // strip BOM
  return s;
}
function countMatches(source, pattern) {
  return (source.match(new RegExp(pattern, 'g')) || []).length;
}

describe('P0: modal-loading-states — 弹窗加载状态', () => {
  // ═══════════════════════════════════════════
  // 1. Loading 态
  // ═══════════════════════════════════════════
  describe('1. Loading 加载中状态', () => {
    it('1.1 AI弹窗有 loading spinner', () => {
      const source = src(MATCH_DETAIL);
      expect(source).toContain('loading');
    });

    it('1.2 功守道弹窗有骨架屏 loading', () => {
      const source = src(GONGSHOUDAO);
      expect(source).toContain('page-skeleton');
      expect(source).toContain('skel-bar');
    });

    it('1.3 方案列表有 loading spinner', () => {
      const source = src(PLANS);
      expect(source).toContain('loading-spinner');
      expect(source).toContain('加载');
    });

    it('1.4 回测页有 loading 占位', () => {
      const source = src(BACKTEST);
      expect(source).toContain('加载中');
    });

    it('1.5 模型仪表盘有 loading spinner', () => {
      const source = src(MODEL_DASH);
      expect(source).toContain('loading-spinner');
    });

    it('1.6 确认方案页无数据时显示空状态（非 loading）', () => {
      const source = src(CONFIRM_SCHEME);
      expect(source).toContain('暂无方案数据');
    });
  });

  // ═══════════════════════════════════════════
  // 2. Error 态
  // ═══════════════════════════════════════════
  describe('2. Error 错误状态', () => {
    it('2.1 AI弹窗有 catch 错误处理', () => {
      const source = src(MATCH_DETAIL);
      expect(source).toContain('.catch') || expect(source).toContain('catch');
    });

    it('2.2 API 失败时有重试/刷新按钮', () => {
      const source = src(MATCH_DETAIL);
      expect(source).toContain('重试') || expect(source).toContain('刷新');
    });

    it('2.3 功守道 API 有 catch 处理', () => {
      const source = src(GONGSHOUDAO);
      expect(source).toContain('.catch');
    });

    it('2.4 方案列表加载失败有处理', () => {
      const source = src(PLANS);
      expect(source).toContain('catch');
    });

    it('2.5 confirm-scheme 解析失败有错误提示', () => {
      const source = src(CONFIRM_SCHEME);
      expect(source).toContain('数据异常');
    });
  });

  // ═══════════════════════════════════════════
  // 3. Empty 态
  // ═══════════════════════════════════════════
  describe('3. Empty 空状态', () => {
    it('3.1 方案列表空态有占位文案', () => {
      const source = src(PLANS);
      expect(source).toContain('暂无') || expect(source).toContain('empty') || expect(source).toContain('方案');
    });

    it('3.2 回测无数据时应有空态', () => {
      const source = src(BACKTEST);
      expect(source).toContain('暂无') || expect(source).toContain('empty');
    });

    it('3.3 confirm-scheme 空态有引导文案', () => {
      const source = src(CONFIRM_SCHEME);
      expect(source).toContain('暂无方案数据');
    });
  });

  // ═══════════════════════════════════════════
  // 4. Timeout 超时处理
  // ═══════════════════════════════════════════
  describe('4. Timeout 超时处理', () => {
    it('4.1 api.js 有超时配置', () => {
      const apiSource = src(path.join(__dirname, '..', 'js', 'api.js'));
      expect(apiSource).toContain('setTimeout');
      expect(apiSource).toContain('AbortController') || expect(apiSource).toContain('abort');
    });

    it('4.2 api.js 有请求超时提示', () => {
      const apiSource = src(path.join(__dirname, '..', 'js', 'api.js'));
      expect(apiSource).toContain('超时');
    });

    it('4.3 api.js 有重试逻辑', () => {
      const apiSource = src(path.join(__dirname, '..', 'js', 'api.js'));
      expect(apiSource).toContain('retries');
    });
  });

  // ═══════════════════════════════════════════
  // 5. 过渡状态
  // ═══════════════════════════════════════════
  describe('5. 加载→渲染过渡', () => {
    it('5.1 AI弹窗有 showAIPrediction 入口', () => {
      const source = src(MATCH_DETAIL);
      expect(source).toContain('function showAIPrediction');
    });

    it('5.2 功守道先显示 loading 再 api 请求', () => {
      const source = src(GONGSHOUDAO);
      // innerHTML = loading html → api() → replace content
      expect(source).toContain('api(');
      const gsStart = source.indexOf('export function showGongshoudao');
      const apiPos = source.indexOf('api(', gsStart);
      expect(apiPos).toBeGreaterThan(gsStart);
    });

    it('5.3 骨架屏渲染在内容之前', () => {
      const source = src(GONGSHOUDAO);
      const loadPos = source.indexOf('page-skeleton');
      const apiPos = source.indexOf('api(', loadPos);
      expect(loadPos).toBeGreaterThan(0);
      // 骨架屏 innerHTML 在 api 调用之前
      expect(loadPos).toBeLessThan(source.indexOf('.then', apiPos));
    });
  });
});
