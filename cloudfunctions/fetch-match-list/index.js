const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const axios = require('axios');

/**
 * 获取指定日期的比赛列表
 * 入参: { date: "2026-05-18" }
 */
exports.main = async (event, context) => {
  const { date } = event;
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const ctx = cloud.getWXContext();
  console.log(`[fetch-match-list] 抓取日期: ${targetDate}, 调用者: ${ctx.FUNCTION_NAME}`);

  try {
    const loginRes = await cloud.callFunction({ name: 'login-midou', data: {} });
    if (loginRes.result.code !== 1) return loginRes.result;
    const token = loginRes.result.data.token;

    const timestamp = new Date(targetDate).getTime();
    const resp = await axios.get('https://midou310.com/mdsj/score/footballDataList.do', {
      params: { time: timestamp, order: ' status desc, start_datetime asc, data_id asc ' },
      headers: { Cookie: `token=${token}` },
      timeout: 15000
    });

    if (!resp.data || resp.data.code !== 1) {
      return { code: 0, msg: '获取比赛列表失败' };
    }

    const matches = (resp.data.data || []).map(m => ({
      matchId: String(m.matchId),
      num: m.num || '',
      homeName: m.homeName || '',
      visitName: m.visitName || '',
      leagueName: m.leagueName || '',
      startTime: m.startTime || '',
      startDatetime: `${targetDate} ${m.startTime || ''}`,
      matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
      score: m.score || '',
      halfScore: m.halfScore || '',
      duration: m.duration || '',
      recommNum: m.recommNum || 0,
      bigDataNum: m.bigDataNum || 0,
      liveNum: m.liveNum || 0,
      date: targetDate,
      captureTime: new Date().toISOString()
    }));

    return { code: 1, data: matches };
  } catch (err) {
    console.error('[fetch-match-list]', err.message);
    return { code: 0, msg: `获取比赛列表异常: ${err.message}` };
  }
};
