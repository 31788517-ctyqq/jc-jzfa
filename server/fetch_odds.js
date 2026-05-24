/**
 * 赔率数据抓取模块 v2
 * 优先从 midou310 的推荐置信度推导，再尝试 JSP 页面解析
 */

const https = require('https');

/**
 * 从比赛的推荐方向数量估算赔率范围
 * 更靠谱：基于专家推荐数推导市场赔率
 */
function inferOddsFromRecommends(recomms, matchStatus) {
  if (!recomms || recomms.length === 0) return null;

  const total = recomms.reduce((s, r) => s + r.num, 0);
  const homeTotal = recomms.filter(r => r.type === '胜' || r.type === '让胜').reduce((s, r) => s + r.num, 0);
  const drawTotal = recomms.filter(r => r.type === '平' || r.type === '让平').reduce((s, r) => s + r.num, 0);
  const awayTotal = recomms.filter(r => r.type === '负' || r.type === '让负').reduce((s, r) => s + r.num, 0);

  if (total === 0) return null;

  const hRatio = homeTotal / total;
  const dRatio = drawTotal / total;
  const aRatio = awayTotal / total;

  // 从推荐比例反推赔率 (高推荐 → 低赔率)
  const maxRatio = Math.max(hRatio, dRatio, aRatio);

  // 检测是否包含让球方向
  const hasHandicap = recomms.some(r => (r.type||'').indexOf('让')===0);

  // 小样本(<5专家)和大样本使用不同参数，使推导更接近市场赔率
  const isSmall = total < 5;
  const home = hRatio > 0 ? (isSmall
    ? (2.0 - hRatio * 0.3 + (hasHandicap ? 0.4 : 0)).toFixed(2)
    : (2.8 - hRatio * 1.3).toFixed(2)
  ) : null;
  const draw = dRatio > 0 ? (isSmall
    ? (3.0 - dRatio * 0.5).toFixed(2)
    : (3.2 - dRatio * 1.3).toFixed(2)
  ) : null;
  const away = aRatio > 0 ? (isSmall
    ? (2.0 - aRatio * 0.3 + (hasHandicap ? 0.4 : 0)).toFixed(2)
    : (2.8 - aRatio * 1.3).toFixed(2)
  ) : null;

  return { home, draw, away };
}

/**
 * 尝试从 qc.100qiu.com 获取真实赔率
 */
function fetchRealOdds(matchId) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'qc.100qiu.com',
      path: `/analysis/detail.jsp?matchId=${matchId}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html',
        'Accept-Language': 'zh-CN',
        'Cache-Control': 'max-age=0',
      },
      rejectUnauthorized: false,
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c.toString('utf8'));
      res.on('end', () => {
        // 尝试从 HTML 中提取 spf 数据
        const spfMatch = body.match(/spf_[spf]\d+[^>]*>([\d.]+)</g);
        if (!spfMatch) return resolve(null);

        const odds = { home: [], draw: [], away: [] };
        spfMatch.forEach(m => {
          const v = parseFloat(m.match(/>([\d.]+)</)[1]);
          if (m.includes('spf_s')) odds.home.push(v);
          else if (m.includes('spf_p')) odds.draw.push(v);
          else if (m.includes('spf_f')) odds.away.push(v);
        });

        const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2) : null;
        resolve({
          home: avg(odds.home),
          draw: avg(odds.draw),
          away: avg(odds.away),
        });
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

module.exports = { inferOddsFromRecommends, fetchRealOdds };
