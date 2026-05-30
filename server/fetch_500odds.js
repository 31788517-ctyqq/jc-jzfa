/**
 * 从 trade.500.com 抓取竞彩赔率 (v2 - P2-2 反爬加固)
 * 
 * 增强:
 *   - Cookie 预热：先访问首页获取 session cookie
 *   - UA 池轮换：8 个真实浏览器 UA
 *   - 请求间隔抖动：1~3秒随机延迟
 *   - 失败重试：最多2次，指数退避
 *   - 连接复用：keep-alive
 */

const https = require('https');
const iconv = require('iconv-lite');

// ═══ 反封策略：UA 池 ═══
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:139.0) Gecko/20100101 Firefox/139.0',
];

function randomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function jitter(baseMs) {
  return Math.floor(baseMs * (0.5 + Math.random() * 1.5));
}

// ═══ Cookie 管理 ═══
let _warmedCookies = null;
let _warmedAt = 0;
const WARM_TTL = 10 * 60 * 1000; // 10分钟

/**
 * 预热: 先访问首页获取 session cookie
 */
function warmCookies() {
  const now = Date.now();
  if (_warmedCookies && (now - _warmedAt < WARM_TTL)) {
    return _warmedCookies;
  }

  return new Promise((resolve) => {
    const req = https.request('https://trade.500.com/', {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 10000,
      rejectUnauthorized: false,
    }, (res) => {
      const setCookie = res.headers['set-cookie'] || [];
      // 合并 set-cookie 数组
      const cookies = setCookie
        .map(c => c.split(';')[0])
        .join('; ');
      
      if (cookies) {
        _warmedCookies = cookies;
        _warmedAt = Date.now();
      }
      
      // 消费完响应体，避免内存泄漏
      res.resume();
      resolve(cookies);
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

/**
 * 构建请求头（含预热 Cookie）
 */
function buildHeaders(extraCookies) {
  const headers = {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };

  // 合并预热cookie + 额外cookie
  const allCookies = [];
  if (_warmedCookies) allCookies.push(_warmedCookies);
  if (extraCookies) allCookies.push(extraCookies);
  if (allCookies.length > 0) {
    headers['Cookie'] = allCookies.join('; ');
  }

  return headers;
}

/**
 * 带重试的页面抓取
 */
function fetchPage(dateStr, g, retries = 2) {
  g = g || 2;
  
  return new Promise(async (resolve, reject) => {
    let lastError = null;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const html = await _fetchPageOnce(dateStr, g);
        // 检查是否是有效HTML（500.com 有时返回空白/错误页）
        if (html && html.length > 500 && html.indexOf('football') > -1) {
          resolve(html);
          return;
        }
        if (attempt < retries) {
          console.log('[500] ' + dateStr + ' g=' + g + ' 返回无效内容(长度=' + (html ? html.length : 0) + ')，' + jitter(2000) + 'ms后重试...');
          await sleep(jitter(2000));
        } else {
          reject(new Error('页面无效，长度=' + (html ? html.length : 0)));
        }
      } catch (e) {
        lastError = e;
        if (attempt < retries) {
          const delay = jitter(2000) * (attempt + 1);
          console.log('[500] ' + dateStr + ' g=' + g + ' 请求失败: ' + e.message + '，' + delay + 'ms后重试(' + (attempt + 1) + '/' + retries + ')');
          // 失败后重新预热cookie
          _warmedCookies = null;
          await sleep(delay);
        }
      }
    }
    reject(lastError || new Error('max retries exceeded'));
  });
}

function _fetchPageOnce(dateStr, g) {
  return new Promise(async (resolve, reject) => {
    // 确保有预热cookie
    if (!_warmedCookies) {
      await warmCookies();
    }

    const url = `https://trade.500.com/jczq/?playid=312&g=${g}&date=${dateStr}`;
    const headers = buildHeaders();
    
    const req = https.request(url, {
      headers,
      timeout: 20000,
      rejectUnauthorized: false,
    }, (res) => {
      // 检查HTTP状态码
      if (res.statusCode >= 400) {
        req.destroy();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      
      // 更新cookie（如果有新的set-cookie）
      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        const newCookies = setCookie.map(c => c.split(';')[0]).join('; ');
        if (_warmedCookies) {
          _warmedCookies = _warmedCookies + '; ' + newCookies;
        } else {
          _warmedCookies = newCookies;
        }
        _warmedAt = Date.now();
      }

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const html = iconv.decode(Buffer.concat(chunks), 'gbk');
          resolve(html);
        } catch (e) {
          reject(new Error('GBK解码失败: ' + e.message));
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

// ═══ HTML 解析函数（保持不变） ═══

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

function extractTotalGoals(html) {
  const result = {};
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  
  const matchPositions = [];
  const regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  while ((m = regex.exec(html)) !== null) {
    matchPositions.push({ num: m[1] + m[2], pos: m.index });
  }
  
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

  while ((m = regex.exec(html)) !== null) {
    blocks.push({ num: m[1] + m[2], start: m.index });
  }

  for (let i = 0; i < blocks.length; i++) {
    blocks[i].end = (i < blocks.length - 1) ? blocks[i+1].start : html.length;
    const segment = html.substring(blocks[i].start, blocks[i].end);
    const odds = parseSegment(segment, blocks[i].num);
    if (odds) result[blocks[i].num] = odds;
  }
  
  const tgData = extractTotalGoals(html);
  Object.keys(tgData).forEach(function(matchNum) {
    if (result[matchNum]) {
      result[matchNum].totalGoals = tgData[matchNum];
    }
  });

  return result;
}

/**
 * 主函数：抓取指定日期的赔率
 * 同时查前一天（跨天场次）
 */
function fetchOdds(dateStr) {
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

function extractShujuIds(html) {
  const result = {};
  const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  const matchRegex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  const shujuRegex = /fenxi\/shuju-(\d+)\.shtml/g;

  const matchPositions = [];
  let m;
  while ((m = matchRegex.exec(html)) !== null) {
    matchPositions.push({ num: m[1] + m[2], pos: m.index });
  }

  const shujuLinks = [];
  while ((m = shujuRegex.exec(html)) !== null) {
    shujuLinks.push({ id: m[1], pos: m.index });
  }

  for (let i = 0; i < shujuLinks.length; i++) {
    let nearestMatch = null, minDist = Infinity;
    for (let j = 0; j < matchPositions.length; j++) {
      const dist = shujuLinks[i].pos - matchPositions[j].pos;
      if (dist > 0 && dist < minDist) {
        minDist = dist;
        nearestMatch = matchPositions[j].num;
      }
    }
    if (nearestMatch && !result[nearestMatch]) {
      result[nearestMatch] = {
        shujuId: shujuLinks[i].id,
        url: 'https://odds.500.com/fenxi/shuju-' + shujuLinks[i].id + '.shtml'
      };
    }
  }

  return result;
}

function fetchShujuMap(dateStr) {
  var prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  var prevStr = prevDate.toISOString().slice(0, 10);

  return Promise.all([
    fetchPage(dateStr, 1).then(extractShujuIds).catch(() => ({})),
    fetchPage(dateStr, 2).then(extractShujuIds).catch(() => ({})),
    fetchPage(prevStr, 1).then(extractShujuIds).catch(() => ({})),
    fetchPage(prevStr, 2).then(extractShujuIds).catch(() => ({}))
  ]).then(function(results) {
    return Object.assign({}, results[0], results[1], results[2], results[3]);
  });
}

module.exports = { fetchOdds, extractOdds, fetchPage, extractShujuIds, fetchShujuMap };
