/**
 * 从 trade.500.com 抓取竞彩赔率
 * 包含：SPF胜平负、RQSPF让球胜平负、半全场、比分、总进球
 */
const https = require('https');
const iconv = require('iconv-lite');

function fetchPage(dateStr) {
  return new Promise((resolve, reject) => {
    const url = `https://trade.500.com/jczq/?playid=312&g=2&date=${dateStr}`;
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
 * 全局扫描 HTML 中的"总进球"段（这些数据在展开行中，不在比赛块内）
 */
function extractTotalGoals(html) {
  const result = {};
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  
  // 构建所有匹配号位置列表
  const matchPositions = [];
  const regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  while ((m = regex.exec(html)) !== null) {
    matchPositions.push({ num: m[1] + m[2], pos: m.index });
  }
  
  // 扫描"总进球"
  let tgIdx = 0;
  while ((tgIdx = html.indexOf('总进球', tgIdx)) !== -1) {
    // 找到此"总进球"后面的8个赔率值
    const after = html.substring(tgIdx + 3, Math.min(tgIdx + 600, html.length));
    const tgNums = (after.match(/(\d{1,3}\.\d{2})/g) || []).map(Number);
    
    // 往前查找最近的比赛编号
    let nearestMatch = null;
    for (let i = matchPositions.length - 1; i >= 0; i--) {
      if (matchPositions[i].pos < tgIdx) {
        nearestMatch = matchPositions[i].num;
        break;
      }
    }
    
    if (nearestMatch && tgNums.length >= 8) {
      result[nearestMatch] = {
        '0': tgNums[0], '1': tgNums[1], '2': tgNums[2], '3': tgNums[3],
        '4': tgNums[4], '5': tgNums[5], '6': tgNums[6], '7+': tgNums[7],
      };
    }
    
    tgIdx++;
  }
  
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
  return fetchPage(dateStr).then(extractOdds).catch(() => ({}));
}

module.exports = { fetchOdds, extractOdds };
