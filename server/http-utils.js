/**
 * HTTP 请求工具模块
 * 支持 GBK 编码解码（米斗数据使用 GBK 编码）
 */
const https = require('https');
const http = require('http');
const iconv = require('iconv-lite');

/**
 * HTTP GET 请求，自动处理 GBK 编码
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

module.exports = { get };
