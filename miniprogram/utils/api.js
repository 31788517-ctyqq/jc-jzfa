const CLOUD_FN = 'get-match-data';

function request(action, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: CLOUD_FN,
      data: { action, data },
      success: (res) => {
        if (res.result && res.result.code === 1) {
          resolve(res.result.data);
        } else {
          reject(new Error((res.result && res.result.msg) || '请求失败'));
        }
      },
      fail: (err) => {
        wx.showToast({ title: '网络异常', icon: 'none' });
        reject(err);
      }
    });
  });
}

function getMatchList(date) {
  return request('match-list', { date });
}

function getRecommendTrend(matchId) {
  return request('recommend-trend', { matchId });
}

function getHitRateStats(days = 30) {
  return request('hit-rate-stats', { days });
}

function getRankingList(date, direction = null, category = null) {
  return request('ranking-list', { date, direction, category });
}

function getMatchDetail(matchId) {
  return request('match-detail', { matchId });
}

module.exports = {
  request,
  getMatchList,
  getRecommendTrend,
  getHitRateStats,
  getRankingList,
  getMatchDetail
};
