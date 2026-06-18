// ECharts 按需懒加载
export var echartsReady = false;
export var echartsLoading = false;

const echartsWaiters = [];

const CHART_THEME = {
  main: '#243238',
  sub: '#4f646a',
  muted: '#6f8086',
  grid: 'rgba(130,158,164,0.18)',
  gridSoft: 'rgba(130,158,164,0.12)',
  tooltipBg: 'rgba(255,255,255,0.96)',
  font: "-apple-system,BlinkMacSystemFont,'PingFang SC','Helvetica Neue',sans-serif",
};

function isOldTextColor(color) {
  return (
    !color ||
    color === '#94A3B8' ||
    color === '#64748B' ||
    color === '#fff' ||
    color === '#FFFFFF' ||
    color === '#E2E8F0'
  );
}

function normalizeAxis(axis, isCategory) {
  if (!axis) return;
  axis.axisLabel = Object.assign({}, axis.axisLabel || {}, {
    color: CHART_THEME.sub,
    fontSize: 11,
    fontWeight: 600,
    lineHeight: 16,
  });
  if (isCategory && axis.axisLabel.rotate) {
    axis.axisLabel.fontSize = 10;
    axis.axisLabel.color = CHART_THEME.sub;
  }
  axis.nameTextStyle = Object.assign({}, axis.nameTextStyle || {}, {
    color: CHART_THEME.sub,
    fontSize: 11,
    fontWeight: 600,
  });
  axis.axisLine = Object.assign({}, axis.axisLine || {}, {
    lineStyle: Object.assign({}, (axis.axisLine && axis.axisLine.lineStyle) || {}, { color: CHART_THEME.grid }),
  });
  axis.axisTick = Object.assign({}, axis.axisTick || {}, {
    lineStyle: Object.assign({}, (axis.axisTick && axis.axisTick.lineStyle) || {}, { color: CHART_THEME.grid }),
  });
  axis.splitLine = Object.assign({}, axis.splitLine || {}, {
    lineStyle: Object.assign({}, (axis.splitLine && axis.splitLine.lineStyle) || {}, { color: CHART_THEME.gridSoft }),
  });
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeSeries(series) {
  asArray(series).forEach(function (s) {
    if (!s) return;
    if (s.label && s.label.show !== false) {
      s.label = Object.assign({}, s.label, {
        color: isOldTextColor(s.label.color) ? CHART_THEME.main : s.label.color,
        fontSize: Math.max(11, s.label.fontSize || 11),
        fontWeight: s.label.fontWeight || 600,
      });
    }
    if (s.labelLine && s.labelLine.lineStyle) {
      s.labelLine.lineStyle.color = CHART_THEME.grid;
    }
  });
}

function normalizeChartOption(option) {
  if (!option || typeof option !== 'object') return option;
  option.backgroundColor = 'transparent';
  option.textStyle = Object.assign({}, option.textStyle || {}, {
    color: CHART_THEME.sub,
    fontSize: 11,
    fontFamily: CHART_THEME.font,
  });
  option.legend = Object.assign({}, option.legend || {}, {
    textStyle: Object.assign({}, (option.legend && option.legend.textStyle) || {}, {
      color: CHART_THEME.sub,
      fontSize: 11,
      fontWeight: 600,
    }),
  });
  option.tooltip = Object.assign({}, option.tooltip || {}, {
    backgroundColor: CHART_THEME.tooltipBg,
    borderColor: CHART_THEME.grid,
    textStyle: Object.assign({}, (option.tooltip && option.tooltip.textStyle) || {}, {
      color: CHART_THEME.main,
      fontSize: 12,
    }),
  });
  if (option.title) {
    asArray(option.title).forEach(function (title) {
      title.textStyle = Object.assign({}, title.textStyle || {}, {
        color: CHART_THEME.main,
        fontSize: 14,
        fontWeight: 800,
      });
      title.subtextStyle = Object.assign({}, title.subtextStyle || {}, {
        color: CHART_THEME.sub,
        fontSize: 11,
      });
    });
  }
  asArray(option.xAxis).forEach(function (axis) {
    normalizeAxis(axis, axis && axis.type === 'category');
  });
  asArray(option.yAxis).forEach(function (axis) {
    normalizeAxis(axis, axis && axis.type === 'category');
  });
  asArray(option.angleAxis).forEach(function (axis) {
    normalizeAxis(axis, false);
  });
  asArray(option.radiusAxis).forEach(function (axis) {
    normalizeAxis(axis, false);
  });
  normalizeSeries(option.series);
  return option;
}

function patchEChartsTheme() {
  if (typeof echarts === 'undefined' || echarts.__alpineMintPatched) return;
  const rawInit = echarts.init;
  echarts.init = function () {
    const inst = rawInit.apply(echarts, arguments);
    if (inst && !inst.__alpineMintPatched) {
      const rawSetOption = inst.setOption;
      inst.setOption = function (option) {
        if (option) normalizeChartOption(option);
        return rawSetOption.apply(inst, arguments);
      };
      inst.__alpineMintPatched = true;
    }
    return inst;
  };
  echarts.__alpineMintPatched = true;
}

export function loadECharts() {
  return new Promise(function (resolve) {
    if (typeof echarts !== 'undefined') {
      echartsReady = true;
      patchEChartsTheme();
      return resolve();
    }
    if (echartsLoading) {
      echartsWaiters.push(resolve);
      return;
    }
    echartsLoading = true;
    const script = document.createElement('script');
    script.src = '/assets/echarts.min.js?v=1';
    script.onload = function () {
      echartsReady = true;
      echartsLoading = false;
      patchEChartsTheme();
      resolve();
      echartsWaiters.forEach(function (w) {
        w();
      });
    };
    script.onerror = function () {
      echartsLoading = false;
      console.warn('ECharts 加载失败，图表功能不可用');
      resolve();
    };
    document.head.appendChild(script);
  });
}

// ═══ ECharts 实例注册管理（防止内存泄漏） ═══
const _chartInstances = {};

/**
 * 创建并注册 ECharts 实例（页面切换时统一 dispose）
 * @param {string} id        - DOM 元素 ID
 * @param {string} namespace - 命名空间（如 'backtest', 'match-detail'）
 * @returns {Object|null} echarts 实例
 */
export function createChart(id, namespace) {
  if (typeof echarts === 'undefined') return null;
  patchEChartsTheme();
  const el = document.getElementById(id);
  if (!el) return null;
  // 清理旧实例
  const key = namespace + ':' + id;
  if (_chartInstances[key]) {
    _chartInstances[key].dispose();
  }
  const instance = echarts.init(el);
  _chartInstances[key] = instance;
  return instance;
}

/**
 * 按命名空间清理所有 ECharts 实例（页面卸载时调用）
 * @param {string} namespace - 命名空间
 */
export function disposeCharts(namespace) {
  Object.keys(_chartInstances).forEach(function (key) {
    if (key.indexOf(namespace + ':') === 0) {
      try {
        _chartInstances[key].dispose();
      } catch (_) {}
      delete _chartInstances[key];
    }
  });
}

/**
 * 获取已注册实例（避免重复创建）
 */
export function getChart(id, namespace) {
  return _chartInstances[namespace + ':' + id] || null;
}
