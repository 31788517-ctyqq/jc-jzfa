const API = require('../../utils/api');
const DATE = require('../../utils/date');

Page({
  data: {
    currentDate: DATE.getToday(),
    matchList: [],
    loading: true,
    refreshing: false,
    selectedIndex: -1
  },

  onShow() {
    this.loadMatches();
  },

  async loadMatches() {
    this.setData({ loading: true, refreshing: false });
    try {
      const matches = await API.getMatchList(this.data.currentDate);
      this.setData({ matchList: matches, loading: false, refreshing: false });
    } catch (err) {
      console.error('加载比赛列表失败:', err);
      this.setData({ loading: false, refreshing: false });
    }
  },

  prevDay() {
    const d = new Date(this.data.currentDate);
    d.setDate(d.getDate() - 1);
    this.setData({ currentDate: DATE.formatDate(d) });
    this.loadMatches();
  },

  nextDay: async function() {
    const d = new Date(this.data.currentDate);
    d.setDate(d.getDate() + 1);
    const nextDate = DATE.formatDate(d);
    // 检查后一天是否有比赛数据，没有则不跳转
    try {
      const matches = await API.getMatchList(nextDate);
      if (!matches || matches.length === 0) {
        wx.showToast({ title: '后一天暂无比赛', icon: 'none', duration: 1500 });
        return;
      }
      this.setData({ currentDate: nextDate, matchList: matches });
    } catch (err) {
      this.setData({ currentDate: nextDate });
      this.loadMatches();
    }
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadMatches();
  },

  goDetail(e) {
    const { matchId } = e.detail || e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/match-detail/match-detail?matchId=${matchId}` });
  }
});
