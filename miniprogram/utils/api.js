/**
 * miniprogram/utils/api.js
 * 微信小程序 API 调用封装
 * 
 * ⚠ CloudBase 云函数模式已废弃，当前生产环境使用自建 Express 服务器。
 *    如需切换回 CloudBase，参考 server/api-schema.json 中的接口定义。
 * 
 * API 规范: server/api-schema.json
 */

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

function getFilterData(params) {
  return request('hit-rate-filter', params);
}

function getFilterLeagues() {
  return request('filter-leagues');
}

module.exports = {
  request,
  getMatchList,
  getRecommendTrend,
  getHitRateStats,
  getRankingList,
  getMatchDetail,
  getFilterData,
  getFilterLeagues
};
