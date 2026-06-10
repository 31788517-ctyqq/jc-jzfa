module.exports = {
  navigation: {
    // 首屏导航预算（ms）
    ttfbMs: 1200,
    domContentLoadedMs: 2600,
    loadMs: 3600,
  },
  routeSwitch: {
    // 页面切换预算（ms）
    home: 1200,
    match: 2000,
    rank: 2200,
    hit: 2200,
    plan: 2200,
    income: 2200,
    'quant-rank': 2600,
    filter: 2200,
    backtest: 2800,
    scheme: 2400,
    'model-dashboard': 2600,
    'data-health': 2600,
    'confirm-scheme': 2200,
  },
};
