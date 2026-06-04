/**
 * JczqChange 欧指倾向数据获取 + 冷热指数计算
 *
 * 调用 m.100qiu.com/api/JczqChange + JczqBasic（本地直连 127.0.0.1:8080）
 * 按产品文档公式计算冷热指数 / 主客队特征
 *
 * V9.0: JczqBasic 全字段持久化到 midou_data.db jczq_basic_cache 表
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const jczqYz = require('./jczqYz_fetcher');

const LOCAL_HOST = '127.0.0.1';
const LOCAL_PORT = 19880;
const CACHE_PATH = path.join(__dirname, 'jczq_change_cache.json');
const BATCH_SIZE = 5; // 增加并发数，减少批次等待
const BATCH_DELAY = 200; // 批次间延迟 ms（原500ms）
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // ★ P1-3: 缓存有效期 30 天

// ★ DB 持久化统计（用于监控）
let _basicStoreStats = { attempts: 0, stored: 0, skipped: 0, errors: 0 };

// ── 缓存 ──

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(data) {
  // ★ P1-3: 写入前清理 30 天前的过期条目
  const cutoff = Date.now() - CACHE_MAX_AGE_MS;
  const newData = {};
  const keys = Object.keys(data);
  let purgedCount = 0;
  for (let i = 0; i < keys.length; i++) {
    const dateKey = keys[i];
    const dateEntries = data[dateKey];
    // 提取日期并检查是否过期
    const dateMatch = dateKey.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const entryDate = new Date(dateMatch[1]).getTime();
      if (entryDate < cutoff) {
        purgedCount++;
        continue; // 跳过过期日期
      }
    }
    newData[dateKey] = dateEntries;
  }
  if (purgedCount > 0) {
    console.log('[jczq_change] 清理 ' + purgedCount + ' 个过期日期条目');
  }
  fs.writeFileSync(CACHE_PATH, JSON.stringify(newData, null, 2), 'utf8');
}

// ── HTTP 请求 ──

function fetchJSON(apiPath, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise(function (resolve) {
    const opts = {
      hostname: LOCAL_HOST,
      port: LOCAL_PORT,
      path: apiPath,
      method: 'GET',
      headers: { Host: 'm.100qiu.com', Accept: 'application/json' },
    };
    http
      .get(opts, function (res) {
        const chunks = [];
        res.on('data', function (c) {
          chunks.push(c);
        });
        res.on('end', function () {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (e) {
            resolve(null);
          }
        });
      })
      .on('error', function () {
        resolve(null);
      })
      .setTimeout(timeoutMs, function () {
        resolve(null);
      });
  });
}

/**
 * 获取单场比赛的 JczqChange 数据
 * @param {string} dateStr  "2026-05-26"
 * @param {number} number   比赛编号（如 1、19）
 * @returns {Object|null}
 */
async function fetchJczqChange(dateStr, number) {
  const dt = dateStr.replace(/-/g, ''); // "20260526"
  const apiPath = '/api/JczqChange?dateTime=' + dt + '&number=' + number;
  const resp = await fetchJSON(apiPath);
  return resp && resp.data ? resp.data : null;
}

/**
 * 获取单场比赛的 JczqBasic 数据（仅用在无法从功守道 cache 取 homePower 的降级场景）
 * @param {string} dateStr
 * @param {number} number
 * @returns {Object|null}
 */
async function fetchJczqBasic(dateStr, number) {
  const dt = dateStr.replace(/-/g, '');
  const apiPath = '/api/JczqBasic?dateTime=' + dt + '&number=' + number;
  const resp = await fetchJSON(apiPath);
  return resp && resp.data ? resp.data : null;
}

/**
 * ★ V9.0 获取 JczqBasic 全字段（40+ 字段，按《竞彩全维度数据_JS字段解释规范》）
 * @param {string} dateStr  "2026-05-26"
 * @param {number} number   比赛编号（如 1、19）
 * @returns {Object|null}   结构化全字段对象，失败返回 null
 */
async function fetchJczqBasicFull(dateStr, number) {
  const dt = dateStr.replace(/-/g, '');
  const apiPath = '/api/JczqBasic?dateTime=' + dt + '&number=' + number;
  const resp = await fetchJSON(apiPath);
  if (!resp || !resp.data) return null;
  const d = resp.data;

  // 提取所有 40+ 字段，按文档规范分类
  return {
    // 一、基础信息与赛事标识
    lineId: d.lineId || null,
    matchTimeStr: d.matchTimeStr || null,
    homeTeam: d.homeTeam || null,
    guestTeam: d.guestTeam || null,
    gameShortName: d.gameShortName || null,
    rq: d.rq !== undefined ? d.rq : null,

    // 二、球队基本面与历史特征
    homePower: d.homePower != null ? Number(d.homePower) : null,
    guestPower: d.guestPower != null ? Number(d.guestPower) : null,
    homeJiFenHomeAll: d.homeJiFenHomeAll != null ? Number(d.homeJiFenHomeAll) : null,
    homeJiFenHome: d.homeJiFenHome != null ? Number(d.homeJiFenHome) : null,
    awayJiFenGuest: d.awayJiFenGuest != null ? Number(d.awayJiFenGuest) : null,
    homeFeature: d.homeFeature || null,
    guestFeature: d.guestFeature || null,
    homeEnterEfficiency: d.homeEnterEfficiency != null ? Number(d.homeEnterEfficiency) : null,
    guestEnterEfficiency: d.guestEnterEfficiency != null ? Number(d.guestEnterEfficiency) : null,
    homePreventEfficiency: d.homePreventEfficiency != null ? Number(d.homePreventEfficiency) : null,
    guestPreventEfficiency: d.guestPreventEfficiency != null ? Number(d.guestPreventEfficiency) : null,
    homeSpf: d.homeSpf || null,
    guestSpf: d.guestSpf || null,
    homeWinQiu_0: d.homeWinQiu_0 != null ? Number(d.homeWinQiu_0) : null,
    homeWinQiu_1: d.homeWinQiu_1 != null ? Number(d.homeWinQiu_1) : null,
    homeWinQiu_2: d.homeWinQiu_2 != null ? Number(d.homeWinQiu_2) : null,
    homeLoseQiu_0: d.homeLoseQiu_0 != null ? Number(d.homeLoseQiu_0) : null,
    homeLoseQiu_1: d.homeLoseQiu_1 != null ? Number(d.homeLoseQiu_1) : null,
    homeLoseQiu_2: d.homeLoseQiu_2 != null ? Number(d.homeLoseQiu_2) : null,
    homeWinGap_1: d.homeWinGap_1 != null ? Number(d.homeWinGap_1) : null,
    homeWinGap_2: d.homeWinGap_2 != null ? Number(d.homeWinGap_2) : null,
    homeLoseGap_1: d.homeLoseGap_1 != null ? Number(d.homeLoseGap_1) : null,
    homeLoseGap_2: d.homeLoseGap_2 != null ? Number(d.homeLoseGap_2) : null,
    homeWinPan: d.homeWinPan != null ? Number(d.homeWinPan) : null,
    guestWinPan: d.guestWinPan != null ? Number(d.guestWinPan) : null,
    jiaoFenDesc: d.jiaoFenDesc || null,
    jiaoFenMatch1: d.jiaoFenMatch1 || null,
    jiaoFenMatch2: d.jiaoFenMatch2 || null,

    // 三、亚指、大小球与欧指让球
    initPan: d.initPan != null ? Number(d.initPan) : null,
    asiaInitAvgWinOdd: d.asiaInitAvgWinOdd != null ? Number(d.asiaInitAvgWinOdd) : null,
    asiaInitAvgLoseOdd: d.asiaInitAvgLoseOdd != null ? Number(d.asiaInitAvgLoseOdd) : null,
    lastPan: d.lastPan != null ? Number(d.lastPan) : null,
    asiaLastAvgWinOdd: d.asiaLastAvgWinOdd != null ? Number(d.asiaLastAvgWinOdd) : null,
    asiaLastAvgLoseOdd: d.asiaLastAvgLoseOdd != null ? Number(d.asiaLastAvgLoseOdd) : null,
    dxqInitPan: d.dxqInitPan != null ? Number(d.dxqInitPan) : null,
    dxqInitAvgWinOdd: d.dxqInitAvgWinOdd != null ? Number(d.dxqInitAvgWinOdd) : null,
    dxqInitAvgLoseOdd: d.dxqInitAvgLoseOdd != null ? Number(d.dxqInitAvgLoseOdd) : null,
    dxqLastPan: d.dxqLastPan != null ? Number(d.dxqLastPan) : null,
    dxqLastAvgWinOdd: d.dxqLastAvgWinOdd != null ? Number(d.dxqLastAvgWinOdd) : null,
    dxqLastAvgLoseOdd: d.dxqLastAvgLoseOdd != null ? Number(d.dxqLastAvgLoseOdd) : null,
    initRqWinOdd: d.initRqWinOdd != null ? Number(d.initRqWinOdd) : null,
    initRqDrawOdd: d.initRqDrawOdd != null ? Number(d.initRqDrawOdd) : null,
    initRqLoseOdd: d.initRqLoseOdd != null ? Number(d.initRqLoseOdd) : null,
    lastRqWinOdd: d.lastRqWinOdd != null ? Number(d.lastRqWinOdd) : null,
    lastRqDrawOdd: d.lastRqDrawOdd != null ? Number(d.lastRqDrawOdd) : null,
    lastRqLoseOdd: d.lastRqLoseOdd != null ? Number(d.lastRqLoseOdd) : null,

    // 四、欧指概率与离散度分析
    winRate: d.winRate != null ? Number(d.winRate) : null,
    drawRate: d.drawRate != null ? Number(d.drawRate) : null,
    loseRate: d.loseRate != null ? Number(d.loseRate) : null,
    lastWinRate: d.lastWinRate != null ? Number(d.lastWinRate) : null,
    lastDrawRate: d.lastDrawRate != null ? Number(d.lastDrawRate) : null,
    lastLoseRate: d.lastLoseRate != null ? Number(d.lastLoseRate) : null,
    winDiscrete: d.winDiscrete != null ? Number(d.winDiscrete) : null,
    drawDiscrete: d.drawDiscrete != null ? Number(d.drawDiscrete) : null,
    loseDiscrete: d.loseDiscrete != null ? Number(d.loseDiscrete) : null,
    lastWinDiscrete: d.lastWinDiscrete != null ? Number(d.lastWinDiscrete) : null,
    lastDrawDiscrete: d.lastDrawDiscrete != null ? Number(d.lastDrawDiscrete) : null,
    lastLoseDiscrete: d.lastLoseDiscrete != null ? Number(d.lastLoseDiscrete) : null,
    initDiscreteDiff: d.initDiscreteDiff != null ? Number(d.initDiscreteDiff) : null,
    lastDiscreteDiff: d.lastDiscreteDiff != null ? Number(d.lastDiscreteDiff) : null,
    initEuroPay: d.initEuroPay != null ? Number(d.initEuroPay) : null,
    lastEuroPay: d.lastEuroPay != null ? Number(d.lastEuroPay) : null,
    initConfi: d.initConfi != null ? Number(d.initConfi) : null,
    lastConfi: d.lastConfi != null ? Number(d.lastConfi) : null,

    // 五、市场支持率与关注度
    winPercent: d.winPercent != null ? Number(d.winPercent) : null,
    drawPercent: d.drawPercent != null ? Number(d.drawPercent) : null,
    losePercent: d.losePercent != null ? Number(d.losePercent) : null,
    rqWinPercent: d.rqWinPercent != null ? Number(d.rqWinPercent) : null,
    rqDrawPercent: d.rqDrawPercent != null ? Number(d.rqDrawPercent) : null,
    rqLosePercent: d.rqLosePercent != null ? Number(d.rqLosePercent) : null,
    hotWinRate: d.hotWinRate != null ? Number(d.hotWinRate) : null,
    hotLoseRate: d.hotLoseRate != null ? Number(d.hotLoseRate) : null,
    hotFocusNum: d.hotFocusNum != null ? Number(d.hotFocusNum) : null,

    // 六、北单实时奖金与换算比例
    homeWinAward: d.homeWinAward != null ? Number(d.homeWinAward) : null,
    drawAward: d.drawAward != null ? Number(d.drawAward) : null,
    guestWinAward: d.guestWinAward != null ? Number(d.guestWinAward) : null,
  };
}

/**
 * ★ V9.0 将 JczqBasic 全字段静默持久化到 SQLite
 * 失败不影响主流程，仅记录统计
 */
function storeBasicToDB(dateStr, matchNum, basicData) {
  if (!basicData || !matchNum) return;
  _basicStoreStats.attempts++;
  try {
    const database = require('./database');
    if (!database.isAvailable || !database.isAvailable()) {
      // 数据库未就绪，静默跳过
      return;
    }
    database.upsertJczqBasic(dateStr, String(matchNum), basicData);
    _basicStoreStats.stored++;
  } catch (e) {
    _basicStoreStats.errors++;
    // 静默失败，不阻塞主流程
  }
}

// ── 辅助 ──

function round(v, d) {
  const m = Math.pow(10, d);
  return Math.round(v * m) / m;
}

function parsePercent(v) {
  // "50.72%" → 50.72
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v.replace('%', '')) || 0;
  return 0;
}

// ── 冷热指数计算（严格按产品文档公式） ──

/**
 * 核心：根据让球数 (rq) 选择冷热指数公式
 *
 *   场景 A  rq = -1  →  R = Bet_home / W       (主队受让一球)
 *   场景 B  rq = +1  →  R = Bet_away / L       (主队让一球)
 *   场景 C  rq ≤ -2  →  R = rqLosePct × factor (深盘受让)
 *   场景 D  rq ≥ +2  →  R = rqWinPct  × factor (深盘让球)
 *   其他（平手等）     →  默认用场景 A 公式
 *
 * @param {number} rq  让球数
 * @param {Object} cd  JczqChange 返回的 data
 * @returns {{ value:number, level:string, label:string }}
 */
function computeHeatIndex(rq, cd) {
  if (!cd) return { value: null, level: 'unknown', label: '-' };

  const r = parseInt(rq) || 0;

  // 解析所有百分比为 0~100 数值
  const winPct = cd.winPercent || 0;
  const losePct = cd.losePercent || 0;
  const lastWR = parsePercent(cd.lastWinRate); // 临盘主胜概率
  const lastLR = parsePercent(cd.lastLoseRate); // 临盘客胜概率
  const rqWinP = cd.rqWinPercent || 0;
  const rqLoseP = cd.rqLosePercent || 0;

  let value;

  if (r === -1) {
    // 主队受让一球：R = 主胜投注比例÷主胜临盘概率
    value = lastWR > 0 ? winPct / lastWR : 0;
  } else if (r === 1) {
    // 主队让一球：R = 客胜投注比例÷客胜临盘概率
    value = lastLR > 0 ? losePct / lastLR : 0;
  } else if (r <= -2) {
    // 深盘受让
    value = rqLoseP / 100;
  } else if (r >= 2) {
    // 深盘让球
    value = rqWinP / 100;
  } else {
    // 平手盘或 rq=0，使用主胜投注/主胜概率
    value = lastWR > 0 ? winPct / lastWR : 0;
  }

  value = round(value, 2);

  // 判定等级
  let level, label;
  if (value > 1.2) {
    level = 'hot';
    label = value + ' 🔥';
  } else if (value < 0.8) {
    level = 'cold';
    label = value + ' 🧊';
  } else {
    level = 'normal';
    label = value + ' 🎯';
  }

  return { value: value, level: level, label: label };
}

// ── 主客队特征生成 ──

/**
 * 根据初盘→临盘欧指变化生成文字描述
 */
function computeFeature(cd, side) {
  if (!cd) return '-';

  if (side === 'home') {
    const init = parsePercent(cd.winRate); // 初始
    const last = parsePercent(cd.lastWinRate); // 临盘
    if (!init || !last) return '-';
    const delta = round(last - init, 1);
    if (Math.abs(delta) < 0.5) return '概率' + last.toFixed(1) + '%' + ' →稳定';
    return '概率' + last.toFixed(1) + '%' + ' →' + (delta > 0 ? '↑' : '↓') + Math.abs(delta).toFixed(1) + '%';
  }

  if (side === 'away') {
    const initA = parsePercent(cd.loseRate);
    const lastA = parsePercent(cd.lastLoseRate);
    if (!initA || !lastA) return '-';
    const deltaA = round(lastA - initA, 1);
    if (Math.abs(deltaA) < 0.5) return '概率' + lastA.toFixed(1) + '%' + ' →稳定';
    return '概率' + lastA.toFixed(1) + '%' + ' →' + (deltaA > 0 ? '↑' : '↓') + Math.abs(deltaA).toFixed(1) + '%';
  }

  return '-';
}

// ── 静态实力差 ──

/**
 * StaticDiff = (homePower - guestPower) / (homePower + guestPower)
 * 按产品文档公式
 */
function computeStaticDiff(homePower, guestPower) {
  const h = parseInt(homePower) || 50;
  const g = parseInt(guestPower) || 50;
  const total = h + g;
  if (total === 0) return 0;
  return round((h - g) / total, 4);
}

// ── 批量入口 ──

/**
 * 为一批比赛计算热度数据
 * @param {string} dateStr         "2026-05-26"
 * @param {Array}  matchList       [{ matchId, num, homePower?, guestPower?, rq? }]
 * @returns {Object}  { [matchId]: { staticDiff, heatIndex, heatLevel, homeFeature, guestFeature, ... } }
 */
async function computeHotData(dateStr, matchList) {
  const cache = readCache();
  const dateKey = dateStr;

  // 初始化缓存 key
  if (!cache[dateKey]) cache[dateKey] = {};

  const results = {};

  // 分批并发请求
  for (let i = 0; i < matchList.length; i += BATCH_SIZE) {
    const batch = matchList.slice(i, i + BATCH_SIZE);

    const promises = batch.map(function (m) {
      return (async function () {
        const matchId = m.matchId;
        const numStr = m.num || '';
        const number = parseInt(numStr.replace(/^[^\d]*/, '')) || 0;

        if (!number || number < 1) {
          results[matchId] = makeEmptyResult();
          return;
        }

        // 1) 先查缓存
        if (cache[dateKey][matchId]) {
          const cached = cache[dateKey][matchId];
          let needUpdate = false;
          // 如果缓存中 Yz 数据缺失（之前请求失败），静默重试 Yz 补齐
          if (cached.hotFocusNum === null || cached.hotFocusNum === undefined) {
            const yzRetry = await jczqYz.fetchJczqYz(dateStr, number);
            if (yzRetry) {
              if (yzRetry.hotFocusNum !== null && yzRetry.hotFocusNum !== undefined) {
                cached.hotFocusNum = yzRetry.hotFocusNum;
                needUpdate = true;
              }
              if (yzRetry.oddsLive !== null && yzRetry.oddsLive !== undefined) {
                cached.oddsLive = yzRetry.oddsLive;
                needUpdate = true;
              }
              if ((cached.rq === undefined || cached.rq === null || cached.rq === 0) && yzRetry.rq) {
                cached.rq = yzRetry.rq;
                needUpdate = true;
              }
              if ((cached.hotWinRate === undefined || cached.hotWinRate === null) && yzRetry.hotWinRate) {
                cached.hotWinRate = yzRetry.hotWinRate;
                cached.hotLoseRate = yzRetry.hotLoseRate;
                needUpdate = true;
              }
            }
          }
          // 如果缓存中 Change 数据缺失（heatIndex 为 null，之前请求繁忙），静默重试 JczqChange
          if (cached.heatIndex === null || cached.heatIndex === undefined) {
            const cdRetry = await fetchJczqChange(dateStr, number);
            if (cdRetry) {
              const rqVal = m.rq !== undefined && m.rq !== null ? m.rq : cached.rq || cdRetry.rq || 0;
              const heatRetry = computeHeatIndex(rqVal, cdRetry);
              cached.heatIndex = heatRetry.value;
              cached.heatLevel = heatRetry.level;
              cached.heatLabel = heatRetry.label;
              cached.homeFeature = computeFeature(cdRetry, 'home');
              cached.guestFeature = computeFeature(cdRetry, 'away');
              needUpdate = true;
            }
          }
          if (needUpdate) {
            cached._ts = new Date().toISOString();
            cache[dateKey][matchId] = cached;
          }
          results[matchId] = cached;

          // ★ V9.0 静默补齐 JczqBasic 到 DB（缓存命中但 DB 可能缺 Basic 数据）
          try {
            const database = require('./database');
            if (database.isAvailable && database.isAvailable() && !database.getJczqBasic(dateStr, String(number))) {
              fetchJczqBasicFull(dateStr, number).then(function (basicData) {
                storeBasicToDB(dateStr, String(number), basicData);
              }).catch(function () {});
            } else {
              _basicStoreStats.skipped++;
            }
          } catch (e) { /* 静默 */ }

          return;
        }

        // 2) 并行获取 JczqChange + JczqYz + JczqBasicFull（V9.0 新增）
        const cdYzBasic = await Promise.all([
          fetchJczqChange(dateStr, number),
          jczqYz.fetchJczqYz(dateStr, number),
          fetchJczqBasicFull(dateStr, number),
        ]);
        const cd = cdYzBasic[0];
        const yz = cdYzBasic[1];
        const basicFull = cdYzBasic[2];

        // ★ V9.0 持久化 JczqBasic 全字段到 SQLite
        storeBasicToDB(dateStr, String(number), basicFull);

        const hotFocusNum = yz ? yz.hotFocusNum : null;
        const oddsLive = yz ? yz.oddsLive : null;
        // 如果 Yz 有 rq 且传入的 matchList.rq 缺失，则用 Yz 的 rq
        if ((m.rq === undefined || m.rq === null) && yz && yz.rq !== undefined && yz.rq !== null) {
          m.rq = yz.rq;
        }

        // 3) 计算各字段
        const rq = m.rq !== undefined && m.rq !== null ? m.rq : cd ? cd.rq : 0;
        const heat = computeHeatIndex(rq, cd);
        const homeFeat = computeFeature(cd, 'home');
        const awayFeat = computeFeature(cd, 'away');

        // staticDiff — 优先用功守道提供的实力数据，只在两者都缺失时才降级到 JczqBasic
        let staticDiff;
        if (m.homePower != null && m.guestPower != null) {
          staticDiff = computeStaticDiff(m.homePower, m.guestPower);
        } else {
          // 降级：优先用刚获取的 basicFull，无额外 API 请求
          staticDiff = computeStaticDiff(
            basicFull && basicFull.homePower != null ? basicFull.homePower : 50,
            basicFull && basicFull.guestPower != null ? basicFull.guestPower : 50,
          );
        }

        const entry = {
          _ts: new Date().toISOString(),
          staticDiff: staticDiff,
          heatIndex: heat.value,
          heatLevel: heat.level,
          heatLabel: heat.label,
          homeFeature: homeFeat,
          guestFeature: awayFeat,
          hotFocusNum: hotFocusNum,
          hotWinRate: yz ? yz.hotWinRate : null,
          hotLoseRate: yz ? yz.hotLoseRate : null,
          oddsLive: oddsLive,
          rq: rq,
        };

        cache[dateKey][matchId] = entry;
        results[matchId] = entry;
      })();
    });

    await Promise.all(promises);
    // 批次间短暂延迟，避免 Java API 繁忙限流
    if (i + BATCH_SIZE < matchList.length) {
      await new Promise(function (resolve) {
        setTimeout(resolve, BATCH_DELAY);
      });
    }
  }

  // 写入缓存
  writeCache(cache);

  return results;
}

function makeEmptyResult() {
  return {
    staticDiff: 0,
    heatIndex: null,
    heatLevel: 'unknown',
    heatLabel: '-',
    homeFeature: '-',
    guestFeature: '-',
    hotFocusNum: 0,
    oddsLive: 0,
    rq: 0,
  };
}

module.exports = {
  computeHotData: computeHotData,
  fetchJczqChange: fetchJczqChange,
  fetchJczqBasicFull: fetchJczqBasicFull,
  storeBasicToDB: storeBasicToDB,
  computeHeatIndex: computeHeatIndex,
  computeStaticDiff: computeStaticDiff,
  computeFeature: computeFeature,
  getBasicStoreStats: function () { return Object.assign({}, _basicStoreStats); },
};
