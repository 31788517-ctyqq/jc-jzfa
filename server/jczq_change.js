/**
 * JczqChange 欧指倾向数据获取 + 冷热指数计算
 *
 * 调用 m.100qiu.com/api/JczqChange 获取投注比例和欧指概率
 * 按产品文档公式计算冷热指数 / 主客队特征
 */
const https = require('https');
const path = require('path');
const fs = require('fs');
const jczqYz = require('./jczqYz_fetcher');

const CACHE_PATH = path.join(__dirname, 'jczq_change_cache.json');
const BATCH_SIZE = 6;  // 并发数

// ── 缓存 ──

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); }
  catch { return {}; }
}

function writeCache(data) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ── HTTP 请求 ──

function fetchJSON(url, timeoutMs) {
  timeoutMs = timeoutMs || 8000;
  return new Promise(function (resolve) {
    https.get(url, { rejectUnauthorized: false }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (e) { resolve(null); }
      });
    }).on('error', function () { resolve(null); })
      .setTimeout(timeoutMs, function () { resolve(null); });
  });
}

/**
 * 获取单场比赛的 JczqChange 数据
 * @param {string} dateStr  "2026-05-26"
 * @param {number} number   比赛编号（如 1、19）
 * @returns {Object|null}
 */
async function fetchJczqChange(dateStr, number) {
  var dt = dateStr.replace(/-/g, '');    // "20260526"
  var url = 'https://m.100qiu.com/api/JczqChange?dateTime=' + dt + '&number=' + number;
  var resp = await fetchJSON(url);
  return (resp && resp.data) ? resp.data : null;
}

/**
 * 获取单场比赛的 JczqBasic 数据（仅用在无法从功守道 cache 取 homePower 的降级场景）
 * @param {string} dateStr
 * @param {number} number
 * @returns {Object|null}
 */
async function fetchJczqBasic(dateStr, number) {
  var dt = dateStr.replace(/-/g, '');
  var url = 'https://m.100qiu.com/api/JczqBasic?dateTime=' + dt + '&number=' + number;
  var resp = await fetchJSON(url);
  return (resp && resp.data) ? resp.data : null;
}

// ── 辅助 ──

function round(v, d) {
  var m = Math.pow(10, d);
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

  var r = parseInt(rq) || 0;

  // 解析所有百分比为 0~100 数值
  var winPct   = cd.winPercent  || 0;
  var losePct  = cd.losePercent || 0;
  var lastWR   = parsePercent(cd.lastWinRate);    // 临盘主胜概率
  var lastLR   = parsePercent(cd.lastLoseRate);   // 临盘客胜概率
  var rqWinP   = cd.rqWinPercent  || 0;
  var rqLoseP  = cd.rqLosePercent || 0;

  var value;

  if (r === -1) {
    // 主队受让一球：R = 主胜投注比例÷主胜临盘概率
    value = lastWR > 0 ? (winPct / lastWR) : 0;
  } else if (r === 1) {
    // 主队让一球：R = 客胜投注比例÷客胜临盘概率
    value = lastLR > 0 ? (losePct / lastLR) : 0;
  } else if (r <= -2) {
    // 深盘受让
    value = rqLoseP / 100;
  } else if (r >= 2) {
    // 深盘让球
    value = rqWinP / 100;
  } else {
    // 平手盘或 rq=0，使用主胜投注/主胜概率
    value = lastWR > 0 ? (winPct / lastWR) : 0;
  }

  value = round(value, 2);

  // 判定等级
  var level, label;
  if (value > 1.20)   { level = 'hot';   label = value + ' 🔥'; }
  else if (value < 0.80) { level = 'cold';   label = value + ' 🧊'; }
  else                   { level = 'normal'; label = value + ' 🎯'; }

  return { value: value, level: level, label: label };
}

// ── 主客队特征生成 ──

/**
 * 根据初盘→临盘欧指变化生成文字描述
 */
function computeFeature(cd, side) {
  if (!cd) return '-';

  if (side === 'home') {
    var init = parsePercent(cd.winRate);      // 初始
    var last = parsePercent(cd.lastWinRate);  // 临盘
    if (!init || !last) return '-';
    var delta = round(last - init, 1);
    if (Math.abs(delta) < 0.5) return '概率' + last.toFixed(1) + '%' + ' →稳定';
    return '概率' + last.toFixed(1) + '%' + ' →' + (delta > 0 ? '↑' : '↓') + Math.abs(delta).toFixed(1) + '%';
  }

  if (side === 'away') {
    var initA = parsePercent(cd.loseRate);
    var lastA = parsePercent(cd.lastLoseRate);
    if (!initA || !lastA) return '-';
    var deltaA = round(lastA - initA, 1);
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
  var h = parseInt(homePower) || 50;
  var g = parseInt(guestPower) || 50;
  var total = h + g;
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
  var cache = readCache();
  var dateKey = dateStr;

  // 初始化缓存 key
  if (!cache[dateKey]) cache[dateKey] = {};

  var results = {};

  // 分批并发请求
  for (var i = 0; i < matchList.length; i += BATCH_SIZE) {
    var batch = matchList.slice(i, i + BATCH_SIZE);

    var promises = batch.map(function (m) {
      return (async function () {
        var matchId   = m.matchId;
        var numStr    = m.num || '';
        var number    = parseInt(numStr.replace(/^[^\d]*/, '')) || 0;

        if (!number || number < 1) {
          results[matchId] = makeEmptyResult();
          return;
        }

        // 1) 先查缓存
        if (cache[dateKey][matchId]) {
          results[matchId] = cache[dateKey][matchId];
          return;
        }

        // 2) 获取 JczqChange
        var cd = await fetchJczqChange(dateStr, number);

        // 2.5) 获取 JczqYz（关注热度 + 亚指临盘）
        var yz = await jczqYz.fetchJczqYz(dateStr, number);
        var hotFocusNum = yz ? yz.hotFocusNum : null;
        var oddsLive    = yz ? yz.oddsLive    : null;
        // 如果 Yz 有 rq 且传入的 matchList.rq 缺失，则用 Yz 的 rq
        if ((m.rq === undefined || m.rq === null) && yz && yz.rq !== undefined && yz.rq !== null) {
          m.rq = yz.rq;
        }

        // 3) 计算各字段
        var rq        = m.rq !== undefined && m.rq !== null ? m.rq : (cd ? cd.rq : 0);
        var heat      = computeHeatIndex(rq, cd);
        var homeFeat  = computeFeature(cd, 'home');
        var awayFeat  = computeFeature(cd, 'away');

        // staticDiff
        var staticDiff;
        if (m.homePower !== undefined && m.guestPower !== undefined) {
          staticDiff = computeStaticDiff(m.homePower, m.guestPower);
        } else {
          // 降级：从 JczqBasic 取
          var basic = await fetchJczqBasic(dateStr, number);
          staticDiff = computeStaticDiff(
            basic ? basic.homePower : 50,
            basic ? basic.guestPower : 50
          );
        }

        var entry = {
          staticDiff: staticDiff,
          heatIndex:   heat.value,
          heatLevel:   heat.level,
          heatLabel:   heat.label,
          homeFeature: homeFeat,
          guestFeature: awayFeat,
          hotFocusNum: hotFocusNum,
          oddsLive:    oddsLive,
          rq:          rq
        };

        cache[dateKey][matchId] = entry;
        results[matchId] = entry;
      })();
    });

    await Promise.all(promises);
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
    rq: 0
  };
}

module.exports = { computeHotData: computeHotData, fetchJczqChange: fetchJczqChange, computeHeatIndex: computeHeatIndex, computeStaticDiff: computeStaticDiff, computeFeature: computeFeature };
