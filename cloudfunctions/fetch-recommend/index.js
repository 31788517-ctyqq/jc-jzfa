const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const axios = require('axios');

/**
 * 获取单场比赛的推荐详情
 * 入参: { matchId: "2039816" }
 */
exports.main = async (event, context) => {
  const { matchId } = event;
  if (!matchId) {
    return { code: 101, msg: '缺少 matchId' };
  }

  try {
    const loginRes = await cloud.callFunction({ name: 'login-midou', data: {} });
    if (loginRes.result.code !== 1) return loginRes.result;
    const token = loginRes.result.data.token;

    const resp = await axios.get('https://midou310.com/mdsj/score/getExpertRecommData.do', {
      params: { dataId: matchId, type: 0 },
      headers: { Cookie: `token=${token}` },
      timeout: 10000
    });

    if (!resp.data || resp.data.code !== 1) {
      return { code: 0, msg: `获取推荐失败: ${resp.data && resp.data.msg}` };
    }

    const rawData = resp.data.data || [];
    const recommendations = rawData
      .filter(item => item && item.type)
      .map(item => ({
        type: item.type,
        num: item.num !== undefined ? item.num : 0,
        result: item.result !== undefined ? item.result : null
      }));

    return {
      code: 1,
      data: {
        matchId,
        captureTime: new Date().toISOString(),
        captureTimestamp: Date.now(),
        recommendations,
        rawData
      }
    };
  } catch (err) {
    console.error(`[fetch-recommend] matchId=${matchId}`, err.message);
    return { code: 0, msg: `获取推荐异常: ${err.message}` };
  }
};
