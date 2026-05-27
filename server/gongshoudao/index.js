/**
 * 功守道量化引擎 — 主入口
 *
 * 编排所有阶段的计算，提供缓存读写、批量计算、增量更新。
 */
const fs = require('fs');
const path = require('path');
const parser = require('./parser');
const attack = require('./attack');
const goal = require('./goal');
const diff = require('./diff');
const score = require('./score');
const fetch = require('./fetch');

const CACHE_PATH = path.join(__dirname, 'cache.json');

// ==================== 缓存管理 ====================

function readCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (e) {
    console.error('[gs] 缓存读取失败:', e.message);
    return {};
  }
}

function writeCache(data) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ==================== 单场比赛计算 ====================

/**
 * 对单场比赛执行完整的功守道量化分析
 * @param {Object} rawStats API 原始统计数据
 * @param {Object} matchInfo data.json 中的比赛基础信息
 * @returns {Object} 完整的弹窗数据
 */
function computeSingleMatch(rawStats, matchInfo) {
  // 第一阶段：字段解析
  const vars = parser.parse(rawStats);
  if (!vars) return null;

  // 第二阶段：实力分析
  const strengthResult = attack.analyze(vars);

  // 第四阶段：大小球 + xG
  const goalResult = goal.analyze(vars, strengthResult.totalAdvantagePct);

  // 第五阶段：净胜球 + 让球分析
  const diffResult = diff.analyze(vars, goalResult.xgHome, goalResult.xgAway);

  // 组装弹窗数据
  return {
    // 基础信息
    matchId: matchInfo.matchId || '',
    homeName: matchInfo.homeName || '',
    visitName: matchInfo.visitName || '',
    leagueName: matchInfo.leagueName || '',
    num: matchInfo.num || '',
    startTime: matchInfo.startTime || '',

    // ⭐ 基础实力分（供 quant-hot 计算 staticDiff）
    homePower: vars.homePower,
    guestPower: vars.awayPower,

    // 第二阶段输出：实力分析
    attackAdvantage: strengthResult.attackAdvantage,
    attackAdvantageValue: strengthResult.attackAdvantageValue,
    defenseAdvantage: strengthResult.defenseAdvantage,
    defenseAdvantageValue: strengthResult.defenseAdvantageValue,
    attackPattern: strengthResult.attackPattern,
    attackWeightHome: strengthResult.attackWeightHome,
    attackWeightAway: strengthResult.attackWeightAway,
    defenseWeightHome: strengthResult.defenseWeightHome,
    defenseWeightAway: strengthResult.defenseWeightAway,
    totalAdvantage: strengthResult.totalAdvantage,
    totalAdvantageValue: strengthResult.totalAdvantageValue,

    // 实力阶梯标签
    ladderLabel: strengthResult.ladder.label,
    ladderLevel: strengthResult.ladder.level,

    // 胜平负交叉分布
    crossWin: strengthResult.cross.crossWin,
    crossDraw: strengthResult.cross.crossDraw,
    crossLose: strengthResult.cross.crossLose,
    crossRq: strengthResult.cross.rq,
    // 原始近10场胜平负场次（用于前端计算赛果对冲差值）
    hWins: strengthResult.cross.hWins,
    hLosses: strengthResult.cross.hLosses,
    aWins: strengthResult.cross.aWins,
    aLosses: strengthResult.cross.aLosses,
    // 大球率（goalRange 内部）
    overRate: goalResult.goalRange.overRate,

    // 第四阶段输出：大小球
    homeWeight: goalResult.homeWeight,
    awayWeight: goalResult.awayWeight,
    goalDiffHome: goalResult.goalDiffHome,
    goalDiffAway: goalResult.goalDiffAway,
    totalGoalsExpect: goalResult.totalGoalsExpect,
    totalGoalsValue: goalResult.totalGoalsValue,
    goalRange: goalResult.goalRange,

    // 第五阶段输出：净胜球
    homeWinExpect: diffResult.homeWinExpect,
    homeWinValue: diffResult.homeWinValue,
    totalAdvantage2: diffResult.totalAdvantage2,
    totalAdvantage2Value: diffResult.totalAdvantage2Value,
    goalCount: diffResult.goalCount,
    goalCountValue: diffResult.goalCountValue,
    verifyResult: diffResult.verifyResult,
    verifyValue: diffResult.verifyValue,

    // 谐振裁决
    resonance: diffResult.resonance,
    sevenMatch: diffResult.sevenMatch,
    anchor: diffResult.anchor,

    // 第六阶段：比分矩阵
    scores: (() => {
      try {
        const s = score.analyze(vars, goalResult.xgHome, goalResult.xgAway, goalResult.goalRange, strengthResult.ladder.level);
        return s.length > 0 ? s : [{ score: '--', percent: '无合法比分' }];
      } catch (e) {
        return [{ score: '--', percent: '计算异常' }];
      }
    })(),

    // 建议
    suggestion: diffResult.resonance.verdict || '基于历史数据的量化分析，仅供参考'
  };
}

// ==================== 全局变量 ====================
let _globalStatsMap = null;  // { matchId: rawStats }
let _globalCacheKey = null;  // 当前批次

function loadDataJsonM() {
  const dataFilePath = path.join(__dirname, '..', 'data.json');
  if (!fs.existsSync(dataFilePath)) return {};
  try { return JSON.parse(fs.readFileSync(dataFilePath, 'utf8')).m || {}; }
  catch (e) { return {}; }
}

// ==================== 批量计算与缓存 ====================

/**
 * 按队名交叉匹配：API data → data.json matchId
 * 匹配所有 data.json 中的比赛（不限定日期），返回 { matchId: rawStats }
 */
async function crossMatchAll() {
  // 自动发现最新批次
  let batchDT;
  try {
    batchDT = await fetch.autoDiscoverBatch();
  } catch (e) {
    console.error('[gs] 批次发现失败:', e.message);
    return {};
  }
  if (!batchDT) {
    console.error('[gs] 无可用批次');
    return {};
  }
  console.log('[gs] 使用批次:', batchDT);

  const matched = await fetch.fetchAndRelateByBatch(batchDT);
  return matched;
}

/**
 * 对全量匹配结果执行批量计算（增量更新：保留已有缓存，只计算新匹配）
 */
async function computeAll() {
  console.log('[gs] === 全量计算（增量模式） ===');

  const cache = readCache();
  const cacheKey = '_global';

  // 1. 保留已有缓存
  const existing = (cache[cacheKey] && Object.keys(cache[cacheKey]).length > 0)
    ? cache[cacheKey] : {};
  let hasAny = Object.values(existing).some(v => v && v.attackPattern);
  if (hasAny) {
    console.log('[gs] 已有缓存', Object.keys(existing).length, '场，增量更新...');
  }

  // 2. 交叉匹配 API ↔ data.json
  let statsMap;
  try {
    statsMap = await crossMatchAll();
  } catch (e) {
    console.error('[gs] crossMatchAll 失败:', e.message);
    // 返回已有缓存
    if (hasAny) {
      console.log('[gs] 降级使用已有缓存');
      return existing;
    }
    return {};
  }
  if (Object.keys(statsMap).length === 0) {
    console.log('[gs] 无匹配数据');
    if (hasAny) return existing;
    return {};
  }

  // 3. 读取 data.json
  const mMap = loadDataJsonM();

  // 4. 只计算缓存中没有的匹配（增量）
  let newCount = 0;
  const toCompute = [];
  Object.entries(statsMap).forEach(([mid, rawStats]) => {
    if (existing[mid] && existing[mid].attackPattern) {
      // 已有有效缓存，跳过（除非要强制刷新）
      return;
    }
    toCompute.push([mid, rawStats]);
  });

  if (toCompute.length > 0) {
    console.log('[gs] 需计算', toCompute.length, '场新匹配...');
    toCompute.forEach(([mid, rawStats]) => {
      const m = mMap[mid] || {};
      try {
        existing[mid] = computeSingleMatch(rawStats, m);
        newCount++;
      } catch (e) {
        console.error('[gs] 计算失败:', mid, e.message);
      }
    });
  }

  console.log('[gs] 增量完成:', newCount, '场新增, 共', Object.keys(existing).length, '场');

  // 5. 写入缓存
  cache[cacheKey] = existing;
  writeCache(cache);

  return existing;
}

/**
 * 获取单场比赛的量化结果
 * @param {string} matchId
 * @returns {Promise<Object|null>}
 */
async function getMatchResult(matchId) {
  // 1. 尝试读缓存（兼容 m_ 前缀）
  const cache = readCache();
  const cacheKey = '_global';
  const globalCache = cache[cacheKey] || {};

  // 直接匹配
  if (globalCache[matchId]) return globalCache[matchId];
  // m_ 前缀匹配
  if (globalCache['m_' + matchId]) return globalCache['m_' + matchId];
  // 去 m_ 前缀匹配
  const clean = String(matchId).replace(/^m_/, '');
  if (globalCache[clean]) return globalCache[clean];

  // 2. 全量计算（首次计算会写入缓存）
  const results = await computeAll();
  return results[matchId] || results['m_' + matchId] || results[clean] || null;
}

/**
 * 刷新缓存（增量模式：保留旧数据，只计算新匹配）
 */
async function refreshCache() {
  return computeAll();
}

module.exports = {
  computeSingleMatch,
  computeAll,
  getMatchResult,
  refreshCache,
  crossMatchAll,
  readCache,
  writeCache
};
