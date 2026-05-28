/**
 * preview/js/api-schema.js
 * 前后端共享 API 接口规范 (与 server/api-schema.json 保持一致)
 * 
 * 调用方式:
 *   const api = require('./api.js');
 *   api.request('match-list', { date: '2026-05-28' }).then(data => {...});
 */

// 当前服务端地址（生产环境由 nginx 代理到同一域名）
const BASE_URL = '';

/**
 * 通用 API 请求
 * @param {string} action  操作名称（对应 api-schema.json 中的 action）
 * @param {object} data    业务参数
 */
function request(action, data = {}) {
  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', BASE_URL + '/api', true);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.timeout = 30000;
    xhr.onload = function() {
      try {
        var r = JSON.parse(xhr.responseText);
        if (r.code === 1) { resolve(r.data); }
        else { reject(new Error(r.msg || '请求失败')); }
      } catch (e) { reject(e); }
    };
    xhr.onerror = function() { reject(new Error('网络异常')); };
    xhr.ontimeout = function() { reject(new Error('请求超时')); };
    xhr.send(JSON.stringify({ action: action, data: data }));
  });
}

// ── 封装函数（与 api-schema.json actions 对应） ──
function getMatchList(date)           { return request('match-list', { date }); }
function getMatchDetail(matchId)       { return request('match-detail', { matchId }); }
function getRecommendTrend(matchId)    { return request('recommend-trend', { matchId }); }
function getRankingList(date, dir, cat){ return request('ranking-list', { date, direction: dir, category: cat }); }
function getHitRateStats(days)         { return request('hit-rate-stats', { days }); }
function getFilterStats()              { return request('filter-stats'); }
function getFilterData(params)         { return request('hit-rate-filter', params); }
function getFilterLeagues()            { return request('filter-leagues'); }
function getAIPredict(matchId, force)  { return request('ai-predict', { matchId, force }); }
function getAIPredictStatus(matchId)   { return request('ai-predict-status', { matchId }); }
function getWeekDates()                { return request('week-dates'); }
function getMatchOdds(matchId, date)   { return request('match-odds', { matchId, date }); }
function getQuantHot(date)             { return request('quant-hot', { date }); }
function getGongShouDao(matchId, date) { return request('gongshoudao', { matchId, date }); }
function getGongShouDaoAll(date)       { return request('gongshoudao-all', { date }); }
function getPlanList(date)             { return request('plan-list', { date }); }
function getIncomeStats(days)          { return request('income-stats', { days }); }

module.exports = {
  request,
  getMatchList, getMatchDetail, getRecommendTrend,
  getRankingList, getHitRateStats,
  getFilterStats, getFilterData, getFilterLeagues,
  getAIPredict, getAIPredictStatus,
  getWeekDates, getMatchOdds, getQuantHot,
  getGongShouDao, getGongShouDaoAll,
  getPlanList, getIncomeStats
};
