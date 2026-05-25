/**
 * Token 管理器
 * 统一管理 midou310.com 登录 token，支持多模块共享复用
 * - Token 有效期约 1 小时，提前 10 分钟续期
 * - 所有模块通过此单例获取 token，避免重复登录请求
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

// 加载 .env 配置
let CONFIG = { MIDOU_MOBILE: '', MIDOU_PASSWORD: '' };
try {
  const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  envFile.split('\n').forEach(l => {
    const p = l.trim().split('=');
    if (p.length === 2) CONFIG[p[0]] = p[1];
  });
} catch (e) {}

const TOKEN_TTL = 50 * 60 * 1000; // 50分钟（提前10分钟续期）

let token = null;
let expireAt = 0;
let loginPromise = null; // 防止并发登录

function get(url, params, headers) {
  return new Promise((resolve, reject) => {
    const qs = params ? '?' + Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&') : '';
    const fullUrl = url + qs;
    const urlObj = new URL(fullUrl);

    const req = https.request({
      hostname: urlObj.hostname, port: 443,
      path: urlObj.pathname + urlObj.search, method: 'GET',
      headers: Object.assign({
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0'
      }, headers || {}),
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let text;
        try { text = iconv.decode(buffer, 'utf-8'); JSON.parse(text); } catch (e) {
          try { text = iconv.decode(buffer, 'gbk'); JSON.parse(text); } catch (e2) {
            text = buffer.toString('utf-8');
          }
        }
        try { resolve(JSON.parse(text)); } catch (e) { reject(new Error('JSON parse fail')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.abort(); reject(new Error('timeout')); });
    req.end();
  });
}

async function doLogin() {
  const res = await get('https://midou310.com/mdsj/gduser/login.do', {
    mobile: CONFIG.MIDOU_MOBILE, password: CONFIG.MIDOU_PASSWORD
  });
  if (res.code !== 1) throw new Error('登录失败: ' + (res.msg || 'unknown'));
  return res.data.token;
}

/**
 * 获取有效 token（自动续期）
 */
async function getToken() {
  const now = Date.now();

  // Token 仍有效，直接返回
  if (token && now < expireAt) return token;

  // 正在登录中，等待结果（防并发）
  if (loginPromise) return loginPromise;

  // 需要重新登录
  loginPromise = (async () => {
    try {
      console.log('[token_manager] 登录 midou310.com...');
      token = await doLogin();
      expireAt = Date.now() + TOKEN_TTL;
      console.log('[token_manager] 登录成功, Token 有效期至', new Date(expireAt).toISOString());
      return token;
    } catch (e) {
      console.error('[token_manager] 登录失败:', e.message);
      throw e;
    } finally {
      loginPromise = null;
    }
  })();

  return loginPromise;
}

/**
 * 强制刷新 token（登录失败后调用）
 */
async function refreshToken() {
  token = null;
  expireAt = 0;
  return getToken();
}

module.exports = { getToken, refreshToken };
