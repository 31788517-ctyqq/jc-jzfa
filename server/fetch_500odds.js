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
  // 从 <span> 标签中提取赔率数值（避免 data-sp 属性重复）
  const spanMatch = segment.match(/<span>(\d{1,3}\.\d{2})<\/span>/g);
  const nums = (spanMatch || []).map(s => Number(s.replace(/<[^>]*>/g, '')));
  if (nums.length < 6) return null;

  // 检测单关投注标识：<span class="ico-dg">单关</span>
  const isSingleGame = segment.indexOf('ico-dg') > -1;

  // 提取主客队名
  const vsMatch = segment.match(/([\u4e00-\u9fa5a-zA-Z]+)\s*VS\s*([\u4e00-\u9fa5a-zA-Z]+)/);
  const homeName = vsMatch ? vsMatch[1].trim() : '';
  const visitName = vsMatch ? vsMatch[2].trim() : '';

  // 提取让球数
  const hcapMatch = segment.match(/([+-]\d)/);
  const handicap = hcapMatch ? parseInt(hcapMatch[1]) : 0;

  // SPF胜平负 (前3个: 0-2)
  const spf = { home: nums[0], draw: nums[1], away: nums[2] };

  // RQSPF让球胜平负 (3-5)
  const rqspf = { home: nums[3], draw: nums[4], away: nums[5], handicap };

  // 半全场 (6-14, 9个)
  const halfFull = nums.length >= 15 ? {
    hh: nums[6], hd: nums[7], ha: nums[8],
    dh: nums[9], dd: nums[10], da: nums[11],
    ah: nums[12], ad: nums[13], aa: nums[14],
  } : null;

  // 总进球（最后8个值：0,1,2,3,4,5,6,7+）
  const totalGoals = nums.length >= 24 ? {
    '0': nums[nums.length - 8],
    '1': nums[nums.length - 7],
    '2': nums[nums.length - 6],
    '3': nums[nums.length - 5],
    '4': nums[nums.length - 4],
    '5': nums[nums.length - 3],
    '6': nums[nums.length - 2],
    '7+': nums[nums.length - 1],
  } : null;

  return { num: matchNum, homeName, visitName, handicap, spf, rqspf, halfFull, totalGoals, isSingleGame };
}

function extractOdds(html) {
  const result = {};
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  const regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  const blocks = [];

  // 第一遍：收集所有场次位置
  while ((m = regex.exec(html)) !== null) {
    blocks.push({ num: m[1] + m[2], start: m.index });
  }

  // 第二遍：设置每个block的end为下一个block的start
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].end = (i < blocks.length - 1) ? blocks[i+1].start : html.length;
    const segment = html.substring(blocks[i].start, blocks[i].end);
    const odds = parseSegment(segment, blocks[i].num);
    if (odds) result[blocks[i].num] = odds;
  }

  return result;
}

function fetchOdds(dateStr) {
  return fetchPage(dateStr).then(extractOdds).catch(() => ({}));
}

module.exports = { fetchOdds, extractOdds };
