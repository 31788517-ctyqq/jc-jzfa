// ECharts 按需懒加载
export var echartsReady = false;
export var echartsLoading = false;

var echartsWaiters = [];

export function loadECharts() {
  return new Promise(function (resolve) {
    if (typeof echarts !== 'undefined') {
      echartsReady = true;
      return resolve();
    }
    if (echartsLoading) {
      echartsWaiters.push(resolve);
      return;
    }
    echartsLoading = true;
    var script = document.createElement('script');
    script.src = '/assets/echarts.min.js?v=1';
    script.onload = function () {
      echartsReady = true;
      echartsLoading = false;
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
var _chartInstances = {};

/**
 * 创建并注册 ECharts 实例（页面切换时统一 dispose）
 * @param {string} id        - DOM 元素 ID
 * @param {string} namespace - 命名空间（如 'backtest', 'match-detail'）
 * @returns {Object|null} echarts 实例
 */
export function createChart(id, namespace) {
  if (typeof echarts === 'undefined') return null;
  var el = document.getElementById(id);
  if (!el) return null;
  // 清理旧实例
  var key = namespace + ':' + id;
  if (_chartInstances[key]) {
    _chartInstances[key].dispose();
  }
  var instance = echarts.init(el);
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
      try { _chartInstances[key].dispose(); } catch (_) {}
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
