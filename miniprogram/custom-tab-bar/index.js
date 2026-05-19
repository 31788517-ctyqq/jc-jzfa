Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/index/index', text: '首页', iconClass: 'icon-home' },
      { pagePath: '/pages/match-list/match-list', text: '比赛', iconClass: 'icon-ball' },
      { pagePath: '/pages/ranking/ranking', text: '排行', iconClass: 'icon-cup' },
      { pagePath: '/pages/hit-rate/hit-rate', text: '统计', iconClass: 'icon-bars' }
    ]
  },

  lifetimes: {
    attached() {
      this.updateSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.updateSelected();
    }
  },

  methods: {
    updateSelected() {
      const pages = getCurrentPages();
      const route = pages.length ? `/${pages[pages.length - 1].route}` : '';
      const selected = this.data.list.findIndex(item => item.pagePath === route);
      if (selected !== -1 && selected !== this.data.selected) {
        this.setData({ selected });
      }
    },

    switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item) return;
      wx.switchTab({ url: item.pagePath });
    }
  }
});
