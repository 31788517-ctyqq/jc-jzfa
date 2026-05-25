// ECharts 按需懒加载
export var echartsReady = false;
export var echartsLoading = false;

var echartsWaiters = [];

export function loadECharts() {
  return new Promise(function (resolve) {
    if (typeof echarts !== 'undefined') { echartsReady = true; return resolve(); }
    if (echartsLoading) { echartsWaiters.push(resolve); return; }
    echartsLoading = true;
    var script = document.createElement('script');
    script.src = '/assets/echarts.min.js?v=1';
    script.onload = function () {
      echartsReady = true;
      echartsLoading = false;
      resolve();
      echartsWaiters.forEach(function (w) { w(); });
    };
    script.onerror = function () {
      echartsLoading = false;
      console.warn('ECharts 加载失败，图表功能不可用');
      resolve();
    };
    document.head.appendChild(script);
  });
}
