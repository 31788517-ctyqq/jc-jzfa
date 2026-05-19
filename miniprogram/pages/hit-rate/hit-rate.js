const API = require('../../utils/api');

Page({
  data: {
    loading: true,
    directionStats: [],
    topStats: [],
    dailyTrend: [],
    totalDays: 0,
    avgHitRate: 0
  },

  onShow() {
    this.loadStats();
  },

  async loadStats() {
    this.setData({ loading: true });
    try {
      const data = await API.getHitRateStats(60);
      const rawStats = data.directionStats || [];
      const directionStats = rawStats.map((item, index) => {
        const hitRate = Number(item.hitRate || 0);
        return {
          ...item,
          rank: index + 1,
          rankTop: index < 3,
          isDanger: hitRate < 40,
          hitRate: hitRate.toFixed(1).replace('.0', ''),
          barWidth: Math.max(8, Math.min(100, hitRate))
        };
      });
      const total = rawStats.reduce((sum, d) => sum + Number(d.hitRate || 0), 0);
      const avg = rawStats.length > 0 ? (total / rawStats.length).toFixed(1) : 0;

      this.setData({
        directionStats,
        topStats: directionStats.slice(0, 5),
        dailyTrend: data.dailyTrend || [],
        totalDays: data.totalDays || 0,
        avgHitRate: avg,
        loading: false
      });
    } catch (err) {
      console.error('加载命中率失败:', err);
      this.setData({ loading: false });
    }
  }
});
