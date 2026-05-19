const API = require('../../utils/api');
const FORMAT = require('../../utils/format');
const CONSTANTS = require('../../utils/constants');
const DATE = require('../../utils/date');

Page({
  data: {
    matchId: '',
    homeName: '',
    visitName: '',
    leagueName: '',
    startTime: '',
    matchStatus: 0,
    score: '',
    scoreDisplay: 'VS',
    statusText: '',
    displayTime: '',
    recommendations: [],
    directionColors: CONSTANTS.DIRECTION_COLORS,
    chartConfig: { lazyLoad: true },
    timeLabels: [],
    series: [],
    loading: true,
    num: '',
    date: '',
    roundDisplay: ''
  },

  onLoad(options) {
    if (options.matchId) {
      this.setData({ matchId: options.matchId });
      this.loadAllData();
    }
  },

  async loadAllData() {
    this.setData({ loading: true });
    try {
      const [match, trend] = await Promise.all([
        API.getMatchDetail(this.data.matchId),
        API.getRecommendTrend(this.data.matchId)
      ]);

      if (match && match.matchId) {
        const roundDisplay = DATE.getRoundDisplay(match.date, match.num);
        this.setData({
          homeName: match.homeName || '',
          visitName: match.visitName || '',
          leagueName: match.leagueName || '',
          startTime: match.startTime || '',
          matchStatus: match.matchStatus || 0,
          score: match.score || '',
          scoreDisplay: match.score || 'VS',
          statusText: FORMAT.getStatusText(match.matchStatus),
          num: match.num || '',
          date: match.date || '',
          roundDisplay,
          displayTime: [match.startTime, roundDisplay].filter(Boolean).join(' · ')
        });
      }

      this.setData({
        recommendations: (trend.lastResult || []).filter(item => item && item.num > 0),
        timeLabels: trend.timeLabels || [],
        series: trend.series || [],
        loading: false
      });

      setTimeout(() => this.initChart(), 60);
    } catch (err) {
      console.error('加载比赛数据失败:', err);
      this.setData({ loading: false });
    }
  },

  initChart() {
    if (this.data.series.length === 0) return;
    const chartComponent = this.selectComponent('#trendChart');
    if (!chartComponent) {
      setTimeout(() => this.initChart(), 300);
      return;
    }
    chartComponent.init((canvas, width, height, dpr) => {
      const echarts = require('../../ec-canvas/echarts');
      const chart = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
      this.setChartOption(chart);
      this.chart = chart;
      return chart;
    });
  },

  setChartOption(chart) {
    const labels = this.data.timeLabels;
    const palette = ['#6de02c', '#ff2d35', '#ffac1a', '#22a8ff', '#7ed321', '#12f1e7', '#b46cff'];
    const colors = this.data.series.map((s, idx) => CONSTANTS.DIRECTION_COLORS[s.name] || palette[idx % palette.length]);
    const interval = labels.length > 8 ? Math.ceil(labels.length / 6) : 0;

    chart.setOption({
      backgroundColor: 'transparent',
      color: colors,
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(0, 18, 26, 0.92)',
        borderColor: 'rgba(18, 241, 231, 0.32)',
        textStyle: { color: '#ffffff', fontSize: 11 }
      },
      legend: { show: false },
      grid: {
        left: 8,
        right: 10,
        bottom: 44,
        top: 20,
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: {
          color: 'rgba(255,255,255,0.78)',
          fontSize: 10,
          interval,
          margin: 12
        },
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.10)' } },
        axisTick: { show: false },
        splitLine: { show: true, lineStyle: { color: 'rgba(255,255,255,0.04)' } }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: 'rgba(255,255,255,0.78)', fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } }
      },
      series: this.data.series.map((s, idx) => ({
        ...s,
        type: 'line',
        smooth: true,
        lineStyle: { width: 2, color: colors[idx] },
        itemStyle: { color: colors[idx] },
        symbol: 'circle',
        symbolSize: 5,
        areaStyle: { opacity: 0 },
        emphasis: { focus: 'series' }
      }))
    });
  },

  goBack() {
    wx.navigateBack();
  },

  switchTab(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.switchTab({ url });
  }
});
