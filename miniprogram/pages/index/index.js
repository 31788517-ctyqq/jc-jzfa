const API = require('../../utils/api');
const DATE = require('../../utils/date');

Page({
  data: {
    today: DATE.getToday(),
    matchCount: 0,
    maxRankCount: 0
  },

  onShow() {
    this.loadStats();
  },

  async loadStats() {
    try {
      const today = DATE.getToday();
      const [matches, ranking] = await Promise.all([
        API.getMatchList(today),
        API.getRankingList(today)
      ]);
      this.setData({
        matchCount: matches.length,
        maxRankCount: ranking.totalMatches
      });
    } catch (err) {
      console.error('首页加载失败:', err);
    }
  },

  goMatchList() {
    wx.switchTab({ url: '/pages/match-list/match-list' });
  },

  goRanking() {
    wx.switchTab({ url: '/pages/ranking/ranking' });
  },

  goHitRate() {
    wx.switchTab({ url: '/pages/hit-rate/hit-rate' });
  }
});
