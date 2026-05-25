/**
 * 从 qc.100qiu.com 分析页面抓取真实初赔数据
 * 直接访问 Java 后端服务器(172.18.93.197:801)
 */
const http = require('http');

/**
 * 从 HTML 中通过分割字符串提取赔率（更健壮的方式）
 */
function extractOdds(html) {
  const result = { home: null, draw: null, away: null };
  
  // 查找"平均X赔率"后的第一个 content_cell value
  function findValueAfterLabel(html, label) {
    const idx = html.indexOf(label);
    if (idx < 0) return null;
    const after = html.substring(idx + label.length);
    // 找下一个 class="content_cell value">...数值
    const match = after.match(/content_cell value">\s*([\d.]+)\s*</);
    if (match) return match[1];
    // fallback: 直接找下一个 >数字< 模式
    const fallback = after.match(/>\s*([\d.]+)\s*</);
    return fallback ? fallback[1] : null;
  }
  
  result.home = findValueAfterLabel(html, '平均胜赔率');
  // 平均平赔率 可能不存在（某些页面用 平均盘口），尝试多种或跳过
  const draw1 = findValueAfterLabel(html, '平均平赔率');
  // 查找第二个"平均胜赔率"后的组（可能是客队的胜平负）
  if (!result.draw) {
    const idx1 = html.indexOf('平均胜赔率');
    const idx2 = html.indexOf('平均胜赔率', idx1 + 1);
    if (idx2 > 0) {
      result.draw = html.substring(idx2 - 5, idx2 + 100).match(/>\s*([\d.]+)\s*</) ? null : null;
    }
  }
  result.draw = draw1;
  
  // 找"平均负赔率"后的值
  result.away = findValueAfterLabel(html, '平均负赔率');
  
  if (result.home || result.draw || result.away) return result;
  return null;
}

/**
 * 获取比赛的真实赔率
 */
function fetchOdds(matchId) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: '172.18.93.197',
      port: 801,
      path: `/analysis/detail.jsp?matchId=${matchId}`,
      method: 'GET',
      headers: {
        'Host': 'qc.100qiu.com',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c.toString());
      res.on('end', () => {
        const odds = extractOdds(body);
        resolve(odds);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = { fetchOdds, extractOdds };
