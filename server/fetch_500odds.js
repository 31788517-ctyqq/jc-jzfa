/**
 * 从 trade.500.com 抓取竞彩赔率
 * 包含：SPF胜平负、RQSPF让球胜平负、半全场、比分、总进球
 */
const https = require('https');
const iconv = require('iconv-lite');

function fetchPage(dateStr, g) {
  g = g || 2;
  return new Promise((resolve, reject) => {
    const url = `https://trade.500.com/jczq/?playid=312&g=${g}&date=${dateStr}`;
    const req = https.request(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://trade.500.com/jczq/',
      },
      timeout: 15000,
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'gbk')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function parseSegment(segment, matchNum) {
  const spanMatch = segment.match(/<span>(\d{1,3}\.\d{2})<\/span>/g);
  const nums = (spanMatch || []).map(s => Number(s.replace(/<[^>]*>/g, '')));
  if (nums.length < 6) return null;

  const isSingleGame = segment.indexOf('ico-dg') > -1;
  const vsMatch = segment.match(/([\u4e00-\u9fa5a-zA-Z]+)\s*VS\s*([\u4e00-\u9fa5a-zA-Z]+)/);
  const homeName = vsMatch ? vsMatch[1].trim() : '';
  const visitName = vsMatch ? vsMatch[2].trim() : '';
  const hcapMatch = segment.match(/([+-]\d)/);
  const handicap = hcapMatch ? parseInt(hcapMatch[1]) : 0;
  const spf = { home: nums[0], draw: nums[1], away: nums[2] };
  const rqspf = { home: nums[3], draw: nums[4], away: nums[5], handicap };
  const halfFull = nums.length >= 15 ? {
    hh: nums[6], hd: nums[7], ha: nums[8],
    dh: nums[9], dd: nums[10], da: nums[11],
    ah: nums[12], ad: nums[13], aa: nums[14],
  } : null;

  return { num: matchNum, homeName, visitName, handicap, spf, rqspf, halfFull, isSingleGame, totalGoals: null };
}

/**
 * 全局扫描 HTML 中的"进球数"段（500.com用"进球数"而非"总进球"）
 */
function extractTotalGoals(html) {
  const result = {};
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  
  const matchPositions = [];
  const regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  while ((m = regex.exec(html)) !== null) {
    matchPositions.push({ num: m[1] + m[2], pos: m.index });
  }
  
  // 同时尝试"进球数"和"总进球"
  const labels = ['进球数', '总进球'];
  labels.forEach(function(label) {
    let tgIdx = 0;
    while ((tgIdx = html.indexOf(label, tgIdx)) !== -1) {
      const after = html.substring(tgIdx + label.length, Math.min(tgIdx + 600, html.length));
      const tgNums = (after.match(/(\d{1,3}\.\d{2})/g) || []).map(Number);
      
      let nearestMatch = null, minDist = Infinity;
      for (let i = 0; i < matchPositions.length; i++) {
        var dist = tgIdx - matchPositions[i].pos;
        if (dist > 0 && dist < minDist) {
          minDist = dist;
          nearestMatch = matchPositions[i].num;
        }
      }
      
      if (nearestMatch && tgNums.length >= 6 && !result[nearestMatch]) {
        // 进球数赔率：8个值，每个在HTML中出现两次，取偶数索引(0,2,4,...)
        var goals = {};
        var gKeys = ['0','1','2','3','4','5','6','7+'];
        for (var gi = 0; gi < gKeys.length; gi++) {
          if (gi * 2 < tgNums.length) goals[gKeys[gi]] = tgNums[gi * 2];
        }
        result[nearestMatch] = goals;
      }
      tgIdx++;
    }
  });
  
  return result;
}

function extractOdds(html) {
  const result = {};
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  const regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  const blocks = [];

  // 收集所有场次位置
  while ((m = regex.exec(html)) !== null) {
    blocks.push({ num: m[1] + m[2], start: m.index });
  }

  // 解析每个块
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].end = (i < blocks.length - 1) ? blocks[i+1].start : html.length;
    const segment = html.substring(blocks[i].start, blocks[i].end);
    const odds = parseSegment(segment, blocks[i].num);
    if (odds) result[blocks[i].num] = odds;
  }
  
  // 全局扫描总进球数据并合并
  const tgData = extractTotalGoals(html);
  Object.keys(tgData).forEach(function(matchNum) {
    if (result[matchNum]) {
      result[matchNum].totalGoals = tgData[matchNum];
    }
  });

  return result;
}

function fetchOdds(dateStr) {
  // 前一天可能包含跨天场次（如周一001-003的彩种date是05-19但500.com在05-18页）
  var prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  var prevStr = prevDate.toISOString().slice(0, 10);
  
  return Promise.all([
    fetchPage(dateStr, 1).then(extractOdds).catch(() => ({})),
    fetchPage(dateStr, 2).then(extractOdds).catch(() => ({})),
    fetchPage(prevStr, 1).then(extractOdds).catch(() => ({})),
    fetchPage(prevStr, 2).then(extractOdds).catch(() => ({}))
  ]).then(function(results) {
    return Object.assign({}, results[0], results[1], results[2], results[3]);
  });
}

module.exports = { fetchOdds, extractOdds };
