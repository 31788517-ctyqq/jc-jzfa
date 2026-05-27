/**
 * 从 trade.500.com 抓取全部竞彩赔率
 * SPF+让球(312), 总进球(270), 比分(271), 半全场(272)
 */
const https = require('https');
const iconv = require('iconv-lite');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.request(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': 'https://trade.500.com/jczq/' },
      timeout: 15000, rejectUnauthorized: false,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'gbk')));
    }).on('error', reject).end();
  });
}

/** 从HTML提取数据: 匹配 data-sp 或 span 模式 */
function extractByDataSp(html, dataType, handler) {
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  const matchRegex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  const positions = [];
  while ((m = matchRegex.exec(html)) !== null) {
    positions.push({ num: m[1]+m[2], start: m.index });
  }

  const result = {};
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i+1].start : html.length;
    const seg = html.substring(positions[i].start, end);
    const odds = handler(seg, positions[i].num, dataType);
    if (odds) result[positions[i].num] = odds;
  }
  return result;
}

/** 解析SPF+让球 (playid=312) */
function parseSPF(seg) {
  const dataSps = seg.match(/data-sp="(\d{1,3}\.\d{2})"/g);
  const nums = (dataSps || []).map(s => parseFloat(s.match(/"([^"]+)"/)[1]));
  if (nums.length < 6) return null;
  
  // Extract team names from title attributes
  const teamMatch = seg.match(/<a[^>]*class="team-l"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<a[^>]*class="team-r"[^>]*title="([^"]+)"[^>]*>/);
  const homeName = teamMatch ? teamMatch[1] : '';
  const visitName = teamMatch ? teamMatch[2] : '';
  
  // 让球数: <p class="xxx itm-rangA2" title="xx"> +1</p>
  const hcapMatch = seg.match(/itm-rangA2[^"]*"[^>]*title="[^"]*">\s*([+-]?\d+)\s*<\/p>/);
  const handicap = hcapMatch ? parseInt(hcapMatch[1].trim()) : 0;
  
  const isSingle = seg.indexOf('ico-dg') > -1;
  
  return {
    num: '', homeName, visitName, handicap, isSingleGame: isSingle,
    spf: { home: nums[0], draw: nums[1], away: nums[2] },
    rqspf: { home: nums[3], draw: nums[4], away: nums[5] },
  };
}

/** 解析总进球数 (playid=270) */
function parseJQS(seg) {
  const dataSps = seg.match(/data-type="jqs" data-value="(\d+)" data-sp="(\d{1,4}\.\d{2})"/g);
  if (!dataSps || dataSps.length < 6) return null;
  
  const goals = {};
  dataSps.forEach(s => {
    const partsMatch = s.match(/data-value="(\d+)" data-sp="(\d{1,4}\.\d{2})"/);
    if (partsMatch) {
      const key = partsMatch[1] === '7' ? '7+' : partsMatch[1];
      goals[key] = parseFloat(partsMatch[2]);
    }
  });
  return goals;
}

/** 解析半全场 (playid=272) */
function parseBQC(seg) {
  // data-type="bqc" data-value="3-3" data-sp="5.15"
  const dataSps = seg.match(/data-type="bqc"\s+data-value="(\d)-(\d)"\s+data-sp="(\d{1,4}\.\d{2})"/g);
  if (!dataSps || dataSps.length < 9) return null;
  
  const nums = dataSps.map(s => parseFloat(s.match(/data-sp="(\d{1,4}\.\d{2})"/)[1]));
  if (nums.length < 9) return null;
  
  // order: 胜胜(3-3), 胜平(3-1), 胜负(3-0), 平胜(1-3), 平平(1-1), 平负(1-0), 负胜(0-3), 负平(0-1), 负负(0-0)
  return { hh: nums[0], hd: nums[1], ha: nums[2], dh: nums[3], dd: nums[4], da: nums[5], ah: nums[6], ad: nums[7], aa: nums[8] };
}

/** 解析比分 (playid=271) - 使用展开区域数据 */
function parseBF(seg) {
  // 比分数据在 sbetbtn 或 betbtn 中
  const dataSps = seg.match(/data-type="bf" data-value="[^"]+" data-sp="(\d{1,5}\.\d{2})"/g);
  if (!dataSps || dataSps.length < 5) return null;
  
  const scores = {};
  dataSps.forEach(s => {
    const m = s.match(/data-value="([^"]+)" data-sp="(\d{1,5}\.\d{2})"/);
    if (m) scores[m[1]] = parseFloat(m[2]);
  });
  return scores;
}

/** 抓取单日全部赔率: SPF + RQSPF + BQC + JQS + BF */
async function fetchAllOdds(dateStr) {
  const baseUrl = 'https://trade.500.com/jczq/';
  const promises = [
    { g: 1, playid: 312, parser: parseSPF, key: 'spf' },
    { g: 2, playid: 312, parser: parseSPF, key: 'spf' },
    { g: 1, playid: 270, parser: parseJQS, key: 'jqs' },
    { g: 2, playid: 270, parser: parseJQS, key: 'jqs' },
    { g: 1, playid: 272, parser: parseBQC, key: 'bqc' },
    { g: 2, playid: 272, parser: parseBQC, key: 'bqc' },
    { g: 1, playid: 271, parser: parseBF, key: 'bf' },
    { g: 2, playid: 271, parser: parseBF, key: 'bf' },
  ];

  const results = await Promise.all(promises.map(p =>
    fetchPage(`${baseUrl}?playid=${p.playid}&g=${p.g}&date=${dateStr}`)
      .then(html => extractByDataSp(html, null, (seg) => p.parser(seg)))
      .then(data => ({ type: p.key, data }))
      .catch(() => ({ type: p.key, data: {} }))
  ));

  // 合并所有数据
  const merged = {};
  const allNums = new Set();
  results.forEach(r => {
    Object.keys(r.data).forEach(k => {
      allNums.add(k);
      if (!merged[k]) merged[k] = {};
      if (r.type === 'spf') {
        Object.assign(merged[k], r.data[k]);
      } else if (r.type === 'jqs') {
        merged[k].totalGoals = r.data[k];
      } else if (r.type === 'bqc') {
        merged[k].halfFull = r.data[k];
      } else if (r.type === 'bf') {
        merged[k].scores = r.data[k];
      }
    });
  });

  return merged;
}

module.exports = { fetchAllOdds };
