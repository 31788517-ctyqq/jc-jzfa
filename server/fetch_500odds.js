/**
 * 从 trade.500.com 抓取竞彩赔率 (v3 — HTML 结构适配 + 反爬加固)
 * 
 * v3 变更:
 *   - 修复页面校验：不再依赖 "football" 文本（新页面不含此词）
 *   - 重写解析器：适配新 HTML 结构（data-matchnum + data-sp 属性）
 *   - 保留: Cookie 预热、UA 池、重试、指数退避
 * 
 * 旧结构: 比赛编号分段 + <span>N.NN</span> 文本 → parseSegment
 * 新结构: <tr data-matchnum="周六001"> + data-sp="N.NN" 属性 → parseMatchRow
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
const WARM_TTL = 10 * 60 * 1000;

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
      const cookies = setCookie.map(c => c.split(';')[0]).join('; ');
      if (cookies) {
        _warmedCookies = cookies;
        _warmedAt = Date.now();
      }
      res.resume();
      resolve(cookies);
    });
    req.on('error', () => resolve(''));
    req.on('timeout', () => { req.destroy(); resolve(''); });
    req.end();
  });
}

function buildHeaders(extraCookies) {
  const headers = {
    'User-Agent': randomUA(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  };
  // 不手动设 Accept-Encoding，让 Node.js 自动处理 gzip 解压

  const allCookies = [];
  if (_warmedCookies) allCookies.push(_warmedCookies);
  if (extraCookies) allCookies.push(extraCookies);
  if (allCookies.length > 0) {
    headers['Cookie'] = allCookies.join('; ');
  }

  return headers;
}

function fetchPage(dateStr, g, retries) {
  if (retries === undefined) retries = 2;
  g = g || 2;

  return new Promise(async (resolve, reject) => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const html = await _fetchPageOnce(dateStr, g);
        // v3: 新页面校验 — 用 data-matchnum 或 bet-tb 判断有效性
        if (html && html.length > 500 && (html.indexOf('data-matchnum') > -1 || html.indexOf('bet-tb') > -1)) {
          resolve(html);
          return;
        }
        // 回退校验：检查竞彩相关关键词
        if (html && html.length > 500 && (html.indexOf('竞彩') > -1 || html.indexOf('jczq') > -1)) {
          resolve(html);
          return;
        }
        if (attempt < retries) {
          const delay = jitter(2000);
          console.log('[500] ' + dateStr + ' g=' + g + ' 返回无效内容(len=' + (html ? html.length : 0) + '),' + delay + 'ms后重试...');
          await sleep(delay);
        } else {
          reject(new Error('页面无效，长度=' + (html ? html.length : 0)));
        }
      } catch (e) {
        lastError = e;
        if (attempt < retries) {
          const delay = jitter(2000) * (attempt + 1);
          console.log('[500] ' + dateStr + ' g=' + g + ' 请求失败: ' + e.message + ', ' + delay + 'ms后重试(' + (attempt + 1) + '/' + retries + ')');
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
    if (!_warmedCookies) {
      await warmCookies();
    }

    const url = 'https://trade.500.com/jczq/?playid=312&g=' + g + '&date=' + dateStr;
    const headers = buildHeaders();

    const req = https.request(url, {
      headers,
      timeout: 20000,
      rejectUnauthorized: false,
    }, (res) => {
      if (res.statusCode >= 400) {
        req.destroy();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }

      const setCookie = res.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        const newCookies = setCookie.map(c => c.split(';')[0]).join('; ');
        _warmedCookies = _warmedCookies ? _warmedCookies + '; ' + newCookies : newCookies;
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

// ═══════════════════════════════════════════════════════
// v3 新解析器：基于 data-matchnum + data-sp 属性
// ═══════════════════════════════════════════════════════

/**
 * 解析单个比赛行（新 HTML 结构）
 * 结构: <tr data-matchnum="周六001" ...>
 *         <td class="td-team">
 *           <span class="team-l"><a>主队名</a></span>
 *           <span class="team-r"><a>客队名</a></span>
 *         </td>
 *         <td class="td-rang"><p>0</p><p class="green">-1</p></td>
 *         <td class="td-betbtn">
 *           <p data-type="nspf" data-sp="2.32">...</p>
 *           <p data-type="spf" data-sp="5.50">...</p>
 *         </td>
 *       </tr>
 */
function parseMatchRow(segment, matchNum) {
  // 提取队名
  var teamLMatch = segment.match(/<a[^>]*class="team-l"[^>]*>([\s\S]*?)<\/a>/);
  var teamRMatch = segment.match(/<a[^>]*class="team-r"[^>]*>([\s\S]*?)<\/a>/);
  if (!teamLMatch || !teamRMatch) return null;

  var homeName = teamLMatch[1].replace(/<[^>]*>/g, '').trim();
  var visitName = teamRMatch[1].replace(/<[^>]*>/g, '').trim();

  // 提取联赛名
  var leagueMatch = segment.match(/<td[^>]*class="[^"]*td-evt[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]*)<\/a>/);
  var leagueName = leagueMatch ? leagueMatch[1].trim() : '';

  // 提取让球数
  var handicap = 0;
  var rangMatch = segment.match(/<td[^>]*class="[^"]*td-rang[^"]*"[^>]*>([\s\S]*?)(?=<\/td>)/);
  if (rangMatch) {
    var hcapM = rangMatch[1].match(/([+-]\d+)/);
    if (hcapM) handicap = parseInt(hcapM[1]);
  }

  // 提取不让球胜平负 (nspf): type="nspf" data-sp="X.XX"
  var nspfValues = [];
  var nspfRegex = /data-type="nspf"[^>]*data-sp="([^"]*)"/g;
  var m;
  while ((m = nspfRegex.exec(segment)) !== null) {
    nspfValues.push(parseFloat(m[1]));
  }

  // 提取让球胜平负 (spf): type="spf" data-sp="X.XX"
  var rqspfValues = [];
  var rqRegex = /data-type="spf"[^>]*data-sp="([^"]*)"/g;
  while ((m = rqRegex.exec(segment)) !== null) {
    rqspfValues.push(parseFloat(m[1]));
  }

  if (nspfValues.length < 3) return null;

  var spf = { home: nspfValues[0], draw: nspfValues[1], away: nspfValues[2] };
  var rqspf = rqspfValues.length >= 3
    ? { home: rqspfValues[0], draw: rqspfValues[1], away: rqspfValues[2], handicap: handicap }
    : null;

  // 半全场 (bqc)
  var halfFull = null;
  var bqcRegex = /data-type="bqc"[^>]*data-sp="([^"]*)"/g;
  var bqcValues = [];
  while ((m = bqcRegex.exec(segment)) !== null) {
    bqcValues.push(parseFloat(m[1]));
  }
  if (bqcValues.length >= 9) {
    halfFull = {
      hh: bqcValues[0], hd: bqcValues[1], ha: bqcValues[2],
      dh: bqcValues[3], dd: bqcValues[4], da: bqcValues[5],
      ah: bqcValues[6], ad: bqcValues[7], aa: bqcValues[8]
    };
  }

  // 总进球 (jq)
  var totalGoals = null;
  var jqRegex = /data-type="jq"[^>]*data-sp="([^"]*)"/g;
  var jqValues = [];
  while ((m = jqRegex.exec(segment)) !== null) {
    jqValues.push(parseFloat(m[1]));
  }
  if (jqValues.length >= 6) {
    totalGoals = {};
    var gKeys = ['0', '1', '2', '3', '4', '5', '6', '7+'];
    for (var gi = 0; gi < Math.min(gKeys.length, Math.floor(jqValues.length / 2)); gi++) {
      totalGoals[gKeys[gi]] = jqValues[gi * 2];
    }
  }

  // 单关标识
  var isSingleGame = segment.indexOf('ico-dg') > -1;

  return {
    num: matchNum, homeName: homeName, visitName: visitName,
    leagueName: leagueName, handicap: handicap,
    spf: spf, rqspf: rqspf, halfFull: halfFull,
    totalGoals: totalGoals, isSingleGame: isSingleGame
  };
}

/**
 * v3 主解析函数：基于 <tr data-matchnum=""> 区块
 */
function extractOdds(html) {
  var result = {};

  // 找所有比赛行
  var rowRegex = /<tr[^>]*data-matchnum="([^"]+)"[^>]*>/g;
  var trMatch;
  var rows = [];

  while ((trMatch = rowRegex.exec(html)) !== null) {
    rows.push({ num: trMatch[1], start: trMatch.index });
  }

  if (rows.length === 0) {
    // 回退：尝试旧式解析
    return _extractOddsLegacy(html);
  }

  // 找到每个行的结束位置
  for (var i = 0; i < rows.length; i++) {
    var endTag = html.indexOf('</tr>', rows[i].start);
    if (endTag === -1) {
      rows[i].end = html.length;
    } else {
      rows[i].end = endTag + 5;
    }
  }

  // 解析每行
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var segment = html.substring(row.start, row.end);
    var odds = parseMatchRow(segment, row.num);
    if (odds) result[row.num] = odds;
  }

  return result;
}

// ═══ 旧式解析器（回退用） ═══
function parseSegment(segment, matchNum) {
  var spanMatch = segment.match(/<span>(\d{1,3}\.\d{2})<\/span>/g);
  var nums = (spanMatch || []).map(function(s) { return Number(s.replace(/<[^>]*>/g, '')); });
  if (nums.length < 6) return null;

  var isSingleGame = segment.indexOf('ico-dg') > -1;
  var vsMatch = segment.match(/([\u4e00-\u9fa5a-zA-Z]+)\s*VS\s*([\u4e00-\u9fa5a-zA-Z]+)/);
  var homeName = vsMatch ? vsMatch[1].trim() : '';
  var visitName = vsMatch ? vsMatch[2].trim() : '';
  var hcapMatch = segment.match(/([+-]\d)/);
  var handicap = hcapMatch ? parseInt(hcapMatch[1]) : 0;
  var spf = { home: nums[0], draw: nums[1], away: nums[2] };
  var rqspf = { home: nums[3], draw: nums[4], away: nums[5], handicap: handicap };
  var halfFull = nums.length >= 15 ? {
    hh: nums[6], hd: nums[7], ha: nums[8],
    dh: nums[9], dd: nums[10], da: nums[11],
    ah: nums[12], ad: nums[13], aa: nums[14],
  } : null;

  return { num: matchNum, homeName: homeName, visitName: visitName, handicap: handicap, spf: spf, rqspf: rqspf, halfFull: halfFull, isSingleGame: isSingleGame, totalGoals: null };
}

function _extractOddsLegacy(html) {
  var result = {};
  var weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  var m;
  var blocks = [];

  while ((m = regex.exec(html)) !== null) {
    blocks.push({ num: m[1] + m[2], start: m.index });
  }

  for (var i = 0; i < blocks.length; i++) {
    blocks[i].end = (i < blocks.length - 1) ? blocks[i + 1].start : html.length;
    var segment = html.substring(blocks[i].start, blocks[i].end);
    var odds = parseSegment(segment, blocks[i].num);
    if (odds) result[blocks[i].num] = odds;
  }
  return result;
}

// ═══ shujuMap 提取 (v3 行内匹配) ═══
function extractShujuIds(html) {
  var result = {};

  // 方法1: 基于 data-matchnum 行精确匹配
  var rowRegex = /<tr[^>]*data-matchnum="([^"]+)"[^>]*>/g;
  var shujuRegex = /fenxi\/shuju-(\d+)\.shtml/;
  var trMatch;

  while ((trMatch = rowRegex.exec(html)) !== null) {
    var matchNum = trMatch[1];
    var endTag = html.indexOf('</tr>', trMatch.index);
    if (endTag === -1) endTag = html.length;
    var rowHtml = html.substring(trMatch.index, endTag + 5);

    var shujuMatch = rowHtml.match(shujuRegex);
    if (shujuMatch) {
      result[matchNum] = {
        shujuId: shujuMatch[1],
        url: 'https://odds.500.com/fenxi/shuju-' + shujuMatch[1] + '.shtml'
      };
    }
  }

  // 方法2: 如果行匹配未找到，回退到位置匹配
  if (Object.keys(result).length === 0) {
    var weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    var matchRegex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
    var shujuLinkRegex = /fenxi\/shuju-(\d+)\.shtml/g;

    var matchPositions = [];
    var m;
    while ((m = matchRegex.exec(html)) !== null) {
      matchPositions.push({ num: m[1] + m[2], pos: m.index });
    }

    var shujuLinks = [];
    while ((m = shujuLinkRegex.exec(html)) !== null) {
      shujuLinks.push({ id: m[1], pos: m.index });
    }

    for (var i = 0; i < shujuLinks.length; i++) {
      var nearestMatch = null, minDist = Infinity;
      for (var j = 0; j < matchPositions.length; j++) {
        var dist = shujuLinks[i].pos - matchPositions[j].pos;
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
  }

  return result;
}

// ═══ 主函数 ═══
function fetchOdds(dateStr) {
  var prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  var prevStr = prevDate.toISOString().slice(0, 10);

  return Promise.all([
    fetchPage(dateStr, 1).then(extractOdds).catch(function() { return {}; }),
    fetchPage(dateStr, 2).then(extractOdds).catch(function() { return {}; }),
    fetchPage(prevStr, 1).then(extractOdds).catch(function() { return {}; }),
    fetchPage(prevStr, 2).then(extractOdds).catch(function() { return {}; })
  ]).then(function(results) {
    var merged = {};
    for (var i = 0; i < results.length; i++) {
      var keys = Object.keys(results[i]);
      for (var j = 0; j < keys.length; j++) {
        merged[keys[j]] = results[i][keys[j]];
      }
    }
    return merged;
  });
}

function fetchShujuMap(dateStr) {
  var prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  var prevStr = prevDate.toISOString().slice(0, 10);

  return Promise.all([
    fetchPage(dateStr, 1).then(extractShujuIds).catch(function() { return {}; }),
    fetchPage(dateStr, 2).then(extractShujuIds).catch(function() { return {}; }),
    fetchPage(prevStr, 1).then(extractShujuIds).catch(function() { return {}; }),
    fetchPage(prevStr, 2).then(extractShujuIds).catch(function() { return {}; })
  ]).then(function(results) {
    var merged = {};
    for (var i = 0; i < results.length; i++) {
      var keys = Object.keys(results[i]);
      for (var j = 0; j < keys.length; j++) {
        merged[keys[j]] = results[i][keys[j]];
      }
    }
    return merged;
  });
}

module.exports = { fetchOdds, extractOdds, fetchPage, extractShujuIds, fetchShujuMap };
