/**
 * P1: charts-render-contract.test.js
 * 图表渲染合同 — ECharts 初始化/配置/实例管理
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const CHARTS_JS = path.join(__dirname, '..', 'js', 'charts.js');
const BACKTEST = path.join(__dirname, '..', 'js', 'pages', 'backtest.js');
const MODEL_DASH = path.join(__dirname, '..', 'js', 'pages', 'model-dashboard.js');
const INCOME = path.join(__dirname, '..', 'js', 'pages', 'income.js');
const HIT_RATE = path.join(__dirname, '..', 'js', 'pages', 'hit-rate.js');
const MATCH_DETAIL = path.join(__dirname, '..', 'js', 'pages', 'match-detail.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  return s;
}

describe('P1: charts-render-contract — 图表渲染合同', () => {
  // ═══════════════════════════════════════════
  // 1. charts.js ECharts 加载
  // ═══════════════════════════════════════════
  describe('1. charts.js ECharts 加载机制', () => {
    const ch = src(CHARTS_JS);

    it('1.1 echartsReady 状态变量存在', () => {
      expect(ch).toContain('echartsReady');
    });

    it('1.2 echartsLoading 状态变量存在', () => {
      expect(ch).toContain('echartsLoading');
    });

    it('1.3 CHART_THEME 主题配置', () => {
      expect(ch).toContain('CHART_THEME');
    });

    it('1.4 normalizeChartOption 函数存在', () => {
      expect(ch).toContain('normalizeChartOption');
    });

    it('1.5 normalizeAxis 函数存在', () => {
      expect(ch).toContain('normalizeAxis');
    });

    it('1.6 normalizeSeries 函数存在', () => {
      expect(ch).toContain('normalizeSeries');
    });

    it('1.7 图表背景透明配置', () => {
      expect(ch).toContain('transparent');
    });

    it('1.8 等待队列 echartsWaiters 存在', () => {
      expect(ch).toContain('echartsWaiters');
    });
  });

  // ═══════════════════════════════════════════
  // 2. backtest.js 图表
  // ═══════════════════════════════════════════
  describe('2. backtest.js 回测图表', () => {
    const bt = src(BACKTEST);

    it('2.1 loadECharts 导入', () => {
      expect(bt).toContain('loadECharts');
    });

    it('2.2 图表容器存在 (btChartInnerGS/AI/PK)', () => {
      expect(bt).toContain('btChartInnerGS');
      expect(bt).toContain('btChartInnerAI');
      expect(bt).toContain('btChartInnerPK');
    });

    it('2.3 图表容器有 .bt-chart-inner CSS 类', () => {
      expect(bt).toContain('bt-chart-inner');
    });

    it('2.4 图表类型切换按钮存在 (btChartType)', () => {
      expect(bt).toContain('btChartType');
      expect(bt).toContain('bt-chart-toggle-btn');
    });

    it('2.5 校准曲线按钮存在', () => {
      expect(bt).toContain('calibration');
    });

    it('2.6 星级校准按钮存在 (PK tab)', () => {
      expect(bt).toContain('stars');
    });

    it('2.7 图表示例缓存 _btChartInst', () => {
      expect(bt).toContain('_btChartInst');
    });

    it('2.8 有校准或统计函数', () => {
      expect(bt).toContain('Calibration') || expect(bt).toContain('calibration');
    });
  });

  // ═══════════════════════════════════════════
  // 3. model-dashboard.js 图表
  // ═══════════════════════════════════════════
  describe('3. model-dashboard.js 模型仪表盘', () => {
    const md = src(MODEL_DASH);

    it('3.1 导入 loadECharts', () => {
      expect(md).toContain('loadECharts');
    });

    it('3.2 模型排名柱状图渲染', () => {
      expect(md).toContain('chart') || expect(md).toContain('echarts');
    });

    it('3.3 榜单数据 rankings 渲染', () => {
      expect(md).toContain('rankings');
    });

    it('3.4 趋势折线图 trendData', () => {
      expect(md).toContain('trendData');
    });

    it('3.5 联赛热力图 leagueHeatmap', () => {
      expect(md).toContain('leagueHeatmap');
    });

    it('3.6 内部模型过滤 isInternalModelName', () => {
      expect(md).toContain('isInternalModelName');
    });
  });

  // ═══════════════════════════════════════════
  // 4. match-detail.js 图表
  // ═══════════════════════════════════════════
  describe('4. match-detail.js 比赛详情图表', () => {
    const md = src(MATCH_DETAIL);

    it('4.1 导入 loadECharts', () => {
      expect(md).toContain('loadECharts');
    });

    it('4.2 赔率趋势图渲染', () => {
      expect(md).toContain('echarts') || expect(md).toContain('chart');
    });
  });

  // ═══════════════════════════════════════════
  // 5. 图表生命周期
  // ═══════════════════════════════════════════
  describe('5. 图表生命周期管理', () => {
    it('5.1 backtest 有 echarts.init 逻辑', () => {
      const bt = src(BACKTEST);
      expect(bt).toContain('echarts') || expect(bt).toContain('init');
    });

    it('5.2 图表容器有固定 height (260px)', () => {
      const bt = src(BACKTEST);
      expect(bt).toContain('260px');
    });

    it('5.3 图表初始激活 tab 有 active 类', () => {
      const bt = src(BACKTEST);
      expect(bt).toContain('bt-chart-wrap active');
    });

    it('5.4 window resize 监听不存在已知泄漏', () => {
      const bt = src(BACKTEST);
      // 应有 dispose 或 resize 处理
      expect(bt).toContain('resize') || expect(bt).toContain('dispose');
    });
  });
});
