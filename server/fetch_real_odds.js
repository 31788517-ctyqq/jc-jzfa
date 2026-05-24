/**
 * 从 qc.100qiu.com 分析页面抓取真实初赔数据
 * 通过服务器本地 nginx 访问 Java 后端
 */
const https = require('https');

/**
 * 从 HTML 中提取平均赔率
 */
function extractOdds(html) {
  const result = { home: null, draw: null, away: null };
  
  // 匹配 "平均胜赔率" 对应的数值：查找 label 后的第一个 value div
  const patterns = [
    { re: /平均胜赔率[\s\S]*?content_cell value">([\d.]+)</g, field: 'home' },
    { re: /平均平赔率[\s\S]*?content_cell value">([\d.]+)</g, field: 'draw' },
    { re: /平均负赔率[\s\S]*?content_cell value">([\d.]+)</g, field: 'away' },
  ];
  
  patterns.forEach(p => {
    // Use fresh regex each time
    const regex = new RegExp(p.re.source, p.re.flags);
    const match = regex.exec(html);
    if (match) result[p.field] = match[1];
  });
  
  // If home is still null, try broader pattern: find all values after "平均胜赔率"
  if (!result.home) {
    const segs = html.split('平均胜赔率');
    if (segs.length > 1) {
      const valMatch = segs[1].match(/value">([\d.]+)</);
      if (valMatch) result.home = valMatch[1];
    }
  }
  if (!result.draw) {
    const segs = html.split('平均平赔率');
    if (segs.length > 1) {
      const valMatch = segs[1].match(/value">([\d.]+)</);
      if (valMatch) result.draw = valMatch[1];
    }
  }
  if (!result.away) {
    const segs = html.split('平均负赔率');
    if (segs.length > 1) {
      const valMatch = segs[1].match(/value">([\d.]+)</);
      if (valMatch) result.away = valMatch[1];
    }
  }
  
  if (result.home || result.draw || result.away) return result;
  return null;
}

/**
 * 获取比赛的真实赔率（从 qc.100qiu.com 分析页面）
 */
function fetchOdds(matchId) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'localhost',
      port: 443,
      path: `/analysis/detail.jsp?matchId=${matchId}`,
      method: 'GET',
      headers: {
        'Host': 'qc.100qiu.com',
        'User-Agent': 'Mozilla/5.0',
      },
      rejectUnauthorized: false,
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
