const API = require('../../utils/api');

Page({
  data: {
    // 联赛列表
    leagueOptions: ['全部'],
    leagueIndex: 0,

    // 时间选项
    timeOptions: ['全部时间', '近一个月', '近两个月', '近三个月'],
    timeIndex: 0,

    // 方向类型（一级）
    directionTypeOptions: ['全部', '胜平负', '让球', '进球数', '双选', '半全场'],
    directionTypeIndex: 0,

    // 方向（二级）
    directionOptions: [],
    directionIndex: 0,
    showDirection: false,

    // 方向映射表
    directionMap: {
      '胜平负': ['全部', '胜', '平', '负'],
      '让球': ['全部', '让胜', '让平', '让负'],
      '进球数': ['全部', '1,2', '2,3', '3,4', '1,2,3', '2,3,4', '3,4,5'],
      '双选': ['全部', '平,让平', '让胜,让平', '让平,让负', '胜,平', '平,负'],
      '半全场': ['全部', '胜胜', '负负']
    },

    // 排名选项
    rankOptions: ['全部', '第一名', '前二名', '前三名', '前四名', '前五名', '前六名'],
    rankIndex: 0,

    // 结果
    loading: false,
    queried: false,
    hitCount: 0,
    totalCount: 0,
    hitRate: 0,
    conditionSummary: '',
    detailList: []
  },

  onLoad() {
    this.loadLeagues();
  },

  /**
   * 加载联赛列表
   */
  async loadLeagues() {
    try {
      // 从数据库获取联赛列表
      const leagues = await API.getFilterLeagues();
      if (leagues && leagues.length > 0) {
        this.setData({
          leagueOptions: ['全部', ...leagues]
        });
      }
    } catch (err) {
      // 联赛加载失败不影响使用，保留默认的"全部"
      console.warn('加载联赛列表失败:', err);
    }
  },

  /**
   * 联赛选择
   */
  onLeagueChange(e) {
    this.setData({ leagueIndex: Number(e.detail.value) });
  },

  /**
   * 时间选择
   */
  onTimeChange(e) {
    this.setData({ timeIndex: Number(e.detail.value) });
  },

  /**
   * 方向类型选择（一级）
   */
  onDirectionTypeChange(e) {
    const index = Number(e.detail.value);
    const type = this.data.directionTypeOptions[index];
    const subDirs = this.data.directionMap[type];

    this.setData({
      directionTypeIndex: index,
      showDirection: type !== '全部',
      directionOptions: subDirs || [],
      directionIndex: 0
    });
  },

  /**
   * 方向选择（二级）
   */
  onDirectionChange(e) {
    this.setData({ directionIndex: Number(e.detail.value) });
  },

  /**
   * 排名选择
   */
  onRankChange(e) {
    this.setData({ rankIndex: Number(e.detail.value) });
  },

  /**
   * 构建请求参数
   */
  buildParams() {
    const {
      leagueOptions, leagueIndex,
      timeOptions, timeIndex,
      directionTypeOptions, directionTypeIndex,
      directionOptions, directionIndex,
      rankIndex
    } = this.data;

    // 时间映射
    const timeMap = { 0: 'all', 1: '30', 2: '60', 3: '90' };
    // 排名映射
    const rankMap = [0, 1, 2, 3, 4, 5, 6];

    const directionType = directionTypeOptions[directionTypeIndex];
    let direction = '';
    if (directionType !== '全部' && directionOptions.length > 0) {
      const dir = directionOptions[directionIndex];
      direction = dir === '全部' ? '' : dir;
    }

    return {
      league: leagueIndex === 0 ? '' : leagueOptions[leagueIndex],
      timeRange: timeMap[timeIndex],
      directionType: directionType === '全部' ? '' : directionType,
      direction: direction,
      rankTop: rankMap[rankIndex]
    };
  },

  /**
   * 执行查询
   */
  async doQuery() {
    this.setData({ loading: true });
    try {
      const params = this.buildParams();
      const result = await API.getFilterData(params);

      this.setData({
        loading: false,
        queried: true,
        hitCount: result.hitCount || 0,
        totalCount: result.totalCount || 0,
        hitRate: result.hitRate || 0,
        conditionSummary: result.conditionSummary || '',
        detailList: result.detailList || []
      });
    } catch (err) {
      console.error('筛选查询失败:', err);
      wx.showToast({ title: '查询失败，请重试', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack();
  }
});
