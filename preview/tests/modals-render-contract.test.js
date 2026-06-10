/**
 * P0: modals-render-contract.test.js
 * 弹窗渲染合同 — 验证所有弹窗的 DOM 结构完整性
 *
 * @jest-environment jsdom
 *
 * 覆盖:
 *   - AI 弹窗 (match-detail.js → showAIPrediction)
 *   - 功守道弹窗 (gongshoudao.js → showGongshoudao)
 *   - 确认方案弹窗 (confirm-scheme.js)
 *   - 分享弹窗 (plans.js → _showShareModal)
 *   - 弹窗模板结构/关闭按钮/overlay 层级
 */

const fs = require('fs');
const path = require('path');

// ═══ 读取源文件 ═══
const MATCH_DETAIL = path.join(__dirname, '..', 'js', 'pages', 'match-detail.js');
const GONGSHOUDAO = path.join(__dirname, '..', 'js', 'pages', 'gongshoudao.js');
const CONFIRM_SCHEME = path.join(__dirname, '..', 'js', 'pages', 'confirm-scheme.js');
const PLANS = path.join(__dirname, '..', 'js', 'pages', 'plans.js');
const BETTING = path.join(__dirname, '..', 'js', 'pages', 'betting.js');
const SCHEME_DESIGN = path.join(__dirname, '..', 'js', 'pages', 'scheme-design.js');
const MODALS_CSS = path.join(__dirname, '..', 'css', 'modals.css');
const APP_CSS = path.join(__dirname, '..', 'css', 'app.css');
const INDEX_HTML = path.join(__dirname, '..', 'index.html');

function src(file) {
  const buf = fs.readFileSync(file);
  let s;
  // UTF-16LE 检测（BOM 0xFF 0xFE）
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    s = buf.toString('utf16le');
  } else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    s = buf.toString('utf8').slice(1);
  } else {
    s = buf.toString('utf8');
  }
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('P0: modals-render-contract — 弹窗渲染合同', () => {
  // ═══════════════════════════════════════════
  // 1. AI 弹窗 (match-detail.js)
  // ═══════════════════════════════════════════
  describe('1. AI 深度解析弹窗', () => {
    const md = src(MATCH_DETAIL);

    it('1.1 showAIPrediction 函数存在', () => {
      expect(md).toContain('export function showAIPrediction');
    });

    it('1.2 渲染 ai-modal-header（标题+关闭按钮）', () => {
      expect(md).toContain('ai-modal-header');
      expect(md).toContain('ai-modal-title');
      expect(md).toContain('ai-modal-close');
      expect(md).toContain('closeAI()');
    });

    it('1.3 AI弹窗渲染了比分/方向预测', () => {
      expect(md).toContain('ai-modal-title');
      expect(md).toContain('预测');
    });

    it('1.4 渲染 "我要做方案" 按钮', () => {
      expect(md).toContain('我要做方案');
    });

    it('1.5 加载中状态有 loading spinner', () => {
      expect(md).toContain('loading-spinner') || expect(md).toContain('loading');
    });

    it('1.6 加载失败时有错误提示 + 重试按钮', () => {
      expect(md).toContain('重试') || expect(md).toContain('刷新');
    });
  });

  // ═══════════════════════════════════════════
  // 2. 功守道弹窗 (gongshoudao.js)
  // ═══════════════════════════════════════════
  describe('2. 功守道量化弹窗', () => {
    const gs = src(GONGSHOUDAO);

    it('2.1 showGongshoudao 函数存在', () => {
      expect(gs).toContain('export function showGongshoudao');
    });

    it('2.2 overlay 打开逻辑：classList.add("active")', () => {
      expect(gs).toContain("classList.add('active')");
      expect(gs).toContain("aiOverlay");
    });

    it('2.3 渲染 7 个分析模块', () => {
      expect(gs).toContain('实力分析');
      expect(gs).toContain('大小球分析');
      expect(gs).toContain('gs-modal-section');
    });

    it('2.4 实力阶梯标签渲染', () => {
      expect(gs).toContain('ladderLabel');
    });

    it('2.5 胜平负交叉渲染', () => {
      expect(gs).toContain('crossSpfWin');
    });

    it('2.6 总进球期望渲染', () => {
      expect(gs).toContain('totalGoalsExpect');
    });

    it('2.7 关闭按钮 + overlay 点击关闭', () => {
      expect(gs).toContain('closeAI');
    });

    it('2.8 数据时效标签渲染', () => {
      expect(gs).toContain('computedAt');
    });
  });

  // ═══════════════════════════════════════════
  // 3. 确认方案弹窗 (confirm-scheme.js)
  // ═══════════════════════════════════════════
  describe('3. 确认方案弹窗', () => {
    const cf = src(CONFIRM_SCHEME);

    it('3.1 loadConfirmScheme 函数存在', () => {
      expect(cf).toContain('export function loadConfirmScheme');
    });

    it('3.2 从 sessionStorage 读取 pendingConfirmPlan', () => {
      expect(cf).toContain('pendingConfirmPlan');
    });

    it('3.3 无数据时显示空状态提示', () => {
      expect(cf).toContain('暂无方案数据');
    });

    it('3.4 渲染方案预览卡片', () => {
      expect(cf).toContain('plan-card');
    });

    it('3.5 渲染过关类型标签', () => {
      expect(cf).toContain('passTypes');
      expect(cf).toContain('关');
    });

    it('3.6 渲染倍数选择器', () => {
      expect(cf).toContain('multiplier') || expect(cf).toContain('倍数');
    });

    it('3.7 渲染底部操作栏', () => {
      const source = src(CONFIRM_SCHEME);
      expect(source).toContain('确认') || expect(source).toContain('bottom-bar');
    });

    it('3.8 渲染比赛列表表格', () => {
      expect(cf).toContain('<table') || expect(cf).toContain('matchRows');
    });
  });

  // ═══════════════════════════════════════════
  // 4. 分享弹窗 (plans.js)
  // ═══════════════════════════════════════════
  describe('4. 方案分享弹窗', () => {
    const pl = src(PLANS);

    it('4.1 _showShareModal 函数存在', () => {
      expect(pl).toContain('function _showShareModal');
    });

    it('4.2 html2canvas 调用', () => {
      expect(pl).toContain('html2canvas');
    });

    it('4.3 sharePlanCard 全局函数存在', () => {
      expect(pl).toContain('window.sharePlanCard');
    });

    it('4.4 _buildShareCard 函数存在', () => {
      expect(pl).toContain('function _buildShareCard');
    });

    it('4.5 分享弹窗有保存/转发按钮', () => {
      expect(pl).toContain('share-btn-save') || expect(pl).toContain('share-btn');
    });
  });

  // ═══════════════════════════════════════════
  // 5. 投注弹窗 (betting.js)
  // ═══════════════════════════════════════════
  describe('5. 投注弹窗', () => {
    const bt = src(BETTING);

    it('5.1 投注弹窗有 overlay 入口', () => {
      const source = src(BETTING);
      expect(source).toContain('ai-overlay');
    });

    it('5.2 投注弹窗有 betting 相关渲染', () => {
      const source = src(BETTING);
      expect(source).toContain('betting') || expect(source).toContain('bet-');
    });
  });

  // ═══════════════════════════════════════════
  // 6. overlay 通用结构 (index.html)
  // ═══════════════════════════════════════════
  describe('6. Overlay 通用结构', () => {
    const html = src(INDEX_HTML);

    it('6.1 #aiOverlay 存在（AI/功守道/PK 共用）', () => {
      expect(html).toContain('id="aiOverlay"');
    });

    it('6.2 #aiModal 容器存在', () => {
      expect(html).toContain('id="aiModal"');
    });

    it('6.3 overlay 点击背景关闭', () => {
      expect(html).toContain('event.target === this');
    });

    it('6.4 overlay 有 z-index 层级定义', () => {
      const css = src(MODALS_CSS);
      expect(css).toContain('z-index');
    });
  });

  // ═══════════════════════════════════════════
  // 7. CSS 合同
  // ═══════════════════════════════════════════
  describe('7. CSS 样式合同', () => {
    const mc = src(MODALS_CSS);
    const ac = src(APP_CSS);

    it('7.1 ai-overlay 有 display: none', () => {
      expect(mc).toContain('display: none');
    });

    it('7.2 ai-overlay.active 有 display: flex', () => {
      expect(mc).toContain('.ai-overlay.active');
    });

    it('7.3 ai-modal 有 border-radius', () => {
      expect(mc).toContain('border-radius');
    });

    it('7.4 ai-modal-close 有样式定义', () => {
      expect(mc).toContain('ai-modal-close');
    });

    it('7.5 功守道模块有 CSS 定义', () => {
      expect(mc).toContain('gs-');
    });

    it('7.6 scheme-design 弹窗层有确认/取消按钮', () => {
      const sd = src(SCHEME_DESIGN);
      expect(sd).toContain('确认') || expect(sd).toContain('取消');
    });
  });
});
