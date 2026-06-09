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
  return new Promise((r) => setTimeout(r, ms));
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
  if (_warmedCookies && now - _warmedAt < WARM_TTL) {
    return _warmedCookies;
  }

  return new Promise((resolve) => {
    const req = https.request(
      'https://trade.500.com/',
      {
        headers: {
          'User-Agent': randomUA(),
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: 10000,
        rejectUnauthorized: false,
      },
      (res) => {
        const setCookie = res.headers['set-cookie'] || [];
        const cookies = setCookie.map((c) => c.split(';')[0]).join('; ');
        if (cookies) {
          _warmedCookies = cookies;
          _warmedAt = Date.now();
        }
        res.resume();
        resolve(cookies);
      },
    );
    req.on('error', () => resolve(''));
    req.on('timeout', () => {
      req.destroy();
      resolve('');
    });
    req.end();
  });
}

function buildHeaders(extraCookies) {
  const headers = {
    'User-Agent': randomUA(),
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
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

function fetchPage(dateStr, g, retries, playid) {
  if (retries === undefined) retries = 2;
  if (playid === undefined) playid = 312;
  g = g || 2;

  return new Promise(async (resolve, reject) => {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const html = await _fetchPageOnce(dateStr, g, playid);
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
          console.log(
            '[500] ' +
              dateStr +
              ' g=' +
              g +
              ' 返回无效内容(len=' +
              (html ? html.length : 0) +
              '),' +
              delay +
              'ms后重试...',
          );
          await sleep(delay);
        } else {
          reject(new Error('页面无效，长度=' + (html ? html.length : 0)));
        }
      } catch (e) {
        lastError = e;
        if (attempt < retries) {
          const delay = jitter(2000) * (attempt + 1);
          console.log(
            '[500] ' +
              dateStr +
              ' g=' +
              g +
              ' 请求失败: ' +
              e.message +
              ', ' +
              delay +
              'ms后重试(' +
              (attempt + 1) +
              '/' +
              retries +
              ')',
          );
          _warmedCookies = null;
          await sleep(delay);
        }
      }
    }
    reject(lastError || new Error('max retries exceeded'));
  });
}

function _fetchPageOnce(dateStr, g, playid) {
  if (playid === undefined) playid = 312;
  return new Promise(async (resolve, reject) => {
    if (!_warmedCookies) {
      await warmCookies();
    }

    const url = 'https://trade.500.com/jczq/?playid=' + playid + '&g=' + g + '&date=' + dateStr;
    const headers = buildHeaders();

    const req = https.request(
      url,
      {
        headers,
        timeout: 20000,
        rejectUnauthorized: false,
      },
      (res) => {
        if (res.statusCode >= 400) {
          req.destroy();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }

        const setCookie = res.headers['set-cookie'];
        if (setCookie && setCookie.length > 0) {
          const newCookies = setCookie.map((c) => c.split(';')[0]).join('; ');
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
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
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
  const teamLMatch = segment.match(/<a[^>]*class="team-l"[^>]*>([\s\S]*?)<\/a>/);
  const teamRMatch = segment.match(/<a[^>]*class="team-r"[^>]*>([\s\S]*?)<\/a>/);
  if (!teamLMatch || !teamRMatch) return null;

  const homeName = teamLMatch[1].replace(/<[^>]*>/g, '').trim();
  const visitName = teamRMatch[1].replace(/<[^>]*>/g, '').trim();

  // 提取联赛名
  const leagueMatch = segment.match(/<td[^>]*class="[^"]*td-evt[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]*)<\/a>/);
  const leagueName = leagueMatch ? leagueMatch[1].trim() : '';

  // 提取让球数
  let handicap = 0;
  const rangMatch = segment.match(/<td[^>]*class="[^"]*td-rang[^"]*"[^>]*>([\s\S]*?)(?=<\/td>)/);
  if (rangMatch) {
    const hcapM = rangMatch[1].match(/([+-]\d+)/);
    if (hcapM) handicap = parseInt(hcapM[1]);
  }

  // 提取不让球胜平负 (nspf): type="nspf" data-sp="X.XX"
  const nspfValues = [];
  const nspfRegex = /data-type="nspf"[^>]*data-sp="([^"]*)"/g;
  let m;
  while ((m = nspfRegex.exec(segment)) !== null) {
    nspfValues.push(parseFloat(m[1]));
  }

  // 提取让球胜平负 (spf): type="spf" data-sp="X.XX"
  const rqspfValues = [];
  const rqRegex = /data-type="spf"[^>]*data-sp="([^"]*)"/g;
  while ((m = rqRegex.exec(segment)) !== null) {
    rqspfValues.push(parseFloat(m[1]));
  }

  // ★ 修复：SPF 未开售时 nspf 可能为空，但 RQSPF 可能已开售——不允许丢弃整行
  if (nspfValues.length < 3 && rqspfValues.length < 3) return null;

  const spf = nspfValues.length >= 3 ? { home: nspfValues[0], draw: nspfValues[1], away: nspfValues[2] } : null;
  const rqspf =
    rqspfValues.length >= 3
      ? { home: rqspfValues[0], draw: rqspfValues[1], away: rqspfValues[2], handicap: handicap }
      : null;

  // 半全场 (bqc)
  let halfFull = null;
  const bqcRegex = /data-type="bqc"[^>]*data-sp="([^"]*)"/g;
  const bqcValues = [];
  while ((m = bqcRegex.exec(segment)) !== null) {
    bqcValues.push(parseFloat(m[1]));
  }
  if (bqcValues.length >= 9) {
    halfFull = {
      hh: bqcValues[0],
      hd: bqcValues[1],
      ha: bqcValues[2],
      dh: bqcValues[3],
      dd: bqcValues[4],
      da: bqcValues[5],
      ah: bqcValues[6],
      ad: bqcValues[7],
      aa: bqcValues[8],
    };
  }

  // 总进球 (jq)
  let totalGoals = null;
  const jqRegex = /data-type="jq"[^>]*data-sp="([^"]*)"/g;
  const jqValues = [];
  while ((m = jqRegex.exec(segment)) !== null) {
    jqValues.push(parseFloat(m[1]));
  }
  if (jqValues.length >= 6) {
    totalGoals = {};
    const gKeys = ['0', '1', '2', '3', '4', '5', '6', '7+'];
    for (let gi = 0; gi < Math.min(gKeys.length, Math.floor(jqValues.length / 2)); gi++) {
      totalGoals[gKeys[gi]] = jqValues[gi * 2];
    }
  }

  // 单关标识
  const isSingleGame = segment.indexOf('ico-dg') > -1;

  return {
    num: matchNum,
    homeName: homeName,
    visitName: visitName,
    leagueName: leagueName,
    handicap: handicap,
    spf: spf,
    rqspf: rqspf,
    halfFull: halfFull,
    totalGoals: totalGoals,
    isSingleGame: isSingleGame,
  };
}

/**
 * v3 主解析函数：基于 <tr data-matchnum=""> 区块
 */
function extractOdds(html) {
  const result = {};

  // 找所有比赛行
  const rowRegex = /<tr[^>]*data-matchnum="([^"]+)"[^>]*>/g;
  let trMatch;
  const rows = [];

  while ((trMatch = rowRegex.exec(html)) !== null) {
    rows.push({ num: trMatch[1], start: trMatch.index });
  }

  if (rows.length === 0) {
    // 回退：尝试旧式解析
    return _extractOddsLegacy(html);
  }

  // 找到每个行的结束位置
  for (let i = 0; i < rows.length; i++) {
    const endTag = html.indexOf('</tr>', rows[i].start);
    if (endTag === -1) {
      rows[i].end = html.length;
    } else {
      rows[i].end = endTag + 5;
    }
  }

  // 解析每行
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    const segment = html.substring(row.start, row.end);
    const odds = parseMatchRow(segment, row.num);
    if (odds) result[row.num] = odds;
  }

  return result;
}

// ═══ 旧式解析器（回退用） ═══
function parseSegment(segment, matchNum) {
  const spanMatch = segment.match(/<span>(\d{1,3}\.\d{2})<\/span>/g);
  const nums = (spanMatch || []).map(function (s) {
    return Number(s.replace(/<[^>]*>/g, ''));
  });
  if (nums.length < 6) return null;

  const isSingleGame = segment.indexOf('ico-dg') > -1;
  const vsMatch = segment.match(/([\u4e00-\u9fa5a-zA-Z]+)\s*VS\s*([\u4e00-\u9fa5a-zA-Z]+)/);
  const homeName = vsMatch ? vsMatch[1].trim() : '';
  const visitName = vsMatch ? vsMatch[2].trim() : '';
  const hcapMatch = segment.match(/([+-]\d)/);
  const handicap = hcapMatch ? parseInt(hcapMatch[1]) : 0;
  const spf = { home: nums[0], draw: nums[1], away: nums[2] };
  const rqspf = { home: nums[3], draw: nums[4], away: nums[5], handicap: handicap };
  const halfFull =
    nums.length >= 15
      ? {
          hh: nums[6],
          hd: nums[7],
          ha: nums[8],
          dh: nums[9],
          dd: nums[10],
          da: nums[11],
          ah: nums[12],
          ad: nums[13],
          aa: nums[14],
        }
      : null;

  // ★ 总进球数赔率 (JQS): 0,1,2,3,4,5,6,7+
  const totalGoals =
    nums.length >= 23
      ? { 0: nums[15], 1: nums[16], 2: nums[17], 3: nums[18], 4: nums[19], 5: nums[20], 6: nums[21], '7+': nums[22] }
      : null;

  return {
    num: matchNum,
    homeName: homeName,
    visitName: visitName,
    handicap: handicap,
    spf: spf,
    rqspf: rqspf,
    halfFull: halfFull,
    totalGoals: totalGoals,
    isSingleGame: isSingleGame,
  };
}

function _extractOddsLegacy(html) {
  const result = {};
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const regex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  let m;
  const blocks = [];

  while ((m = regex.exec(html)) !== null) {
    blocks.push({ num: m[1] + m[2], start: m.index });
  }

  for (let i = 0; i < blocks.length; i++) {
    blocks[i].end = i < blocks.length - 1 ? blocks[i + 1].start : html.length;
    const segment = html.substring(blocks[i].start, blocks[i].end);
    const odds = parseSegment(segment, blocks[i].num);
    if (odds) result[blocks[i].num] = odds;
  }
  return result;
}

// ═══ shujuMap 提取 (v3 行内匹配) ═══
function extractShujuIds(html) {
  const result = {};

  // 方法1: 基于 data-matchnum 行精确匹配
  const rowRegex = /<tr[^>]*data-matchnum="([^"]+)"[^>]*>/g;
  const shujuRegex = /fenxi\/shuju-(\d+)\.shtml/;
  let trMatch;

  while ((trMatch = rowRegex.exec(html)) !== null) {
    const matchNum = trMatch[1];
    let endTag = html.indexOf('</tr>', trMatch.index);
    if (endTag === -1) endTag = html.length;
    const rowHtml = html.substring(trMatch.index, endTag + 5);

    const shujuMatch = rowHtml.match(shujuRegex);
    if (shujuMatch) {
      result[matchNum] = {
        shujuId: shujuMatch[1],
        url: 'https://odds.500.com/fenxi/shuju-' + shujuMatch[1] + '.shtml',
      };
    }
  }

  // 方法2: 如果行匹配未找到，回退到位置匹配
  if (Object.keys(result).length === 0) {
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const matchRegex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
    const shujuLinkRegex = /fenxi\/shuju-(\d+)\.shtml/g;

    const matchPositions = [];
    let m;
    while ((m = matchRegex.exec(html)) !== null) {
      matchPositions.push({ num: m[1] + m[2], pos: m.index });
    }

    const shujuLinks = [];
    while ((m = shujuLinkRegex.exec(html)) !== null) {
      shujuLinks.push({ id: m[1], pos: m.index });
    }

    for (let i = 0; i < shujuLinks.length; i++) {
      let nearestMatch = null,
        minDist = Infinity;
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
          url: 'https://odds.500.com/fenxi/shuju-' + shujuLinks[i].id + '.shtml',
        };
      }
    }
  }

  return result;
}

// ═══ 通用辅助：从特定 playid 页面提取赔率 ═══
/**
 * 从 HTML 中按 data-matchnum 行提取指定 data-type 的赔率
 * @param {string} html - 页面 HTML
 * @param {string} dataType - data-type 值，如 "bf"/"jqs"/"bqc"
 * @param {function} valueParser - (seg, result) => void，自定义解析逻辑
 * @returns {Object} { 比赛编号: { key: value } }
 */
function extractByDataType(html, dataType, valueParser) {
  const result = {};

  const rowRegex = /<tr[^>]*data-matchnum="([^"]+)"[^>]*>/g;
  let trMatch;
  const rows = [];

  while ((trMatch = rowRegex.exec(html)) !== null) {
    rows.push({ num: trMatch[1], start: trMatch.index });
  }

  // 回退到旧式匹配
  if (rows.length === 0) {
    const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const legacyRegex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
    let m;
    while ((m = legacyRegex.exec(html)) !== null) {
      rows.push({ num: m[1] + m[2], start: m.index });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    // ★ 用下一场比赛的起始位置作为边界（而非 </tr>），确保捕获跨多行的展开内容
    const end = i + 1 < rows.length ? rows[i + 1].start : html.length;
    const seg = html.substring(rows[i].start, end);
    valueParser(seg, result, rows[i].num, dataType);
  }

  return result;
}

// ═══ BF 比分赔率解析 (playid=271) ═══
function extractBfOdds(html) {
  return extractByDataType(html, 'bf', function (seg, result, num) {
    const bfRegex = /data-type="bf"\s+data-value="([^"]+)"\s+data-sp="(\d{1,5}\.\d{2})"/g;
    let m;
    const scores = {};
    while ((m = bfRegex.exec(seg)) !== null) {
      scores[m[1]] = parseFloat(m[2]);
    }
    if (Object.keys(scores).length > 0) {
      if (!result[num]) result[num] = {};
      result[num].scores = scores;
    }
  });
}

// ═══ JQS 总进球赔率解析 (playid=270) ═══
function extractJqsOdds(html) {
  return extractByDataType(html, 'jqs', function (seg, result, num) {
    const jqsRegex = /data-type="jqs"\s+data-value="(\d+)"\s+data-sp="(\d{1,5}\.\d{2})"/g;
    let m;
    const goals = {};
    while ((m = jqsRegex.exec(seg)) !== null) {
      const key = m[1] === '7' ? '7+' : m[1];
      goals[key] = parseFloat(m[2]);
    }
    if (Object.keys(goals).length >= 6) {
      if (!result[num]) result[num] = {};
      result[num].totalGoals = goals;
    }
  });
}

// ═══ BQC 半全场赔率解析 (playid=272) ═══
function extractBqcOdds(html) {
  return extractByDataType(html, 'bqc', function (seg, result, num) {
    // HTML: data-type="bqc" data-value="3-3" data-sp="5.15"
    // 顺序: 胜胜(3-3), 胜平(3-1), 胜负(3-0), 平胜(1-3), 平平(1-1), 平负(1-0), 负胜(0-3), 负平(0-1), 负负(0-0)
    const bqcRegex = /data-type="bqc"\s+data-value="(\d)-(\d)"\s+data-sp="(\d{1,5}\.\d{2})"/g;
    let m;
    const halfFull = {};
    const valueMap = {
      '3-3': 'hh',
      '3-1': 'hd',
      '3-0': 'ha',
      '1-3': 'dh',
      '1-1': 'dd',
      '1-0': 'da',
      '0-3': 'ah',
      '0-1': 'ad',
      '0-0': 'aa',
    };
    while ((m = bqcRegex.exec(seg)) !== null) {
      const combo = m[1] + '-' + m[2];
      const key = valueMap[combo] || combo;
      halfFull[key] = parseFloat(m[3]);
    }
    if (Object.keys(halfFull).length >= 9) {
      if (!result[num]) result[num] = {};
      result[num].halfFull = halfFull;
    }
  });
}

/**
 * 通用抓取函数：抓取指定 playid 的赔率
 * @param {string} dateStr
 * @param {number} playid
 * @param {function} extractor
 */
function fetchPlayOdds(dateStr, playid, extractor) {
  return Promise.all([
    fetchPage(dateStr, 1, 2, playid)
      .then(extractor)
      .catch(function () {
        return {};
      }),
    fetchPage(dateStr, 2, 2, playid)
      .then(extractor)
      .catch(function () {
        return {};
      }),
  ]).then(function (results) {
    const merged = {};
    for (let i = 0; i < results.length; i++) {
      const keys = Object.keys(results[i]);
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        if (!merged[k]) merged[k] = {};
        Object.assign(merged[k], results[i][k]);
      }
    }
    return merged;
  });
}

/**
 * 深度合并辅助：将 playid 专项数据合并到主结果
 */
function deepMerge(target, source, defaultKeys) {
  Object.keys(source).forEach(function (k) {
    if (!target[k]) {
      target[k] = {};
      if (defaultKeys) {
        defaultKeys.forEach(function (dk) {
          target[k][dk] = null;
        });
      }
    }
    Object.assign(target[k], source[k]);
  });
}

// ═══ 辅助：逐页抓取 SPF+RQSPF，停止条件=连续2页无新比赛 ═══
async function fetch312Pages(dateStr, maxPages) {
  maxPages = maxPages || 6;
  const results = [];
  let emptyStreak = 0;
  for (let g = 1; g <= maxPages; g++) {
    try {
      const pageData = await fetchPage(dateStr, g, 312).then(extractOdds);
      const count = Object.keys(pageData).length;
      if (count > 0) {
        results.push(pageData);
        emptyStreak = 0;
      } else {
        emptyStreak++;
        if (emptyStreak >= 2) break; // 连续2页无数据，停止
      }
    } catch (e) {
      emptyStreak++;
      if (emptyStreak >= 2) break;
    }
  }
  return results;
}

// ═══ 主函数 ═══
async function fetchOdds(dateStr) {
  const prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevStr = prevDate.toISOString().slice(0, 10);

  // SPF + RQSPF: 逐页抓取直到无新数据
  const [pages312, prevPages312, jqsData, bqcData, bfData] = await Promise.all([
    fetch312Pages(dateStr),
    fetch312Pages(prevStr),
    fetchPlayOdds(dateStr, 270, extractJqsOdds).catch(function () {
      return {};
    }),
    fetchPlayOdds(dateStr, 272, extractBqcOdds).catch(function () {
      return {};
    }),
    fetchPlayOdds(dateStr, 271, extractBfOdds).catch(function () {
      return {};
    }),
  ]);

  const merged = {};
  // 合并 SPF+RQSPF 数据（当天 + 前一天）
  for (const pageData of pages312) {
    for (const key of Object.keys(pageData)) {
      merged[key] = pageData[key];
    }
  }
  for (const pageData of prevPages312) {
    for (const key of Object.keys(pageData)) {
      merged[key] = pageData[key];
    }
  }
  // JQS 总进球
  deepMerge(merged, jqsData, ['spf', 'rqspf', 'halfFull', 'totalGoals']);
  // BQC 半全场
  deepMerge(merged, bqcData, ['spf', 'rqspf', 'halfFull', 'totalGoals']);
  // BF 比分
  deepMerge(merged, bfData, ['halfFull', 'totalGoals', 'scores']);
  return merged;
}

function fetchShujuMap(dateStr) {
  const prevDate = new Date(dateStr);
  prevDate.setDate(prevDate.getDate() - 1);
  const prevStr = prevDate.toISOString().slice(0, 10);

  return Promise.all([
    fetchPage(dateStr, 1)
      .then(extractShujuIds)
      .catch(function () {
        return {};
      }),
    fetchPage(dateStr, 2)
      .then(extractShujuIds)
      .catch(function () {
        return {};
      }),
    fetchPage(prevStr, 1)
      .then(extractShujuIds)
      .catch(function () {
        return {};
      }),
    fetchPage(prevStr, 2)
      .then(extractShujuIds)
      .catch(function () {
        return {};
      }),
  ]).then(function (results) {
    const merged = {};
    for (let i = 0; i < results.length; i++) {
      const keys = Object.keys(results[i]);
      for (let j = 0; j < keys.length; j++) {
        merged[keys[j]] = results[i][keys[j]];
      }
    }
    return merged;
  });
}

module.exports = { fetchOdds, extractOdds, fetchPage, extractShujuIds, fetchShujuMap };
