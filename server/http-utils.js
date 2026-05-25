/**
 * HTTP 请求工具模块
 * - 支持 GBK 编码解码（米斗数据使用 GBK 编码）
 * - 反封策略：随机 UA 池、请求间隔抖动、失败重试+指数退避
 */
const https = require('https');
const http = require('http');
const iconv = require('iconv-lite');

// ═══ 反封策略：随机 UA 池 ═══
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0',
];

function randomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

/**
 * 请求间隔随机抖动
 * @param {number} baseMs 基础延迟(ms)
 * @returns {number} 50%~150% 范围内的随机延迟
 */
function jitter(baseMs) {
  return Math.floor(baseMs * (0.5 + Math.random() * 1.5));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * HTTP GET 请求，自动处理 GBK 编码（向后兼容）
 */
function get(url, params = {}, headers = {}) {
  return new Promise((resolve, reject) => {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const fullUrl = url + (qs ? '?' + qs : '');
    const urlObj = new URL(fullUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;

    lib.get(fullUrl, { headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);

        // 检测编码：优先使用响应头中的 Content-Type
        const contentType = res.headers['content-type'] || '';
        let encoding = 'utf-8';
        if (contentType.includes('charset=gbk') || contentType.includes('charset=gb2312')) {
          encoding = 'gbk';
        }

        // 尝试 UTF-8 解码，如果失败则用 GBK
        let text;
        try {
          text = iconv.decode(buffer, encoding);
          JSON.parse(text); // 验证是否能解析
        } catch (e) {
          // UTF-8 解码失败，尝试 GBK
          try {
            text = iconv.decode(buffer, 'gbk');
            JSON.parse(text);
          } catch (e2) {
            // GBK 也失败，尝试 UTF-8
            text = buffer.toString('utf-8');
          }
        }

        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('JSON解析失败: ' + (text || buffer.toString('utf-8')).slice(0, 200)));
        }
      });
    }).on('error', reject);
  });
}

/**
 * 带反封策略的 GET 请求（随机 UA + GBK 自动检测 + 超时控制）
 * @param {string} url
 * @param {object} params URL 参数
 * @param {object} extraHeaders 额外请求头（会合并到默认头）
 */
function getWithUA(url, params = {}, extraHeaders = {}) {
  const headers = Object.assign({
    'Accept': 'application/json, text/plain, */*',
    'User-Agent': randomUA(),
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  }, extraHeaders);

  return new Promise((resolve, reject) => {
    const qs = params ? '?' + Object.keys(params).map(k =>
      encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
    ).join('&') : '';
    const fullUrl = url + qs;
    const urlObj = new URL(fullUrl);
    const lib = urlObj.protocol === 'https:' ? https : http;

    const req = lib.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        let encoding = 'utf-8';
        if (contentType.includes('charset=gbk') || contentType.includes('charset=gb2312')) {
          encoding = 'gbk';
        }
        let text;
        try {
          text = iconv.decode(buffer, encoding);
          JSON.parse(text);
        } catch (e) {
          try {
            text = iconv.decode(buffer, 'gbk');
            JSON.parse(text);
          } catch (e2) {
            text = buffer.toString('utf-8');
          }
        }
        try {
          resolve(JSON.parse(text));
        } catch (e) {
          reject(new Error('JSON解析失败: ' + (text || buffer.toString('utf-8')).slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.abort(); reject(new Error('timeout')); });
    req.end();
  });
}

/**
 * 带重试的 GET 请求（指数退避）
 * @param {string} url
 * @param {object} params
 * @param {object} headers
 * @param {number} maxRetries 最大重试次数（不含首次）
 * @param {number} baseDelay 基础延迟(ms)
 */
async function getWithRetry(url, params = {}, headers = {}, maxRetries = 3, baseDelay = 1000) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await getWithUA(url, params, headers);
    } catch (e) {
      lastError = e;
      if (i < maxRetries) {
        const delay = baseDelay * Math.pow(2, i) + jitter(300);
        console.log('[http] 请求失败, ' + delay + 'ms 后重试(' + (i + 1) + '/' + maxRetries + '): ' + e.message);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

module.exports = { get, getWithUA, getWithRetry, randomUA, jitter, sleep };
