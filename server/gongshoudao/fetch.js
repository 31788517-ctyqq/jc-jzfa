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
const USE_LOCAL = process.env.GONGSHOUDAO_LOCAL === 'true';
const LOCAL_API = 'http://127.0.0.1:19880';
const STATS_BANK_PATH = path.join(__dirname, '..', 'stats_bank.json');

// ★ 抓取成功率监控
const _fetchStats = {
  totalAttempts: 0,
  successes: 0,
  failures: 0,
  avgLatencyMs: 0,
  lastAttempt: null,
  errors: [],
};

function recordFetchStats(success, latencyMs, errMsg) {
  _fetchStats.totalAttempts++;
  if (success) {
    _fetchStats.successes++;
    // 加权移动平均
    _fetchStats.avgLatencyMs =
      _fetchStats.totalAttempts === 1
        ? latencyMs
        : _fetchStats.avgLatencyMs * 0.9 + latencyMs * 0.1;
  } else {
    _fetchStats.failures++;
    _fetchStats.errors.push({
      time: new Date().toISOString(),
      error: errMsg || 'unknown',
    });
    if (_fetchStats.errors.length > 50) _fetchStats.errors = _fetchStats.errors.slice(-50);
  }
  _fetchStats.lastAttempt = new Date().toISOString();

  // 每 20 次检查告警
  if (_fetchStats.totalAttempts % 20 === 0) {
    const rate = (_fetchStats.successes / _fetchStats.totalAttempts) * 100;
    if (rate < 90) {
      console.warn(
        '[fetch] ⚠️ API抓取成功率低于90%: ' + rate.toFixed(1) + '% (' +
          _fetchStats.successes + '/' + _fetchStats.totalAttempts + ')',
      );
    }
  }
}

function getFetchStats() {
  const total = _fetchStats.totalAttempts;
  return {
    ..._fetchStats,
    successRate: total > 0 ? (_fetchStats.successes / total * 100).toFixed(1) + '%' : 'N/A',
    avgLatency: Math.round(_fetchStats.avgLatencyMs) + 'ms',
    recentErrors: _fetchStats.errors.slice(-3).map((e) => e.time + ' ' + e.error),
  };
}

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
    batch: parseInt(s.slice(4)),
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
  const opts = { headers: { Accept: 'application/json' } };
  if (USE_LOCAL) {
    opts.headers['Host'] = 'm.100qiu.com';
  }
  return opts;
}

function httpGetJSON(url, timeoutMs) {
  timeoutMs = timeoutMs || 15000;
  const startTime = Date.now();
  const isLocal = url.startsWith('http://');
  const lib = isLocal ? http : https;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isLocal ? 80 : 443),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: { Accept: 'application/json' },
      rejectUnauthorized: false,
    };
    if (isLocal) {
      opts.headers['Host'] = 'm.100qiu.com';
    }
    lib
      .get(opts, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
            recordFetchStats(true, latencyMs);
            resolve(data);
          } catch (e) {
            recordFetchStats(false, latencyMs, 'JSON parse: ' + e.message);
            reject(new Error('JSON parse: ' + e.message));
          }
        });
      })
      .on('error', (err) => {
        const latencyMs = Date.now() - startTime;
        recordFetchStats(false, latencyMs, err.message);
        reject(err);
      })
      .setTimeout(timeoutMs, () => {
        const latencyMs = Date.now() - startTime;
        recordFetchStats(false, latencyMs, 'timeout(' + timeoutMs + 'ms)');
        reject(new Error('timeout'));
      });
  });
}

// ==================== 批次发现 ====================

const BATCH_CONFIG_PATH = path.join(__dirname, '..', 'stats_bank.json');
const LAST_BATCH_KEY = '_last_batch';

// ★ 跳表探测序列：从高往低，步长递减，减少空请求
//    15 → 10 → 5 → 3 → 2 → 1
const JUMP_SEQUENCE = [15, 10, 5, 3, 2, 1];

// ★ 探测间隔控制（ms），避免触发反爬
const PROBE_GAP_MS = 300;
const PROBE_TIMEOUT_MS = 8000;

// ★ 缓存命中计数器（用于监控发现效率）
let _discoverHits = 0;
let _discoverMisses = 0;
function getDiscoverMetrics() {
  const total = _discoverHits + _discoverMisses;
  return {
    hits: _discoverHits,
    misses: _discoverMisses,
    hitRate: total > 0 ? (_discoverHits / total * 100).toFixed(1) + '%' : 'N/A',
    total,
  };
}

/**
 * ★ 跳表探测单月可用批次（优化版）
 * 使用 JUMP_SEQUENCE 跳表探测，减少 API 请求次数
 *
 * 策略：
 *   1. 先查本地缓存（_raw_ 前缀）
 *   2. 缓存未命中 → 跳表探测 API
 *   3. 找到有效批次后，往前再探 1 步确认是否为最新
 *
 * @param {number} year
 * @param {number} month
 * @returns {Promise<string|null>} 最高有效 batch 的 dateTime
 */
async function probeWithJumpSequence(year, month) {
  const foundBatches = []; // 收集所有有效批次

  for (let idx = 0; idx < JUMP_SEQUENCE.length; idx++) {
    const batch = JUMP_SEQUENCE[idx];
    const dt = makeDateTime(year, month, batch);

    // 1) 本地缓存优先
    const cachedRaw = loadRawCache(dt);
    if (cachedRaw && Array.isArray(cachedRaw) && cachedRaw.length > 0) {
      console.log('[fetch] 跳表-缓存命中:', dt, cachedRaw.length + '场');
      foundBatches.push({ dt, count: cachedRaw.length });
      // 找到最高批次，往前再确认 1 步
      if (batch < 15) {
        const nextBatch = batch + 1;
        const nextDT = makeDateTime(year, month, nextBatch);
        const nextCached = loadRawCache(nextDT);
        if (nextCached && Array.isArray(nextCached) && nextCached.length > 0) {
          console.log('[fetch] 跳表-确认更高批次:', nextDT, nextCached.length + '场');
          foundBatches.push({ dt: nextDT, count: nextCached.length });
        }
      }
      _discoverHits++;
      break;
    }

    // 2) API 探测
    let result = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await httpGetJSON(buildApiUrl(dt), PROBE_TIMEOUT_MS);
        break;
      } catch (e) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    }

    if (result && result.data && result.data.length > 0) {
      console.log('[fetch] 跳表-发现批次:', dt, result.data.length + '场');
      saveRawCache(dt, result.data);
      foundBatches.push({ dt, count: result.data.length });

      // 往前再探 1 步确认是否还有更高批次
      if (batch < 15) {
        const nextBatch = batch + 1;
        const nextDT = makeDateTime(year, month, nextBatch);
        const nextCached = loadRawCache(nextDT);
        if (!nextCached) {
          try {
            const nextResult = await httpGetJSON(buildApiUrl(nextDT), PROBE_TIMEOUT_MS);
            if (nextResult && nextResult.data && nextResult.data.length > 0) {
              console.log('[fetch] 跳表-确认更高批次:', nextDT, nextResult.data.length + '场');
              saveRawCache(nextDT, nextResult.data);
              foundBatches.push({ dt: nextDT, count: nextResult.data.length });
            }
          } catch (e) {
            // 忽略探测失败
          }
        }
      }
      _discoverHits++;
      break;
    }

    // 批次间短暂间隔
    if (idx < JUMP_SEQUENCE.length - 1) {
      await new Promise((r) => setTimeout(r, PROBE_GAP_MS));
    }
  }

  // 取最高批次号
  if (foundBatches.length === 0) {
    _discoverMisses++;
    return null;
  }
  foundBatches.sort((a, b) => parseInt(b.dt) - parseInt(a.dt));
  return foundBatches[0].dt;
}

/**
 * ★ 传统线性探测（兼容保留，作为 fallback）
 * @deprecated 使用 probeWithJumpSequence 替代
 */
async function findLatestBatch(year, month, startBatch) {
  for (let b = startBatch; b >= 1; b--) {
    const dt = makeDateTime(year, month, b);
    if (b < startBatch) {
      await new Promise((r) => setTimeout(r, 1000));
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await httpGetJSON(buildApiUrl(dt), 10000);
        if (result.data && result.data.length > 0) {
          console.log('[fetch] 发现批次:', dt, result.data.length + '场');
          return dt;
        }
        break;
      } catch (e) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
    }
  }
  return null;
}

/**
 * ★ 自动发现最新可用批次（优化版）
 *
 * 策略（三阶段）：
 *   1. 缓存优先：复用 _last_batch（命中率 > 80%）
 *   2. 缓存失效 → 并发跳表探测当前月 ± 1 月
 *   3. 回退传统线性探测
 *
 * @returns {Promise<string|null>}
 */
async function autoDiscoverBatch() {
  // 阶段 1) 优先复用上次成功的批次
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
        _discoverHits++;
        return lastBatch;
      }
    } catch (e) {
      console.log('[fetch] 缓存批次失效:', lastBatch);
    }
  }

  // 阶段 2) ★ 并发跳表探测 3 个月跨度
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  // 构建候选月份列表（当前月 + 前后各 1 月）
  const monthsToProbe = [];
  for (let m = month + 1; m >= month - 1; m--) {
    if (m < 1 || m > 12) continue;
    const y = m > month ? (month === 12 ? year + 1 : year) : m < 1 ? year - 1 : year;
    monthsToProbe.push({ year: y, month: m });
  }

  console.log('[fetch] 跳表并发探测月份:', monthsToProbe.length, '个月');

  // 并发探测所有候选月份
  const results = await Promise.all(
    monthsToProbe.map(({ year: y, month: m }) =>
      probeWithJumpSequence(y, m).catch((e) => {
        console.log('[fetch] 月份探测异常:', y + '-' + m, e.message);
        return null;
      }),
    ),
  );

  // 取最高有效批次
  const validResults = results.filter(Boolean);
  if (validResults.length > 0) {
    const bestBatch = validResults.sort((a, b) => parseInt(b) - parseInt(a))[0];
    console.log('[fetch] 并发探测完成，最佳批次:', bestBatch);

    // 记录到缓存
    try {
      let bank = {};
      if (fs.existsSync(STATS_BANK_PATH)) {
        bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
      }
      bank[LAST_BATCH_KEY] = bestBatch;
      fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
    } catch (e) {}

    return bestBatch;
  }

  // 阶段 3) 回退传统线性探测
  console.log('[fetch] 跳表探测无结果，回退线性探测...');
  for (const { year: y, month: m } of monthsToProbe) {
    const dt = await findLatestBatch(y, m, 15);
    if (dt) {
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

  console.log('[fetch] 未找到可用批次');
  _discoverMisses++;
  return null;
}

/**
 * ★ 获取批次发现效率统计
 */
function getBatchDiscoveryReport() {
  const metrics = getDiscoverMetrics();
  return {
    ...metrics,
    strategy: 'jump-table + concurrent',
    sequence: JUMP_SEQUENCE.join('→'),
    probeMonths: 3,
  };
}

// ==================== 队名匹配 ====================

/**
 * 构建 name -> stats 的映射
 */
function buildStatsMap(apiData) {
  const map = {};
  (apiData || []).forEach((item) => {
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
  布兰: ['布兰', '白兰恩'],
  萨尔普斯堡: ['萨尔普斯堡', '萨普斯堡', '萨尔普斯', '萨普斯'],
  奥斯陆KFUM: ['奥斯陆KFUM', 'KFUM奥斯陆'],
  特罗姆瑟: ['特罗姆瑟', '特罗姆', '特罗姆瑟IL'],
  博德闪耀: ['博德闪耀', '博多闪耀', '博多格林特', '博德'],
  莫尔德: ['莫尔德', '莫迪'],
  瓦勒伦加: ['瓦勒伦加', '瓦勒伦'],
  奥德: ['奥德', '奥德格伦兰', '奇格陵兰'],
  桑纳菲尤尔: ['桑纳菲尤尔', '桑德菲杰', '桑纳菲'],
  克里斯蒂安松: ['克里斯蒂安松', '基斯迪辛特', '克里斯蒂'],
  腓特烈斯塔: ['腓特烈斯塔', '费德列斯达', '弗雷德里克斯塔'],
  海于格松: ['海于格松', '侯格辛特', '豪格松'],
  罗森博格: ['罗森博格', '洛辛堡', '罗森博'],
  斯特罗姆加斯特: ['斯特罗姆加斯特', '史卓加斯特', '斯特罗姆'],
  利勒斯特罗姆: ['利勒斯特罗姆', '利勒斯特罗', '利勒斯特'],
  斯塔贝克: ['斯塔贝克', '史达贝克'],
  // ── 瑞典超 ──
  马尔默: ['马尔默', '马模', '马默'],
  赫根: ['赫根', '哈肯', '海肯'],
  埃尔夫斯堡: ['埃尔夫斯堡', '艾夫斯堡'],
  北雪平: ['北雪平', '诺科平'],
  佐加顿斯: ['佐加顿斯', '佐加顿'],
  哈马比: ['哈马比', '哈马尔比'],
  天狼星: ['天狼星', '西里安斯卡'],
  哥德堡: ['哥德堡', 'IFK哥德堡', '戈登堡'],
  卡尔马: ['卡尔马', '卡马亚'],
  // ── 芬超 ──
  赫尔辛基: ['赫尔辛基', '赫尔辛', 'HJK赫尔辛基', 'HJK'],
  库普斯: ['库普斯', '古比斯', '库奥皮奥'],
  塞伊奈约基: ['塞伊奈约基', 'SJK', '塞那乔其', '塞那乔恩'],
  瓦萨: ['瓦萨', 'VPS瓦萨'],
  英特土尔库: ['英特土尔库', '国际图尔库', '图尔库国际'],
  拉赫蒂: ['拉赫蒂', '拉迪'],
  // ── 丹超 ──
  哥本哈根: ['哥本哈根', '哥本哈'],
  中日德兰: ['中日德兰', '米迪兰特', '中日德'],
  布隆德比: ['布隆德比', '邦比'],
  奥胡斯: ['奥胡斯', '阿晓斯'],
  奥尔堡: ['奥尔堡', '阿尔堡'],
  // ── 日职联 ──
  鹿岛鹿角: ['鹿岛鹿角', '鹿岛'],
  浦和红钻: ['浦和红钻', '浦和红宝石', '浦和'],
  横滨水手: ['横滨水手', '横滨', '横滨F水手'],
  川崎前锋: ['川崎前锋', '川崎', '川崎前'],
  广岛三箭: ['广岛三箭', '广岛'],
  大阪钢巴: ['大阪钢巴', '大阪飞脚', '钢巴'],
  神户胜利船: ['神户胜利船', '神户', '神户胜利'],
  町田泽维亚: ['町田泽维亚', '町田', '町田泽维'],
  // ── 韩K联 ──
  蔚山现代: ['蔚山现代', '蔚山', '蔚山HD'],
  全北现代: ['全北现代', '全北', '全北汽车'],
  首尔FC: ['首尔FC', 'FC首尔', '首尔'],
  浦项制铁: ['浦项制铁', '浦项', '浦项铁人'],
  水原三星: ['水原三星', '水原', '水原蓝翼'],
  大邱FC: ['大邱FC', '大邱'],
  仁川联: ['仁川联', '仁川联合', '仁川'],
  // ── 国家队 ──
  波黑: ['波黑', '波斯尼亚', '波斯尼亚和黑塞哥维那'],
  北马其顿: ['北马其顿', '马其顿', '北马其'],
  克罗地亚: ['克罗地亚', '克罗地'],
  斯洛文尼亚: ['斯洛文尼亚', '斯洛文'],
  塞尔维亚: ['塞尔维亚', '塞尔维'],
  斯洛伐克: ['斯洛伐克', '斯洛伐'],
  捷克: ['捷克', '捷克共和国'],
};

/**
 * 标准化队名：去括号、去空格、转小写
 */
function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .replace(/\(.*\)/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * 计算两个字符串的 Levenshtein 编辑距离
 */
function levenshteinDistance(s1, s2) {
  const len1 = s1.length,
    len2 = s2.length;
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
        prev[j] + 1, // 删除
        curr[j - 1] + 1, // 插入
        prev[j - 1] + cost, // 替换
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
    const aliasSet = aliases.map((a) => normalizeTeamName(a));
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

  Object.keys(mMap).forEach((mid) => {
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
        mid,
        homeName,
        visitName,
        league: m.leagueName || '',
        date: m.matchDate || '',
      });
    }
  });

  // 诊断：输出未匹配比赛（帮助排查队名译名差异）
  if (_unmatchedTeams.length > 0) {
    console.log('[fetch] 未匹配到数据的比赛 (' + _unmatchedTeams.length + ' 场):');
    _unmatchedTeams.forEach((u) => {
      console.log(
        '  - ' +
          (u.league ? '[' + u.league + '] ' : '') +
          u.homeName +
          ' vs ' +
          u.visitName +
          (u.date ? ' (' + u.date + ')' : '') +
          '  mid=' +
          u.mid,
      );
    });
    console.log('[fetch] API 端队名样本（前10场）:');
    apiList.slice(0, 10).forEach((item) => {
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

  // ★ P1: 多批次聚合，最大化比赛覆盖
  const result = await fetchAndRelateMultiBatch(latestDT);

  // 缓存
  if (Object.keys(result).length > 0) {
    saveStatsCache(latestDT, result);
  }

  return result;
}

/**
 * ★ P1 新增：多批次聚合匹配
 * 主批次匹配后，对仍未匹配的比赛尝试补充批次
 *
 * 策略：
 *   1. 先用主批次匹配全部 data.json
 *   2. 筛选出最新日期中仍未匹配的比赛
 *   3. 按月份探测补充批次，只匹配未命中的比赛
 *   4. 聚合所有结果
 *
 * @param {string} primaryDT 主批次编码
 * @returns {Promise<Object>} 聚合后的 { [matchId]: statsObj }
 */
async function fetchAndRelateMultiBatch(primaryDT) {
  console.log('[fetch] === 多批次聚合匹配 ===');
  console.log('[fetch] 主批次:', primaryDT);

  // 1. 主批次匹配
  const primaryResult = await fetchAndRelateByBatch(primaryDT);
  const primaryCount = Object.keys(primaryResult).length;
  console.log('[fetch] 主批次匹配:', primaryCount, '场');

  if (primaryCount === 0) {
    console.log('[fetch] 主批次无匹配，跳过补充批次');
    return primaryResult;
  }

  // 2. 加载 data.json，找出仍未匹配的最新日期比赛
  const dataFilePath = path.join(__dirname, '..', 'data.json');
  let mMap = {};
  try {
    if (fs.existsSync(dataFilePath)) {
      mMap = JSON.parse(fs.readFileSync(dataFilePath, 'utf8')).m || {};
    }
  } catch (e) {
    return primaryResult;
  }

  // 收集仍未匹配的比赛（重点关注最近10天）
  const allDates = new Set();
  Object.values(mMap).forEach((m) => {
    if (m && m.date) allDates.add(String(m.date).slice(0, 10));
  });
  const sortedDates = [...allDates].sort().reverse();
  const recentDates = sortedDates.slice(0, 10);
  const recentDateSet = new Set(recentDates);

  const stillUnmatched = [];
  Object.entries(mMap).forEach(([mid, m]) => {
    if (!m || !m.homeName) return;
    const d = String(m.date || '').slice(0, 10);
    // 只关注最近日期内仍未匹配的比赛
    if (!recentDateSet.has(d)) return;
    if (primaryResult[mid] || primaryResult['m_' + mid] || primaryResult[mid.replace(/^m_/, '')]) return;
    stillUnmatched.push({ mid, m, date: d });
  });

  // 检查缓存中是否已有这些比赛（来自之前的批次）
  let fromExistingCache = 0;
  const supplementaryNeeded = [];
  stillUnmatched.forEach(({ mid, m }) => {
    const cached = loadStatsCache(primaryDT);
    const existing = cached ? (cached[mid] || cached['m_' + mid] || cached[mid.replace(/^m_/, '')]) : null;
    if (existing) {
      primaryResult[mid] = existing;
      fromExistingCache++;
    } else {
      supplementaryNeeded.push({ mid, m });
    }
  });

  console.log('[fetch] 最近日期未命中比赛:', stillUnmatched.length, '场');
  console.log('[fetch] 其中历史缓存覆盖:', fromExistingCache, '场');

  if (supplementaryNeeded.length === 0) {
    console.log('[fetch] 无需补充批次，覆盖率已充足');
    return primaryResult;
  }

  console.log('[fetch] 需要补充匹配:', supplementaryNeeded.length, '场');
  supplementaryNeeded.slice(0, 5).forEach(({ m }) => {
    console.log('  - [' + (m.leagueName || '') + '] ' + m.homeName + ' vs ' + m.visitName);
  });

  // 3. 探测补充批次
  // 按主批次的月份前后扩展探测
  const parsed = parseDateTime(primaryDT);
  const primaryYear = parsed.year;
  const primaryMonth = parsed.month;

  // 候选批次列表：同月剩余批次 + 前后月
  const candidateBatches = [];
  for (let m = primaryMonth + 1; m >= primaryMonth - 1; m--) {
    if (m < 1 || m > 12) continue;
    const y = m > primaryMonth ? (primaryMonth === 12 ? primaryYear + 1 : primaryYear) : m < 1 ? primaryYear - 1 : primaryYear;
    for (let b = 15; b >= 1; b--) {
      const dt = makeDateTime(y, m, b);
      if (dt !== primaryDT) candidateBatches.push(dt);
    }
  }

  // 最多探测 8 个补充批次（避免过多请求）
  const maxSupplementary = 8;
  let supplementaryCount = 0;
  let totalSupplemented = 0;
  const unmatchedAfterSupplement = new Set(supplementaryNeeded.map((s) => s.mid));

  for (const dt of candidateBatches) {
    if (supplementaryCount >= maxSupplementary) break;
    if (unmatchedAfterSupplement.size === 0) break;

    // 只请求有数据的批次
    let apiResult;
    const cachedRaw = loadRawCache(dt);
    if (cachedRaw && Array.isArray(cachedRaw) && cachedRaw.length > 0) {
      apiResult = { data: cachedRaw };
    } else {
      try {
        apiResult = await httpGetJSON(buildApiUrl(dt), 8000);
        if (apiResult && apiResult.data && apiResult.data.length > 0) {
          saveRawCache(dt, apiResult.data);
        }
      } catch (e) {
        continue; // 请求失败，跳过
      }
      // 批次间间隔，避免反爬
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!apiResult || !apiResult.data || apiResult.data.length === 0) continue;

    const apiList = apiResult.data;
    supplementaryCount++;

    // 只对仍未匹配的比赛做匹配
    let foundInThis = 0;
    for (const { mid, m } of supplementaryNeeded) {
      if (!unmatchedAfterSupplement.has(mid)) continue;
      const homeName = (m.homeName || '').replace(/\(.*\)/g, '').trim();
      const visitName = (m.visitName || '').replace(/\(.*\)/g, '').trim();

      for (const item of apiList) {
        const aHome = (item.homeTeam || '').replace(/\(.*\)/g, '').trim();
        const aGuest = (item.guestTeam || '').replace(/\(.*\)/g, '').trim();
        if (fuzzyMatch(homeName, aHome) && fuzzyMatch(visitName, aGuest)) {
          primaryResult[mid] = item;
          unmatchedAfterSupplement.delete(mid);
          foundInThis++;
          totalSupplemented++;
          break;
        }
      }
    }

    if (foundInThis > 0) {
      console.log('[fetch] 补充批次', dt, ': +', foundInThis, '场 (剩余', unmatchedAfterSupplement.size, '场)');
    }
  }

  console.log('[fetch] 多批次聚合完成:', Object.keys(primaryResult).length, '场 (补充', totalSupplemented, '场)');
  if (unmatchedAfterSupplement.size > 0) {
    console.log('[fetch] ⚠️ 仍有', unmatchedAfterSupplement.size, '场比赛在所有批次中均无数据');
  }

  return primaryResult;
}

// ==================== 缓存 ====================

/**
 * ★ 同步更新批次索引 batch_index.json
 */
function syncBatchIndex(dateTime, rawData) {
  try {
    const BATCH_INDEX_PATH = path.join(__dirname, '..', 'batch_index.json');
    let index = {};
    if (fs.existsSync(BATCH_INDEX_PATH)) {
      index = JSON.parse(fs.readFileSync(BATCH_INDEX_PATH, 'utf8'));
    }
    const now = Date.now();
    const matchCount = Array.isArray(rawData) ? rawData.length : (rawData && rawData.length) || 0;
    index[dateTime] = {
      valid: true,
      matchCount: matchCount,
      discoveredAt: index[dateTime] ? index[dateTime].discoveredAt : now,
      updatedAt: now,
      expiresAt: now + 30 * 24 * 3600 * 1000, // 30天过期
    };
    fs.writeFileSync(BATCH_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  } catch (e) {
    // 静默失败，不影响主流程
  }
}

/**
 * ★ 原始 API 数据缓存（带 TTL + 格式兼容）
 *
 * 支持两种格式：
 *   旧格式: bank['_raw_26061'] = [ apiData... ]
 *   新格式: bank['_raw_26061'] = { data: [...], createdAt: ts, expiresAt: ts }
 *
 * 写入时使用新格式（带 TTL），读取时兼容两种格式。
 */
function saveRawCache(dateTime, rawData) {
  let bank = {};
  if (fs.existsSync(STATS_BANK_PATH)) {
    try {
      bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    } catch (e) {}
  }
  // ★ 新格式：带 TTL 包装
  const now = Date.now();
  bank['_raw_' + dateTime] = {
    data: rawData,
    createdAt: now,
    expiresAt: now + 14 * 24 * 3600 * 1000, // 14天过期
  };
  fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');

  // ★ 同步更新批次索引
  syncBatchIndex(dateTime, rawData);
}

function loadRawCache(dateTime) {
  if (!fs.existsSync(STATS_BANK_PATH)) return null;
  try {
    const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    const entry = bank['_raw_' + dateTime];
    if (!entry) return null;

    // 兼容旧格式（直接是数组）
    if (Array.isArray(entry)) return entry;

    // 新格式：检查 TTL
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      console.log('[fetch] 原始缓存过期:', dateTime);
      delete bank['_raw_' + dateTime];
      fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
      return null;
    }

    return entry.data || entry;
  } catch (e) {
    return null;
  }
}

/**
 * ★ 匹配结果缓存（带 TTL + 格式兼容）
 */
function saveStatsCache(dateTime, data) {
  let bank = {};
  if (fs.existsSync(STATS_BANK_PATH)) {
    try {
      bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    } catch (e) {}
  }
  const now = Date.now();
  bank[dateTime] = {
    data: data,
    createdAt: now,
    expiresAt: now + 7 * 24 * 3600 * 1000, // 7天过期
    count: Object.keys(data || {}).length,
  };
  fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
}

function loadStatsCache(dateTime) {
  if (!fs.existsSync(STATS_BANK_PATH)) return null;
  try {
    const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    const entry = bank[dateTime];
    if (!entry) return null;

    // 兼容旧格式（直接是对象，无 expiresAt 包装）
    if (typeof entry === 'object' && !entry.data && !entry.expiresAt) {
      return entry; // 旧格式直接返回
    }

    // 新格式：检查 TTL
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      console.log('[fetch] 匹配缓存过期:', dateTime);
      delete bank[dateTime];
      fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
      return null;
    }

    return entry.data || null;
  } catch (e) {
    return null;
  }
}

/**
 * ★ 缓存健康检查 + 自动清理
 * 建议每次写入后异步调用
 */
function cleanupExpiredCache() {
  if (!fs.existsSync(STATS_BANK_PATH)) return;
  try {
    const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
    const now = Date.now();
    let cleaned = 0;

    Object.keys(bank).forEach((key) => {
      if (key === '_last_batch') return;
      const entry = bank[key];
      if (entry && entry.expiresAt && entry.expiresAt < now) {
        delete bank[key];
        cleaned++;
      }
    });

    if (cleaned > 0) {
      fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
      console.log('[fetch] 自动清理过期缓存:', cleaned, '条');
    }
  } catch (e) {
    // 静默失败
  }
}

async function updateStats(dateStr) {
  const data = await fetchAndRelate(dateStr);
  return data;
}

module.exports = {
  fetchAndRelate,
  fetchAndRelateByBatch,
  fetchAndRelateMultiBatch,
  updateStats,
  loadStatsCache,
  saveStatsCache,
  autoDiscoverBatch,
  findLatestBatch,
  probeWithJumpSequence,
  makeDateTime,
  parseDateTime,
  getDiscoverMetrics,
  getBatchDiscoveryReport,
  cleanupExpiredCache,
  saveRawCache,
  loadRawCache,
  getFetchStats,
  recordFetchStats,
  JUMP_SEQUENCE,
};
