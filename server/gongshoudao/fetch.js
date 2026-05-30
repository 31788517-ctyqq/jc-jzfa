/**
 * 数据获取模块
 * 从 m.100qiu.com/api/dcListBasic 拉取比赛统计数据，缓存到本地
 *
 * dateTime 编码规则：
 *   26058 = 26(年) + 0(固定) + 5(月,1位) + 8(第8期,2位)
 *   5月: 26051~26058, 6月: 26061起, 1月: 26011起
 *   每期覆盖 1~2 个自然日的比赛
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://m.100qiu.com';

// 生产环境（同一台服务器）使用本地直连，绕过公网 HTTPS
// 设置环境变量 GONGSHOUDAO_LOCAL=true 启用
const USE_LOCAL = process.env.GONGSHOUDAO_LOCAL === 'true';
const LOCAL_API = 'http://127.0.0.1:19880'; // Java 后端 API 端口
const STATS_BANK_PATH = path.join(__dirname, '..', 'stats_bank.json');

// ==================== dateTime 编码 ====================

/**
 * 根据年月期号生成 dateTime
 * @param {number} year 2026
 * @param {number} month 1-12
 * @param {number} batch 期号 1-99
 * @returns {string} "26058"
 */
function makeDateTime(year, month, batch) {
  const yy = String(year).slice(2);
  // 格式: YY + 0 + M(1位) + 批次(不补零)
  // 26058 = 26 + 0 + 5 + 8
  // 26011 = 26 + 0 + 1 + 1
  return yy + '0' + String(month) + String(batch);
}

/**
 * 解析 dateTime 字符串
 * @param {string} dt "26058"
 * @returns {{year:number, month:number, batch:number}}
 */
function parseDateTime(dt) {
  // "26058" → yy=26, 0, M=5, batch=8
  // "26011" → yy=26, 0, M=1, batch=1
  // "260121" → yy=26, 0, M=1, batch=21
  const s = String(dt);
  return {
    year: 2000 + parseInt(s.slice(0, 2)),
    month: parseInt(s[3]),
    batch: parseInt(s.slice(4))
  };
}

// ==================== HTTP ====================

/**
 * 构建正确的 API URL（自动选择本地直连或公网）
 */
function buildApiUrl(dateTime) {
  if (USE_LOCAL) {
    return LOCAL_API + '/api/dcListBasic?dateTime=' + dateTime;
  }
  return 'https://m.100qiu.com/api/dcListBasic?dateTime=' + dateTime;
}

/**
 * 构建请求选项（本地调用需要 Host 头）
 */
function getRequestOptions() {
  const opts = { headers: { 'Accept': 'application/json' } };
  if (USE_LOCAL) {
    opts.headers['Host'] = 'm.100qiu.com';
  }
  return opts;
}

function httpGetJSON(url, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  const isLocal = url.startsWith('http://');
  const lib = isLocal ? http : https;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isLocal ? 80 : 443),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      rejectUnauthorized: false
    };
    if (isLocal) {
      opts.headers['Host'] = 'm.100qiu.com';
    }
    lib.get(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch (e) {
          reject(new Error('JSON parse: ' + e.message));
        }
      });
    }).on('error', reject).setTimeout(timeoutMs, () => reject(new Error('timeout')));
  });
}

// ==================== 批次发现 ====================

/**
 * 探测指定月份从 batch 开始最近的可用批次
 * @param {number} year
 * @param {number} month
 * @param {number} startBatch 从高往低探
 * @returns {Promise<string|null>} 可用 dateTime
 */
async function findLatestBatch(year, month, startBatch) {
  let found = null;

  // 策略：从高往低探测，遇到任何有数据的批次都记录下来，继续往前探直到确认这是最近的有效批次
  for (let b = startBatch; b >= 1; b--) {
    const dt = makeDateTime(year, month, b);
    // 间隔 1s 避免反爬
    if (b < startBatch) {
      await new Promise(r => setTimeout(r, 1000));
    }
    
    // 每个批次最多重试2次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await httpGetJSON(buildApiUrl(dt), 10000);
        if (result.data && result.data.length > 0) {
          console.log('[fetch] 发现批次:', dt, result.data.length + '场');
          // 返回发现的第一个（最高的批次号）
          return dt;
        }
        // result.data 为空数组，跳出重试循环
        break;
      } catch (e) {
        if (attempt === 0) {
          // 首次失败 -> 等待后重试
          await new Promise(r => setTimeout(r, 1500));
        }
        // 第二次还是失败 -> 继续下一个批次
      }
    }
  }
  return null;
}

/**
 * 自动发现最新可用批次
 * 从当前月份开始，往前找最多 3 个月
 * @returns {Promise<string|null>}
 */
const BATCH_CONFIG_PATH = path.join(__dirname, '..', 'stats_bank.json');
const LAST_BATCH_KEY = '_last_batch';

async function autoDiscoverBatch() {
  // 1) 优先复用上次成功的批次
  let lastBatch = null;
  try {
    if (fs.existsSync(STATS_BANK_PATH)) {
      const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
      lastBatch = bank[LAST_BATCH_KEY];
    }
  } catch (e) {}

  if (lastBatch) {
    try {
      const result = await httpGetJSON(buildApiUrl(lastBatch), 8000);
      if (result.data && result.data.length > 0) {
        console.log('[fetch] 复用缓存批次:', lastBatch, result.data.length + '场');
        saveRawCache(lastBatch, result.data);
        return lastBatch;
      }
    } catch (e) {
      console.log('[fetch] 缓存批次失效:', lastBatch);
    }
  }

  // 2) 自动探测：当前月 + 前后各1个月
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const toTry = [];
  for (let m = month + 1; m >= month - 1; m--) {
    if (m < 1 || m > 12) continue;
    const y = m > month ? (month === 12 ? year + 1 : year) : (m < 1 ? year - 1 : year);
    toTry.push({ year: y, month: m });
  }

  for (const { year: y, month: m } of toTry) {
    const dt = await findLatestBatch(y, m, 15);
    if (dt) {
      // 记录到缓存
      try {
        let bank = {};
        if (fs.existsSync(STATS_BANK_PATH)) {
          bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
        }
        bank[LAST_BATCH_KEY] = dt;
        fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
      } catch (e) {}
      return dt;
    }
  }

  // 3) 都没有，返回 null
  console.log('[fetch] 未找到可用批次');
  return null;
}

// ==================== 队名匹配 ====================

/**
 * 构建 name -> stats 的映射
 */
function buildStatsMap(apiData) {
  const map = {};
  (apiData || []).forEach(item => {
    const home = (item.homeTeam || '').replace(/\(.*\)/g, '').trim();
    const guest = (item.guestTeam || '').replace(/\(.*\)/g, '').trim();
    const key = home + '|' + guest;
    map[key] = item;
  });
  return map;
}

/**
 * 手动队名别名映射表
 * key: 标准队名（data.json 中的名称）
 * value: API 端可能出现的别名列表
 */
const TEAM_ALIAS_MAP = {
  // ── 挪超 ──
  '布兰': ['布兰', '白兰恩'],
  '萨尔普斯堡': ['萨尔普斯堡', '萨普斯堡', '萨尔普斯', '萨普斯'],
  '奥斯陆KFUM': ['奥斯陆KFUM', 'KFUM奥斯陆'],
  '特罗姆瑟': ['特罗姆瑟', '特罗姆', '特罗姆瑟IL'],
  '博德闪耀': ['博德闪耀', '博多闪耀', '博多格林特', '博德'],
  '莫尔德': ['莫尔德', '莫迪'],
  '瓦勒伦加': ['瓦勒伦加', '瓦勒伦'],
  '奥德': ['奥德', '奥德格伦兰', '奇格陵兰'],
  '桑纳菲尤尔': ['桑纳菲尤尔', '桑德菲杰', '桑纳菲'],
  '克里斯蒂安松': ['克里斯蒂安松', '基斯迪辛特', '克里斯蒂'],
  '腓特烈斯塔': ['腓特烈斯塔', '费德列斯达', '弗雷德里克斯塔'],
  '海于格松': ['海于格松', '侯格辛特', '豪格松'],
  '罗森博格': ['罗森博格', '洛辛堡', '罗森博'],
  '斯特罗姆加斯特': ['斯特罗姆加斯特', '史卓加斯特', '斯特罗姆'],
  '利勒斯特罗姆': ['利勒斯特罗姆', '利勒斯特罗', '利勒斯特'],
  '斯塔贝克': ['斯塔贝克', '史达贝克'],
  // ── 瑞典超 ──
  '马尔默': ['马尔默', '马模', '马默'],
  '赫根': ['赫根', '哈肯', '海肯'],
  '埃尔夫斯堡': ['埃尔夫斯堡', '艾夫斯堡'],
  '北雪平': ['北雪平', '诺科平'],
  '佐加顿斯': ['佐加顿斯', '佐加顿'],
  '哈马比': ['哈马比', '哈马尔比'],
  '天狼星': ['天狼星', '西里安斯卡'],
  '哥德堡': ['哥德堡', 'IFK哥德堡', '戈登堡'],
  '卡尔马': ['卡尔马', '卡马亚'],
  // ── 芬超 ──
  '赫尔辛基': ['赫尔辛基', '赫尔辛', 'HJK赫尔辛基', 'HJK'],
  '库普斯': ['库普斯', '古比斯', '库奥皮奥'],
  '塞伊奈约基': ['塞伊奈约基', 'SJK', '塞那乔其', '塞那乔恩'],
  '瓦萨': ['瓦萨', 'VPS瓦萨'],
  '英特土尔库': ['英特土尔库', '国际图尔库', '图尔库国际'],
  '拉赫蒂': ['拉赫蒂', '拉迪'],
  // ── 丹超 ──
  '哥本哈根': ['哥本哈根', '哥本哈'],
  '中日德兰': ['中日德兰', '米迪兰特', '中日德'],
  '布隆德比': ['布隆德比', '邦比'],
  '奥胡斯': ['奥胡斯', '阿晓斯'],
  '奥尔堡': ['奥尔堡', '阿尔堡'],
  // ── 日职联 ──
  '鹿岛鹿角': ['鹿岛鹿角', '鹿岛'],
  '浦和红钻': ['浦和红钻', '浦和红宝石', '浦和'],
  '横滨水手': ['横滨水手', '横滨', '横滨F水手'],
  '川崎前锋': ['川崎前锋', '川崎', '川崎前'],
  '广岛三箭': ['广岛三箭', '广岛'],
  '大阪钢巴': ['大阪钢巴', '大阪飞脚', '钢巴'],
  '神户胜利船': ['神户胜利船', '神户', '神户胜利'],
  '町田泽维亚': ['町田泽维亚', '町田', '町田泽维'],
  // ── 韩K联 ──
  '蔚山现代': ['蔚山现代', '蔚山', '蔚山HD'],
  '全北现代': ['全北现代', '全北', '全北汽车'],
  '首尔FC': ['首尔FC', 'FC首尔', '首尔'],
  '浦项制铁': ['浦项制铁', '浦项', '浦项铁人'],
  '水原三星': ['水原三星', '水原', '水原蓝翼'],
  '大邱FC': ['大邱FC', '大邱'],
  '仁川联': ['仁川联', '仁川联合', '仁川'],
  // ── 国家队 ──
  '波黑': ['波黑', '波斯尼亚', '波斯尼亚和黑塞哥维那'],
  '北马其顿': ['北马其顿', '马其顿', '北马其'],
  '克罗地亚': ['克罗地亚', '克罗地'],
  '斯洛文尼亚': ['斯洛文尼亚', '斯洛文'],
  '塞尔维亚': ['塞尔维亚', '塞尔维'],
  '斯洛伐克': ['斯洛伐克', '斯洛伐'],
  '捷克': ['捷克', '捷克共和国'],
};

/**
 * 标准化队名：去括号、去空格、转小写
 */
function normalizeTeamName(name) {
  if (!name) return '';
  return name.replace(/\(.*\)/g, '').replace(/\s+/g, '').toLowerCase();
}

/**
 * 计算两个字符串的 Levenshtein 编辑距离
 */
function levenshteinDistance(s1, s2) {
  const len1 = s1.length, len2 = s2.length;
  if (len1 === 0) return len2;
  if (len2 === 0) return len1;
  // 用两行滚动数组节省内存
  let prev = Array.from({ length: len2 + 1 }, (_, i) => i);
  let curr = new Array(len2 + 1);
  for (let i = 1; i <= len1; i++) {
    curr[0] = i;
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // 删除
        curr[j - 1] + 1,    // 插入
        prev[j - 1] + cost  // 替换
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[len2];
}

/**
 * 模糊匹配队名（多策略，处理译名差异）
 *
 * 策略优先级：
 *   1) 精确匹配
 *   2) 包含匹配（长度差 ≤ 50%）
 *   3) 前缀匹配（取 minLen 字前缀）
 *   4) TEAM_ALIAS_MAP 别名匹配
 *   5) Levenshtein 编辑距离匹配（≤ 1 且双方 ≥ 3 字）
 */
function fuzzyMatch(name1, name2) {
  if (!name1 || !name2) return false;
  const nn1 = normalizeTeamName(name1);
  const nn2 = normalizeTeamName(name2);

  // 策略1: 精确匹配
  if (nn1 === nn2) return true;

  // 策略2: 包含匹配（长度差 ≤ 50%，防止短名误匹配）
  if (nn1.length >= 2 && nn2.length >= 2) {
    const lenRatio = Math.min(nn1.length, nn2.length) / Math.max(nn1.length, nn2.length);
    if (lenRatio >= 0.5 && (nn1.includes(nn2) || nn2.includes(nn1))) return true;
  }

  // 策略3: 前缀匹配（minLen 字前缀相同）
  const minLen = Math.min(nn1.length, nn2.length, 4);
  if (minLen >= 2 && nn1.slice(0, minLen) === nn2.slice(0, minLen)) return true;

  // 策略4: 别名映射表查
  for (const [stdName, aliases] of Object.entries(TEAM_ALIAS_MAP)) {
    const ns = normalizeTeamName(stdName);
    const aliasSet = aliases.map(a => normalizeTeamName(a));
    const n1InSet = aliasSet.includes(nn1);
    const n2InSet = aliasSet.includes(nn2);
    if (n1InSet && n2InSet) return true;
    // 反向也查：name1 可能是标准名
    if ((nn1 === ns && n2InSet) || (nn2 === ns && n1InSet)) return true;
  }

  // 策略5: Levenshtein 编辑距离（兜底模糊匹配）
  // 条件：双方长度 ≥ 3 字、编辑距离 ≤ 1
  if (nn1.length >= 3 && nn2.length >= 3) {
    const dist = levenshteinDistance(nn1, nn2);
    if (dist <= 1) return true;
  }

  return false;
}

// ==================== 核心流程 ====================

/**
 * 从 API 批次获取数据并按 data.json 队名匹配
 * @param {string} dateTime 批次编码
 * @returns {Promise<Object>} { [matchId]: statsObj }
 */
async function fetchAndRelateByBatch(dateTime) {
  // 先从 stats_bank.json 读取缓存的 API 原始数据
  let apiResult = null;
  let usedCache = false;
  
  const cached = loadRawCache(dateTime);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    console.log('[fetch] 使用缓存批次:', dateTime, cached.length + '场');
    apiResult = { data: cached };
    usedCache = true;
  }

  if (!apiResult) {
    try {
      apiResult = await httpGetJSON(buildApiUrl(dateTime), 10000);
      // 缓存原始数据
      if (apiResult && apiResult.data && apiResult.data.length > 0) {
        saveRawCache(dateTime, apiResult.data);
      }
    } catch (e) {
      console.error('[fetch] 批次请求失败:', dateTime, e.message);
      return {};
    }
  }

  const apiList = apiResult.data || [];
  console.log('[fetch] 批次', dateTime, '返回', apiList.length, '场');

  // 加载 data.json
  const dataFilePath = path.join(__dirname, '..', 'data.json');
  let mMap = {};
  if (fs.existsSync(dataFilePath)) {
    try {
      mMap = JSON.parse(fs.readFileSync(dataFilePath, 'utf8')).m || {};
    } catch (e) {
      console.error('[fetch] data.json 读取失败:', e.message);
    }
  }

  // 按队名匹配（不局限于特定日期）
  const result = {};
  const matchedTeams = new Set();
  const _unmatchedTeams = []; // 诊断：收集未匹配的比赛

  Object.keys(mMap).forEach(mid => {
    const m = mMap[mid];
    if (!m || !m.homeName) return;
    const homeName = (m.homeName || '').replace(/\(.*\)/g, '').trim();
    const visitName = (m.visitName || '').replace(/\(.*\)/g, '').trim();
    if (!homeName) return;

    let matched = false;
    for (const item of apiList) {
      const aHome = (item.homeTeam || '').replace(/\(.*\)/g, '').trim();
      const aGuest = (item.guestTeam || '').replace(/\(.*\)/g, '').trim();
      if (fuzzyMatch(homeName, aHome) && fuzzyMatch(visitName, aGuest)) {
        result[mid] = item;
        matchedTeams.add(homeName + '|' + visitName);
        matched = true;
        break;
      }
    }
    if (!matched) {
      _unmatchedTeams.push({
        mid, homeName, visitName,
        league: m.leagueName || '',
        date: m.matchDate || ''
      });
    }
  });

  // 诊断：输出未匹配比赛（帮助排查队名译名差异）
  if (_unmatchedTeams.length > 0) {
    console.log('[fetch] 未匹配到数据的比赛 (' + _unmatchedTeams.length + ' 场):');
    _unmatchedTeams.forEach(u => {
      console.log('  - ' + (u.league ? '[' + u.league + '] ' : '') +
        u.homeName + ' vs ' + u.visitName +
        (u.date ? ' (' + u.date + ')' : '') +
        '  mid=' + u.mid);
    });
    console.log('[fetch] API 端队名样本（前10场）:');
    apiList.slice(0, 10).forEach(item => {
      console.log('  - ' + (item.homeTeam || '?') + ' vs ' + (item.guestTeam || '?'));
    });
  }

  console.log('[fetch] 匹配到', Object.keys(result).length, '场 / 共', Object.keys(mMap).length, '场');
  return result;
}

/**
 * 按队名匹配（不限制日期）
 * @param {string} dateStr 可选，用于缓存 key
 * @returns {Promise<Object>}
 */
async function fetchAndRelate(dateStr) {
  // 尝试最新批次
  const latestDT = await autoDiscoverBatch();
  if (!latestDT) {
    console.error('[fetch] 未找到可用批次');
    return {};
  }

  const result = await fetchAndRelateByBatch(latestDT);

  // 缓存
  if (Object.keys(result).length > 0) {
    saveStatsCache(latestDT, result);
  }

  return result;
}

// ==================== 缓存 ====================

function saveStatsCache(dateTime, data) {
  let bank = {};
  if (fs.existsSync(STATS_BANK_PATH)) {
    try { bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8')); } catch (e) {}
  }
  bank[dateTime] = data;
  fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
}

function loadStatsCache(dateTime) {
  if (!fs.existsSync(STATS_BANK_PATH)) return null;
  try {
    const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    return bank[dateTime] || null;
  } catch (e) { return null; }
}

// 原始 API 数据缓存（key: '_raw_' + dateTime）
function saveRawCache(dateTime, rawData) {
  let bank = {};
  if (fs.existsSync(STATS_BANK_PATH)) {
    try { bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8')); } catch (e) {}
  }
  bank['_raw_' + dateTime] = rawData;
  fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
}

function loadRawCache(dateTime) {
  if (!fs.existsSync(STATS_BANK_PATH)) return null;
  try {
    const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    return bank['_raw_' + dateTime] || null;
  } catch (e) { return null; }
}

async function updateStats(dateStr) {
  const data = await fetchAndRelate(dateStr);
  return data;
}

module.exports = {
  fetchAndRelate,
  fetchAndRelateByBatch,
  updateStats,
  loadStatsCache,
  saveStatsCache,
  autoDiscoverBatch,
  findLatestBatch,
  makeDateTime,
  parseDateTime
};
