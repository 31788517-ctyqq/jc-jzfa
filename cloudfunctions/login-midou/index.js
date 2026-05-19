const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const axios = require('axios');

/**
 * 登录米斗数据，获取认证token
 * 入参: 无（使用环境变量）
 * 出参: { code: 1, data: { token, userId } }
 */
exports.main = async (event, context) => {
  const MOBILE = process.env.MIDOU_MOBILE;
  const PASSWORD = process.env.MIDOU_PASSWORD;

  if (!MOBILE || !PASSWORD) {
    return { code: 102, msg: '缺少环境变量 MIDOU_MOBILE 或 MIDOU_PASSWORD' };
  }

  try {
    const resp = await axios.get('https://midou310.com/mdsj/gduser/login.do', {
      params: { mobile: MOBILE, password: PASSWORD },
      timeout: 10000
    });

    if (resp.data && resp.data.code === 1) {
      const token = resp.data.data.token;
      const userId = resp.data.data.userId;
      return { code: 1, data: { token, userId } };
    }
    return { code: 102, msg: `登录失败: ${(resp.data && resp.data.msg) || '未知错误'}` };
  } catch (err) {
    console.error('[login-midou]', err.message);
    return { code: 104, msg: `登录异常: ${err.message}` };
  }
};
