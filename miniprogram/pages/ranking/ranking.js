const API = require('../../utils/api');
const DATE = require('../../utils/date');

Page({
  data: {
    rankings: [],
    loading: true,
    refreshing: false,
    filterDirection: '',
    filterCategory: '',
    selectedTab: 0,
    topExpertCount: 1,
    rankTabs: [
      { text: '综合排名', category: '', direction: '' },
      { text: '胜平负', category: '胜平负', direction: '' },
      { text: '半全场', category: '半全场', direction: '' },
      { text: '进球数', category: '进球数', direction: '' },
      { text: '双选', category: '双选', direction: '' },
      { text: '让球', category: '让球', direction: '' }
    ]
  },

  onShow() {
    this.loadRankings();
  },

  async loadRankings() {
    this.setData({ loading: true, refreshing: false });
    try {
      const data = await API.getRankingList(
        DATE.getToday(),
        this.data.filterDirection || null,
        this.data.filterCategory || null
      );
      const ranking = data.ranking || [];
      const topCount = ranking.length > 0 ? ranking[0].expertCount : 1;

      this.setData({
        rankings: ranking,
        topExpertCount: topCount,
        loading: false,
        refreshing: false
      });
    } catch (err) {
      console.error('加载排名失败:', err);
      this.setData({ loading: false, refreshing: false });
    }
  },

  onChipTap(e) {
    const index = e.currentTarget.dataset.index;
    const item = this.data.rankTabs[index] || this.data.rankTabs[0];
    this.setData({
      selectedTab: index,
      filterDirection: item.direction || '',
      filterCategory: item.category || ''
    });
    this.loadRankings();
  },

  onRefresh() {
    this.setData({ refreshing: true });
    this.loadRankings();
  },

  goDetail(e) {
    const { matchId } = e.detail || {};
    if (matchId) {
      wx.navigateTo({ url: `/pages/match-detail/match-detail?matchId=${matchId}` });
    }
  }
});
