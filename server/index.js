/**
 * server/index.js
 * 竞彩足球推荐趋势监控 — Express API 服务入口
 *
 * 模块结构:
 *   core/cache.js     — data.json / trends.json / odds 缓存层
 *   core/midou.js     — 米斗数据登录、爬取、数据获取
 *   core/ai-timing.js — AI 计时统计
 *   database.js       — SQLite 主存储（降级 JSON）
 */
require('dotenv').config();
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const database = require('./database');
const predictionLog = require('./prediction_log');
const { get } = require('./http-utils');
const logger = require('./logger');
const deepseek = require('./deepseek');
const doubao = require('./doubao');
const aiMerger = require('./ai_merger');
const authService = require('./auth-service');

// ── 核心模块 ──
const cacheModule = require('./core/cache');
const midouModule = require('./core/midou');
const aiTiming = require('./core/ai-timing');
const health = require('./core/health');

// ── AI/GS 缓存内存加速（避免每次请求同步读大文件） ──
let _aiCacheData = null;
let _aiCacheTime = 0;
let _gsCacheData = null;
let _gsCacheTime = 0;
const { getDeltaHistory } = require('./core/odds-tracker');
const spAdapter = require('./core/sp_data_adapter'); // ★ V9: SP官方数据统一访问
const oddsProvider = require('./core/odds-provider'); // ★ 统一赔率读取辅助
const payments = require('./payments/index'); // ★ V9.1: 支付/订阅/返利模块

// ── 函数别名（保持 POST /api 路由中引用兼容） ──
const localDate = cacheModule.localDate;
const latestDataDate = cacheModule.latestDataDate;
const getDataJson = cacheModule.getDataJson;
const getTrendsJson = cacheModule.getTrendsJson;
const getOddsHistory = cacheModule.getOddsHistory;
const getHitRateCache = cacheModule.getHitRateCache;
const setHitRateCache = cacheModule.setHitRateCache;
const DATA_JSON_PATH = cacheModule.DATA_JSON_PATH;
const TRENDS_PATH = cacheModule.TRENDS_PATH;

const login = midouModule.login;
const fetchMatches = midouModule.fetchMatches;
const fetchRecommends = midouModule.fetchRecommends;
const ensureData = midouModule.ensureData;
const ensureRecommends = midouModule.ensureRecommends;
const safeApiCall = midouModule.safeApiCall;
const CONFIG = midouModule.CONFIG;

// 500.com 全玩法数据缓存（含 BF 比分赔率）
let _allplaysCache = null;
let _allplaysCacheTime = 0;
let _allplaysCacheMtime = 0;
const ALLPLAYS_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
function getAllplaysData() {
  const now = Date.now();
  try {
    const ap = path.join(__dirname, 'ttyingqiu_data', 'odds_500_allplays.json');
    if (fs.existsSync(ap)) {
      const stat = fs.statSync(ap);
      if (_allplaysCache && stat.mtimeMs === _allplaysCacheMtime && now - _allplaysCacheTime < ALLPLAYS_CACHE_TTL) {
        return _allplaysCache;
      }
      _allplaysCache = JSON.parse(fs.readFileSync(ap, 'utf8'));
      _allplaysCacheTime = now;
      _allplaysCacheMtime = stat.mtimeMs;
      return _allplaysCache;
    }
  } catch (e) {
    logger.warn('[allplays] 读取失败: ' + e.message);
  }
  return _allplaysCache || {};
}

// 方案页赛果叠加：优先使用 prediction_logs / live_scores 中的最新可靠比分
const _planOutcomeOverlayCache = {};
let _liveScoresMtime = 0;
function normalizeScoreText(score) {
  if (score === null || score === undefined) return '';
  return String(score).trim().replace(/\s+/g, '').replace(/:/g, '-');
}
function buildScoreFromGoals(homeGoals, awayGoals) {
  if (homeGoals === null || homeGoals === undefined || awayGoals === null || awayGoals === undefined) return '';
  const h = parseInt(homeGoals, 10);
  const a = parseInt(awayGoals, 10);
  if (Number.isNaN(h) || Number.isNaN(a)) return '';
  return h + '-' + a;
}
function getPlanOutcomeOverlay(dateStr) {
  if (!dateStr) return { byId: {}, byNum: {} };
  const now = Date.now();
  const cached = _planOutcomeOverlayCache[dateStr];

  // 检查 live_scores.json 是否有更新
  let lsMtime = 0;
  const livePath = path.join(__dirname, 'live_scores.json');
  try {
    if (fs.existsSync(livePath)) lsMtime = fs.statSync(livePath).mtimeMs;
  } catch (e) {}

  if (cached && now - cached.time < 60000 && lsMtime === _liveScoresMtime) return cached.data;

  const overlay = { byId: {}, byNum: {} };
  function addOutcome(row, source) {
    if (!row) return;
    const score =
      normalizeScoreText(row.score || row.actual_score) ||
      buildScoreFromGoals(row.homeScore || row.actual_home_goals, row.visitScore || row.actual_away_goals);
    if (!score) return;
    const item = {
      score: score,
      matchStatus: row.matchStatus != null ? row.matchStatus : 2,
      halfScore: row.halfScore || row.actual_half_score || '',
      source: source,
    };
    const mid = row.matchId || row.match_id;
    const num = row.matchNum || row.match_num || row.num;
    if (mid) overlay.byId[String(mid).replace(/^m_/, '')] = item;
    if (num) overlay.byNum[String(num)] = item;
  }
  // ★ P1 Layer 2: 多源赛果核实 — 读取 data_sync 定时生成的缓存
  try {
    var verPath = path.join(__dirname, 'verified_results.json');
    if (fs.existsSync(verPath)) {
      var verCache = JSON.parse(fs.readFileSync(verPath, 'utf8'));
      var verDateEntry = verCache[dateStr];
      if (verDateEntry && verDateEntry.results) {
        // 解析 data.json 中该日期的比赛，建立 num→matchId 映射
        var numToMid = {};
        var dataJson = getDataJson();
        var rawMap = dataJson.m || {};
        Object.keys(rawMap).forEach(function (k) {
          var x = rawMap[k];
          if ((x.date || '').slice(0, 10) === dateStr && x.num && x.matchId) {
            numToMid[x.num] = x.matchId;
          }
        });

        verDateEntry.results.forEach(function (r) {
          var score = r.score;
          if (!score) return;
          var parts = (r.anchor || '').split(' ');
          var verNum = parts[0];
          var verItem = {
            score: score,
            matchStatus: 2,
            halfScore: '',
            source: 'verified(c=' + (r.confidence || 0).toFixed(2) + ')',
          };
          if (verNum && numToMid[verNum]) {
            overlay.byId[String(numToMid[verNum]).replace(/^m_/, '')] = verItem;
          }
          if (verNum) overlay.byNum[String(verNum)] = verItem;
        });
      }
    }
  } catch (e) {
    // verifier cache 不可用时降级
  }
  try {
    if (fs.existsSync(livePath)) {
      const live = JSON.parse(fs.readFileSync(livePath, 'utf8'));
      _liveScoresMtime = lsMtime;
      if (!live.date || live.date === dateStr) {
        (live.matches || []).forEach(function (m) {
          addOutcome(m, 'live_scores');
        });
      }
    }
  } catch (e) {}

  try {
    const adp = database.getAdapter();
    if (adp) {
      const rows = adp.execAll(
        "SELECT matchId, matchNum, actual_score, actual_home_goals, actual_away_goals FROM prediction_logs WHERE date = ? AND ((actual_score IS NOT NULL AND actual_score != '') OR (actual_home_goals IS NOT NULL AND actual_away_goals IS NOT NULL))",
        dateStr,
      );
      rows.forEach(function (r) {
        addOutcome(r, 'prediction_logs');
      });
    }
  } catch (e) {}

  // ★ P1-3 修复：data.json 作为最权威完赛比分源（覆盖半场误判等过期数据）
  try {
    const dataJson = getDataJson();
    const rawMap = dataJson.m || {};
    Object.keys(rawMap).forEach(function (k) {
      var x = rawMap[k];
      var dt = (x.date || '').slice(0, 10);
      if (dt !== dateStr) return;
      // 仅完赛比赛（matchStatus>=2）且有比分才补充
      if (x.matchStatus < 2 || !x.score) return;
      var item = {
        score: normalizeScoreText(x.score),
        matchStatus: x.matchStatus,
        halfScore: x.halfScore || '',
        source: 'data.json',
      };
      var mid = x.matchId || x.match_id;
      var num = x.matchNum || x.match_num || x.num;
      // 直接覆盖（data.json 是最权威的全场比分源）
      // ★ byId 优先于 byNum（matchId 唯一，num 跨日期重复）
      if (mid) overlay.byId[String(mid).replace(/^m_/, '')] = item;
      if (num) overlay.byNum[String(num)] = item; // ← date 过滤后安全，但仅作降级
    });
  } catch (e) {}

  _planOutcomeOverlayCache[dateStr] = { time: now, data: overlay };
  return overlay;
}
function applyPlanOutcomeOverlay(dateStr, match) {
  if (!match) return match;
  const overlay = getPlanOutcomeOverlay(dateStr);
  const idKey = match.matchId ? String(match.matchId).replace(/^m_/, '') : '';
  const numKey = match.num || match.matchNum || '';
  const out = (idKey && overlay.byId[idKey]) || (numKey && overlay.byNum[numKey]);
  if (!out || !out.score) return match;
  const next = Object.assign({}, match);
  next.score = out.score;
  next.actualScore = out.score;
  next.matchStatus = out.matchStatus != null ? out.matchStatus : next.matchStatus || 2;
  if (out.halfScore) next.halfScore = out.halfScore;
  next._scoreSource = out.source;
  return next;
}

// ★ P0 Layer 5: 方案输出一致性门禁 — 响应前校验奖金/比分/中奖状态
function validatePlanResponse(plans, dateStr) {
  if (!plans || !Array.isArray(plans)) return plans;
  var fixed = 0;
  var dataJson = getDataJson();
  var mMap = dataJson.m || {};

  plans.forEach(function (p) {
    // 1. 奖金数值保护
    if (p.winningPrize === undefined || p.winningPrize === null || isNaN(p.winningPrize)) {
      p.winningPrize = p.isPlanWon === true ? p.maxPrize || 0 : 0;
      fixed++;
    }
    if (p.winningPrize > p.maxPrize && p.maxPrize > 0) {
      p.winningPrize = p.maxPrize;
      fixed++;
    }
    if (p.isPlanWon === true && p.winningPrize === 0 && p.maxPrize > 0) {
      p.winningPrize = p.maxPrize;
      fixed++;
    }

    // 2. 比分/结果校验
    (p.matches || []).forEach(function (m) {
      // 查找 data.json 权威比分
      // ★ 只用 matchId 匹配（唯一），不用 num（跨日期重复如周五003）
      // ★ 附加 date 过滤防跨日期污染
      var authScore = '';
      var authMatch = null;
      var keys = Object.keys(mMap);
      for (var ki = 0; ki < keys.length; ki++) {
        var x = mMap[keys[ki]];
        var xDt = (x.date || '').slice(0, 10);
        // matchId 唯一匹配 + 必须同日期
        if (x.matchId && String(x.matchId) === String(m.matchId) && xDt === dateStr) {
          if (x.matchStatus >= 2 && x.score) {
            authScore = x.score.replace(/:/g, '-');
            authMatch = x;
          }
          break;
        }
      }

      // actualScore 为空 → 补充
      if (!m.actualScore && authScore) {
        m.actualScore = authScore;
        fixed++;
      }
      // actualScore 与权威比分不一致 → 修正
      if (m.actualScore && authScore && m.actualScore !== authScore) {
        logger.warn('[guard] actualScore 修正: ' + (m.matchNum || '') + ' ' + m.actualScore + ' → ' + authScore);
        m.actualScore = authScore;
        fixed++;
      }

      // 完赛但 isMatchWon 为空 → 尝试补算
      if (authMatch && authMatch.matchStatus >= 2 && m.isMatchWon === null && m.isMatchLose === null) {
        // 无法确定方向结果，只标记
        logger.warn('[guard] 缺赛果: ' + (m.matchNum || '') + ' 方向=' + (m.direction || ''));
      }

      // isMatchLose 互斥检测
      if (m.isMatchWon === true && m.isMatchLose === true) {
        m.isMatchLose = false;
        fixed++;
      }
    });

    // 3. 方案级互斥
    if (p.isPlanWon === true && p.isPlanLose === true) {
      p.isPlanLose = false;
      fixed++;
    }
  });

  if (fixed > 0) {
    logger.warn('[guard] 输出门禁修正了 ' + fixed + ' 个字段 (date=' + dateStr + ')');
  }
  return plans;
}

// ★ P0-1: 功守道 cache.json _global 内存缓存 — 避免 match-list 每次请求读磁盘
let _gsGlobalCache = null;
let _gsGlobalCacheTime = 0;
const GS_GLOBAL_CACHE_TTL = 5 * 60 * 1000; // 5 分钟 TTL
function getGsGlobalMap() {
  const now = Date.now();
  if (_gsGlobalCache && now - _gsGlobalCacheTime < GS_GLOBAL_CACHE_TTL) return _gsGlobalCache;
  try {
    const gsEngine = require('./gongshoudao/index');
    const gsCache = gsEngine.readCache();
    _gsGlobalCache = gsCache['_global'] || {};
    _gsGlobalCacheTime = now;
    return _gsGlobalCache;
  } catch (e) {
    logger.warn('[gs-cache] 读取缓存失败: ' + e.message);
  }
  return _gsGlobalCache || {};
}

function buildFallbackPKDecision(reason) {
  const msg = reason || 'PK标准字段暂缺';
  return {
    playType: 'spf',
    finalDirection: 'watch',
    decisionLevel: '观望',
    stars: 0,
    riskLevel: 'yellow',
    riskTags: [msg],
    degradeReasons: [msg],
    decisionNarrative: 'PK裁判：' + msg + '，当前按观望处理。',
    finalDecision: 'watch',
    expectedValue: null,
    valueEdge: null,
    pkCompositeScore: null,
  };
}

function buildPKDecisionMapForMatches(matches) {
  const map = {};
  if (!Array.isArray(matches) || matches.length === 0) return map;
  try {
    // ★ P1+P2: 优先从 SQLite prediction_logs 读取 pk_scorer 真实输出
    const adp = database.getAdapter && database.getAdapter();
    if (adp) {
      const mids = matches.map(function (m) {
        return String(m.matchId || '').replace(/^m_/, '');
      }).filter(Boolean);
      if (mids.length > 0) {
        const placeholders = mids.map(function () { return '?'; }).join(',');
        const rows = adp.execAll(
          'SELECT matchId, pk_direction, pk_composite_score, pk_final_direction, pk_decision_level, ' +
          'pk_risk_level, pk_stars, pk_risk_tags, pk_degrade_reasons, pk_decision_narrative, ' +
          'pk_play_type, pk_expected_value, pk_value_edge ' +
          'FROM prediction_logs WHERE matchId IN (' + placeholders + ') ORDER BY updated_at DESC',
          mids,
        );
        if (rows && rows.length > 0) {
          rows.forEach(function (r) {
            const mid = String(r.matchId || '').replace(/^m_/, '');
            if (!mid || map[mid]) return; // 已填充则跳过（第一条即最新）
            var riskTags = [];
            try { riskTags = JSON.parse(r.pk_risk_tags || '[]'); } catch (e) {}
            var degradeReasons = [];
            try { degradeReasons = JSON.parse(r.pk_degrade_reasons || '[]'); } catch (e) {}
            map[mid] = {
              playType: r.pk_play_type || 'spf',
              finalDirection: r.pk_final_direction || r.pk_direction || 'watch',
              decisionLevel: r.pk_decision_level || (r.pk_direction ? '可做' : '观望'),
              stars: r.pk_stars || 0,
              riskLevel: r.pk_risk_level || 'yellow',
              riskTags: riskTags,
              degradeReasons: degradeReasons,
              decisionNarrative: r.pk_decision_narrative || 'PK裁判：基于 PK 融合评分输出。',
              finalDecision: r.pk_final_direction || r.pk_direction || 'watch',
              expectedValue: r.pk_expected_value || null,
              valueEdge: r.pk_value_edge || null,
              pkCompositeScore: r.pk_composite_score || 0,
            };
          });
        }
      }
    }

    // ★ P3: fallback — 仅当 SQLite 无数据时才构造兜底
    matches.forEach(function (m) {
      const mid = String(m.matchId || '').replace(/^m_/, '');
      if (!mid || map[mid]) return;
      // 有 GS/AI 数据则显示融合摘要，否则显示"待分析"
      var hasGS = !!(m.attackPattern || (m.totalAdvantageRaw != null));
      var hasAI = !!(m.aiConfidence); // 从 match 字段读取
      map[mid] = hasGS || hasAI
        ? {
            playType: 'spf',
            finalDirection: 'watch',
            decisionLevel: '待分析',
            stars: 0,
            riskLevel: 'yellow',
            riskTags: hasGS ? ['GS功守道已分析'] : ['AI已分析'],
            degradeReasons: [],
            decisionNarrative: 'PK裁判：' + (hasGS && hasAI ? 'GS+AI 数据已就绪，等待融合裁判输出' : hasGS ? 'GS 功守道已分析，等待融合裁判' : 'AI 已分析，等待融合裁判') + '。',
            finalDecision: 'watch',
            expectedValue: null,
            valueEdge: null,
            pkCompositeScore: 0,
          }
        : buildFallbackPKDecision('PK数据生成中，请稍后刷新');
    });
  } catch (e) {
    logger.warn('[ranking-list] PK数据读取失败: ' + e.message);
  }
  return map;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function buildModelPlayMatrix(rankings) {
  return (rankings || []).map(function (r) {
    const total = Number(r.total) || 0;
    function metric(rate, sample, note) {
      return {
        sample: sample || 0,
        hitRate: sample > 0 ? Number(rate) || 0 : null,
        roi: sample > 0 ? ((Number(rate) || 0) / 100) * 2 - 1 : null,
        sampleNote: note || (sample < 10 ? '样本不足，仅供观察' : ''),
      };
    }
    return {
      modelName: r.modelName,
      spf: metric(r.directionRate, total),
      handicap: metric(null, 0, '让球样本暂未结构化'),
      overUnder: metric(r.overUnderRate, total),
      score: metric(r.scoreRate, total),
    };
  });
}

function enrichModelReliability(rankings, trendData) {
  const trendMap = {};
  (trendData || []).forEach(function (t) {
    const values = (t.values || []).filter(function (v) {
      return v !== null && v !== undefined && !Number.isNaN(Number(v));
    });
    const last = values.length ? Number(values[values.length - 1]) : 0;
    const prev = values.length > 1 ? Number(values[values.length - 2]) : last;
    const range = values.length ? Math.max.apply(null, values) - Math.min.apply(null, values) : 100;
    trendMap[t.modelName] = {
      trend: parseFloat((last - prev).toFixed(1)),
      stabilityScore: clampNumber(100 - range, 0, 100),
    };
  });
  return (rankings || [])
    .map(function (r) {
      const total = Number(r.total) || 0;
      const dirRate = Number(r.directionRate) || 0;
      const roi = parseFloat(((dirRate / 100) * 2 - 1).toFixed(4));
      const trend = trendMap[r.modelName] || { trend: 0, stabilityScore: total >= 10 ? 70 : 40 };
      const sampleScore = clampNumber((total / 50) * 100, 0, 100);
      const roiScore = clampNumber((roi + 1) * 50, 0, 100);
      const calibrationError = Math.abs(dirRate - 50);
      const calibrationScore = clampNumber(100 - calibrationError, 0, 100);
      const reliabilityScore = parseFloat(
        (
          dirRate * 0.35 +
          roiScore * 0.2 +
          trend.stabilityScore * 0.15 +
          sampleScore * 0.2 +
          calibrationScore * 0.1
        ).toFixed(1),
      );
      let calibrationStatus = '较准确';
      if (total < 10) calibrationStatus = '样本不足';
      else if (dirRate >= 68 && total < 30) calibrationStatus = '偏自信';
      else if (dirRate < 45) calibrationStatus = '偏保守/需复核';
      return Object.assign({}, r, {
        reliabilityScore,
        roi,
        stabilityScore: parseFloat(trend.stabilityScore.toFixed(1)),
        calibrationScore: parseFloat(calibrationScore.toFixed(1)),
        calibrationStatus,
        sampleStatus: total < 10 ? '样本不足，仅供观察' : total < 30 ? '样本偏少' : '样本充足',
        eligibleForRanking: total >= 10,
        trend: trend.trend,
      });
    })
    .sort(function (a, b) {
      if (a.eligibleForRanking !== b.eligibleForRanking) return a.eligibleForRanking ? -1 : 1;
      return b.reliabilityScore - a.reliabilityScore;
    });
}

function buildModelReliabilitySummary(rankings) {
  const eligible = (rankings || []).filter(function (r) {
    return r.eligibleForRanking;
  });
  const bestStable = eligible.slice().sort(function (a, b) {
    return b.stabilityScore - a.stabilityScore;
  })[0];
  return {
    activeModels: (rankings || []).length,
    eligibleModels: eligible.length,
    validSamples: (rankings || []).reduce(function (sum, r) {
      return sum + (Number(r.total) || 0);
    }, 0),
    bestStableModel: bestStable ? bestStable.modelName : null,
    health: eligible.length >= 2 ? 'stable' : 'sample_insufficient',
    note: eligible.length >= 2 ? '模型样本可用于可靠性观察' : '样本不足，结论仅供观察',
  };
}

function buildReadOnlyWeightSuggestions(rankings) {
  const eligible = (rankings || []).filter(function (r) {
    return r.eligibleForRanking;
  });
  const totalScore = eligible.reduce(function (sum, r) {
    return sum + (Number(r.reliabilityScore) || 0);
  }, 0);
  return eligible.map(function (r) {
    return {
      modelName: r.modelName,
      suggestedWeight: totalScore > 0 ? parseFloat((r.reliabilityScore / totalScore).toFixed(4)) : 0,
      reason: '只读建议：基于可靠性评分，不自动覆盖生产规则',
    };
  });
}

// ★ P2-1: 核心内存缓存统计
function getCoreCacheStats() {
  const now = Date.now();
  return {
    gsGlobalCache: {
      active: !!_gsGlobalCache,
      age_sec: _gsGlobalCacheTime ? Math.round((now - _gsGlobalCacheTime) / 1000) : null,
      ttl_sec: Math.round(GS_GLOBAL_CACHE_TTL / 1000),
    },
    matchListCache: {
      entries: Object.keys(_matchListCacheByDate).length,
      maxEntries: MATCH_LIST_CACHE_MAX_KEYS,
      keys: Object.keys(_matchListCacheByDate).slice(-5),
    },
    gsAllCache: {
      active: !!_gsAllCache,
      date: _gsAllCache ? _gsAllCache.date : null,
      age_sec: _gsAllCacheTime ? Math.round((now - _gsAllCacheTime) / 1000) : null,
    },
    quantHotCache: {
      active: !!_quantHotCache,
      date: _quantHotCache ? _quantHotCache.date : null,
      age_sec: _quantHotCacheTime ? Math.round((now - _quantHotCacheTime) / 1000) : null,
    },
    quantPlanCache: {
      entries: Object.keys(_quantPlanCache).length,
      keys: Object.keys(_quantPlanCache).slice(-5),
    },
    allplaysCache: {
      active: !!_allplaysCache,
      age_sec: _allplaysCacheTime ? Math.round((now - _allplaysCacheTime) / 1000) : null,
    },
    weekDatesCache: {
      active: !!_cachedWeekDates,
      entries: _cachedWeekDates ? _cachedWeekDates.length : 0,
    },
  };
}

// ★ P1-4: week-dates 预计算缓存（通过 data.json mtime 自动失效）
let _cachedWeekDates = null;
let _cachedWeekDatesMtime = 0;
const WEEK_DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function getWeekDates() {
  // 检查 data.json 是否已更新，自动失效缓存
  let mtime = 0;
  try {
    mtime = fs.statSync(DATA_JSON_PATH).mtimeMs;
  } catch (e) {}
  if (_cachedWeekDates && _cachedWeekDatesMtime === mtime) return _cachedWeekDates;
  // 缓存失效或首次加载，重新计算
  try {
    const dataFile = getDataJson();
    const mMap = dataFile.m || {};

    // ★ V9: 按日历日生成连续日期（从最早有数据的日期到今天）
    // 先找最早日期，再按日历逐日列出，日期标签用日历星期几
    const dateSet = new Set();
    Object.keys(mMap).forEach((k) => {
      const m = mMap[k];
      if (!m || !m.date) return;
      const md = m.date.slice(0, 10);
      if (md.length === 10) dateSet.add(md);
    });

    const sortedDates = Array.from(dateSet).sort();
    if (sortedDates.length === 0) return [];

    // 从最早有数据的日期到今天的日历范围
    const today = localDate();
    const startDate = sortedDates[0] < today ? new Date(sortedDates[0]) : new Date(today);
    const endDate = new Date(today);

    const list = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const ds = d.toISOString().slice(0, 10);
      if (!dateSet.has(ds)) continue; // 跳过无比赛日
      const md = ds.slice(5);
      const weekNum = WEEK_DAYS[d.getDay()];
      list.push({ weekNum: weekNum, matchDate: md });
    }

    _cachedWeekDates = list;
    _cachedWeekDatesMtime = mtime;
    return list;
  } catch (e) {
    return [];
  }
}

// ★ P1-6: match-list 请求级缓存（同一日期 5 分钟内复用）
let _matchListCacheByDate = {};
let _matchListCacheLRU = []; // ★ P2: LRU 驱逐队列（最多 30 天）
// ★ P1: gongshoudao-all / quant-hot 请求级缓存
let _gsAllCache = null;
let _gsAllCacheTime = 0;
let _quantHotCache = null;
let _quantHotCacheTime = 0;
// ★ P1-1: quant-plan-list 响应缓存
let _quantPlanCache = {};
let _profit7dCache = null; // ★ P2: daily-profit-7d 响应缓存
let _profit7dCacheTime = 0;
// ★ P0-2: ranking-list 请求级缓存（减少重复遍历 + buildPKDecisionMap）
let _rankListCache = {};
let _rankListCacheTime = {};
const RANK_LIST_CACHE_TTL = 2 * 60 * 1000; // 2 分钟
// ★ P0-1: plan-list 响应缓存（生成计算密集）
let _planListResponseCache = {};
let _planListResponseTime = {};
const PLAN_LIST_CACHE_TTL = 10 * 60 * 1000; // 10 分钟

// ★ P1-3 优化：通用响应缓存（减少重复计算密集 API 的响应时间）
const RESPONSE_CACHE_TTL = {
  'income-stats': 5 * 60 * 1000,
  'hit-rate-stats': 5 * 60 * 1000,
  'prediction-backtest': 3 * 60 * 1000,
  'model-dashboard': 5 * 60 * 1000,
  'data-health': 10 * 60 * 1000,
};
const _responseCache = {}; // { cacheKey: { time, response } }
function getCachedResponse(action, cacheKey) {
  var entry = _responseCache[cacheKey];
  var ttl = RESPONSE_CACHE_TTL[action] || 60 * 1000;
  if (entry && Date.now() - entry.time < ttl) return entry.response;
  return null;
}
function setCachedResponse(action, cacheKey, response) {
  var keys = Object.keys(_responseCache);
  if (keys.length > 50) {
    var oldest = keys.sort(function (a, b) {
      return _responseCache[a].time - _responseCache[b].time;
    })[0];
    delete _responseCache[oldest];
  }
  _responseCache[cacheKey] = { time: Date.now(), response: response };
}
const CACHE_TTL_5MIN = 5 * 60 * 1000;
const CACHE_TTL_10MIN = 10 * 60 * 1000; // ★ P2: 用于 quant-plan-list（计算最密集）
const MATCH_LIST_CACHE_TTL = 5 * 60 * 1000; // 5 分钟（原 1 分钟，P1 延长减少磁盘 I/O）
const MATCH_LIST_CACHE_MAX_KEYS = 30; // ★ P2: 最多缓存 30 个日期
const PROFIT_7D_CACHE_TTL = 10 * 60 * 1000; // 10 分钟（计算密集，命中后复用）
// 根据 date + num 获取比分赔率，格式转换 "1:0" → "1-0"
function getScoreOdds(allplays, dateStr, num) {
  if (!allplays || !dateStr || !num) return null;
  const dayData = allplays[dateStr];
  if (!dayData) return null;
  const m = dayData[num];
  if (!m || !m.scores) return null;
  const result = {};
  Object.keys(m.scores).forEach(function (k) {
    // 只保留标准比分格式 (如 "1:0")，过滤 "胜其它" 等非比分 key
    if (/^\d+:\d+$/.test(k)) {
      result[k.replace(':', '-')] = m.scores[k];
    }
  });
  return Object.keys(result).length > 0 ? result : null;
}

// ★ 将 oddsDelta 按玩法分组 + 摘要统计
function _groupDeltaByPlay(deltaChanges) {
  var result = {
    spf: {},
    rqspf: {},
    halfFull: {},
    totalGoals: {},
    scores: {},
    spfSummary: { up: 0, down: 0, flat: 0 },
    rqspfSummary: { up: 0, down: 0, flat: 0 },
    halfFullSummary: { up: 0, down: 0, flat: 0 },
    totalGoalsSummary: { up: 0, down: 0, flat: 0 },
    scoresSummary: { up: 0, down: 0, flat: 0 },
  };
  if (!deltaChanges || Object.keys(deltaChanges).length === 0) return result;

  Object.keys(deltaChanges).forEach(function (k) {
    var dir = deltaChanges[k]; // 'up' | 'down' | 'flat'
    var dotIdx = k.indexOf('.');
    if (dotIdx === -1) return;
    var prefix = k.slice(0, dotIdx);
    var field = k.slice(dotIdx + 1);

    // 按玩法前缀分组方向映射
    if (result[prefix] !== undefined) {
      result[prefix][field] = dir;
    }

    // 摘要计数
    var summaryKey = prefix + 'Summary';
    if (result[summaryKey] && dir === 'up') result[summaryKey].up++;
    else if (result[summaryKey] && dir === 'down') result[summaryKey].down++;
    else if (result[summaryKey] && dir === 'flat') result[summaryKey].flat++;
  });

  return result;
}

// ★ 构建赔率走势信号（分析最后 N 条 delta 记录的方向趋势）
function _buildDeltaTrend(deltaLogs) {
  var result = { spfTrend: '', rqspfTrend: '', scoresTrend: '', totalGoalsTrend: '', halfFullTrend: '' };
  if (!deltaLogs || deltaLogs.length === 0) return result;

  // 取最近 6 条记录的 spf.home 方向
  var maxRecords = Math.min(6, deltaLogs.length);
  var recent = deltaLogs.slice(-maxRecords);

  var trends = { spf: { home: [], draw: [], away: [] }, rqspf: { home: [], draw: [], away: [] } };

  recent.forEach(function (log) {
    if (!log.changes) return;
    Object.keys(log.changes).forEach(function (k) {
      var val = log.changes[k];
      // val 可能是 "1.50→1.55" 格式或已经是 'up'/'down'
      var dir = val;
      if (typeof val === 'string' && val.indexOf('→') > -1) {
        var parts = val.split('→');
        var oldV = parseFloat(parts[0]);
        var newV = parseFloat(parts[1]);
        if (oldV > 0 && newV > 0) dir = newV > oldV ? 'up' : newV < oldV ? 'down' : 'flat';
        else dir = 'flat';
      }
      var dotIdx = k.indexOf('.');
      if (dotIdx === -1) return;
      var prefix = k.slice(0, dotIdx);
      var field = k.slice(dotIdx + 1);
      if (trends[prefix] && trends[prefix][field]) {
        trends[prefix][field].push(dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→');
      }
    });
  });

  // 合并各玩法方向序列
  function mergeTrend(pref) {
    var t = trends[pref];
    if (!t) return '';
    var all = (t.home || []).concat(t.draw || []).concat(t.away || []);
    if (all.length === 0) return '';
    // 取最后 5 个
    return all.slice(-5).join('');
  }

  result.spfTrend = mergeTrend('spf');
  result.rqspfTrend = mergeTrend('rqspf');

  // BF/JQS/BQC 趋势从 deltaChanges 的原始键聚合
  return result;
}

// ★ 获取每场比赛推荐专家数最多的方向（用于方案设计页黄色底色标记）
function getMaxRecommendDirs(dataFile, matchId) {
  try {
    var recMap = (dataFile && dataFile.r) || {};
    var recs = recMap['m_' + matchId] || recMap[matchId] || [];
    if (!recs.length) return [];
    // 找最大专家数
    var maxNum = 0;
    for (var i = 0; i < recs.length; i++) {
      if (recs[i].num > maxNum) maxNum = recs[i].num;
    }
    if (maxNum <= 0) return [];
    // 收集所有达到最大专家数的方向
    var dirs = [];
    for (var j = 0; j < recs.length; j++) {
      if (recs[j].num === maxNum) {
        dirs.push(recs[j].type);
      }
    }
    return dirs;
  } catch (e) {
    return [];
  }
}

const getEstimatedWaitTime = aiTiming.getEstimatedWaitTime;
const updateTimingStats = aiTiming.updateTimingStats;

// ── 数据库桥接 ──
async function dbMatchList() {
  const today = localDate();
  if (database.isAvailable && database.isAvailable()) {
    const m = database.getMatchesByDate(today);
    if (m && m.length > 0) return m;
    return database.getAllMatches() || [];
  }
  return [];
}
async function dbRecommends(matchId) {
  if (database.isAvailable && database.isAvailable()) {
    return database.getRecommendsByMatchId(matchId) || [];
  }
  return [];
}

// ══════════════════════════════════════════
// Express 应用初始化
// ══════════════════════════════════════════
const app = express();
const PORT = process.env.PORT || 3000;
let wsServer = null; // WebSocket 服务实例（顶层作用域，供 health 检查使用）

// 生产在 Nginx/反代后，必须信任一跳代理，否则 req.ip 会退化为内网地址导致全站共用限流桶
app.set('trust proxy', 1);

app.disable('x-powered-by');
if (!process.env.BEHIND_PROXY) {
  app.use(compression());
}
app.use(cors({ origin: true, credentials: true }));
// 手动 JSON 解析（绕过 body-parser 版本兼容问题）
app.use('/api', (req, res, next) => {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.indexOf('application/json') === -1) return next();
  const chunks = [];
  req.on('data', function (c) {
    chunks.push(c);
  });
  req.on('end', function () {
    if (chunks.length === 0) {
      req.body = {};
      return next();
    }
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (e) {
      logger.warn('[json-parse] ' + e.message);
      return res.status(400).json({ code: -1, msg: 'Invalid JSON: ' + e.message });
    }
    next();
  });
});

// UTF-8 响应头
app.use('/api', (req, res, next) => {
  const origJson = res.json;
  res.json = function (body) {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson.call(this, body);
  };
  next();
});

// 速率限制（按真实客户端分桶，避免反代后全站共享 1 个桶）
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    max: process.env.E2E_TEST === '1' || process.env.NODE_ENV === 'test' ? 1000 : 180,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const deviceId = String(req.headers['x-device-id'] || '').trim();
      const fwd = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
      const ipRaw = req.ip || req.socket.remoteAddress || fwd || 'unknown';
      const ip = String(ipRaw).replace(/^::ffff:/, '');
      return deviceId ? 'd:' + deviceId + '|ip:' + ip : 'ip:' + ip;
    },
    message: { code: -1, msg: '请求过于频繁，请稍后再试' },
  }),
);

// 静态资源
const staticOpts = { maxAge: '7d', etag: true, lastModified: true };
app.use('/assets/worldcup', express.static(path.join(__dirname, '../miniprogram/images/worldcup'), staticOpts));
app.use('/assets', express.static(path.join(__dirname, '../miniprogram/images'), staticOpts));

let homeCache = null,
  homeCacheTime = 0;
const hp = path.join(__dirname, '../preview/index.html');
const HOME_HTML_CACHE_TTL = process.env.NODE_ENV === 'production' ? 60000 : 0;
function getHomeHTML(cb) {
  const now = Date.now();
  if (HOME_HTML_CACHE_TTL > 0 && homeCache && now - homeCacheTime < HOME_HTML_CACHE_TTL) return cb(null, homeCache);
  fs.readFile(hp, 'utf8', (err, html) => {
    if (!err) {
      homeCache = html;
      homeCacheTime = now;
    }
    cb(err, html || homeCache);
  });
}
app.get('/', (req, res) => {
  getHomeHTML((err, html) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
    res.end(html);
  });
});

app.use(
  express.static(path.join(__dirname, '../preview'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    setHeaders: (res, fPath) => {
      // HTML 不缓存，确保用户始终获取最新页面结构
      if (fPath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else {
        // JS/CSS/图片 强缓存 7 天（文件名带版本号 ?v= 时缓存命中）
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      }
      // MIME 设置
      if (fPath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
      else if (fPath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      else if (fPath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=utf-8');
      else if (fPath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
      else if (fPath.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
      else res.setHeader('Content-Type', 'application/octet-stream; charset=utf-8');
    },
  }),
);

// SPA fallback: 未匹配的 .html 请求返回 index.html（支持客户端路由）
app.use((req, res, next) => {
  if (req.path.endsWith('.html') && !fs.existsSync(path.join(__dirname, '../preview', req.path))) {
    return getHomeHTML((err, html) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
      res.end(html);
    });
  }
  next();
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), time: new Date().toISOString() });
});
// WebSocket 状态
app.get('/health/ws', (req, res) => {
  let wsInfo = { enabled: false, clients: 0 };
  if (wsServer) {
    wsInfo = { enabled: true, clients: wsServer.getClientCount() };
  }
  res.json(wsInfo);
});
// 调度器状态
app.get('/health/scheduler', (req, res) => {
  try {
    const state = JSON.parse(
      require('fs').readFileSync(require('path').join(__dirname, 'scheduler_state.json'), 'utf8'),
    );
    res.json(state);
  } catch (e) {
    res.json({ status: 'no_state', message: '调度器状态文件不存在' });
  }
});
// 深度健康检查（数据库 / 数据完整性 / 外部API / 系统资源 / 文件追踪 / 赔率覆盖）
app.get('/health/deep', async (req, res) => {
  try {
    const r = await health.deepCheck();
    res.json(r);
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

// 文件追踪快照
app.get('/health/files', (req, res) => {
  try {
    const tracker = require('./core/file-tracker');
    const snap = tracker.snapshot();
    res.json(snap);
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

app.get('/api/payments/simulate-pay', async (req, res) => {
  try {
    const authToken = authService.resolveSessionToken(req, req.query || {});
    req.authSession = authToken ? authService.validateSession(authToken, true) : null;
    return await payments.handleSimulatePay(req, res);
  } catch (e) {
    logger.error('[payments] simulate-pay 路由异常: ' + e.message);
    return res.status(500).send('支付失败: ' + e.message);
  }
});

app.post('/api/payments/notify', express.urlencoded({ extended: false }), async (req, res) => {
  try {
    return await payments.handleAlipayNotify(req, res);
  } catch (e) {
    logger.error('[payments] notify 路由异常: ' + e.message);
    return res.send('fail');
  }
});

// 启动校验

if (!CONFIG.MOBILE || !CONFIG.PASSWORD) {
  logger.error('启动失败：缺少 MIDOU_MOBILE / MIDOU_PASSWORD 配置');
  const alert = require('./alert');
  alert.loginFailed('缺少 MIDOU_MOBILE/MIDOU_PASSWORD').then(() => process.exit(1));
} else {
  // ==================== WebSocket 实时推送 (P3-1) ====================
  try {
    wsServer = require('./websocket');
    logger.info('[ws] WebSocket 模块已加载');
  } catch (e) {
    logger.warn('[ws] WebSocket 模块加载失败: ' + e.message);
  }

  // ==================== API 路由 ====================

  // ★ P3-2: ETag 中间件（支持 HTTP 304 条件请求，减少重复传输）
  app.post('/api', function (req, res, next) {
    // 为所有 API 响应自动添加 ETag
    const _origJson = res.json;
    res.json = function (body) {
      if (body && body.code !== undefined) {
        // 生成简单 ETag（基于 JSON 序列化的 MD5）
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(JSON.stringify(body)).digest('hex').slice(0, 12);
        res.set('ETag', '"' + hash + '"');
        res.set('Cache-Control', 'private, max-age=60'); // 允许浏览器缓存 60 秒

        // 检查 If-None-Match
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === '"' + hash + '"') {
          return res.status(304).end();
        }
      }
      return _origJson.call(this, body);
    };
    next();
  });

  app.post('/api', async (req, res) => {
    const { action, data: wrappedData = {} } = req.body || {};
    // 前端传参格式兼容: {action, date, days} 和 {action, data: {date, days}} 都支持
    const data = Object.assign({}, wrappedData, req.body);
    logger.info(`API: ${action} ${JSON.stringify(data).slice(0, 100)}`);
    try {
      let authSession = null;
      const authToken = authService.resolveSessionToken(req, data);

      if (authService.isActionProtected(action)) {
        authSession = authService.validateSession(authToken, true);
        if (!authSession) {
          return res.json({ code: 401, msg: 'UNAUTHORIZED' });
        }

        const requiredPermission = authService.getRequiredPermission(action);
        if (requiredPermission && !authService.hasPermission(authSession, requiredPermission)) {
          return res.json({ code: 403, msg: 'FORBIDDEN', permission: requiredPermission });
        }
      } else if (authToken) {
        authSession = authService.validateSession(authToken, true);
      }

      // ★ BF/JQS/BQC 数据格式转换（对象→数组），供 batch-match-odds / match-odds 复用
      function _convertBfToArray(source) {
        if (!source) return null;
        if (Array.isArray(source)) return source;
        if (typeof source === 'object') {
          return Object.keys(source).map(function (k) {
            return { score: k, odds: source[k] };
          });
        }
        return null;
      }
      function _convertJqsToArray(source) {
        if (!source) return null;
        if (Array.isArray(source)) return source;
        if (typeof source === 'object') {
          return Object.keys(source).map(function (k) {
            return { goals: k, odds: source[k] };
          });
        }
        return null;
      }
      function _convertBqcToArray(source) {
        if (!source) return null;
        if (Array.isArray(source)) return source;
        if (typeof source === 'object') {
          return Object.keys(source).map(function (k) {
            return { combo: k, odds: source[k] };
          });
        }
        return null;
      }
      // ★ 空数组 → null（解决 [] || fallback 不触发的问题：[] 是 truthy）
      function _safeArray(arr) {
        if (!arr || !Array.isArray(arr)) return null;
        return arr.length > 0 ? arr : null;
      }

      switch (action) {
        case 'auth-login': {
          const username = String(data.username || '').trim();
          const password = String(data.password || '');
          if (!username || !password) return res.json({ code: 0, msg: '缺少用户名或密码' });
          // ★ P1-2 优化：await 异步登录（scrypt 不阻塞事件循环）
          const result = await authService.loginWithPassword(username, password, {
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
            userAgent: req.headers['user-agent'] || '',
          });
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '登录失败' });
          return res.json({
            code: 1,
            data: {
              token: result.token,
              expiresAt: result.expiresAt,
              user: result.user,
              roles: result.roles,
              permissions: result.permissions,
            },
          });
        }

        case 'auth-register': {
          const username = String(data.username || '').trim();
          const password = String(data.password || '');
          const result = authService.registerUser(username, password, {
            referralCode: data.referralCode || null,
            deviceFingerprint: data.deviceFingerprint || null,
            ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
          });
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '注册失败' });
          return res.json({
            code: 1,
            data: {
              referralCode: result.referralCode,
              referralUrl: result.referralUrl,
            },
          });
        }

        case 'auth-session': {
          if (!authSession) return res.json({ code: 401, msg: 'UNAUTHORIZED' });
          return res.json({
            code: 1,
            data: {
              user: authSession.user,
              roles: authSession.roles,
              permissions: authSession.permissions,
              expiresAt: authSession.expiresAt,
            },
          });
        }

        case 'auth-logout': {
          authService.logout(authToken);
          return res.json({ code: 1, data: { ok: true } });
        }

        case 'auth-change-password': {
          if (!authSession) return res.json({ code: 401, msg: 'UNAUTHORIZED' });
          const oldPassword = String(data.oldPassword || '');
          const newPassword = String(data.newPassword || '');
          // ★ P1-2 优化：await 异步密码修改
          const result = await authService.changePassword(authSession.userId, oldPassword, newPassword);
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '修改密码失败' });
          return res.json({ code: 1, data: { ok: true } });
        }

        case 'user-list': {
          return res.json({ code: 1, data: authService.listUsers() });
        }

        case 'user-create': {
          const username = String(data.username || '').trim();
          const roleCode = String(data.roleCode || '').trim() || 'viewer';
          const result = authService.createUser(username, roleCode);
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '创建账号失败' });
          return res.json({ code: 1, data: result });
        }

        case 'user-update-status': {
          const userId = Number(data.userId || 0);
          if (!userId) return res.json({ code: 0, msg: '缺少 userId' });
          if (String(data.op || '').trim() === 'unlock') {
            return res.json({ code: 1, data: authService.unlockUser(userId) });
          }
          const status = String(data.status || '').trim();
          const result = authService.updateUserStatus(userId, status);
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '更新失败' });
          return res.json({ code: 1, data: result });
        }

        case 'role-list': {
          return res.json({ code: 1, data: authService.listRolesWithPermissions() });
        }

        case 'role-permission-update': {
          const roleCode = String(data.roleCode || '').trim();
          const permissionCodes = Array.isArray(data.permissionCodes) ? data.permissionCodes : [];
          const result = authService.updateRolePermissions(roleCode, permissionCodes);
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '更新角色权限失败' });
          return res.json({ code: 1, data: result });
        }

        case 'user-role-update': {
          const userId = Number(data.userId || 0);
          const roleCodes = Array.isArray(data.roleCodes) ? data.roleCodes : [];
          if (!userId) return res.json({ code: 0, msg: '缺少 userId' });
          const result = authService.updateUserRoles(userId, roleCodes);
          if (!result.ok) return res.json({ code: 0, msg: result.msg || '更新用户角色失败' });
          return res.json({ code: 1, data: result });
        }

        case 'week-dates': {
          // ★ P1-4: 使用预计算缓存，避免每次请求都遍历 data.json
          return res.json({ code: 1, data: getWeekDates() });
        }

        case 'match-list': {
          // 从 data.json 读取比赛列表（支持历史日期切换）
          // ★ P0-1 + P1-6: 使用内存缓存避免每次读磁盘 + 请求级缓存
          try {
            const dateStr = data.matchDate
              ? new Date().getFullYear() + '-' + data.matchDate
              : data.date || latestDataDate();

            // ★ hideFinished: 仅返回未开赛比赛（方案设计/投注页使用）
            const hideFinished = data.hideFinished === true || data.hideFinished === 'true';
            const cacheKey = dateStr + (hideFinished ? ':active' : '');

            // P1-6: 请求级缓存（同一日期 1 分钟内命中）
            const now = Date.now();
            const cached = _matchListCacheByDate[cacheKey];
            if (cached && now - cached.time < MATCH_LIST_CACHE_TTL) {
              return res.json(cached.response);
            }

            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {}; // ★ 用于实时计算 recommNum

            // 读取 500.com 赔率数据获取单关标识（缓存内置自动降级）
            const oddsMap = getOddsHistory(dateStr) || {};

            // ★ P0-1: 功守道 _global 内存缓存，不再每次读磁盘
            const gsCacheMap = getGsGlobalMap();

            // ⭐ 仅今天/最近日期允许后台补算，历史页不触发全量刷新，避免拖慢页面打开
            let gsNeedCompute = false;
            const shouldCheckGsCompute = dateStr === localDate() || dateStr === latestDataDate();

            // 构建比赛列表的同时检测是否需要计算，避免两次大循环
            const list = [];
            const mMapEntries = Object.entries(mMap);
            for (let i = 0; i < mMapEntries.length; i++) {
              const [k, m] = mMapEntries[i];
              if (!m) continue;
              const md = (m.date || '').slice(0, 10);
              if (md !== dateStr) continue;

              // ★ hideFinished: 方案设计/投注页仅显示未开赛比赛
              if (hideFinished && m.matchStatus !== 0) continue;

              // 检查功守道数据是否可用
              const cachedGS =
                gsCacheMap[k] || gsCacheMap[k.replace(/^m_/, '')] || gsCacheMap['m_' + k.replace(/^m_/, '')];
              const hasGS = !!(cachedGS && cachedGS.attackPattern);

              if (shouldCheckGsCompute && !hasGS) {
                gsNeedCompute = true;
              }

              // 补充单关标识（odds_history → data.json → allplays 三级兜底）
              const fiveOdds = oddsMap[m.num || ''];
              // P0: allplays.json 兜底 — 当日 odds_history 缺失时仍可获取单关标记
              var apDay = getAllplaysData()[dateStr] || {};
              var apEntry = apDay[m.num] || (m.num ? apDay['num_' + m.num] : null) || null;
              var apIsSingle = !!(apEntry && apEntry.isSingleGame);
              const isSingleGame =
                (fiveOdds && fiveOdds.isSingleGame === true) || m.isSingleGame === true || apIsSingle;
              const concede =
                fiveOdds && fiveOdds.rqspf && fiveOdds.rqspf.handicap != null ? fiveOdds.rqspf.handicap : null;

              // 实时专家数（口径修正：优先取方向汇总，兜底/对齐 match 本身 recommNum）
              const rawRecs = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
              const recFromMap = rawRecs.reduce((s, r) => s + Number(r.n || r.num || 0), 0);
              const recFromMatch = Number(m.recommNum || 0);
              const actualRecommNum = Math.max(recFromMap, recFromMatch);

              list.push(
                Object.assign({}, m, {
                  isSingleGame: isSingleGame,
                  hasGongshoudao: hasGS,
                  concede: concede,
                  recommNum: actualRecommNum,
                }),
              );
            }

            // 如果有未缓存比赛，后台异步触发计算（不阻塞响应）
            if (gsNeedCompute) {
              const gsEngine = require('./gongshoudao/index');
              logger.info('[gs] 检测到' + dateStr + '存在未缓存功守道数据, 后台异步计算...');
              gsEngine
                .refreshCache()
                .then(() => {
                  logger.info('[gs] 后台计算完成');
                  // 计算完成后刷新内存缓存
                  _gsGlobalCache = null;
                  _gsGlobalCacheTime = 0;
                })
                .catch((e) => {
                  logger.warn('[gs] 后台计算失败: ' + e.message);
                });
            }

            // 按比赛编号排序

            list.sort((a, b) => (a.num || '').localeCompare(b.num || ''));

            // ★ 合并 live_scores.json 即时比分（1 分钟缓存）
            try {
              var _lsCache = _recalcLiveScoresCache;
              var _lsNow = Date.now();
              if (!_lsCache || _lsNow - _recalcLiveScoresCacheTime > 60000) {
                var _lsPath = path.join(__dirname, 'live_scores.json');
                _recalcLiveScoresCache = { byId: {}, byDateNum: {}, byNum: {} };
                if (fs.existsSync(_lsPath)) {
                  var _lsData = JSON.parse(fs.readFileSync(_lsPath, 'utf8'));
                  (_lsData.matches || []).forEach(function (ls) {
                    var lsId = ls && ls.matchId != null ? String(ls.matchId) : '';
                    var lsNum = ls && ls.num ? String(ls.num) : '';
                    var lsDate = ls && ls.date ? String(ls.date).slice(0, 10) : '';
                    if (lsId) _recalcLiveScoresCache.byId[lsId] = ls;
                    if (lsNum && lsDate) _recalcLiveScoresCache.byDateNum[lsDate + '|' + lsNum] = ls;
                    if (lsNum && !lsDate) _recalcLiveScoresCache.byNum[lsNum] = ls;
                  });
                }
                _recalcLiveScoresCacheTime = _lsNow;
                _lsCache = _recalcLiveScoresCache;
              }
              if (_lsCache) {
                list.forEach(function (m) {
                  var mDate = String((m && m.date) || '').slice(0, 10);
                  var mNum = m && m.num ? String(m.num) : '';
                  var ls =
                    (_lsCache.byId && _lsCache.byId[String(m.matchId)]) ||
                    (_lsCache.byDateNum && mDate && mNum ? _lsCache.byDateNum[mDate + '|' + mNum] : null) ||
                    (_lsCache.byNum && mNum ? _lsCache.byNum[mNum] : null);
                  if (ls && ls.date && mDate && String(ls.date).slice(0, 10) !== mDate) return;
                  if (ls && ls.matchStatus !== undefined) {
                    // ★ 只使用可靠的 matchStatus: 500.com 明确标记"中"(1) 或有时长
                    // ★ P1-3 修复：放宽 live 判定条件
                    //    midou API 经常返回 duration:"" 但 matchStatus=1（赛中）
                    //    原来的 reliableLive 要求 duration 非空导致大多数赛中比赛被过滤
                    // ★ 放宽实时识别：500 有时会给到比分但 status 仍为 0、duration 为空
                    var hasLive =
                      ls.matchStatus === 1 ||
                      (ls.duration && ls.duration !== '') ||
                      (ls.score && /\d+\s*[-:：]\s*\d+/.test(String(ls.score)));
                    if (hasLive) {
                      var hasScore = ls.score && /\d+\s*[-:：]\s*\d+/.test(String(ls.score));
                      // 500 有时比分已到，但 matchStatus 仍为 0；此时至少标记为赛中，避免前端显示“未开始”
                      var inferredStatus =
                        typeof ls.matchStatus === 'number' && ls.matchStatus > 0
                          ? ls.matchStatus
                          : hasScore || (ls.duration && ls.duration !== '')
                            ? 1
                            : m.matchStatus || 0;

                      m.matchStatus = inferredStatus;
                      m.duration = ls.duration || m.duration || '';
                      if (m.matchStatus === 1 && !m.duration) {
                        m.duration = '进行中';
                      }
                      m.score = ls.score || m.score || '';
                      m.halfScore = ls.halfScore || m.halfScore || '';
                      m.homeScore = ls.homeScore !== undefined ? ls.homeScore : m.homeScore;
                      m.visitScore = ls.visitScore !== undefined ? ls.visitScore : m.visitScore;
                      m.yellow = ls.yellow || m.yellow || '';
                      m.red = ls.red || m.red || '';
                    }
                  }
                });
              }
            } catch (_ls_e) {
              /* live_scores.json 缺失或损坏时忽略 */
            }

            // 兜底归一化：部分上游会出现“score 已有、matchStatus 仍为 0”
            // 为避免前端误显示“未开始”，只要有合法比分即至少标记为赛中(1)
            list.forEach(function (m) {
              if ((m.matchStatus === 0 || m.matchStatus === undefined || m.matchStatus === null) && m.score) {
                if (/\d+\s*[-:：]\s*\d+/.test(String(m.score))) {
                  m.matchStatus = 1;
                }
              }
              if (m.matchStatus === 1 && !m.duration) {
                m.duration = '进行中';
              }
            });

            // 如果没有找到数据，尝试实时抓取（仅限今天）
            if (list.length === 0) {
              const today = localDate();
              if (dateStr === today) {
                const liveMatches = await safeApiCall(
                  () => ensureData(),
                  async () => [],
                );
                const filtered = liveMatches.filter((m) => {
                  if ((m.date || '').slice(0, 10) !== today) return false;
                  if (hideFinished && m.matchStatus !== 0) return false;
                  return true;
                });
                if (filtered.length > 0) {
                  return res.json({ code: 1, data: filtered });
                }
                // ★ 兜底: 实时 API 也无数据 → 回退到 data.json 最近有数据的日期
                const fallbackDate = latestDataDate();
                if (fallbackDate && fallbackDate !== today) {
                  const fallbackList = [];
                  const fallbackOdds = getOddsHistory(fallbackDate) || {};
                  Object.keys(mMap).forEach((k) => {
                    const m = mMap[k];
                    if (!m) return;
                    if ((m.date || '').slice(0, 10) !== fallbackDate) return;
                    if (hideFinished && m.matchStatus !== 0) return;
                    const fo = fallbackOdds[m.num || ''] || {};
                    const cgs =
                      gsCacheMap[k] || gsCacheMap[k.replace(/^m_/, '')] || gsCacheMap['m_' + k.replace(/^m_/, '')];
                    const fbRecs = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
                    const fbFromMap = fbRecs.reduce((s, r) => s + Number(r.n || r.num || 0), 0);
                    const fbFromMatch = Number(m.recommNum || 0);
                    const fbRecommNum = Math.max(fbFromMap, fbFromMatch);
                    fallbackList.push(
                      Object.assign({}, m, {
                        isSingleGame: fo && fo.isSingleGame === true,
                        hasGongshoudao: !!(cgs && cgs.attackPattern),
                        recommNum: fbRecommNum,
                      }),
                    );
                  });
                  fallbackList.sort((a, b) => (a.num || '').localeCompare(b.num || ''));
                  if (fallbackList.length > 0) {
                    return res.json({ code: 1, data: fallbackList, _fallbackDate: fallbackDate });
                  }
                }
                return res.json({ code: 1, data: filtered });
              }
            }

            const response = { code: 1, data: list };
            // ★ P1-6: 缓存结果（cacheKey 区分 hideFinished 模式）
            _matchListCacheByDate[cacheKey] = { time: now, response };
            // ★ P2-4: LRU 驱逐（最多缓存 MATCH_LIST_CACHE_MAX_KEYS 个日期）
            _matchListCacheLRU.push(cacheKey);
            while (_matchListCacheLRU.length > MATCH_LIST_CACHE_MAX_KEYS) {
              const oldest = _matchListCacheLRU.shift();
              delete _matchListCacheByDate[oldest];
            }
            return res.json(response);
          } catch (e) {
            logger.error(
              '[match-list] 异常: ' +
                (e.message || e) +
                ' stack: ' +
                (e.stack || '').split('\n').slice(0, 3).join(' | '),
            );
            return res.json({ code: 1, data: [] });
          }
        }

        case 'recommend-trend': {
          const { matchId } = data;
          if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });

          // 获取推荐：先尝试实时API，失败则回退到 data.json
          let recomms = [];
          try {
            recomms = await ensureRecommends(matchId);
          } catch (e) {
            logger.warn('实时推荐获取失败，回退到 data.json: ' + e.message);
            try {
              const fs = require('fs');
              const dataFile = getDataJson();
              const rMap = dataFile.r || {};
              const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
              recomms = raw.map(function (x) {
                return {
                  type: x.t || x.type,
                  num: x.n || x.num,
                  result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
                };
              });
            } catch (e2) {
              logger.warn('data.json 回退也失败: ' + e2.message);
            }
          }

          // 从 trends.json 读取真实趋势快照（period_daemon 每20分钟写入，使用内存缓存）
          let timeLabels = [],
            series = [];
          try {
            const trends = getTrendsJson();
            if (trends && Object.keys(trends).length > 0) {
              const key = 'm_' + matchId;
              const snaps = trends[key] || [];
              if (snaps.length > 0) {
                timeLabels = snaps.map(function (s) {
                  return s.t;
                });
                const allTypes = {};
                snaps.forEach(function (s) {
                  Object.keys(s).forEach(function (k) {
                    if (k !== 't' && k !== 'ts') allTypes[k] = true;
                  });
                });
                Object.keys(allTypes).forEach(function (type) {
                  series.push({
                    name: type,
                    type: 'line',
                    smooth: true,
                    data: snaps.map(function (s) {
                      return s[type] || 0;
                    }),
                  });
                });
              }
            }
          } catch (e) {
            logger.warn('读取趋势快照失败: ' + e.message);
          }

          // 如果没有历史快照，用当前值生成单点趋势
          if (series.length === 0 && recomms.length > 0) {
            var now = new Date();
            const t = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
            timeLabels = [t];
            series = recomms.map(function (r) {
              return { name: r.type, type: 'line', smooth: true, data: [r.num] };
            });
          }

          return res.json({ code: 1, data: { matchId, timeLabels, series, lastResult: recomms } });
        }

        case 'ranking-list': {
          // ★ P0-2: 请求级缓存 — 相同参数 2 分钟内命中
          const rankCacheKey = (data.date || '') + '|' + (data.category || '') + '|' + (data.direction || '');
          const rankNow = Date.now();
          if (_rankListCache[rankCacheKey] && _rankListCacheTime[rankCacheKey] &&
              rankNow - _rankListCacheTime[rankCacheKey] < RANK_LIST_CACHE_TTL) {
            return res.json(_rankListCache[rankCacheKey]);
          }

          // 从 data.json 读取比赛（包含历史比赛+推荐结果，确保 isHit 正确）
          let matches = [];
          let cachedRMap = null;
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            cachedRMap = dataFile.r || {};
            matches = Object.values(mMap).filter((m) => m && m.matchId);
          } catch {}
          // 兜底：实时 API
          if (matches.length === 0) {
            matches = await ensureData();
          }

          // 日期筛选：默认最新有数据日期，支持指定日期
          const requestDate = data.date || latestDataDate();
          matches = matches.filter((m) => String((m && m.date) || '').slice(0, 10) === requestDate);

          // 获取推荐（缓存 rMap，避免每次读磁盘）
          function getRecs(matchId) {
            if (cachedRMap) {
              const raw = cachedRMap['m_' + matchId] || cachedRMap[String(matchId)] || [];
              return raw.map((x) => ({
                type: x.t || x.type,
                num: x.n || x.num,
                result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
              }));
            }
            return [];
          }
          const filterCategory = data.category || null;
          const filterDirection = data.direction || null;
          const pkDecisionMap = buildPKDecisionMapForMatches(matches);

          // ====== 分类函数 ======
          function classifyType(type) {
            if (type.startsWith('半全场')) return '半全场';
            if (type.startsWith('总进球')) return '进球数';
            if (type.includes('、')) return '双选';
            if (type.startsWith('让')) return '让球';
            if (['胜', '平', '负'].includes(type)) return '胜平负';
            return '其他';
          }

          // ====== 收集所有方向及专家数 ======
          const dirStats = {}; // { type: { totalNum: number, matches: [] } }
          const matchTotalMap = {}; // matchId → 该比赛所有方向专家数之和
          for (const m of matches) {
            let recomms;
            try {
              recomms = getRecs(m.matchId);
            } catch {
              continue;
            }
            // 计算该比赛推荐总数：取方向明细求和与 match recommNum 的较大值
            const recTotalFromMap = recomms.reduce((s, r) => s + Number(r.num || 0), 0);
            const recTotalFromMatch = Number(m.recommNum || 0);
            matchTotalMap[m.matchId] = Math.max(recTotalFromMap, recTotalFromMatch);
            for (const r of recomms) {
              const expertNum = Number(r.num || 0);
              if (!r.type || expertNum <= 0) continue;
              if (!dirStats[r.type]) dirStats[r.type] = { totalNum: 0, matches: [] };
              dirStats[r.type].totalNum += expertNum;
              // ★ P0-3: 只存前端需要的字段，减少响应体积
              dirStats[r.type].matches.push({
                matchId: m.matchId,
                homeName: m.homeName,
                visitName: m.visitName,
                leagueName: m.leagueName,
                num: m.num,
                direction: r.type,
                expertCount: expertNum,
                totalExpertCount: Number(matchTotalMap[m.matchId] || expertNum),
                isHit: r.result === 1,
              });
            }
          }

          // ====== 构建分类结构 ======
          const categories = {};
          for (const [type, stats] of Object.entries(dirStats)) {
            const cat = classifyType(type);
            if (!categories[cat]) categories[cat] = { directions: [] };
            categories[cat].directions.push({
              name: type,
              totalExpertCount: stats.totalNum,
            });
          }

          // 每个分类内的方向按专家数从高到低排序
          for (const cat of Object.values(categories)) {
            cat.directions.sort((a, b) => b.totalExpertCount - a.totalExpertCount);
          }

          // 分类排序：保持预期顺序
          const CAT_ORDER = ['胜平负', '半全场', '进球数', '双选', '让球'];
          const sortedCategories = {};
          for (const key of CAT_ORDER) {
            if (categories[key]) sortedCategories[key] = categories[key];
          }

          // ====== 构建排名列表 ======
          const list = [];
          if (filterDirection && dirStats[filterDirection]) {
            // 按具体方向筛选（isHit 已在上面收集阶段设置）
            for (const item of dirStats[filterDirection].matches) {
              list.push({ ...item });
            }
          } else if (filterCategory && categories[filterCategory]) {
            // 按分类筛选：取该分类下所有方向的比赛的 TOP 方向
            const catDirs = new Set(categories[filterCategory].directions.map((d) => d.name));
            for (const m of matches) {
              let recomms;
              try {
                recomms = getRecs(m.matchId);
              } catch {
                continue;
              }
              const filtered = recomms.filter((r) => catDirs.has(r.type) && Number(r.num || 0) > 0);
              if (filtered.length > 0) {
                const maxDir = filtered.reduce((a, b) => (Number(b.num || 0) > Number(a.num || 0) ? b : a));
                // ★ P0-3: 只存前端需要的字段
                list.push({
                  matchId: m.matchId,
                  homeName: m.homeName,
                  visitName: m.visitName,
                  leagueName: m.leagueName,
                  num: m.num,
                  direction: maxDir.type,
                  expertCount: maxDir.num,
                  totalExpertCount: matchTotalMap[m.matchId] || maxDir.num,
                  isHit: maxDir.result === 1,
                });
              }
            }
          } else {
            // 综合排名：恢复旧规则——每场取“方向专家数”最高的方向，再按 expertCount 排序
            for (const m of matches) {
              let recomms;
              try {
                recomms = getRecs(m.matchId);
              } catch {
                continue;
              }
              const maxDir = recomms.reduce((a, b) => (Number(b.num || 0) > Number((a && a.num) || 0) ? b : a), null);
              if (maxDir && maxDir.num > 0) {
                list.push({
                  matchId: m.matchId,
                  homeName: m.homeName,
                  visitName: m.visitName,
                  leagueName: m.leagueName,
                  num: m.num,
                  direction: maxDir.type,
                  expertCount: Number(maxDir.num || 0),
                  totalExpertCount: Number(matchTotalMap[m.matchId] || maxDir.num || 0),
                  isHit: maxDir.result === 1,
                });
              }
            }
          }

          list.sort((a, b) => Number(b.expertCount || 0) - Number(a.expertCount || 0));
          const ranking = list.map(function (item, i) {
            const mid = String((item && item.matchId) || '').replace(/^m_/, '');
            const pkDecision = pkDecisionMap[mid] || buildFallbackPKDecision('PK标准字段暂缺');
            return { rank: i + 1, ...item, ...pkDecision };
          });
          const topExpertCount = ranking.length > 0 ? ranking[0].expertCount : 0;

          // ★Phase1: 获取 data.json 文件修改时间
          let dataTime = null;
          try {
            const fs = require('fs');
            const path = require('path');
            const dataJsonPath = path.join(__dirname, 'data.json');
            if (fs.existsSync(dataJsonPath)) {
              dataTime = fs.statSync(dataJsonPath).mtime.toISOString();
            }
          } catch (e) {}

          const rankResponse = {
            code: 1,
            data: {
              date: requestDate,
              dataTime: dataTime,
              filterCategory,
              filterDirection,
              totalMatches: ranking.length,
              topExpertCount,
              ranking,
              categories: sortedCategories,
            },
          };
          _rankListCache[rankCacheKey] = rankResponse;
          _rankListCacheTime[rankCacheKey] = Date.now();
          return res.json(rankResponse);
        }

        case 'home-reconcile-stats': {
          const requestDate = data.date || latestDataDate() || localDate();
          let mMap = {};
          let rMap = {};
          try {
            const dataFile = getDataJson();
            mMap = dataFile.m || {};
            rMap = dataFile.r || {};
          } catch {}

          const matches = Object.values(mMap).filter((m) => String((m && m.date) || '').slice(0, 10) === requestDate);
          function getRecs(matchId) {
            const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
            return Array.isArray(raw) ? raw : [];
          }

          const rawTop = { matchId: '', num: '-', value: 0 };
          const aggTop = { matchId: '', num: '-', value: 0 };
          const topDirection = { matchId: '', num: '-', direction: '-', value: 0 };

          for (const m of matches) {
            const rawNum = Number(m.recommNum || 0);
            if (rawNum > rawTop.value) {
              rawTop.matchId = String(m.matchId || '');
              rawTop.num = m.num || m.matchNum || m.matchId || '-';
              rawTop.value = rawNum;
            }

            const recs = getRecs(m.matchId);
            const mapTotal = recs.reduce((sum, r) => sum + Number(r.n || r.num || 0), 0);
            const aggNum = Math.max(mapTotal, rawNum);
            if (aggNum > aggTop.value) {
              aggTop.matchId = String(m.matchId || '');
              aggTop.num = m.num || m.matchNum || m.matchId || '-';
              aggTop.value = aggNum;
            }

            for (const r of recs) {
              const dirCount = Number(r.n || r.num || 0);
              if (dirCount > topDirection.value) {
                topDirection.matchId = String(m.matchId || '');
                topDirection.num = m.num || m.matchNum || m.matchId || '-';
                topDirection.direction = r.t || r.type || '-';
                topDirection.value = dirCount;
              }
            }
          }

          const drift = {
            matchCount: false,
            maxRecommend: rawTop.value !== aggTop.value || rawTop.matchId !== aggTop.matchId,
            hottestMatch: rawTop.value !== aggTop.value || rawTop.matchId !== aggTop.matchId,
          };

          return res.json({
            code: 1,
            data: {
              date: requestDate,
              matchCount: { raw: matches.length, aggregated: matches.length },
              maxRecommend: { raw: rawTop, aggregated: aggTop },
              hottestMatch: { raw: rawTop, aggregated: aggTop },
              topDirection,
              drift,
              generatedAt: new Date().toISOString(),
            },
          });
        }

        case 'match-top-directions': {
          const { matchId: mtMid } = data;
          if (!mtMid) return res.json({ code: 0, msg: '缺少 matchId' });

          let recommendations = [];
          try {
            const dataFile = getDataJson();
            const rMap = dataFile.r || {};
            const key = 'm_' + mtMid;
            const raw = rMap[key] || rMap[String(mtMid)] || [];
            recommendations = raw
              .filter((r) => r && (r.num || r.n) > 0)
              .map((r) => ({
                direction: r.t || r.type,
                expertCount: r.n || r.num,
              }))
              .sort((a, b) => b.expertCount - a.expertCount)
              .slice(0, 5);
          } catch (e) {
            /* mute */
          }

          return res.json({
            code: 1,
            data: {
              matchId: mtMid,
              directions: recommendations.map((d, i) => ({
                rank: i + 1,
                direction: d.direction,
                expertCount: d.expertCount,
              })),
            },
          });
        }

        case 'match-detail': {
          const { matchId } = data;
          // 从 data.json 读取比赛+推荐（支持历史比赛）
          let match = null;
          let recommends = [];
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const key = 'm_' + matchId;
            match = mMap[key] || mMap[matchId] || null;
            // 读取推荐并兼容新旧 schema
            const raw = rMap[key] || rMap[String(matchId)] || [];
            recommends = raw.map(function (x) {
              return {
                type: x.t || x.type,
                num: x.n || x.num,
                result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
              };
            });
          } catch {}
          // 兜底：尝试实时数据（仅 match，无历史推荐）
          if (!match) {
            try {
              const matches = await ensureData();
              match = matches.find((m) => m.matchId === matchId) || null;
            } catch {}
          }

          // ★ 蓝图辅助函数（内联，避免顶层污染）
          async function _getMatchConsensus(m, recs) {
            try {
              const gs = getGsGlobalMap();
              const cacheKey = m.matchId;
              const gsResult = gs[cacheKey] || gs['m_' + cacheKey] || {};
              const models = [];

              // 功守道
              if (gsResult.fusionConsensusType) {
                models.push({
                  model: '功守道',
                  direction: gsResult.directionAdvantage?.direction || '?',
                  confidence: gsResult.directionAdvantage?.confidence || 50,
                  goal: gsResult.goalLine,
                  score: gsResult.predictedScore,
                });
              }
              // 专家共识
              if (recs.length > 0) {
                const dirMap = { home: 0, draw: 0, away: 0 };
                let total = 0;
                recs.forEach((r) => {
                  const t = (r.type || '').trim();
                  const n = r.num || 1;
                  total += n;
                  // SPF: 胜/主胜 → home, 平/平局 → draw, 负/客胜 → away
                  if (t === '胜' || t === '主胜') dirMap.home += n;
                  else if (t === '平' || t === '平局') dirMap.draw += n;
                  else if (t === '负' || t === '客胜') dirMap.away += n;
                  // RQSPF: 让胜 → home, 让平 → draw, 让负 → away
                  else if (t === '让胜') dirMap.home += n;
                  else if (t === '让平') dirMap.draw += n;
                  else if (t === '让负') dirMap.away += n;
                  // 组合: 胜平 → home+draw 均分
                  else if (t === '胜平') {
                    dirMap.home += n / 2;
                    dirMap.draw += n / 2;
                  } else if (t === '平负') {
                    dirMap.draw += n / 2;
                    dirMap.away += n / 2;
                  }
                });
                const topDir = Object.entries(dirMap).sort((a, b) => b[1] - a[1])[0];
                models.push({
                  model: '专家共识',
                  direction: topDir[0],
                  confidence: total > 0 ? Math.round((topDir[1] / total) * 100) : 50,
                });
              }
              // AI
              try {
                const adp = database.getAdapter();
                if (adp) {
                  const aiRow = adp.execOne(
                    'SELECT * FROM ai_predictions WHERE matchId=? ORDER BY updatedAt DESC LIMIT 1',
                    m.matchId,
                  );
                  if (aiRow && aiRow.content) {
                    const dir =
                      aiRow.content.includes(m.homeName + '胜') || aiRow.content.includes('主胜')
                        ? 'home'
                        : aiRow.content.includes(m.visitName + '胜') || aiRow.content.includes('客胜')
                          ? 'away'
                          : aiRow.content.includes('平')
                            ? 'draw'
                            : null;
                    if (dir)
                      models.push({
                        model: 'DeepSeek',
                        direction: dir,
                        confidence: Math.round((aiRow.confidence || 0.5) * 100),
                      });
                  }
                }
              } catch (e) {}

              const dirPreds = models.filter((m) => m.direction);
              if (dirPreds.length === 0) return null;
              const dirMap2 = {};
              dirPreds.forEach((m) => {
                dirMap2[m.direction] = (dirMap2[m.direction] || 0) + 1;
              });
              const main = Object.entries(dirMap2).sort((a, b) => b[1] - a[1])[0];
              const ratio = main[1] / dirPreds.length;
              return {
                models,
                mainDirection: main[0],
                agreeCount: main[1],
                totalCount: dirPreds.length,
                consensus: ratio >= 0.8 ? 'strong' : ratio >= 0.6 ? 'weak' : ratio <= 0.4 ? 'meltdown' : 'neutral',
              };
            } catch (e) {
              return null;
            }
          }

          async function _getMatchFeatures(m) {
            try {
              const db = database.getAdapter();
              if (!db) return null;
              const rows = db.execAll(
                'SELECT feature_name,feature_value FROM feature_store WHERE match_num=? AND match_date=? AND feature_version=?',
                m.num,
                (m.date || '').slice(0, 10),
                'v1.0',
              );
              if (rows.length === 0) return null;
              const f = {};
              rows.forEach((r) => {
                f[r.feature_name] = r.feature_value;
              });
              return f;
            } catch (e) {
              return null;
            }
          }

          async function _getMatchH2H(m) {
            try {
              const db = database.getAdapter();
              if (!db || !m.homeName || !m.visitName) return [];
              return db.execAll(
                `SELECT home_team,away_team,match_date,home_score,away_score,spf_result
                 FROM h2h_history WHERE (home_team=? AND away_team=?) OR (home_team=? AND away_team=?)
                 ORDER BY match_date DESC LIMIT 10`,
                m.homeName,
                m.visitName,
                m.visitName,
                m.homeName,
              );
            } catch (e) {
              return [];
            }
          }

          async function _getMatchStandings(m) {
            try {
              const db = database.getAdapter();
              if (!db || !m.homeName || !m.visitName) return null;
              const homeRow = db.execOne(
                'SELECT * FROM league_standings WHERE team_name=? ORDER BY fetch_date DESC LIMIT 1',
                m.homeName,
              );
              const awayRow = db.execOne(
                'SELECT * FROM league_standings WHERE team_name=? ORDER BY fetch_date DESC LIMIT 1',
                m.visitName,
              );
              if (!homeRow && !awayRow) return null;
              return {
                home: homeRow
                  ? { rank: homeRow.rank, points: homeRow.points, played: homeRow.played, goalDiff: homeRow.goal_diff }
                  : null,
                away: awayRow
                  ? { rank: awayRow.rank, points: awayRow.points, played: awayRow.played, goalDiff: awayRow.goal_diff }
                  : null,
                rankDiff: homeRow && awayRow && homeRow.rank && awayRow.rank ? homeRow.rank - awayRow.rank : null,
              };
            } catch (e) {
              return null;
            }
          }

          function _getMatchGsData(m, matchId) {
            try {
              const gs = getGsGlobalMap();
              const cacheKey = matchId;
              const gsResult = gs[cacheKey] || gs['m_' + cacheKey] || {};
              if (Object.keys(gsResult).length === 0) return null;
              return {
                homePower: gsResult.homePower,
                guestPower: gsResult.guestPower,
                fusionConsensus: gsResult.fusionConsensusType,
                goalLine: gsResult.goalLine,
                predictedScore: gsResult.predictedScore,
                directionAdvantage: gsResult.directionAdvantage,
              };
            } catch (e) {
              return null;
            }
          }

          async function _getFullFusion(m, matchId, recs) {
            try {
              const { engine } = require('./core/prediction-fusion');
              if (!engine._initialized) engine.init();

              // 收集 AI 预测和 prediction_log 上下文
              let aiPrediction = null,
                predictionLogRow = null;
              try {
                const adp = database.getAdapter();
                if (adp) {
                  aiPrediction = adp.execOne(
                    'SELECT * FROM ai_predictions WHERE matchId=? ORDER BY updatedAt DESC LIMIT 1',
                    matchId,
                  );
                  // 从 prediction_log 获取 PK/标签评分数据
                  try {
                    predictionLogRow = adp.execOne(
                      'SELECT * FROM prediction_logs WHERE matchId=? ORDER BY updatedAt DESC LIMIT 1',
                      matchId,
                    );
                  } catch (e) {}
                }
              } catch (e) {}

              const context = {
                dataFile: getDataJson(),
                gsCache: getGsGlobalMap(),
                odds: getAllplaysData()[m.num] || {},
                recommends: recs,
                aiPrediction: aiPrediction,
                predictionLogRow: predictionLogRow,
              };
              const result = await engine.fuseForMatch(
                {
                  matchId: matchId,
                  num: m.num,
                  date: (m.date || '').slice(0, 10),
                  homeName: m.homeName,
                  visitName: m.visitName,
                  recommends: recs,
                },
                context,
              );
              // 只返回摘要（减少响应体积）
              return result.fusion && result.consensus
                ? {
                    direction: result.fusion.direction,
                    confidence: result.fusion.confidence,
                    overUnder: result.fusion.overUnder,
                    score: result.fusion.score,
                    consensus: result.consensus,
                    modelCount: result.modelPredictions ? result.modelPredictions.length : 0,
                  }
                : null;
            } catch (e) {
              return null;
            }
          }

          // ★ V9: SP官方数据注入（优先使用官网数据）
          let spData = null;
          try {
            if (match && match.num) {
              spData = spAdapter.getFullSPData(match.num, (match.date || '').slice(0, 10));
            }
          } catch (e) {}

          return res.json({
            code: 1,
            data: {
              match: match || {},
              recommends: recommends,
              // ★ V9: SP官方数据（优先级最高）
              sp_odds:
                spData && spData.odds
                  ? {
                      spf: spData.odds.spf,
                      rqspf: spData.odds.rqspf,
                      handicap: spData.odds.handicap,
                      jqs: spData.odds.jqs,
                      bqc: spData.odds.bqc,
                      lottery: spData.odds.lottery,
                      score: spData.odds.score,
                      homeRecord: spData.odds.homeRecord,
                      awayRecord: spData.odds.awayRecord,
                    }
                  : null,
              sp_preview: spData && spData.preview ? spData.preview : null,
              // ★ 蓝图新增字段（全部可选，兜底保护）
              consensus: await _getMatchConsensus(match || {}, recommends).catch(() => null),
              fusion: await _getFullFusion(match || {}, matchId, recommends).catch(() => null),
              features: await _getMatchFeatures(match || {}).catch(() => null),
              h2h: await _getMatchH2H(match || {}).catch(() => []),
              standings: await _getMatchStandings(match || {}).catch(() => null),
              gsData: _getMatchGsData(match || {}, matchId),
            },
          });
        }

        case 'hit-rate-stats': {
          const days = parseInt(data.days) || 30;
          try {
            // 尝试走内存缓存（TTL 60s，data.json 变更自动失效）
            const cached = getHitRateCache();
            if (cached && cached.days === days) {
              return res.json({ code: 1, data: cached.data });
            }

            // Load from data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }

            // 单次遍历：同时收集 dirMap、dateDirMap、matchDayTop
            var cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            var cutoffStr = cutoff.toISOString().slice(0, 10);

            const dirMap = {};
            const dateDirMap = {};
            const matchDayTop = {}; // mid -> { date, expertCount, isHit }
            let allRecsCount = 0;

            Object.keys(rMap).forEach(function (k) {
              const mid = k.replace(/^m_/, '');
              const match = mMap['m_' + mid] || mMap[mid];
              const matchDate = match ? (match.date || '').slice(0, 10) : '';
              if (!matchDate) return;
              const recs = normalizeRecs(rMap[k] || []);
              if (recs.length === 0) return;

              // 取该场比赛综合排名第一的方向(max num)
              var maxNum = -Infinity;
              var topRec = null;
              for (var ri = 0; ri < recs.length; ri++) {
                var r = recs[ri];
                if (r.num > maxNum) {
                  maxNum = r.num;
                  topRec = r;
                }
              }
              if (topRec && topRec.result !== null && topRec.result !== undefined) {
                matchDayTop[mid] = {
                  date: matchDate,
                  expertCount: topRec.num || 0,
                  isHit: topRec.result === 1,
                };
              }

              if (!matchDate || matchDate < cutoffStr) return;
              for (var j = 0; j < recs.length; j++) {
                var rr = recs[j];
                if (!rr.type || rr.result === null || rr.result === undefined) continue;
                allRecsCount++;
                // 按方向聚合
                if (!dirMap[rr.type]) dirMap[rr.type] = { total: 0, hits: 0, misses: 0 };
                dirMap[rr.type].total++;
                if (rr.result === 1) dirMap[rr.type].hits++;
                else dirMap[rr.type].misses++;
                // 按日期-方向聚合
                if (!dateDirMap[matchDate]) dateDirMap[matchDate] = {};
                if (!dateDirMap[matchDate][rr.type]) dateDirMap[matchDate][rr.type] = { total: 0, hits: 0 };
                dateDirMap[matchDate][rr.type].total++;
                if (rr.result === 1) dateDirMap[matchDate][rr.type].hits++;
              }
            });

            if (allRecsCount === 0) {
              return res.json({
                code: 0,
                msg: '命中率统计需要历史数据积累。请先运行爬虫抓取历史数据：node scraper.js',
              });
            }

            const directionStats = Object.keys(dirMap)
              .map(function (d) {
                const s = dirMap[d];
                return {
                  direction: d,
                  totalRecommends: s.total,
                  hitCount: s.hits,
                  missCount: s.misses,
                  hitRate: s.total > 0 ? Math.round((s.hits / s.total) * 1000) / 10 : 0,
                };
              })
              .sort(function (a, b) {
                return b.hitCount - a.hitCount;
              });

            // 按日期分组：每天取 top5 比赛
            const dayTop5 = {};
            Object.keys(matchDayTop).forEach(function (mid) {
              const item = matchDayTop[mid];
              if (!dayTop5[item.date]) dayTop5[item.date] = [];
              dayTop5[item.date].push({ matchId: mid, expertCount: item.expertCount, isHit: item.isHit });
            });
            Object.keys(dayTop5).forEach(function (d) {
              dayTop5[d].sort(function (a, b) {
                return b.expertCount - a.expertCount;
              });
              dayTop5[d] = dayTop5[d].slice(0, 5);
            });

            // 取近 N 个有效比赛日
            const validDates = Object.keys(dayTop5)
              .filter(function (d) {
                return d <= localDate() && dayTop5[d].length >= 1;
              })
              .sort()
              .reverse();
            const targetDays = days || 60;
            let qualifiedDays = 0,
              participatingDays = 0;
            for (let di = 0; di < validDates.length && participatingDays < targetDays; di++) {
              const dd = validDates[di];
              const top5 = dayTop5[dd];
              if (top5.length < 3) continue;
              participatingDays++;
              const dayHits = top5.filter(function (x) {
                return x.isHit;
              }).length;
              if (dayHits >= 3) qualifiedDays++;
            }
            const top3HitRate = participatingDays > 0 ? Math.round((qualifiedDays / participatingDays) * 1000) / 10 : 0;

            // dailyTrend 裁剪到最近30天（减少响应体积）
            const sortedDates = Object.keys(dateDirMap).sort();
            const recentDates = sortedDates.slice(-30);
            const dailyTrend = recentDates.map(function (d) {
              const dirs = [];
              Object.keys(dateDirMap[d]).forEach(function (dir) {
                const s = dateDirMap[d][dir];
                dirs.push({
                  direction: dir,
                  hitRate: s.total > 0 ? Math.round((s.hits / s.total) * 1000) / 10 : 0,
                });
              });
              return { date: d, directions: dirs };
            });

            const resultPayload = {
              totalDays: days,
              directionStats: directionStats,
              dailyTrend: dailyTrend,
              top3HitRate: top3HitRate,
            };

            // ★ 模型维度命中率（from prediction_outcomes）
            try {
              const db = database.getAdapter();
              if (db) {
                const modelRows = db.execAll(
                  'SELECT model_name, COUNT(*) as total, SUM(direction_hit) as hits, ' +
                    'ROUND(SUM(direction_hit) * 100.0 / COUNT(*), 1) as hit_rate ' +
                    'FROM prediction_outcomes ' +
                    "WHERE model_name NOT IN ('data_fusion','market_signal') " +
                    "AND match_date >= date('now', '-" +
                    days +
                    " days') " +
                    'GROUP BY model_name ORDER BY hit_rate DESC',
                );
                if (modelRows && modelRows.length > 0) {
                  resultPayload.modelStats = modelRows.map(function (r) {
                    return {
                      modelName: r.model_name,
                      total: r.total,
                      hits: r.hits,
                      hitRate: r.hit_rate,
                    };
                  });
                }
              }
            } catch (e) {
              // 模型维度查询失败不影响主流程
              console.error('[hit-rate] modelStats query failed:', e.message);
            }

            // 写入内存缓存
            setHitRateCache({ days: days, data: resultPayload });

            return res.json({
              code: 1,
              data: resultPayload,
            });
          } catch (dbErr) {
            return res.json({ code: 0, msg: '命中率统计失败: ' + dbErr.message });
          }
        }

        case 'crawl-history': {
          const crawler = require('./scraper');
          // 不等待完成，后台执行
          res.json({ code: 1, data: { message: '历史数据抓取已启动，请查看控制台日志' } });
          crawler.main().catch((err) => console.error('[crawl-history] 错误:', err));
          return;
        }

        case 'crawl-status': {
          const crawled = database.getCrawledDates();
          const allMatches = database.getAllMatches();
          const stats = {
            totalCrawledDates: crawled.length,
            crawledDates: crawled,
            totalMatches: allMatches.length,
            lastUpdate: allMatches.length > 0 ? allMatches[0].updatedAt : null,
          };
          return res.json({ code: 1, data: stats });
        }

        case 'hit-rate-filter': {
          const { league, timeRange, directionType, direction, rankType, rankTop } = data;
          try {
            const fs = require('fs');
            const path = require('path');

            // 读取 data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            function norm(recs) {
              return recs.map(function (x) {
                return {
                  type: x.t || x.type,
                  num: x.n || x.num,
                  result: x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null,
                };
              });
            }

            // 方向分类
            function classifyDir(type) {
              if (!type) return '其他';
              if (['胜', '平', '负'].indexOf(type) >= 0) return '胜平负';
              if (type.indexOf('让') === 0 && type.length <= 3) return '让球';
              if (type.indexOf('总进球') === 0) return '进球数';
              if (['胜胜', '负负'].indexOf(type) >= 0 || type.indexOf('半全场') === 0) return '半全场';
              if (type.indexOf('、') >= 0 || type.indexOf(',') >= 0) return '双选';
              return '其他';
            }

            // Build match+rec list from data.json
            let allItems = [];
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || !m.matchId || !m.date) return;
              const date = m.date.slice(0, 10);
              const raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
              const recs = norm(raw);
              recs.forEach(function (r) {
                if (r.type && r.num > 0 && r.result !== null && r.result !== undefined) {
                  allItems.push({
                    matchId: m.matchId,
                    date: date,
                    leagueName: m.leagueName || '',
                    homeName: m.homeName || '',
                    visitName: m.visitName || '',
                    num: m.num || '',
                    direction: r.type,
                    expertCount: r.num,
                    result: r.result,
                    dirType: classifyDir(r.type),
                    matchStatus: m.matchStatus || 0,
                  });
                }
              });
            });

            // Filter: timeRange
            var now = new Date();
            if (timeRange && timeRange !== 'all') {
              var cutoff = new Date(now);
              cutoff.setDate(cutoff.getDate() - parseInt(timeRange, 10));
              var cutoffStr = cutoff.toISOString().slice(0, 10);
              allItems = allItems.filter(function (x) {
                return x.date >= cutoffStr;
              });
            }

            // Filter: league
            if (league) {
              allItems = allItems.filter(function (x) {
                return x.leagueName === league;
              });
            }

            // Filter: directionType
            // "综合排名" means: for each match, take the top expertCount direction regardless of type
            if (directionType === '综合排名') {
              // sort by matchId+expertCount desc, pick top per match
              const matchTop = {};
              allItems.forEach(function (x) {
                if (!matchTop[x.matchId] || matchTop[x.matchId].expertCount < x.expertCount) {
                  matchTop[x.matchId] = x;
                }
              });
              allItems = Object.values(matchTop);
            } else if (directionType) {
              allItems = allItems.filter(function (x) {
                return x.dirType === directionType;
              });
            }

            // Filter: direction
            if (direction) {
              allItems = allItems.filter(function (x) {
                return x.direction === direction;
              });
            }

            // Filter: rankTop (per match)
            const isPerMatch = rankType === '每场' && rankTop > 0;
            const isDaily = rankType === '每天' && rankTop > 0;
            if (isPerMatch) {
              // For each match, only keep top N directions by expertCount
              var matchGroups = {};
              allItems.forEach(function (x) {
                if (!matchGroups[x.matchId]) matchGroups[x.matchId] = [];
                matchGroups[x.matchId].push(x);
              });
              allItems = [];
              Object.keys(matchGroups).forEach(function (mid) {
                const items = matchGroups[mid];
                items.sort(function (a, b) {
                  return b.expertCount - a.expertCount;
                });
                // Get the max expertCount to find "tied for first"
                const maxCount = items[0].expertCount;
                const kept = items
                  .filter(function (x) {
                    return x.expertCount === maxCount;
                  })
                  .slice(0, rankTop);
                allItems = allItems.concat(kept);
              });
            } else if (isDaily) {
              // For each day, find the global max expertCount, then filter per match
              const dayMax = {};
              allItems.forEach(function (x) {
                if (!dayMax[x.date] || dayMax[x.date] < x.expertCount) dayMax[x.date] = x.expertCount;
              });
              allItems = allItems.filter(function (x) {
                return x.expertCount === dayMax[x.date];
              });
              // Then pick top N per match
              var matchGroups = {};
              allItems.forEach(function (x) {
                if (!matchGroups[x.matchId]) matchGroups[x.matchId] = [];
                matchGroups[x.matchId].push(x);
              });
              allItems = [];
              Object.keys(matchGroups).forEach(function (mid) {
                const items = matchGroups[mid];
                items.sort(function (a, b) {
                  return b.expertCount - a.expertCount;
                });
                allItems = allItems.concat(items.slice(0, rankTop));
              });
            }

            // Calculate stats
            let hitCount = 0,
              totalCount = allItems.length;
            allItems.forEach(function (x) {
              if (x.result === 1) hitCount++;
            });
            const hitRate = totalCount > 0 ? Math.round((hitCount / totalCount) * 1000) / 10 : 0;

            // Daily results
            const dailyMap = {};
            allItems.forEach(function (x) {
              if (!dailyMap[x.date]) dailyMap[x.date] = { totalMatch: 0, hitMatch: 0, matchSet: {}, hitSet: {} };
              if (!dailyMap[x.date].matchSet[x.matchId]) {
                dailyMap[x.date].matchSet[x.matchId] = true;
                dailyMap[x.date].totalMatch++;
              }
              if (x.result === 1 && !dailyMap[x.date].hitSet[x.matchId]) {
                dailyMap[x.date].hitSet[x.matchId] = true;
                dailyMap[x.date].hitMatch++;
              }
            });
            const dailyResults = Object.keys(dailyMap)
              .sort()
              .reverse()
              .slice(0, 15)
              .map(function (d) {
                const dm = dailyMap[d];
                return {
                  date: d.replace(/-/g, '/'),
                  totalMatch: dm.totalMatch,
                  hitMatch: dm.hitMatch,
                  hitRate: dm.totalMatch > 0 ? Math.round((dm.hitMatch / dm.totalMatch) * 1000) / 10 : 0,
                };
              });

            // Condition summary
            const condParts = [];
            if (league) condParts.push(league);
            if (timeRange === '30') condParts.push('近30天');
            else if (timeRange === '60') condParts.push('近60天');
            else if (timeRange === '90') condParts.push('近90天');
            if (direction) condParts.push(direction);
            else if (directionType && directionType !== '综合排名') condParts.push(directionType);
            else if (directionType === '综合排名') condParts.push('综合排名');
            if (isPerMatch) condParts.push('每场前' + rankTop);
            if (isDaily) condParts.push('每天前' + rankTop);
            const conditionSummary = condParts.length > 0 ? condParts.join(' | ') : '全部条件';

            return res.json({
              code: 1,
              data: {
                hitCount: hitCount,
                totalCount: totalCount,
                hitRate: hitRate,
                conditionSummary: conditionSummary,
                detailList: allItems,
                dailyResults: dailyResults,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '查询失败: ' + e.message });
          }
        }

        case 'filter-leagues': {
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const leagueSet = {};
            Object.values(mMap).forEach(function (m) {
              if (m && m.leagueName) leagueSet[m.leagueName] = true;
            });
            return res.json({ code: 1, data: Object.keys(leagueSet).sort() });
          } catch (e) {
            return res.json({ code: 0, msg: '获取联赛列表失败: ' + e.message });
          }
        }

        case 'backfill-results': {
          // 兜底回填：补查完赛但缺失结果的推荐数据
          const backfill = require('./backfill_results');
          database.initDatabase();
          backfill
            .main()
            .then((r) => {
              console.log('[api] backfill done:', JSON.stringify(r));
            })
            .catch((err) => console.error('[api] backfill error:', err));
          return res.json({
            code: 1,
            data: {
              message: '结果回填已启动，正在后台执行。几分钟后完赛推荐命中数据将更新。',
              hint: '可稍后重新查询筛选结果。也可运行: node backfill_results.js',
            },
          });
        }

        case 'backfill-status': {
          const stale = database.getStaleRecommendations();
          const matchCount = new Set(stale.map((r) => r.matchId)).size;
          return res.json({
            code: 1,
            data: { staleCount: stale.length, staleMatches: matchCount, needBackfill: stale.length > 0 },
          });
        }

        case 'sync-match-date': {
          // 手动触发指定日期的赛程同步（用于补同步缺失日期）
          try {
            const ds = require('./data_sync');
            const syncDate = data.date || '';
            if (!syncDate) return res.json({ code: 0, msg: '缺少 date 参数' });
            logger.info('[api] 手动触发 ' + syncDate + ' 赛程同步...');
            ds.syncMatchList(syncDate)
              .then(function () {
                logger.info('[api] ' + syncDate + ' 赛程同步完成, 开始同步赔率...');
                return ds.sync500Odds ? ds.sync500Odds(syncDate) : Promise.resolve();
              })
              .then(function () {
                logger.info('[api] ' + syncDate + ' 赔率同步完成, 开始同步推荐...');
                return ds.syncRecommends(syncDate);
              })
              .then(function () {
                logger.info('[api] ' + syncDate + ' 推荐同步完成');
                return ds.backfillResults(syncDate).catch(function () {});
              })
              .then(function () {
                if (ds.runModelClosure) {
                  logger.info('[api] ' + syncDate + ' 启动模型补算闭环...');
                  return ds
                    .runModelClosure(syncDate, { reason: 'api_sync_match_date', aiDelayMs: 300 })
                    .catch(function () {});
                }
              })
              .catch(function (e) {
                logger.error('[api] ' + syncDate + ' 同步失败: ' + e.message);
              });
            return res.json({ code: 1, data: { hint: '已启动后台同步 ' + syncDate + ', 请稍候查看' } });
          } catch (e) {
            return res.json({ code: 0, msg: '同步触发失败: ' + e.message });
          }
        }

        case 'sync-gov-schedule': {
          // ★ P1: 手动触发SP官方赛程同步（轻量 HTTP，主数据源）
          try {
            const ds = require('./data_sync');
            logger.info('[api] 手动触发 SP 赛程同步...');
            ds.syncGovScheduleWrap()
              .then(function (result) {
                if (result && result.success) {
                  logger.info('[api] SP赛程同步完成: +' + (result.added || 0) + '新 ' + (result.updated || 0) + '更新');
                  if (ds.runModelClosure) {
                    const targetDate = (data && data.date) || localDate();
                    return ds
                      .runModelClosure(targetDate, { reason: 'api_sync_gov_schedule', aiDelayMs: 300 })
                      .catch(function () {});
                  }
                } else {
                  logger.warn('[api] SP赛程同步未成功: ' + JSON.stringify(result));
                }
              })
              .catch(function (e) {
                logger.error('[api] SP赛程同步失败: ' + e.message);
              });
            return res.json({ code: 1, data: { hint: '已启动 SP 赛程同步，请稍候查看 data.json' } });
          } catch (e) {
            return res.json({ code: 0, msg: 'SP赛程同步触发失败: ' + e.message });
          }
        }

        case 'daily-profit-7d': {
          // ★ V9: 近7日专家博热方案盈利统计（调用共享方案生成模块）
          try {
            const days = parseInt(data.days) || 7;

            // ★ P2: 响应级缓存（10 分钟），避免重复同步计算阻塞事件循环
            const profitCacheKey = 'd' + days;
            const profitNow = Date.now();
            if (
              _profit7dCache &&
              _profit7dCache.key === profitCacheKey &&
              profitNow - _profit7dCacheTime < PROFIT_7D_CACHE_TTL
            ) {
              return res.json(_profit7dCache.response);
            }

            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            // ★ 从数据中提取最近N个有比赛的日期（与收入方案页实际显示对齐）
            const allDates = new Set();
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              const d = ((m && m.date) || '').slice(0, 10);
              if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) allDates.add(d);
            });
            const sortedDates = Array.from(allDates).sort().reverse(); // 降序
            // ★ 多取2天作为缓冲：如果最新日期比赛未完成（所有方案isPlanWon=null），跳过后再取最新的 days 条
            const fetchDays = Math.min(days + 2, sortedDates.length);
            const dates = sortedDates.slice(0, fetchDays).reverse(); // 取最近fetchDays天，再升序

            const dateLabels = [];
            const dateProfits = [];
            const AMOUNT = 1000; // 每方案1000分（10元）

            function findRecommends(matchId) {
              const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
              return (raw || []).map((x) => {
                const rawVal = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = rawVal === 0 || rawVal === 1 ? rawVal : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }

            const PG = require('./core/plan-generator');

            // ★ 从最新日期向最旧日期遍历，确保展示的是"最近N天"而非"最早N天"
            for (let di = dates.length - 1; di >= 0; di--) {
              const ds = dates[di];
              const mList = [];
              Object.keys(mMap).forEach((k) => {
                const m = mMap[k];
                if (!m || (m.date || '').slice(0, 10) !== ds) return;
                mList.push(m);
              });

              // 当天没有比赛 → 利润为0，但日期仍然显示（保证7天连续）
              if (mList.length === 0) {
                dateLabels.push(ds.slice(5));
                dateProfits.push(0);
                continue;
              }

              // 构建 matchDataMap（与 income-stats 完全一致）
              const histOdds = getOddsHistory(ds);
              const matchDataMap = {};
              for (const m of mList) {
                const num = m.num || '';
                let oddsObj = null;
                if (histOdds && histOdds[num]) {
                  const od = histOdds[num];
                  oddsObj = {
                    spf: od.spf || null,
                    rqspf: od.rqspf || null,
                    totalGoals: od.totalGoals || null,
                    isSingleGame: od.isSingleGame || false,
                  };
                }
                matchDataMap[m.matchId] = {
                  match: m,
                  recs: findRecommends(m.matchId),
                  odds: oddsObj,
                };
              }

              // 生成专家博热方案 & 计算日盈利
              const plans = PG.generateExpertPlans(mList, matchDataMap, ds);
              let dayProfit = 0;
              let hasResolvedPlan = false; // ★ 标记当天是否有方案已完成
              plans.forEach((pp) => {
                if (pp.isPlanWon === null && pp.isPlanLose === null) return;
                hasResolvedPlan = true; // ★ 有方案已出结果
                if (pp.isPlanWon === true) dayProfit += (pp.winningPrize || 0) - AMOUNT;
                else if (pp.isPlanLose === true) dayProfit -= AMOUNT;
              });

              // ★ 跳过"有比赛、有方案、但全部未完成"的日期（比赛未结束）
              if (mList.length > 0 && plans.length > 0 && !hasResolvedPlan) continue;

              dateLabels.push(ds.slice(5));
              dateProfits.push(Math.round(dayProfit));

              // ★ 收集够 days 条有效数据就提前退出
              if (dateLabels.length >= days) break;
            }

            // ★ 反转回时间升序（从新到旧收集后，恢复正序供前端图表使用）
            dateLabels.reverse();
            dateProfits.reverse();

            const profitResponse = { code: 1, data: { dates: dateLabels, profits: dateProfits } };
            _profit7dCache = { key: profitCacheKey, response: profitResponse };
            _profit7dCacheTime = profitNow;
            return res.json(profitResponse);
          } catch (e) {
            logger.error('[daily-profit-7d] ' + e.message);
            return res.json({ code: 0, msg: '获取盈利数据失败: ' + e.message });
          }
        }

        case 'auto-heal': {
          // ★ P2: 手动触发自动补漏检查
          try {
            const autoHeal = require('./auto_heal');
            logger.info('[api] 手动触发 auto_heal 检查...');
            autoHeal
              .checkAndHeal({ days: 7 })
              .then(function (result) {
                logger.info('[api] auto_heal 完成: ' + JSON.stringify(result.gaps));
              })
              .catch(function (e) {
                logger.error('[api] auto_heal 失败: ' + e.message);
              });
            return res.json({ code: 1, data: { hint: 'auto_heal 检查已启动' } });
          } catch (e) {
            return res.json({ code: 0, msg: 'auto_heal 失败: ' + e.message });
          }
        }

        case 'error-log-summary': {
          // ★ 管理后台: 最近错误日志摘要（读 winston error 日志尾部，脱敏返回）
          try {
            const fs = require('fs');
            const limit = Math.min(Number(data.limit) || 5, 20);
            const logDir = path.join(__dirname, '..', 'logs');
            const today = new Date();
            const entries = [];
            // 最多回看 3 天的 error-YYYY-MM-DD.log，凑够 limit 条为止
            for (let d = 0; d < 3 && entries.length < limit; d++) {
              const day = new Date(today.getTime() - d * 86400000);
              const tag =
                day.getFullYear() +
                '-' +
                String(day.getMonth() + 1).padStart(2, '0') +
                '-' +
                String(day.getDate()).padStart(2, '0');
              const file = path.join(logDir, 'error-' + tag + '.log');
              if (!fs.existsSync(file)) continue;
              const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
              for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
                // 脱敏: token/密码字段抹除 + 单条截断 300 字符
                const safe = lines[i]
                  .replace(/(token|password|secret|key)["']?\s*[:=]\s*["']?[\w-]+/gi, '$1=***')
                  .slice(0, 300);
                entries.push(safe);
              }
            }
            return res.json({ code: 1, data: { errors: entries } });
          } catch (e) {
            return res.json({ code: 0, msg: '读取错误日志失败: ' + e.message });
          }
        }

        case 'refresh-predictions': {
          // ★ 管理后台: 手动触发 AI 预测重跑（异步启动，立即返回）
          try {
            const aiDaemon = require('./ai_daemon');
            logger.info('[api] 手动触发 AI 预测重跑 (dailyBatch)...');
            Promise.resolve(aiDaemon.dailyBatch())
              .then(function () {
                logger.info('[api] refresh-predictions 完成');
              })
              .catch(function (e) {
                logger.error('[api] refresh-predictions 失败: ' + e.message);
              });
            return res.json({ code: 1, data: { hint: 'AI 预测重跑已启动，预计数分钟后完成' } });
          } catch (e) {
            return res.json({ code: 0, msg: '触发 AI 预测失败: ' + e.message });
          }
        }

        case 'refill-expert-consensus': {
          // ★ V9.1: 删除旧专家共识记录 + 重新回填（进程内执行，避免子进程DB冲突）
          try {
            const db = database.getAdapter();
            if (!db) return res.json({ code: 0, msg: '数据库不可用' });

            // 删除旧记录
            const poDel = db.execRun("DELETE FROM prediction_outcomes WHERE model_name='专家共识'");
            const upDel = db.execRun("DELETE FROM unified_predictions WHERE model_name='专家共识'");
            logger.info('[api] 已删除专家共识旧记录: outcomes=' + poDel + ', unified=' + upDel);

            // ★ 进程内回填：读取 data.json → computeConsensus → insert unified_predictions
            const fs = require('fs');
            const DATA_FILE = path.join(__dirname, 'data.json');
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const rMap = data.r || {},
              mMap = data.m || {};
            const keys = Object.keys(rMap).filter((k) => Array.isArray(rMap[k]) && rMap[k].length > 0);

            // 同 backfill_expert_consensus.js 的 computeConsensus
            const computeConsensus = (recs) => {
              const dirs = { home: 0, draw: 0, away: 0 };
              let total = 0;
              recs.forEach((r) => {
                const type = r.type || '',
                  num = Number(r.num) || 1;
                total += num;
                if (type === '胜' || type === '主胜') dirs.home += num;
                else if (type === '平' || type === '平局') dirs.draw += num;
                else if (type === '负' || type === '客胜') dirs.away += num;
                else if (type === '让胜') dirs.home += num;
                else if (type === '让平') dirs.draw += num;
                else if (type === '让负') dirs.away += num;
                else if (type === '胜平') {
                  dirs.home += num / 2;
                  dirs.draw += num / 2;
                } else if (type === '平负') {
                  dirs.draw += num / 2;
                  dirs.away += num / 2;
                } else total -= num;
              });
              if (total <= 0) return null;
              let top = 'home',
                topCount = dirs.home;
              if (dirs.draw > topCount) {
                top = 'draw';
                topCount = dirs.draw;
              }
              if (dirs.away > topCount) {
                top = 'away';
                topCount = dirs.away;
              }
              const conf = topCount / total;
              return {
                direction: top,
                confidence: Math.min(conf, 1),
                consensusTag: conf >= 0.6 ? 'strong' : conf >= 0.4 ? 'weak' : 'neutral',
                homeCount: dirs.home,
                drawCount: dirs.draw,
                awayCount: dirs.away,
                total,
              };
            };

            let inserted = 0,
              skipped = 0;
            keys.forEach((k) => {
              const recs = rMap[k] || [];
              const m = mMap[k] || {};
              const mid = (m.matchId || '').replace(/^m_/, '');
              const date = (m.date || '').substring(0, 10);
              const num = m.num || '';
              const cons = computeConsensus(recs);
              if (!cons) return;
              const predId = 'expert_consensus_v1.0_' + mid + '_' + date;
              const exists = db.execOne('SELECT id FROM unified_predictions WHERE prediction_id=?', predId);
              if (exists) {
                skipped++;
                return;
              }
              db.execRun(
                'INSERT INTO unified_predictions (match_num,match_date,match_id,model_name,model_version,prediction_id,direction,direction_confidence,consensus_tag,raw_output_json,computed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                num,
                date,
                mid,
                '专家共识',
                'v1.0',
                predId,
                cons.direction,
                cons.confidence,
                cons.consensusTag,
                JSON.stringify({
                  homeCount: cons.homeCount,
                  drawCount: cons.drawCount,
                  awayCount: cons.awayCount,
                  total: cons.total,
                }),
                new Date().toISOString(),
              );
              inserted++;
            });

            // Outcome backfill
            const { backfiller } = require('./core/outcome-backfill');
            const bfResult = await backfiller.backfill(db, { dryRun: false });
            const roCount = db.execOne("SELECT COUNT(*) as c FROM prediction_outcomes WHERE model_name='专家共识'");

            logger.info(
              '[api] 专家共识回填完成: inserted=' +
                inserted +
                ' skipped=' +
                skipped +
                ' outcomes=' +
                (roCount ? roCount.c : 0),
            );
            return res.json({
              code: 1,
              data: {
                inserted,
                skipped,
                deletedPo: poDel,
                deletedUp: upDel,
                outcomes: roCount ? roCount.c : 0,
                backfillResult: bfResult,
              },
            });
          } catch (e) {
            logger.error('[api] 专家共识回填失败: ' + e.message);
            return res.json({ code: 0, msg: '专家共识回填失败: ' + e.message });
          }
        }

        // ========== AI 预测 ==========
        case 'ai-predict': {
          const mid = data.matchId;
          if (!mid) return res.json({ code: 0, msg: '缺少 matchId' });
          try {
            const fs = require('fs');
            const path = require('path');

            // ★ 内存缓存缓存文件内容（30s TTL）
            if (!_aiCacheData || Date.now() - _aiCacheTime > 30000) {
              const cacheFile = path.join(__dirname, 'ai_cache.json');
              _aiCacheData = {};
              if (fs.existsSync(cacheFile)) {
                try {
                  _aiCacheData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                } catch (e) {}
              }
              _aiCacheTime = Date.now();
            }
            let cachedEntry = _aiCacheData[mid];
            const hasDS =
              cachedEntry &&
              cachedEntry.sources &&
              cachedEntry.sources.deepseek &&
              cachedEntry.sources.deepseek.content;
            const hasDB =
              cachedEntry && cachedEntry.sources && cachedEntry.sources.doubao && cachedEntry.sources.doubao.content;

            // 获取比赛信息
            let matchInfo = {};
            try {
              const df = getDataJson();
              var m = (df.m || {})['m_' + mid] || (df.m || {})[mid];
              if (m)
                matchInfo = {
                  matchId: mid,
                  homeName: m.homeName,
                  visitName: m.visitName,
                  leagueName: m.leagueName,
                  date: m.date,
                  num: m.num,
                };
            } catch (e) {}
            // ★ 回退: data.json 无历史比赛时从 prediction_logs 补全
            if (!matchInfo.homeName) {
              try {
                const adp = database.getAdapter();
                const pm = adp
                  ? adp.execOne(
                      'SELECT matchId,homeName,visitName,leagueName,date,matchNum FROM prediction_logs WHERE matchId = ? LIMIT 1',
                      mid,
                    )
                  : null;
                if (pm)
                  matchInfo = {
                    matchId: mid,
                    homeName: pm.homeName,
                    visitName: pm.visitName,
                    leagueName: pm.leagueName,
                    date: pm.date,
                    num: pm.matchNum,
                  };
              } catch (e3) {}
            }

            // ★ 检查 500.com 数据是否存在
            let shujuMissing = true;
            try {
              if (matchInfo.date) {
                const dateStr = matchInfo.date.slice(0, 10);
                const shujuFile = path.join(__dirname, 'shuju_data', 'shuju_merged_' + dateStr + '.json');
                if (fs.existsSync(shujuFile) && fs.statSync(shujuFile).size > 100) {
                  const shujuJson = JSON.parse(fs.readFileSync(shujuFile, 'utf8'));
                  shujuMissing = !(shujuJson.matches || {})[matchInfo.num];
                }
              }
            } catch (e) {}
            if (shujuMissing) {
              console.log('[ai] 500.com 数据缺失: ' + mid + ' ' + matchInfo.num + ', 后台触发抓取...');
              // 后台异步触发抓取
              const ds = require('./data_sync');
              ds.triggerShujuFetch && ds.triggerShujuFetch(matchInfo.date ? matchInfo.date.slice(0, 10) : '');
            }

            // 缓存写入（后台合并）
            function saveCache(source, content, conf) {
              try {
                let cur = {};
                try {
                  cur = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                } catch (e) {}
                const entry = cur[mid] || { sources: {} };
                if (!entry.sources) entry.sources = {};
                entry.sources[source] = { content, confidence: conf, generatedAt: new Date().toISOString() };
                if (entry.sources.deepseek && entry.sources.doubao) {
                  const merged = aiMerger.mergeAnalyses(
                    { content: entry.sources.deepseek.content, confidence: entry.sources.deepseek.confidence || 70 },
                    { content: entry.sources.doubao.content, confidence: entry.sources.doubao.confidence || 70 },
                    matchInfo,
                  );
                  entry.content = merged.content || merged; // ★ P0-3: mergeAnalyses 返回分析对象本身，可能没有 .content
                  entry.confidence = merged.confidence;
                  entry.merged = true;
                  console.log('[ai] 双模型合并完成: ' + mid);
                } else {
                  entry.content = content;
                  entry.confidence = conf;
                  entry.merged = false;
                  console.log('[ai] ' + source + ' 缓存: ' + mid + ' conf=' + conf);
                }
                entry.updatedAt = new Date().toISOString();
                cur[mid] = entry;
                fs.writeFileSync(cacheFile, JSON.stringify(cur));

                // ★ 回测钩子: AI 预测持久化
                try {
                  const preds = entry.content && entry.content['预测建议'] ? entry.content['预测建议'] : [];
                  const aiFields = { confidence: entry.confidence || 0, content: JSON.stringify(entry.content) };
                  if (matchInfo.date) aiFields.date = matchInfo.date.slice(0, 10);
                  if (matchInfo.homeName) aiFields.homeName = matchInfo.homeName;
                  if (matchInfo.visitName) aiFields.visitName = matchInfo.visitName;
                  if (matchInfo.leagueName) aiFields.leagueName = matchInfo.leagueName;
                  if (matchInfo.num) aiFields.matchNum = matchInfo.num;
                  if (matchInfo.handicap !== undefined) aiFields.handicap = matchInfo.handicap;
                  else if (matchInfo.rq !== undefined) aiFields.handicap = matchInfo.rq;
                  preds.forEach(function (p) {
                    if (p['玩法'] === '胜平负') aiFields.spf = p['建议方向'];
                    if (p['玩法'] === '大小球') aiFields.overunder = p['建议方向'];
                    if (p['玩法'] === '比分预测') aiFields.score = p['建议方向'];
                  });
                  predictionLog.upsertAI(mid, aiFields);
                } catch (e) {}

                return entry;
              } catch (e) {
                console.error('[ai] cache err:', e.message);
                return null;
              }
            }

            // 已有双模型合并 → 直接返回
            if (cachedEntry && cachedEntry.content && hasDS && hasDB) {
              return res.json({
                code: 1,
                data: {
                  matchId: mid,
                  content: cachedEntry.content,
                  confidence: cachedEntry.confidence || 0,
                  fromCache: true,
                  dualModel: true,
                  merged: true,
                  shujuMissing: shujuMissing,
                },
              });
            }
            // 旧格式
            if (cachedEntry && cachedEntry.content && !cachedEntry.sources) {
              return res.json({
                code: 1,
                data: {
                  matchId: mid,
                  content: cachedEntry.content,
                  confidence: cachedEntry.confidence || 0,
                  fromCache: true,
                  legacy: true,
                  shujuMissing: shujuMissing,
                },
              });
            }
            // 已有单模型缓存（另一个还在跑）→ 先返回，让前端轮询
            if (cachedEntry && cachedEntry.content && cachedEntry.sources && (hasDS || hasDB) && !(hasDS && hasDB)) {
              return res.json({
                code: 1,
                data: {
                  matchId: mid,
                  content: cachedEntry.content,
                  confidence: cachedEntry.confidence || 0,
                  fromCache: true,
                  singleModel: true,
                  pendingMerge: true,
                  readySource: hasDS ? 'deepseek' : 'doubao',
                  failedSource: null,
                  shujuMissing: shujuMissing,
                },
              });
            }

            // ★ P0-2: 无缓存 → 后台触发 daemon 批量生成（fire-and-forget）
            if (!_aiBatchGenerating) {
              _aiBatchGenerating = true;
              const daemon = require('./ai_daemon');
              setTimeout(function () {
                daemon.dailyBatch();
                // 5 分钟后解锁，允许再次触发
                setTimeout(function () {
                  _aiBatchGenerating = false;
                }, 300000);
              }, 500).unref();
            }

            return res.json({
              code: 1,
              data: {
                matchId: mid,
                notReady: true,
                msg: 'AI 分析已后台触发生成，请等待 30-60 秒后点击"刷新"按钮重试。每日 11:30 / 16:30 也会定时批量生成。',
                canRetry: true,
              },
            });
          } catch (e) {
            logger.error('[ai-predict] ' + e.message);
            return res.json({ code: 0, msg: 'AI 分析异常，请稍后重试' });
          }
        }
        case 'ai-predict-status': {
          try {
            const fs = require('fs');
            const path = require('path');
            const today = localDate();
            let totalMatches = 0,
              finishedMatches = 0;
            try {
              const dataFile = getDataJson();
              const mMap = dataFile.m || {};
              Object.values(mMap).forEach(function (m) {
                if (!m || !m.date) return;
                if ((m.date || '').slice(0, 10) === today) {
                  totalMatches++;
                  if (m.matchStatus >= 2) finishedMatches++;
                }
              });
            } catch (e) {}
            return res.json({
              code: 1,
              data: {
                todayDate: today,
                totalMatches: totalMatches,
                finishedMatches: finishedMatches,
                unfinishedMatches: totalMatches - finishedMatches,
                canShowCards: totalMatches - finishedMatches > 0,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: e.message });
          }
        }
        // ========== 攻守道量化 ==========
        case 'gongshoudao': {
          const mid = data.matchId;
          if (!mid) return res.json({ code: 0, msg: '缺少 matchId' });
          try {
            // P0-1: L1 内存极速缓存（1s TTL，免JSON.parse大文件）
            try {
              const gsEngine = require('./gongshoudao/index');
              var gsResult = gsEngine.getMatchFromCache ? gsEngine.getMatchFromCache(mid) : null;
            } catch (e) {
              gsResult = null;
            }
            // 内存缓存未命中 → 回退到引擎查询
            if (!gsResult) {
              try {
                const gsEngine = require('./gongshoudao/index');
                gsResult = await Promise.race([
                  gsEngine.getMatchResult(mid),
                  new Promise(function (_, reject) {
                    setTimeout(function () {
                      reject(new Error('GS timeout'));
                    }, 10000);
                  }),
                ]);
              } catch (gsErr) {
                logger.warn('[gongshoudao] 引擎异常/超时: ' + gsErr.message);
              }
            }

            if (gsResult) {
              // ★ 追加比分赔率（BF scoreOdds）
              try {
                const dataFile2 = getDataJson();
                const mMap2 = dataFile2.m || {};
                const m2 = mMap2['m_' + mid] || mMap2[mid];
                if (m2) {
                  const dateStr2 = (m2.date || '').slice(0, 10);
                  const num2 = m2.num || '';
                  const allplays = getAllplaysData();
                  const so = getScoreOdds(allplays, dateStr2, num2);
                  if (so) gsResult.scoreOdds = so;
                }
              } catch (e) {
                /* ignore */
              }
              return res.json({ code: 1, data: gsResult });
            }

            // 降级：使用 AI 缓存 + data.json 返回基础数据
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const m = mMap['m_' + mid] || mMap[mid];
            if (!m) return res.json({ code: 0, msg: '比赛不存在' });

            const num = m.num || '';
            const histOdds = getOddsHistory(latestDataDate()) || {};
            const od = histOdds[num] || {};

            const gs = {
              matchId: mid,
              homeName: m.homeName || '',
              visitName: m.visitName || '',
              leagueName: m.leagueName || '',
              num: m.num || '',
              attackAdvantage: '+0%',
              attackAdvantageValue: 50,
              defenseAdvantage: '+0%',
              defenseAdvantageValue: 50,
              attackPattern: '攻守平衡',
              attackWeightHome: '50%',
              attackWeightAway: '50%',
              defenseWeightHome: '50%',
              defenseWeightAway: '50%',
              totalAdvantage: '+0%',
              totalAdvantageValue: 50,
              homeWeight: '50%',
              awayWeight: '50%',
              goalDiffHome: '--',
              goalDiffAway: '--',
              totalGoalsExpect: '--',
              totalGoalsValue: 50,
              homeWinExpect: '+0.00',
              homeWinValue: 50,
              totalAdvantage2: '+0.00',
              totalAdvantage2Value: 50,
              goalCount: '±0',
              goalCountValue: 50,
              verifyResult: '暂无数据',
              verifyValue: 50,
              resonance: { verdict: '数据不足，无法完成量化分析，请使用"AI深度解析"获取更全面的比赛分析' },
              scores: [],
              suggestion: '统计数据暂未就绪。请使用AI深度解析功能获取实时分析。',
            };
            return res.json({ code: 1, data: gs, fallback: true });
          } catch (e) {
            return res.json({ code: 0, msg: '查询失败: ' + e.message });
          }
        }
        // ========== 量化热度数据 ==========
        case 'gongshoudao-all': {
          // 批量获取所有比赛的功守道数据（一次请求替代 N 次单场 gongshoudao 调用）
          const requestDate = data.date || latestDataDate();

          // ★ P1: 5 分钟内存缓存
          const now = Date.now();
          if (_gsAllCache && _gsAllCache.date === requestDate && now - _gsAllCacheTime < CACHE_TTL_5MIN) {
            return res.json(_gsAllCache.response);
          }

          try {
            // ★ P1-2: 复用统一的 _gsGlobalCache，不再独立读磁盘
            const gsAll = getGsGlobalMap();

            // 读取 data.json 筛选当天比赛，按 matchId 返回缓存数据
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};

            const result = {};
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || !m.date || m.date.slice(0, 10) !== requestDate) return;
              const mid = m.matchId || k.replace(/^m_/, '');
              // 兼容多种缓存 key 格式（含/不含 m_ 前缀）
              result[mid] = gsAll[k] || gsAll['m_' + mid] || gsAll[mid] || null;
            });

            // ★ P1-2: 使用内存缓存时间戳替代磁盘 stat
            const gsCacheTime = _gsGlobalCacheTime ? new Date(_gsGlobalCacheTime).toISOString() : null;

            const response = { code: 1, data: { date: requestDate, gsData: result, gsCacheTime: gsCacheTime } };
            // ★ P1: 缓存结果（5 分钟）
            _gsAllCache = { date: requestDate, response };
            _gsAllCacheTime = now;
            return res.json(response);
          } catch (e) {
            return res.json({ code: 0, msg: '功守道批量获取失败: ' + e.message });
          }
        }

        // ========== 预测回测 ==========
        case 'prediction-backtest': {
          try {
            // ★ P1-3: 3 分钟响应缓存
            var _btCacheKey =
              'bt|' +
              (data.type || 'all') +
              '|' +
              (data.dateRange || 'all') +
              '|' +
              (data.league || 'all') +
              '|' +
              (data.direction || 'all') +
              '|' +
              (data.consensus || 'all') +
              '|' +
              (data.model || 'all') +
              '|dl' +
              (data.decisionLevel || 'all') +
              '|rl' +
              (data.riskLevel || 'all') +
              '|ev' +
              (data.evRange || 'all') +
              '|ct' +
              (data.conflictType || 'all') +
              '|at' +
              (data.attributionTag || 'all') +
              '|p' +
              (parseInt(data.page) || 1);
            var _btCached = getCachedResponse('prediction-backtest', _btCacheKey);
            if (_btCached) return res.json(_btCached);

            await predictionLog.asyncEnsure();
            const result = predictionLog.queryBacktest({
              type: data.type || 'all',
              dateRange: data.dateRange || 'all',
              league: data.league || 'all',
              direction: data.direction || 'all',
              aiConf: data.aiConf || 'all',
              pkConf: data.pkConf || 'all',
              consensus: data.consensus || 'all',
              model: data.model || 'all',
              decisionLevel: data.decisionLevel || 'all',
              riskLevel: data.riskLevel || 'all',
              evRange: data.evRange || 'all',
              conflictType: data.conflictType || 'all',
              attributionTag: data.attributionTag || 'all',
              page: parseInt(data.page) || 1,
              pageSize: parseInt(data.pageSize) || 20,
            });

            // ★ P1-4: 空数据时输出诊断信息
            if (!result.items || result.items.length === 0) {
              const totalAll = predictionLog.getTotalCount();
              logger.warn(
                '[bt] 回测查询返回空 | DB就绪=' +
                  predictionLog.isReady() +
                  ' | 有赛果总数=' +
                  totalAll +
                  ' | 筛选条件=' +
                  JSON.stringify({ type: data.type, dateRange: data.dateRange, direction: data.direction }),
              );
              if (!predictionLog.isReady()) {
                logger.warn('[bt] ⚠ 数据库未就绪，请检查 midou_data.db 初始化状态');
              }
              if (totalAll === 0) {
                logger.warn('[bt] ⚠ prediction_logs 表中无赛果记录，请运行: node server/backfill_prediction_logs.js');
              }
            }

            // Add league list and total count
            result.leagues = predictionLog.getLeagues();
            result.models = predictionLog.getModels();

            var _btResp = { code: 1, data: result };
            setCachedResponse('prediction-backtest', _btCacheKey, _btResp);
            return res.json(_btResp);
          } catch (e) {
            return res.json({ code: 0, msg: '回测查询失败: ' + e.message });
          }
        }

        // ========== 预测回测联赛列表 ==========
        case 'backtest-leagues': {
          try {
            await predictionLog.asyncEnsure();
            const leagues = predictionLog.getLeagues();
            const total = predictionLog.getTotalCount();
            return res.json({ code: 1, data: { leagues: leagues, total: total } });
          } catch (e) {
            return res.json({ code: 0, msg: e.message });
          }
        }

        // ========== PK 版本对比（pk_scorer v1.0 vs v2.0） ==========
        case 'pk-version-compare': {
          try {
            await predictionLog.asyncEnsure();
            const pk = require('./pk_scorer');
            const versions = data.versions || [];

            const compareData = predictionLog.queryPKVersionCompare({
              versions: versions,
              dateRange: data.dateRange || 'all',
              league: data.league || 'all',
            });

            return res.json({
              code: 1,
              data: compareData,
              currentVersion: pk.PK_SCORER_VERSION,
              msg: compareData.versions && compareData.versions.length > 0 ? '' : '暂无版本对比数据',
            });
          } catch (e) {
            return res.json({ code: 0, msg: 'PK版本对比失败: ' + e.message });
          }
        }

        // ========== 量化热度数据 ==========
        case 'quant-hot': {
          const requestDate = data.date || latestDataDate();

          // ★ P1: 5 分钟内存缓存
          const now2 = Date.now();
          if (_quantHotCache && _quantHotCache.date === requestDate && now2 - _quantHotCacheTime < CACHE_TTL_5MIN) {
            return res.json(_quantHotCache.response);
          }

          try {
            // ★ P1-2: 复用统一的 _gsGlobalCache，不再独立读磁盘
            const gsCacheMap = getGsGlobalMap();

            // 2) 读取 data.json → 筛选当天比赛
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};

            const matchList = [];
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || !m.date) return;
              if (m.date.slice(0, 10) !== requestDate) return;
              const mid = m.matchId || k.replace(/^m_/, '');
              const gs = gsCacheMap[k] || gsCacheMap['m_' + mid] || gsCacheMap[mid] || {};
              matchList.push({
                matchId: mid,
                num: m.num || '',
                rq: gs.crossRq !== undefined ? gs.crossRq : null,
                homePower: gs.homePower,
                guestPower: gs.guestPower,
              });
            });

            // 3) 调用热度计算
            const jczqChange = require('./jczq_change');
            const result = await jczqChange.computeHotData(requestDate, matchList);

            // ★Phase1: 从结果中取最晚的 _ts 作为热度数据更新时间
            let hotCacheTime = null;
            try {
              Object.keys(result).forEach(function (k) {
                const ts = result[k] && result[k]._ts;
                if (ts && (!hotCacheTime || ts > hotCacheTime)) hotCacheTime = ts;
              });
            } catch (e) {}
            // 如果 entry 中没有 _ts，回退到全量缓存文件的 mtime
            if (!hotCacheTime) {
              try {
                const changeCachePath = path.join(__dirname, 'jczq_change_cache.json');
                if (fs.existsSync(changeCachePath)) {
                  hotCacheTime = fs.statSync(changeCachePath).mtime.toISOString();
                }
              } catch (e) {}
            }

            const response = { code: 1, data: { date: requestDate, hotData: result, hotCacheTime: hotCacheTime } };
            // ★ P1: 缓存结果（5 分钟）
            _quantHotCache = { date: requestDate, response };
            _quantHotCacheTime = now2;
            return res.json(response);
          } catch (e) {
            return res.json({ code: 0, msg: '热度数据获取失败: ' + e.message });
          }
        }

        case 'ai-batch-generate': {
          const daemon = require('./ai_daemon');
          daemon.dailyBatch();
          return res.json({ code: 1, data: { message: 'AI批量生成已启动' } });
        }

        // ========== 今日方案列表 ==========
        case 'plan-list': {
          try {
            const dateStr = data.date || latestDataDate();
            const fs = require('fs');
            const path = require('path');

            // ★ 当日方案仅在下午 4 点后展示
            const today = localDate();
            if (dateStr === today) {
              const now = new Date();
              const hour = now.getHours();
              if (hour < 16) {
                return res.json({
                  code: 1,
                  data: { date: dateStr, plans: [], notice: '今日方案预计 16:00 后陆续更新', waitUntil: '16:00' },
                });
              }
            }

            // ★ P0-1: 响应缓存命中（10 分钟 TTL，data.json mtime 变更自动失效）
            const planCacheKey = dateStr;
            const planNow = Date.now();
            const planCacheEntry = _planListResponseCache[planCacheKey];
            if (planCacheEntry && _planListResponseTime[planCacheKey] &&
                planNow - _planListResponseTime[planCacheKey] < PLAN_LIST_CACHE_TTL) {
              return res.json(planCacheEntry);
            }

            // 1) 从 data.json 加载比赛和推荐
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const mList = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(applyPlanOutcomeOverlay(dateStr, m));
            });

            // 2) 工具函数
            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }
            function loadOddsFromFile(date, num) {
              const odds = getOddsHistory(date);
              return odds ? odds[num] || null : null;
            }

            // 预计算：一次获取所有比赛的 recs 和 odds，消除 N 次重复查找
            const matchDataMap = {};
            for (const m of mList) {
              const num = m.num || '';
              const key = m.matchId;
              const raw = rMap['m_' + key] || rMap[String(key)] || [];
              matchDataMap[key] = {
                match: m,
                recs: normalizeRecs(raw),
                odds: loadOddsFromFile(dateStr, num),
              };
            }

            // 3) 调用共享方案生成模块
            const PG = require('./core/plan-generator');
            const plans = PG.generateExpertPlans(mList, matchDataMap, dateStr);

            // ★ P0 Layer 5: 输出门禁 — 响应前校验比分/奖金/中奖状态
            var validatedPlans = validatePlanResponse(plans, dateStr);

            const planResp = { code: 1, data: { date: dateStr, plans: validatedPlans } };
            _planListResponseCache[planCacheKey] = planResp;
            _planListResponseTime[planCacheKey] = Date.now();
            return res.json(planResp);
          } catch (e) {
            return res.json({ code: 0, msg: '获取方案列表失败: ' + e.message });
          }
        }

        // ========== 比分方案列表 ==========
        case 'score-plan-list': {
          try {
            const dateStr = data.date || latestDataDate();
            const today = localDate();

            // ★ 当天方案在 12:00 前不展示
            if (dateStr === today) {
              const now = new Date();
              const hour = now.getHours();
              if (hour < 12) {
                return res.json({
                  code: 1,
                  data: { date: dateStr, plans: [], notice: '单关比分方案预计 12:00 后自动生成', waitUntil: '12:00' },
                });
              }
            }

            const fs = require('fs');
            const path = require('path');

            // 1) 加载功守道缓存
            let gsCacheMap = {};
            const gsCachePath = path.join(__dirname, 'gongshoudao', 'cache.json');
            try {
              if (fs.existsSync(gsCachePath)) {
                gsCacheMap = JSON.parse(fs.readFileSync(gsCachePath, 'utf8'))['_global'] || {};
              }
            } catch (e) {
              logger.warn('[score-plan] 功守道缓存读取失败: ' + e.message);
            }

            // 2) 加载 data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const mList = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (m && (m.date || '').slice(0, 10) === dateStr) {
                // 兼容缓存 key 格式
                const mid = m.matchId || k.replace(/^m_/, '');
                const cached = gsCacheMap[k] || gsCacheMap['m_' + mid] || gsCacheMap[mid] || null;
                mList.push({ match: applyPlanOutcomeOverlay(dateStr, m), gs: cached, matchId: mid });
              }
            });

            if (mList.length === 0) {
              return res.json({ code: 1, data: { date: dateStr, plans: [], notice: '今日暂无比赛数据' } });
            }

            // 3) 加载 BF 赔率
            const allplays = getAllplaysData();

            // 4) 荷兰式均分辅助函数（P2-方案七/八 + P0-方案二/三 + P1-方案六）
            function dutchCombinations(oddsMap, totalCapital, strongIsHome, useBfOdds, qual) {
              const scorePercentMap = (qual && qual.scorePercentMap) || null;
              const goalUpper = (qual && qual.goalUpper) || 0;
              const xgHome = (qual && qual.xgHome) || 0;
              const xgAway = (qual && qual.xgAway) || 0;
              const xgDiff = Math.abs(xgHome - xgAway);
              const totalStrength = (qual && qual.totalStrength) || 0;
              const absStrength = Math.abs(totalStrength);
              const strongXg = strongIsHome ? xgHome : xgAway;
              const weakXg = strongIsHome ? xgAway : xgHome;

              // ★ P2-方案七：强弱队进球模式分类
              let matchType = 'normal';
              if (absStrength > 0.25 && xgDiff > 1.2) {
                matchType = 'crush'; // 碾压型：弱队基本不进球
              } else if (absStrength > 0.2 && weakXg > 0.8) {
                matchType = 'attack-crush'; // 对攻碾压：弱队能还手1球
              } else if (absStrength <= 0.2 || xgDiff <= 1.0) {
                matchType = 'narrow'; // 险胜型：窄比分为主
              }

              // 筛选候选比分
              const preferred = [];
              const drawCandidates = []; // ★ P1-方案六：高比分平局
              const allCandidates = [];
              Object.keys(oddsMap).forEach(function (score) {
                const parts = score.split('-');
                if (parts.length !== 2) return;
                const h = parseInt(parts[0]),
                  a = parseInt(parts[1]);
                if (isNaN(h) || isNaN(a)) return;
                allCandidates.push(score);

                const strongWin = strongIsHome ? h - a >= 1 : a - h >= 1;
                if (strongWin) {
                  // ★ P2-方案七：根据进球模式筛选
                  if (matchType === 'crush') {
                    // 碾压型：弱队必须 0 球 (如 2-0/3-0/4-0)
                    if ((strongIsHome ? a : h) === 0) preferred.push(score);
                  } else if (matchType === 'narrow') {
                    // 险胜型：只取净胜 ≤2 的比分 (如 1-0/2-1/2-0)
                    if (Math.abs(h - a) <= 2) preferred.push(score);
                  } else {
                    // 对攻碾压/正常型：弱队最多进 1 球
                    if ((strongIsHome ? a : h) <= 1) preferred.push(score);
                  }
                }

                // ★ P1-方案六：高比分平局纳入（大球场景下 2-2/3-3 等）
                if (goalUpper >= 4 && h === a && h >= 2) {
                  drawCandidates.push(score);
                }
              });

              // 先用分类后的比分，不足2个则用全部比分
              const candidates = preferred.length >= 2 ? preferred.slice() : allCandidates.slice();
              // ★ P1-方案六：大球平局补充
              if (goalUpper >= 4 && drawCandidates.length > 0) {
                drawCandidates.forEach(function (ds) {
                  if (candidates.indexOf(ds) < 0) candidates.push(ds);
                });
              }
              if (candidates.length < 2) return [];

              // 按赔率从低到高排序
              candidates.sort(function (a, b) {
                return (oddsMap[a] || 100) - (oddsMap[b] || 100);
              });

              // 尝试 2~4 个比分的组合
              const results = [];
              function tryCombos(r, start, chosen) {
                if (chosen.length >= 2 && chosen.length <= 4) {
                  let invSum = 0;
                  let coverageSum = 0;
                  let hasDraw = false;
                  for (var i = 0; i < chosen.length; i++) {
                    const odd = oddsMap[chosen[i]];
                    if (!odd || odd <= 0) return;
                    invSum += 1 / odd;
                    // ★ P0-方案二：覆盖率计算
                    if (useBfOdds) {
                      coverageSum += 1 / odd; // 真实赔率的隐含概率
                    } else if (scorePercentMap && typeof scorePercentMap[chosen[i]] !== 'undefined') {
                      coverageSum += parseFloat(scorePercentMap[chosen[i]]) || 0;
                    }
                    const parts2 = chosen[i].split('-');
                    if (parts2[0] === parts2[1]) hasDraw = true;
                  }
                  if (invSum > 0) {
                    // ★ P3: 使用衰减后权重分配的回报为 adjInvSum 对应值，此处为基准预期回报
                    const baseExpectedReturn = totalCapital / invSum;

                    // ★ P0-方案三：虚拟赔率分级下限（按覆盖比分数量）
                    let minR;
                    if (useBfOdds) {
                      minR = 1.8;
                    } else {
                      if (chosen.length === 2) minR = 2.0;
                      else if (chosen.length === 3) minR = 1.6;
                      else minR = 1.4; // 4 个比分
                    }

                    // ★ P0-方案二：覆盖率检查
                    const minCoverage = useBfOdds ? 0.3 : 25;
                    if (coverageSum < minCoverage) return;

                    // ★ P1-方案六：平局衰减→回报率要求提高10%
                    const effectiveMinR = hasDraw ? minR * 1.1 : minR;

                    if (
                      baseExpectedReturn >= totalCapital * effectiveMinR &&
                      baseExpectedReturn <= totalCapital * 2.5
                    ) {
                      const combo = chosen.slice();
                      // 计算带衰减的资金分配权重
                      const weights = [];
                      for (let j = 0; j < combo.length; j++) {
                        const o2 = oddsMap[combo[j]];
                        let w = 1 / o2;
                        // ★ P1-方案六：平局比分资金分配衰减到80%
                        const parts3 = combo[j].split('-');
                        if (parts3[0] === parts3[1] && goalUpper >= 4) {
                          w *= 0.8;
                        }
                        weights.push(w);
                      }
                      const adjInvSum = weights.reduce(function (a, b) {
                        return a + b;
                      }, 0);
                      const allocations = [];
                      for (let k = 0; k < combo.length; k++) {
                        allocations.push(Math.round((totalCapital * weights[k]) / adjInvSum));
                      }
                      // 微调使总和等于 totalCapital
                      const allocSum = allocations.reduce(function (a, b) {
                        return a + b;
                      }, 0);
                      if (allocSum !== totalCapital) {
                        allocations[allocations.length - 1] += totalCapital - allocSum;
                      }

                      // ★ P2-方案八：综合评分 = 覆盖率×0.5 + 回报率×0.5
                      const coverageNorm = useBfOdds ? Math.min(1, coverageSum / 0.5) : Math.min(1, coverageSum / 40);
                      const returnNorm = Math.min(
                        1,
                        (baseExpectedReturn / totalCapital - effectiveMinR) / (2.5 - effectiveMinR),
                      );
                      const compositeScore = coverageNorm * 0.5 + returnNorm * 0.5;

                      results.push({
                        scores: combo.map(function (s, si) {
                          return { score: s, odds: oddsMap[s], allocation: allocations[si] };
                        }),
                        // ★ P3: 更名为 baseExpectedReturn 以区分衰减后实际回报
                        baseExpectedReturn: Math.round(baseExpectedReturn),
                        comboLength: combo.length,
                        coverage: coverageSum,
                        compositeScore: compositeScore,
                        matchType: matchType,
                      });
                    }
                  }
                }
                if (r <= 0 || chosen.length >= 4) return;
                for (var i = start; i < candidates.length; i++) {
                  chosen.push(candidates[i]);
                  tryCombos(r - 1, i + 1, chosen);
                  chosen.pop();
                }
              }
              tryCombos(candidates.length, 0, []);

              // ★ P2-方案八：综合评分排序（覆盖率×回报率），替代固定长度优先级
              results.sort(function (a, b) {
                if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
                // 评分相同：3比分 > 2比分 > 4比分
                const orderA = a.comboLength === 3 ? 0 : a.comboLength === 2 ? 1 : 2;
                const orderB = b.comboLength === 3 ? 0 : b.comboLength === 2 ? 1 : 2;
                return orderA - orderB;
              });
              return results;
            }

            // ★ P0: 共识类型解析（优先 fusionConsensusType，降级中文标签映射）
            function resolveConsensusType(gs) {
              const ct = gs.fusionConsensusType;
              if (ct === 'strong' || ct === 'weak' || ct === 'meltdown') return ct;
              const cn = gs.fusionConsensus || '';
              if (cn.startsWith('熔断')) return 'meltdown';
              if (cn.startsWith('弱一致')) return 'weak';
              if (cn.startsWith('强一致')) return 'strong';
              return '';
            }

            // 5) 筛选规则（★ P0-方案一：共识状态门禁）
            function qualifyMatch(item) {
              const gs = item.gs;
              if (!gs) return false;

              // ★ P0-方案一：共识状态门禁（resolveConsensusType 兼容中英文）
              const consensus = resolveConsensusType(gs);
              if (consensus === 'meltdown') return false; // 四重熔断，比分预测完全不可信
              const weakThreshold = consensus === 'weak';
              const stabilityOverall = parseFloat(gs.stabilityOverall) || 0;

              // 规则1: 大球方向
              const bigBallRatio = parseFloat(gs.bigBallRatio) || 0;
              const overRate = gs.goalRange && gs.goalRange.overRate ? parseFloat(gs.goalRange.overRate) : 0;
              const totalExpect = parseFloat(gs.totalGoalsExpect) || 0;
              const isOver = bigBallRatio > 30 || overRate > 35 || totalExpect >= 2.0;
              if (!isOver) return false;

              // 规则2: 攻防同向极化（进攻强的一方防守强，进攻弱的一方防守差）
              const attRaw = parseFloat(gs.attackAdvantageRaw) || 0;
              const defRaw = parseFloat(gs.defenseAdvantageRaw) || 0;
              if (attRaw * defRaw <= 0) return false; // 攻防方向必须一致

              const attAbs = Math.abs(attRaw),
                defAbs = Math.abs(defRaw);
              if (attAbs <= 0.03 || defAbs <= 0.005) return false; // 极化强度不足

              const strongIsHome = attRaw > 0;

              // 规则3: 进球差异 ≥0.6球
              const xgHome = parseFloat(gs.xgHome) || 0;
              const xgAway = parseFloat(gs.xgAway) || 0;
              const xgDiff = Math.abs(xgHome - xgAway);
              if (xgDiff < 0.6) return false;

              // ★ P0-方案一：弱一致提门槛 → 稳定性≥55 且 xgDiff≥1.0
              if (weakThreshold && (stabilityOverall < 55 || xgDiff < 1.0)) return false;

              // 规则4: 弱队进球能力 ≤1.5
              const weakXg = strongIsHome ? xgAway : xgHome;
              if (weakXg > 1.5) return false;

              return {
                strongIsHome: strongIsHome,
                bigBallRatio: bigBallRatio,
                xgHome: xgHome,
                xgAway: xgAway,
                consensus: consensus,
                stabilityOverall: stabilityOverall,
                attRaw: attRaw,
                defRaw: defRaw,
                totalExpect: totalExpect,
              };
            }

            // 6) 遍历比赛，收集候选方案（★ P1-方案四：多维质量分 + ★ P0-方案三：分级下限）
            // ★ P1-方案四：提前构建概率映射备用
            function buildScorePercentMap(gs) {
              if (!gs || !gs.scores || gs.scores.length === 0) return null;
              const map = {};
              gs.scores.forEach(function (s) {
                if (s && s.score && typeof s.percent !== 'undefined') {
                  map[s.score] = parseFloat(s.percent) || 0;
                }
              });
              return Object.keys(map).length > 0 ? map : null;
            }

            const allCandidates = [];
            for (let mi = 0; mi < mList.length; mi++) {
              var item = mList[mi];
              const qual = qualifyMatch(item);
              if (!qual) continue;

              // 获取比分赔率
              const matchDate = (item.match.date || '').slice(0, 10);
              const matchNum = item.match.num || '';
              var bfOdds = getScoreOdds(allplays, matchDate, matchNum);
              const useBfOdds = !!bfOdds;

              // 如果BF赔率不可用，用概率反推
              if (!bfOdds && item.gs && item.gs.scores && item.gs.scores.length > 0) {
                bfOdds = {};
                item.gs.scores.forEach(function (s) {
                  if (!s || !s.score || !s.percent) return;
                  const pct = parseFloat(s.percent) || 0;
                  if (pct > 0) bfOdds[s.score] = Math.round((100 / pct) * 100) / 100;
                });
                // 比分不足4个时，根据已有比分扩展邻近比分
                var existingKeys = Object.keys(bfOdds);
                if (existingKeys.length < 4) {
                  var expandScores = [];
                  existingKeys.forEach(function (sc) {
                    const p = sc.split('-');
                    const h = parseInt(p[0]),
                      a = parseInt(p[1]);
                    if (isNaN(h) || isNaN(a)) return;
                    const variants = [
                      // ±1 变体
                      h + 1 + '-' + a,
                      h + '-' + (a + 1),
                      h + 1 + '-' + (a > 0 ? a - 1 : 0),
                      (h > 0 ? h - 1 : 0) + '-' + (a + 1),
                      (h > 0 ? h - 1 : 0) + '-' + a,
                      h + '-' + (a > 0 ? a - 1 : 0),
                      // ±2 变体（P2 扩展，提升赔率覆盖）
                      h + 2 + '-' + a,
                      h + '-' + (a + 2),
                      h + 2 + '-' + (a + 1),
                      h + 1 + '-' + (a + 2),
                    ];
                    variants.forEach(function (v) {
                      if (expandScores.indexOf(v) < 0 && existingKeys.indexOf(v) < 0) {
                        expandScores.push(v);
                      }
                    });
                  });
                  expandScores.forEach(function (es) {
                    if (!bfOdds[es]) {
                      let minPct = 100;
                      item.gs.scores.forEach(function (s) {
                        const p = parseFloat(s.percent) || 100;
                        if (p < minPct) minPct = p;
                      });
                      const estPct = Math.max(1, minPct * 0.3);
                      bfOdds[es] = Math.round((100 / estPct) * 100) / 100;
                    }
                  });
                }
              }
              if (!bfOdds || Object.keys(bfOdds).length === 0) continue;

              // ★ 构建 qual 对象传给 dutchCombinations
              const scorePercentMap = buildScorePercentMap(item.gs);
              let goalUpper = 0;
              if (item.gs.goalRange && item.gs.goalRange.upper) {
                goalUpper = parseInt(item.gs.goalRange.upper) || 0;
              } else if (item.gs.goalRange && item.gs.goalRange.range) {
                // 兼容 "2-4球" 格式
                const grParts = String(item.gs.goalRange.range).split('-');
                if (grParts.length >= 2) goalUpper = parseInt(grParts[1]) || 0;
              }
              const dutchQual = {
                scorePercentMap: scorePercentMap,
                goalUpper: goalUpper,
                xgHome: qual.xgHome,
                xgAway: qual.xgAway,
                totalStrength: parseFloat(item.gs.totalStrength) || 0,
              };

              const combos = dutchCombinations(bfOdds, 1000, qual.strongIsHome, useBfOdds, dutchQual);
              if (combos.length === 0) continue;

              // ★ P1-方案四：多维比分质量分（在push前计算，用于最终排序）
              const qs = computeScoreQuality(item.gs, qual);
              allCandidates.push({
                match: item.match,
                gs: item.gs,
                matchId: item.matchId,
                strongIsHome: qual.strongIsHome,
                bigBallRatio: qual.bigBallRatio,
                xgHome: qual.xgHome,
                xgAway: qual.xgAway,
                consensus: qual.consensus,
                stabilityOverall: qual.stabilityOverall,
                qualityScore: qs,
                bestCombo: combos[0], // ★ P2-方案八：combos已按综合评分排序
              });
            }

            // ★ P1-方案四 + P1-方案五：多维质量分排序 + 动态方案数量
            function computeScoreQuality(gs, qual) {
              let score = 0;

              // 大球信号 (25分)
              const bigBallRatio = parseFloat(gs.bigBallRatio) || 0;
              score += Math.min(25, bigBallRatio / 4);

              // xG差距 (25分)
              const xgDiff = Math.abs(qual.xgHome - qual.xgAway);
              score += Math.min(25, (xgDiff / 2.0) * 25);

              // 进球稳定性 (20分)
              const stability = parseFloat(gs.stabilityOverall) || 0;
              score += Math.min(20, stability / 5);

              // 共识强度 (20分) — resolveConsensusType 兼容中英文
              const consensus = resolveConsensusType(gs);
              if (consensus === 'strong') score += 20;
              else if (consensus === 'weak') score += 10;
              else if (consensus === 'none' || !consensus) score += 5;

              // 联赛校准 (10分)
              const leagueGoals = parseFloat(gs.leagueAvgGoals) || 0;
              if (leagueGoals > 2.85) score += 10;
              else if (leagueGoals > 2.5) score += 5;

              return Math.min(100, Math.round(score));
            }

            // 按质量分降序排序
            allCandidates.sort(function (a, b) {
              return b.qualityScore - a.qualityScore;
            });

            // ★ P1-方案五：动态方案数量（质量分阈值决定 0~3 个）
            let topCount = 0;
            if (allCandidates.length > 0 && allCandidates[0].qualityScore >= 45) topCount = 1;
            if (allCandidates.length >= 2 && allCandidates[1].qualityScore >= 50) topCount = 2;
            if (
              allCandidates.length >= 3 &&
              allCandidates[2].qualityScore >= 45 &&
              allCandidates[2].bestCombo &&
              (allCandidates[2].bestCombo.coverage || 0) >= 0.25
            )
              topCount = 3;
            // 无高质量候选则不输出
            if (topCount === 0 && allCandidates.length >= 1 && allCandidates[0].qualityScore < 45) topCount = 0;
            const topCandidates = allCandidates.slice(0, Math.max(0, topCount));

            // 7) 构建方案输出（★ 新增 qualityScore、consensus、matchType 字段）
            const plans = topCandidates.map(function (c, idx) {
              const match = c.match;
              const strongSide = c.strongIsHome ? 'home' : 'away';
              const combo = c.bestCombo;

              // 进攻优势格式化
              const attRaw = parseFloat(c.gs.attackAdvantageRaw) || 0;
              const attDisplay = attRaw > 0 ? '+' + Math.round(attRaw * 100) + '%' : Math.round(attRaw * 100) + '%';

              // 赔率组合显示
              const oddsDisplay = combo.scores
                .map(function (s) {
                  return s.odds.toFixed(2);
                })
                .join('/');

              // 进球区间
              const goalRange = c.gs.goalRange && c.gs.goalRange.range ? c.gs.goalRange.range : '2-4球';

              // 共识中文标签
              const consensus = c.consensus || '';
              const consensusLabel = consensus === 'strong' ? '强一致' : consensus === 'weak' ? '弱一致' : '未融合';

              // ★ 中奖判定：对比实际比分
              const rawScore = (match.score || '').replace(/:/g, '-');
              let isScoreWon = false,
                isScoreLose = false,
                winAlloc = 0,
                winOdds = 0;
              if (rawScore) {
                for (let si2 = 0; si2 < combo.scores.length; si2++) {
                  if (combo.scores[si2].score === rawScore) {
                    isScoreWon = true;
                    winAlloc = combo.scores[si2].allocation || 0;
                    winOdds = combo.scores[si2].odds || 0;
                    break;
                  }
                }
                isScoreLose = !isScoreWon;
              }
              const winningPrize = isScoreWon ? Math.round(winAlloc * winOdds) : 0;

              // ★ 已出结果的比赛带上实际比分
              var actualScore = '';
              if (isScoreWon || isScoreLose) {
                actualScore = (match.score || '').replace(/:/g, '-');
              }

              return {
                planId: 'score_plan_' + dateStr + '_' + (idx + 1),
                planName: '单关比分方案 ' + (idx + 1),
                matchId: c.matchId,
                matchNum: match.num || '',
                homeName: match.homeName || '',
                visitName: match.visitName || '',
                leagueName: match.leagueName || '',
                startTime: match.startTime || '',
                actualScore: actualScore,
                strongSide: strongSide,
                selectedScores: combo.scores,
                totalCapital: 1000,
                expectedReturn: combo.baseExpectedReturn,
                bigBallRatio: c.bigBallRatio.toFixed(1),
                attackAdvantage: attDisplay,
                goalRange: goalRange,
                playType: '单场比分',
                passType: '比分单关',
                betCount: 250,
                ticketCount: 10,
                multiplier: 1,
                oddsDisplay: oddsDisplay,
                amount: 1000,
                matchCount: 1,
                maxPrize: combo.baseExpectedReturn,
                // ★ 中奖判定字段
                isScoreWon: isScoreWon,
                isScoreLose: isScoreLose,
                winningPrize: winningPrize,
                // ★ 新增字段
                qualityScore: c.qualityScore,
                consensusLabel: consensusLabel,
                matchType: combo.matchType || 'normal',
                coverage: combo.coverage || 0,
                compositeScore: combo.compositeScore || 0,
                stabilityOverall: c.stabilityOverall ? c.stabilityOverall.toFixed(0) : '',
              };
            });

            var notice = '';
            if (plans.length === 0) {
              if (allCandidates.length === 0) {
                notice = '今日暂无符合条件的单关比分方案';
              } else {
                notice = '候选场次质量分不足（最高: ' + allCandidates[0].qualityScore + '/100），已自动跳过';
              }
            }

            // ★ P0 Layer 5: 输出门禁
            var validatedPlans = validatePlanResponse(plans, dateStr);
            return res.json({ code: 1, data: { date: dateStr, plans: validatedPlans, notice: notice } });
          } catch (e) {
            logger.error('[score-plan-list] ' + e.message);
            return res.json({ code: 0, msg: '获取比分方案失败: ' + e.message });
          }
        }

        // ========== 量化方案列表（搏冷 2串1） ==========
        case 'quant-plan-list': {
          try {
            const dateStr = data.date || latestDataDate();
            const today = localDate();

            // ★ P1-1: 10 分钟响应缓存（计算最密集的端点）
            const qpNow = Date.now();
            const qpCached = _quantPlanCache[dateStr];
            if (qpCached && qpNow - qpCached.time < CACHE_TTL_10MIN) {
              return res.json(qpCached.response);
            }

            // ★ 当天方案在 18:00 前不展示
            if (dateStr === today) {
              const now = new Date();
              const hour = now.getHours();
              if (hour < 18) {
                return res.json({
                  code: 1,
                  data: { date: dateStr, plans: [], notice: '量化博冷方案预计 18:00 后自动生成' },
                });
              }
            }

            // 1) 加载 data.json 比赛列表
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const mList = [];
            Object.keys(mMap).forEach((k) => {
              const m = mMap[k];
              if (m && (m.date || '').slice(0, 10) === dateStr) mList.push(applyPlanOutcomeOverlay(dateStr, m));
            });

            if (mList.length === 0) {
              return res.json({ code: 1, data: { date: dateStr, plans: [], notice: '今日暂无比赛数据' } });
            }

            // 2) 加载 jczq_change 缓存（获取 heatIndex）
            let changeCache = {};
            const changeCachePath = path.join(__dirname, 'jczq_change_cache.json');
            try {
              if (fs.existsSync(changeCachePath)) {
                changeCache = JSON.parse(fs.readFileSync(changeCachePath, 'utf8')) || {};
              }
            } catch (e) {
              logger.warn('[quant-plan] jczq_change 缓存读取失败: ' + e.message);
            }
            const changeDate = changeCache[dateStr] || {};

            // 3) 加载功守道缓存（获取 fusionConsensus、totalStrength）
            // ★ P1-2: 复用统一的 _gsGlobalCache，不再独立读磁盘
            const gsCacheMap = getGsGlobalMap();

            // 4) 加载 SPF 赔率
            const od = getOddsHistory(dateStr) || {};
            const allplays = getAllplaysData();

            // 辅助：获取比赛赔率
            function getMatchOdds(m) {
              const num = m.num || '';
              if (od[num]) return od[num];
              const ap = allplays || {};
              const k = 'num_' + num;
              if (ap[k]) return ap[k];
              if (m.matchId && ap[m.matchId]) return ap[m.matchId];
              return null;
            }

            // ★ 辅助：计算比赛命中/未命中结果（复用专家方案逻辑）
            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }
            function computeMatchResult(matchId, direction) {
              const key = matchId;
              const raw = rMap['m_' + key] || rMap[String(key)] || [];
              const recs = normalizeRecs(raw);

              let isMatchWon = null,
                isMatchLose = null;
              const subResults = [];
              const matchedRecsSet = new Set();

              // 子方向拆分（处理"胜平"等双选）
              let effectiveDir = direction;
              if (direction === '胜平') effectiveDir = '胜、平';
              else if (direction === '平负') effectiveDir = '平、负';
              const subDirs = effectiveDir.split(/[、,]/);

              function recContains(recType, sd) {
                if (recType === sd) return true;
                const parts = recType.split(/[、,]/);
                return parts.some(function (p) {
                  return p.trim() === sd;
                });
              }

              for (let si = 0; si < subDirs.length; si++) {
                const sd = subDirs[si].trim();
                let found = null;
                // 精确匹配
                for (let ri = 0; ri < recs.length; ri++) {
                  if (recs[ri].type === sd) {
                    found = recs[ri];
                    break;
                  }
                }
                // 组合类型包含子方向
                if (!found) {
                  for (let rj = 0; rj < recs.length; rj++) {
                    if (recContains(recs[rj].type, sd)) {
                      found = recs[rj];
                      break;
                    }
                  }
                }
                if (found) matchedRecsSet.add(found);
                subResults.push({ direction: sd, result: found ? found.result : null });
              }

              // 全方向模糊匹配兜底
              if (matchedRecsSet.size === 0) {
                for (let rk = 0; rk < recs.length; rk++) {
                  const rt = recs[rk].type || '';
                  if (rt.indexOf(direction) >= 0 || direction.indexOf(rt) >= 0) {
                    matchedRecsSet.add(recs[rk]);
                  }
                }
                if (matchedRecsSet.size === 0 && subResults.length === 0) {
                  subResults.push({ direction: direction, result: null });
                }
              }

              const matchedArray = Array.from(matchedRecsSet);
              let anyWon = false,
                anyLose = false,
                anyUnknown = false;
              for (let mi = 0; mi < matchedArray.length; mi++) {
                if (matchedArray[mi].result === 1) anyWon = true;
                else if (matchedArray[mi].result === 0) anyLose = true;
                else anyUnknown = true;
              }
              if (!anyUnknown && matchedArray.length > 0) {
                isMatchWon = anyWon;
                isMatchLose = !anyWon && anyLose;
              }

              // ★ fallback: 推荐数据无 result 时，用比分+赔率直判方向对错
              if (isMatchWon === null && isMatchLose === null) {
                const matchKey2 = 'm_' + String(key);
                const mForScore = mMap[matchKey2] || mMap[String(key)] || null;
                if (mForScore && mForScore.matchStatus >= 1 && mForScore.score) {
                  const scoreParts = String(mForScore.score).replace(/[-:]/g, ':').split(':');
                  const hg = parseInt(scoreParts[0]);
                  const ag = parseInt(scoreParts[1]);
                  if (!isNaN(hg) && !isNaN(ag)) {
                    const moddsForFallback = getMatchOdds(mForScore);
                    const hcp = moddsForFallback && moddsForFallback.rqspf ? moddsForFallback.rqspf.handicap : null;
                    // 内联比分判定
                    function judgeScore(d, s, h) {
                      // ★ 复合方向（含、号，如"平、让平"）：分开判定，任一命中即可
                      if (d.indexOf('、') >= 0) {
                        var parts = d.split(/[、,]/);
                        for (var pi = 0; pi < parts.length; pi++) {
                          if (judgeScore(parts[pi].trim(), s, h)) return true;
                        }
                        return false;
                      }
                      var p = String(s).replace(/[-:]/g, ':').split(':');
                      var hh = parseInt(p[0]);
                      var aa = parseInt(p[1]);
                      if (isNaN(hh) || isNaN(aa)) return null;
                      if (d === '胜') return hh > aa;
                      if (d === '平') return hh === aa;
                      if (d === '负') return hh < aa;
                      if (d === '胜平') return hh > aa || hh === aa;
                      if (d === '平负') return hh === aa || hh < aa;
                      if (d === '让胜' || d === '让平' || d === '让负') {
                        var ec = hh + (h != null ? parseFloat(h) || 0 : 0);
                        if (d === '让胜') return ec > aa;
                        if (d === '让平') return ec === aa;
                        if (d === '让负') return ec < aa;
                      }
                      var gm = d.match(/总进球-(\d+)/);
                      if (gm) return hh + aa === parseInt(gm[1]);
                      // ★ 总进球复合方向子项（如 "3球"、"4球" — "总进球-2、3球" 拆分后）
                      var simpleGoal = d.match(/^(\d+)球$/);
                      if (simpleGoal) return hh + aa === parseInt(simpleGoal[1]);
                      // ★ 半全场方向（如 "半全场-平平" → 仅判定全场部分的平/胜/负）
                      var hfMatch = d.match(/^半全场-(.+)$/);
                      if (hfMatch) {
                        var fullChar = hfMatch[1].slice(-1);
                        if (fullChar === '胜') return hh > aa;
                        if (fullChar === '平') return hh === aa;
                        if (fullChar === '负') return hh < aa;
                        return null;
                      }
                      return null;
                    }
                    var scoreResult = judgeScore(direction, mForScore.score, hcp);
                    if (scoreResult !== null) {
                      isMatchWon = scoreResult;
                      isMatchLose = !scoreResult;
                      // 同步更新 subResults — 直接用 isMatchWon 确保一致
                      for (var sri = 0; sri < subResults.length; sri++) {
                        var sd = subResults[sri].direction;
                        var sr = judgeScore(sd, mForScore.score, hcp);
                        if (sr !== null) {
                          subResults[sri].result = sr ? 1 : 0;
                        } else if (sd === direction || sd.indexOf(direction) >= 0 || direction.indexOf(sd) >= 0) {
                          // judgeScore 返回 null 时用主方向结果兜底
                          subResults[sri].result = isMatchWon ? 1 : 0;
                        }
                      }
                    }
                  }
                }
              }

              // ★ 最终兜底：isMatchWon 已确定但 subResults 仍有 null 时同步
              if (isMatchWon !== null && isMatchLose !== null) {
                for (var sri2 = 0; sri2 < subResults.length; sri2++) {
                  if (subResults[sri2].result === null || subResults[sri2].result === undefined) {
                    subResults[sri2].result = isMatchWon ? 1 : 0;
                  }
                }
              }

              // ★ 最终兜底：isMatchWon 已确定但 subResults 仍有 null 时同步
              if (isMatchWon !== null && isMatchLose !== null) {
                // 方案六三方向进球：若缺少比分无法拆分具体命中进球数，不强制全部标红
                var isPlan6Multi = direction.indexOf('总进球-') === 0 && direction.indexOf('、') > 0;
                for (var sri3 = 0; sri3 < subResults.length; sri3++) {
                  if (subResults[sri3].result === null || subResults[sri3].result === undefined) {
                    if (isPlan6Multi && isMatchWon && (!m.score || m.score === '')) {
                      // 缺少比分数据，无法确定具体哪个进球命中，保留 null（前端显示白色/待定）
                      subResults[sri3].result = null;
                    } else {
                      subResults[sri3].result = isMatchWon ? 1 : 0;
                    }
                  }
                }
              }

              return { isMatchWon: isMatchWon, isMatchLose: isMatchLose, subResults: subResults };
            }

            // ==================== P0-方案一：冷门方向验证 ====================
            // 不再纯赔率驱动，结合模型信号（实力/共识）做交叉验证
            function getColdDirectionWithValidation(modds, gs) {
              if (!modds || !modds.spf) return null;
              const spf = modds.spf;
              const hOdds = spf.home != null ? parseFloat(spf.home) : 0;
              const dOdds = spf.draw != null ? parseFloat(spf.draw) : 0;
              const aOdds = spf.away != null ? parseFloat(spf.away) : 0;
              if (!hOdds || !dOdds || !aOdds) return null;

              const directions = [
                { dir: '胜', odds: hOdds, signal: 0 },
                { dir: '平', odds: dOdds, signal: 0 },
                { dir: '负', odds: aOdds, signal: 0 },
              ];

              const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
              const consensus = gs ? gs.fusionConsensus || '' : '';

              // 信号1: 实力均衡 → 利好平局方向（|totalStrength| < 0.15）
              if (Math.abs(totalStrength) < 0.15) {
                directions.forEach(function (d) {
                  if (d.dir === '平') d.signal += 2.5;
                });
              }

              // 信号2: 弱一致 → 模型不确定 → 利好任何冷门方向
              if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) {
                directions.forEach(function (d) {
                  d.signal += 1.5;
                });
              }
              // 熔断加分保守（模型打架但不一定利好特定方向）
              if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) {
                directions.forEach(function (d) {
                  d.signal += 0.5;
                });
              }

              // 信号3: 赔率最高方的隐含概率低但实力差距不大 → 市场过度低估
              // 此时赔率最高方向获得额外加成
              directions.sort(function (a, b) {
                return b.odds - a.odds;
              });
              const highestDir = directions[0];
              const impliedProb = 1 / highestDir.odds;
              const strengthGap = Math.abs(totalStrength);
              if (strengthGap < 0.2 && impliedProb < 0.15) {
                highestDir.signal += 2.0;
              }
              if (strengthGap < 0.1 && highestDir.dir !== '平') {
                highestDir.signal += 1.0; // 实力极接近但赔率没反映，定价偏差
              }

              // 综合评分: 0.6 × 赔率排名分 + 0.4 × 模型信号分
              // 赔率排名分: 赔率最高=3, 第二=2, 最低=1
              directions.sort(function (a, b) {
                return b.odds - a.odds;
              });
              const oddsRankScore = [3, 2, 1];
              directions.forEach(function (d, i) {
                d.finalScore = oddsRankScore[i] * 0.6 + d.signal * 0.4;
              });

              directions.sort(function (a, b) {
                return b.finalScore - a.finalScore;
              });
              return directions[0];
            }

            // ==================== P0-方案二：多维冷门评分 ====================
            function computeColdScore(hi, gs, modds, coldDir) {
              let score = 0;
              const totalStrength = gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0;
              const consensus = gs ? gs.fusionConsensus || '' : '';

              // 因子1: 热度反转（weight 30%）— 越冷分越高
              if (hi !== null && hi !== undefined) {
                const heatFactor = Math.max(0, (0.85 - hi) / 0.85) * 30;
                score += heatFactor;
              } else {
                score += 15; // 无热度数据给中等分
              }

              // 因子2: 实力均衡度（weight 25%）— 越均衡越容易出冷
              const tsAbs = Math.abs(totalStrength);
              const balanceFactor = Math.max(0, (0.3 - tsAbs) / 0.3) * 25;
              score += balanceFactor;

              // 因子3: 模型不确定性（weight 20%）— 模型打架/不确定是冷门信号
              if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) score += 15;
              if (consensus.indexOf('meltdown') >= 0 || consensus.indexOf('熔断') >= 0) score += 5;
              if (!consensus) score += 8; // 未融合说明数据不充分

              // 因子4: 赔率价值（weight 15%）— 冷门方向隐含概率 10~25% 为甜区
              const coldImplied = 1 / coldDir.odds;
              if (coldImplied >= 0.1 && coldImplied <= 0.25) {
                score += 12;
              } else if (coldImplied > 0.25 && coldImplied <= 0.35) {
                score += 7;
              } else if (coldImplied > 0.08 && coldImplied < 0.1) {
                score += 5;
              } else {
                score += 2; // 太离谱或太可能都不加分
              }

              // 因子5: 大市场共识（weight 10%）— 非强一致有不确定性空间
              if (consensus.indexOf('strong') >= 0 || consensus.indexOf('强') >= 0) {
                score += 0;
              } else {
                score += 5;
              }

              return Math.min(100, Math.round(score));
            }

            // ==================== P2-方案四：组合相关性检测 ====================
            function checkCorrelation(a, b) {
              const warnings = [];
              // 同一联赛
              const leagueA = (a.match.leagueName || '').trim();
              const leagueB = (b.match.leagueName || '').trim();
              if (leagueA && leagueB && leagueA === leagueB) {
                warnings.push('同联赛');
              }

              // 开球时间接近（< 1.5小时）
              const timeA = parseKickoffTime(a.match.startTime);
              const timeB = parseKickoffTime(b.match.startTime);
              if (timeA && timeB && Math.abs(timeA - timeB) < 5400000) {
                warnings.push('开球时间接近');
              }

              // 同一球队（主-主、客-客、主-客 匹配）
              const homeA = (a.match.homeName || '').trim();
              const awayA = (a.match.visitName || '').trim();
              const homeB = (b.match.homeName || '').trim();
              const awayB = (b.match.visitName || '').trim();
              if (homeA && homeB && (homeA === homeB || homeA === awayB || awayA === homeB || awayA === awayB)) {
                warnings.push('同一球队');
              }

              const riskLevel = warnings.length >= 2 ? 'high' : warnings.length === 1 ? 'medium' : 'low';
              return { riskLevel: riskLevel, warnings: warnings };
            }

            function parseKickoffTime(startTime) {
              if (!startTime) return null;
              try {
                const ts = new Date(startTime.replace('T', ' ')).getTime();
                return isNaN(ts) ? null : ts;
              } catch (e) {
                return null;
              }
            }

            // ==================== 主流程：筛选冷门场次 ====================
            const hasChangeData = Object.keys(changeDate).length > 0;
            const MIN_COLD_SCORE = hasChangeData ? 40 : 35; // P1-方案三：单场最低冷门分（无热度降级放宽）
            const MIN_PLAN_AVG_SCORE = hasChangeData ? 45 : 40; // P1-方案三：方案最低平均冷门分（无热度降级放宽）

            const coldCandidates = [];

            for (let i = 0; i < mList.length; i++) {
              var m = mList[i];
              const mid = m.matchId;

              // 获取功守道数据
              let gs = gsCacheMap['m_' + mid] || gsCacheMap[mid] || null;
              const consensus = gs ? gs.fusionConsensus || '' : '';

              // 获取赔率
              const modds = getMatchOdds(m);
              const spf = modds && modds.spf ? modds.spf : null;
              if (!spf || spf.home == null || spf.draw == null || spf.away == null) continue;

              // ===== P0-方案一：冷门方向验证 =====
              const coldDirResult = getColdDirectionWithValidation(modds, gs);
              const coldDir = coldDirResult;
              // 保留原始赔率排名供展示
              const rawDirections = [
                { dir: '胜', odds: parseFloat(spf.home) },
                { dir: '平', odds: parseFloat(spf.draw) },
                { dir: '负', odds: parseFloat(spf.away) },
              ].sort(function (a, b) {
                return b.odds - a.odds;
              });

              const changeEntry = changeDate[mid];
              let hi =
                changeEntry && changeEntry.heatIndex !== null && changeEntry.heatIndex !== undefined
                  ? changeEntry.heatIndex
                  : null;

              // 熔断场始终排除（无论有无热度数据）
              if (consensus.indexOf('熔断') >= 0 || consensus === 'meltdown') continue;

              if (hasChangeData) {
                // 有热度数据：用热度做初筛（保留硬阈值但只做粗筛，精筛靠多维评分）
                if (hi === null) continue;
                if (hi >= 1.4) continue;
                if (hi >= 0.85) continue;
              } else {
                // ===== P1-方案五：无热度数据降级增强 =====
                // 用赔率推导冷门可能性 + 共识状态过滤，替代原全纳入策略
                // ★ V9.1: null-safe, SPF未开售时跳过此逻辑（已在 getMatchOdds 中补齐）
                var safeHome = parseFloat(spf.home) || 0;
                var safeDraw = parseFloat(spf.draw) || 0;
                var safeAway = parseFloat(spf.away) || 0;
                if (!safeHome || !safeDraw || !safeAway) continue;

                var impliedHome = 1 / safeHome;
                var impliedDraw = 1 / safeDraw;
                var impliedAway = 1 / safeAway;
                var totalImplied = impliedHome + impliedDraw + impliedAway;
                const fairHome = impliedHome / totalImplied;
                const fairAway = impliedAway / totalImplied;
                const fairDraw = impliedDraw / totalImplied;

                // 冷门方向（高赔率方）的公平概率
                var coldFair = fairDraw;
                if (coldDir.dir === '胜') coldFair = fairHome;
                if (coldDir.dir === '负') coldFair = fairAway;

                // 过滤：冷门方向公平概率 < 12% 太不可能
                if (coldFair < 0.12) continue;

                // 强一致但有高赔率冷门方向 → 市场与模型分歧 → 可能是套利机会
                if (consensus.indexOf('strong') >= 0 || consensus.indexOf('强') >= 0) {
                  // 冷门方向赔率高(≥3.5)且公平概率≥15% → 市场低估，保留
                  if (coldFair >= 0.15 && coldDir.odds >= 3.5) {
                    // 保留（市场和模型认知分歧）
                  } else {
                    continue; // 正常强一致跳过
                  }
                }

                // 没有功守道数据，虚拟中性数据
                if (!gs || gs.totalStrength === null || gs.totalStrength === undefined) {
                  gs = Object.assign({}, gs || {}, { totalStrength: 0 });
                }

                // 自适应降级默认值：根据共识状态动态调整
                if (consensus.indexOf('weak') >= 0 || consensus.indexOf('弱') >= 0) {
                  hi = 0.55; // 弱一致 → 模型不确定 → 更可能出冷
                } else if (!gs || !consensus) {
                  hi = 0.7; // 无 GS 数据 → 偏保守
                } else {
                  hi = 0.65; // 默认保守估计
                }
              }

              // ===== P0-方案二：多维冷门评分 =====
              const coldScore = computeColdScore(hi, gs, modds, coldDir);

              // ===== P1-方案三：质量门禁（单场最低分）=====
              if (coldScore < MIN_COLD_SCORE) continue;

              // 共识状态中文
              let consensusLabel = '';
              if (consensus.indexOf('强一致') >= 0 || consensus === 'strong') consensusLabel = '✅强一致';
              else if (consensus.indexOf('弱一致') >= 0 || consensus === 'weak') consensusLabel = '🟡弱一致';
              else if (consensus.indexOf('熔断') >= 0 || consensus === 'meltdown') consensusLabel = '⚠️熔断';
              else consensusLabel = '⚪未融合';

              coldCandidates.push({
                match: m,
                heatIndex: hi,
                heatLevel: (changeEntry && changeEntry.heatLevel) || 'cold',
                heatLabel: (changeEntry && changeEntry.heatLabel) || hi.toFixed(2) + ' 🧊',
                coldDir: coldDir.dir,
                coldOdds: coldDir.odds,
                coldDirScore: coldDir.finalScore != null ? parseFloat(coldDir.finalScore.toFixed(2)) : 0,
                consensus: consensus,
                consensusLabel: consensusLabel,
                compositeScore: coldScore,
                coldScore: coldScore,
                totalStrength: gs && gs.totalStrength != null ? parseFloat(gs.totalStrength) : 0,
                odds: modds,
                rankedDirections: rawDirections,
              });
            }

            // 6) 排序：按多维冷门评分降序
            coldCandidates.sort(function (a, b) {
              return b.coldScore - a.coldScore;
            });

            // ===== P1-方案三：动态方案数量 =====
            let planCount = 0;
            if (
              coldCandidates.length >= 4 &&
              (coldCandidates[0].coldScore + coldCandidates[1].coldScore) / 2 >= MIN_PLAN_AVG_SCORE
            ) {
              planCount = 2;
            } else if (coldCandidates.length >= 4) {
              planCount = 1;
            } else if (
              coldCandidates.length >= 2 &&
              (coldCandidates[0].coldScore + coldCandidates[1].coldScore) / 2 >= MIN_PLAN_AVG_SCORE
            ) {
              planCount = 1;
            }

            // 7) 生成方案（加入 P2 相关性过滤）
            const plans = [];
            const usedMatchIds = [];

            for (let p = 0; p < planCount; p++) {
              // 扫描候选列表，为当前方案找最佳配对
              let picked = [];
              for (let ci = 0; ci < coldCandidates.length && picked.length < 2; ci++) {
                if (usedMatchIds.indexOf(coldCandidates[ci].match.matchId) >= 0) continue;
                if (picked.length === 0) {
                  picked.push(coldCandidates[ci]);
                } else {
                  // ===== P2-方案四：组合相关性检测 =====
                  const corr = checkCorrelation(picked[0], coldCandidates[ci]);
                  if (corr.riskLevel === 'high') continue; // 高风险跳过
                  picked.push(coldCandidates[ci]);
                }
              }

              // 如果相关性过滤导致配对不足，回退到宽松模式重试
              if (picked.length < 2) {
                picked = [];
                for (let ci2 = 0; ci2 < coldCandidates.length && picked.length < 2; ci2++) {
                  if (usedMatchIds.indexOf(coldCandidates[ci2].match.matchId) >= 0) continue;
                  picked.push(coldCandidates[ci2]);
                }
              }

              if (picked.length < 2) break;

              const ca = picked[0];
              const cb = picked[1];
              usedMatchIds.push(ca.match.matchId, cb.match.matchId);

              // 方案平均分门禁
              const planAvg = Math.round((ca.coldScore + cb.coldScore) / 2);
              if (planAvg < MIN_PLAN_AVG_SCORE) continue;

              // P2：方案相关性标记
              const corrResult = checkCorrelation(ca, cb);

              // ★ 计算比赛命中/未命中结果
              const resultA = computeMatchResult(ca.match.matchId, ca.coldDir);
              const resultB = computeMatchResult(cb.match.matchId, cb.coldDir);

              // ★ 方案级中奖判定（2串1：两场都中才算中奖）
              let isPlanWon = null,
                isPlanLose = null;
              if (resultA.isMatchWon === true && resultB.isMatchWon === true) {
                isPlanWon = true;
                isPlanLose = false;
              } else if (resultA.isMatchLose === true || resultB.isMatchLose === true) {
                isPlanWon = false;
                isPlanLose = true;
              }

              const matchA = {
                matchId: ca.match.matchId,
                homeName: ca.match.homeName || '',
                visitName: ca.match.visitName || '',
                leagueName: ca.match.leagueName || '',
                matchNum: ca.match.num || '',
                startTime: ca.match.startTime || '',
                direction: ca.coldDir,
                odds: ca.odds,
                isMatchWon: resultA.isMatchWon,
                isMatchLose: resultA.isMatchLose,
                subResults: resultA.subResults,
                heatIndex: ca.heatIndex,
                heatLabel: ca.heatLabel,
                consensus: ca.consensusLabel,
                compositeScore: ca.compositeScore,
                coldScore: ca.coldScore,
                coldDirScore: ca.coldDirScore,
                actualScore:
                  resultA.isMatchWon !== null || resultA.isMatchLose !== null
                    ? (ca.match.score || '').replace(/:/g, '-')
                    : '',
              };

              const matchB = {
                matchId: cb.match.matchId,
                homeName: cb.match.homeName || '',
                visitName: cb.match.visitName || '',
                leagueName: cb.match.leagueName || '',
                matchNum: cb.match.num || '',
                startTime: cb.match.startTime || '',
                direction: cb.coldDir,
                odds: cb.odds,
                isMatchWon: resultB.isMatchWon,
                isMatchLose: resultB.isMatchLose,
                subResults: resultB.subResults,
                heatIndex: cb.heatIndex,
                heatLabel: cb.heatLabel,
                actualScore:
                  resultB.isMatchWon !== null || resultB.isMatchLose !== null
                    ? (cb.match.score || '').replace(/:/g, '-')
                    : '',
                consensus: cb.consensusLabel,
                compositeScore: cb.compositeScore,
                coldScore: cb.coldScore,
                coldDirScore: cb.coldDirScore,
              };

              const oddsCombo =
                ca.coldOdds.toFixed(2) +
                ' × ' +
                cb.coldOdds.toFixed(2) +
                ' = ' +
                (ca.coldOdds * cb.coldOdds).toFixed(2);
              // ★ 赔率缺失（coldOdds 为 0/NaN）不计算奖金
              const hasValidOdds = ca.coldOdds > 0 && cb.coldOdds > 0 && !isNaN(ca.coldOdds * cb.coldOdds);
              const maxPrize = hasValidOdds ? Math.round(1000 * ca.coldOdds * cb.coldOdds) : 0;
              const winningPrize = isPlanWon === true ? maxPrize : isPlanLose === true ? 0 : null;
              const avgCPI = ((ca.heatIndex + cb.heatIndex) / 2).toFixed(2);
              const avgComp = Math.round((ca.coldScore + cb.coldScore) / 2);
              const consensusParts = [ca.consensusLabel, cb.consensusLabel];
              const combinedConsensus = consensusParts.join(' | ');

              plans.push({
                planId: 'quant_' + dateStr + '_' + (p + 1),
                planName: '量化博冷方案 ' + (p + 1),
                matches: [matchA, matchB],
                amount: 1000,
                playType: '混合投注（搏冷）',
                matchCount: 2,
                passType: '2串1',
                betCount: 250,
                ticketCount: 10,
                multiplier: 25,
                maxPrize: maxPrize,
                winningPrize: winningPrize,
                isPlanWon: isPlanWon,
                isPlanLose: isPlanLose,
                oddsDisplay: oddsCombo,
                coldIndex: avgCPI,
                compositeScore: avgComp,
                coldScore: avgComp,
                consensus: combinedConsensus,
                correlationRisk: corrResult.riskLevel,
                correlationWarnings: corrResult.warnings,
              });
            }

            // ===== P1-方案六：单场博冷兜底 =====
            // 当 2串1 方案数为 0 但存在高分候选时，生成单场方案
            if (plans.length === 0 && coldCandidates.length >= 1 && coldCandidates[0].coldScore >= 50) {
              const sc = coldCandidates[0];
              const sResult = computeMatchResult(sc.match.matchId, sc.coldDir);

              const sMatch = {
                matchId: sc.match.matchId,
                homeName: sc.match.homeName || '',
                visitName: sc.match.visitName || '',
                leagueName: sc.match.leagueName || '',
                matchNum: sc.match.num || '',
                startTime: sc.match.startTime || '',
                direction: sc.coldDir,
                odds: sc.odds,
                isMatchWon: sResult.isMatchWon,
                isMatchLose: sResult.isMatchLose,
                subResults: sResult.subResults,
                heatIndex: sc.heatIndex,
                heatLabel: sc.heatLabel,
                consensus: sc.consensusLabel,
                compositeScore: sc.compositeScore,
                coldScore: sc.coldScore,
                coldDirScore: sc.coldDirScore,
              };

              const sHasOdds = sc.coldOdds > 0 && !isNaN(sc.coldOdds);
              const sMaxPrize = sHasOdds ? Math.round(1000 * sc.coldOdds) : 0;

              plans.push({
                planId: 'quant_' + dateStr + '_single',
                planName: '量化博冷方案（单场）',
                matches: [sMatch],
                amount: 1000,
                playType: '单场博冷',
                matchCount: 1,
                passType: '单场',
                betCount: 200,
                ticketCount: 5,
                multiplier: 40,
                maxPrize: sMaxPrize,
                winningPrize: sResult.isMatchWon === true ? sMaxPrize : sResult.isMatchLose === true ? 0 : null,
                isPlanWon: sResult.isMatchWon,
                isPlanLose: sResult.isMatchLose,
                oddsDisplay: sc.coldOdds.toFixed(2),
                coldIndex: sc.heatIndex.toFixed(2),
                compositeScore: sc.coldScore,
                coldScore: sc.coldScore,
                consensus: sc.consensusLabel,
                correlationRisk: 'none',
                correlationWarnings: [],
              });
            }

            var notice = '';
            if (plans.length === 0) {
              if (coldCandidates.length === 0) {
                notice = '今日暂无符合条件的冷门场次';
              } else {
                notice = '今日冷门场次未达方案质量阈值（候选' + coldCandidates.length + '场）';
              }
            }

            const qpResponse = {
              code: 1,
              data: {
                date: dateStr,
                plans: plans,
                notice: notice,
                meta: {
                  candidates: coldCandidates.length,
                  qualified: coldCandidates.length,
                  hasChangeData: hasChangeData,
                  minColdScore: MIN_COLD_SCORE,
                  minPlanAvgScore: MIN_PLAN_AVG_SCORE,
                },
              },
            };
            // ★ P1-1: 缓存量化方案结果
            _quantPlanCache[dateStr] = { time: qpNow, response: qpResponse };
            // ★ P2: LRU 清理（最多缓存 10 个日期）
            const qpKeys = Object.keys(_quantPlanCache);
            if (qpKeys.length > 10) {
              qpKeys.sort(function (a, b) {
                return _quantPlanCache[a].time - _quantPlanCache[b].time;
              });
              delete _quantPlanCache[qpKeys[0]];
            }
            return res.json(qpResponse);
          } catch (e) {
            logger.error('[quant-plan-list] ' + e.message);
            return res.json({ code: 0, msg: '获取量化方案失败: ' + e.message });
          }
        }

        case 'income-stats': {
          try {
            // ★ P1-3: 5 分钟响应缓存（计算最密集的 API 之一）
            var _incCacheKey =
              'income-stats|' +
              (data.plan || 'all') +
              '|' +
              (data.direction || 'all') +
              '|' +
              (parseInt(data.days) || 0);
            var _incCached = getCachedResponse('income-stats', _incCacheKey);
            if (_incCached) return res.json(_incCached);

            const planFilter = data.plan || 'all';
            const directionFilter = data.direction || 'all';
            const daysFilter = parseInt(data.days) || 0;
            const AMOUNT = 1000;
            const fs = require('fs');
            const path = require('path');

            function fmtDate2(dd) {
              return (
                dd.getFullYear() +
                '-' +
                String(dd.getMonth() + 1).padStart(2, '0') +
                '-' +
                String(dd.getDate()).padStart(2, '0')
              );
            }

            const minDate = '2026-03-19';
            const endDate = new Date();
            let startDate = new Date(minDate);
            if (daysFilter > 0) {
              startDate = new Date(endDate.getTime() - (daysFilter - 1) * 86400000);
              if (fmtDate2(startDate) < minDate) startDate = new Date(minDate);
            }

            // Load data from data.json
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            function normalizeRecs(recs) {
              return (recs || []).map(function (x) {
                const raw = x.rs !== undefined ? x.rs : x.result !== undefined ? x.result : null;
                const r = raw === 0 || raw === 1 ? raw : null;
                return { type: x.t || x.type, num: x.n || x.num, result: r };
              });
            }

            function findRecommends(matchId) {
              const raw = rMap['m_' + matchId] || rMap[String(matchId)] || [];
              return normalizeRecs(raw);
            }

            // （extractOddsVal / extractIndividualOdds 已移除——统一由 plan-generator.js 处理）

            // ===== 收益率辅助：所有方案每单投入金额 =====
            const AMOUNT_SCORE_OR_QUANT = 1000;

            // 导入共享方案生成模块
            const PG = require('./core/plan-generator');

            const results = [];
            let totalPlans = 0,
              totalWon = 0,
              totalIncome = 0;

            // 预加载共享缓存（避免每天循环内重复读取）
            let _globalGsMap = {};
            try {
              const _gsPathPre = path.join(__dirname, 'gongshoudao', 'cache.json');
              if (fs.existsSync(_gsPathPre))
                _globalGsMap = JSON.parse(fs.readFileSync(_gsPathPre, 'utf8'))['_global'] || {};
            } catch (e) {}
            const _globalAllplays = getAllplaysData();
            let _globalChgMap = {};
            try {
              const _chgPathPre = path.join(__dirname, 'jczq_change_cache.json');
              if (fs.existsSync(_chgPathPre)) _globalChgMap = JSON.parse(fs.readFileSync(_chgPathPre, 'utf8')) || {};
            } catch (e) {}

            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
              const ds = fmtDate2(d);
              const mList = [];
              Object.keys(mMap).forEach((k) => {
                const m = mMap[k];
                if (m && (m.date || '').slice(0, 10) === ds) mList.push(m);
              });
              if (mList.length === 0) continue;

              const histOdds = getOddsHistory(ds);

              // 预计算：一次获取所有比赛的 recs 和 odds
              const matchDataMap = {};
              for (const mm of mList) {
                const num = mm.num || '';
                let oddsObj = null;
                if (histOdds && histOdds[num]) {
                  const od = histOdds[num];
                  oddsObj = {
                    spf: od.spf || null,
                    rqspf: od.rqspf || null,
                    totalGoals: od.totalGoals || null,
                    isSingleGame: od.isSingleGame || false,
                  };
                }
                matchDataMap[mm.matchId] = {
                  match: mm,
                  recs: findRecommends(mm.matchId),
                  odds: oddsObj,
                };
              }

              // 使用共享方案生成模块，与 plan-list 完全一致
              const plans = PG.generateExpertPlans(mList, matchDataMap, ds);

              // ===== 专家博热方案 =====
              if (directionFilter === 'all' || directionFilter === 'expert') {
                plans.forEach((pp) => {
                  if (planFilter !== 'all' && pp.name !== planFilter) return;

                  // 结果未确定 → 跳过
                  if (pp.isPlanWon === null && pp.isPlanLose === null) return;

                  const isWon = pp.isPlanWon === true;
                  const isLose = pp.isPlanLose === true;

                  let dayIncome = 0,
                    statusE = 'unknown';
                  if (isWon) {
                    dayIncome = pp.winningPrize - AMOUNT;
                    statusE = 'won';
                    totalWon++;
                  } else if (isLose) {
                    dayIncome = -AMOUNT;
                    statusE = 'lose';
                  }
                  totalPlans++;
                  totalIncome += dayIncome;
                  results.push({
                    date: ds,
                    plan: pp.planName,
                    status: statusE,
                    matches: pp.matches.map((mm) => ({
                      matchNum: mm.matchNum,
                      home: mm.homeName,
                      visit: mm.visitName,
                      direction: mm.direction,
                      isWon: mm.isMatchWon,
                      isLose: mm.isMatchLose,
                    })),
                    prize: isWon ? pp.winningPrize : 0,
                    income: dayIncome,
                  });
                });
              }

              // ===== 单场比分方案 =====
              if (directionFilter === 'all' || directionFilter === 'score') {
                const _scoreCandidates = [];
                for (let _si = 0; _si < mList.length; _si++) {
                  const _m = mList[_si];
                  const _mid = _m.matchId || '';
                  const _gs = _globalGsMap['m_' + _mid] || _globalGsMap[_mid] || null;
                  if (!_gs) continue;
                  const _qual = PG.qualifyMatch({ gs: _gs });
                  if (!_qual) continue;

                  const _matchDate = (_m.date || '').slice(0, 10);
                  const _matchNum = _m.num || '';
                  var _bfOdds = getScoreOdds(_globalAllplays, _matchDate, _matchNum);
                  const _useBfOdds = !!_bfOdds;
                  if (!_bfOdds && _gs && _gs.scores && _gs.scores.length > 0) {
                    _bfOdds = {};
                    _gs.scores.forEach(function (s) {
                      if (!s || !s.score || !s.percent) return;
                      const pct = parseFloat(s.percent) || 0;
                      if (pct > 0) _bfOdds[s.score] = Math.round((100 / pct) * 100) / 100;
                    });
                  }
                  if (!_bfOdds || Object.keys(_bfOdds).length === 0) continue;

                  const _spm = PG.buildScorePercentMap(_gs);
                  let _goalUpper = 0;
                  if (_gs.goalRange && _gs.goalRange.upper) _goalUpper = parseInt(_gs.goalRange.upper) || 0;
                  else if (_gs.goalRange && _gs.goalRange.range) {
                    const _grParts = String(_gs.goalRange.range).split('-');
                    if (_grParts.length >= 2) _goalUpper = parseInt(_grParts[1]) || 0;
                  }
                  const _dQual = {
                    scorePercentMap: _spm,
                    goalUpper: _goalUpper,
                    xgHome: _qual.xgHome,
                    xgAway: _qual.xgAway,
                    totalStrength: parseFloat(_gs.totalStrength) || 0,
                  };
                  const _combos = PG.dutchCombinations(_bfOdds, 1000, _qual.strongIsHome, _useBfOdds, _dQual);
                  if (_combos.length === 0) continue;

                  const _qs = PG.computeScoreQuality(_gs, _qual);
                  _scoreCandidates.push({
                    match: _m,
                    gs: _gs,
                    matchId: _mid,
                    strongIsHome: _qual.strongIsHome,
                    qualityScore: _qs,
                    bestCombo: _combos[0],
                  });
                }

                _scoreCandidates.sort(function (a, b) {
                  return b.qualityScore - a.qualityScore;
                });
                let _topCount = 0;
                if (_scoreCandidates.length > 0 && _scoreCandidates[0].qualityScore >= 45) _topCount = 1;
                if (_scoreCandidates.length >= 2 && _scoreCandidates[1].qualityScore >= 50) _topCount = 2;
                if (
                  _scoreCandidates.length >= 3 &&
                  _scoreCandidates[2].qualityScore >= 45 &&
                  _scoreCandidates[2].bestCombo &&
                  (_scoreCandidates[2].bestCombo.coverage || 0) >= 0.25
                )
                  _topCount = 3;
                if (_topCount === 0 && _scoreCandidates.length >= 1 && _scoreCandidates[0].qualityScore < 45)
                  _topCount = 0;
                const _topCands = _scoreCandidates.slice(0, Math.max(0, _topCount));

                _topCands.forEach(function (c, idx) {
                  const combo = c.bestCombo;
                  const rawScore = (c.match.score || '').replace(/:/g, '-');
                  let sWon = false,
                    sLose = false,
                    prize = 0,
                    winAlloc = 0,
                    winOdds = 0;
                  if (rawScore) {
                    for (let _si2 = 0; _si2 < combo.scores.length; _si2++) {
                      if (combo.scores[_si2].score === rawScore) {
                        sWon = true;
                        winAlloc = combo.scores[_si2].allocation || 0;
                        winOdds = combo.scores[_si2].odds || 0;
                        break;
                      }
                    }
                    sLose = !sWon;
                  }
                  if (!sWon && !sLose) return;
                  prize = sWon ? Math.round(winAlloc * winOdds) : 0;

                  totalPlans++;
                  if (sWon) {
                    totalWon++;
                    totalIncome += prize - AMOUNT_SCORE_OR_QUANT;
                  } else if (sLose) {
                    totalIncome -= AMOUNT_SCORE_OR_QUANT;
                  }

                  results.push({
                    date: ds,
                    plan: '单关比分方案 ' + (idx + 1),
                    status: sWon ? 'won' : sLose ? 'lose' : 'unknown',
                    matches: [
                      {
                        matchNum: c.match.num || '',
                        home: c.match.homeName || '',
                        visit: c.match.visitName || '',
                        direction: '比分',
                        isWon: sWon,
                        isLose: sLose,
                      },
                    ],
                    prize: prize,
                    income: sWon ? prize - AMOUNT_SCORE_OR_QUANT : sLose ? -AMOUNT_SCORE_OR_QUANT : 0,
                  });
                });
              }

              // ===== 量化博冷方案 =====
              if (directionFilter === 'all' || directionFilter === 'quant') {
                const _chgDay = _globalChgMap[ds] || {};
                const _hasChg = Object.keys(_chgDay).length > 0;

                const _od = getOddsHistory(ds) || {};
                const MIN_COLD_SCORE = 40,
                  MIN_PLAN_AVG = 45;

                const _coldCands = [];
                for (let _qi = 0; _qi < mList.length; _qi++) {
                  const _qm = mList[_qi];
                  const _qmid = _qm.matchId;
                  let _qgs = _globalGsMap['m_' + _qmid] || _globalGsMap[_qmid] || null;
                  const _consensus = _qgs ? _qgs.fusionConsensus || '' : '';
                  if (_consensus.indexOf('熔断') >= 0 || _consensus === 'meltdown') continue;

                  const _modds = PG.getMatchOdds(_qm, _od, _globalAllplays);
                  const _spf = _modds && _modds.spf ? _modds.spf : null;
                  if (!_spf || _spf.home == null || _spf.draw == null || _spf.away == null) continue;

                  const _coldDir = PG.getColdDirection({ spf: _spf }, _qgs);
                  const _chgEntry = _chgDay[_qmid];
                  let _hi =
                    _chgEntry && _chgEntry.heatIndex !== null && _chgEntry.heatIndex !== undefined
                      ? _chgEntry.heatIndex
                      : null;

                  if (_hasChg) {
                    if (_hi === null) continue;
                    if (_hi >= 1.4 || _hi >= 0.85) continue;
                  } else {
                    var impliedHome = 1 / parseFloat(_spf.home),
                      impliedDraw = 1 / parseFloat(_spf.draw),
                      impliedAway = 1 / parseFloat(_spf.away);
                    var totalImplied = impliedHome + impliedDraw + impliedAway;
                    var coldFair = impliedDraw;
                    if (_coldDir.dir === '胜') coldFair = impliedHome;
                    if (_coldDir.dir === '负') coldFair = impliedAway;
                    if (coldFair < 0.12) continue;
                    if (_consensus.indexOf('strong') >= 0 || _consensus.indexOf('强') >= 0) continue;
                    if (!_qgs || _qgs.totalStrength === null || _qgs.totalStrength === undefined)
                      _qgs = Object.assign({}, _qgs || {}, { totalStrength: 0 });
                    _hi = 0.65;
                  }

                  const _coldScore = PG.computeColdScore(_hi, _qgs, { spf: _spf }, _coldDir);
                  if (_coldScore < MIN_COLD_SCORE) continue;

                  _coldCands.push({
                    match: _qm,
                    gs: _qgs,
                    heatIndex: _hi,
                    coldDir: _coldDir.dir,
                    coldOdds: _coldDir.odds,
                    coldScore: _coldScore,
                    odds: _modds,
                  });
                }

                _coldCands.sort(function (a, b) {
                  return b.coldScore - a.coldScore;
                });
                let _qPlanCount = 0;
                if (_coldCands.length >= 4 && (_coldCands[0].coldScore + _coldCands[1].coldScore) / 2 >= MIN_PLAN_AVG)
                  _qPlanCount = 2;
                else if (_coldCands.length >= 4) _qPlanCount = 1;
                else if (
                  _coldCands.length >= 2 &&
                  (_coldCands[0].coldScore + _coldCands[1].coldScore) / 2 >= MIN_PLAN_AVG
                )
                  _qPlanCount = 1;

                const _usedIds = [];
                for (let _qp = 0; _qp < _qPlanCount; _qp++) {
                  const _picked = [];
                  for (let _qci = 0; _qci < _coldCands.length && _picked.length < 2; _qci++) {
                    if (_usedIds.indexOf(_coldCands[_qci].match.matchId) >= 0) continue;
                    if (_picked.length === 0) {
                      _picked.push(_coldCands[_qci]);
                    } else {
                      const _corr = PG.checkCorrelation(_picked[0].match, _coldCands[_qci].match);
                      if (_corr.riskLevel === 'high') continue;
                      _picked.push(_coldCands[_qci]);
                    }
                  }
                  if (_picked.length < 2) break;
                  _usedIds.push(_picked[0].match.matchId, _picked[1].match.matchId);

                  const _ca = _picked[0],
                    _cb = _picked[1];
                  const _pAvg = Math.round((_ca.coldScore + _cb.coldScore) / 2);
                  if (_pAvg < MIN_PLAN_AVG) continue;

                  // 判定两场命中结果
                  const _rA = PG.checkMatchResult(_ca.match.matchId, _ca.coldDir, rMap, normalizeRecs, mMap);
                  const _rB = PG.checkMatchResult(_cb.match.matchId, _cb.coldDir, rMap, normalizeRecs, mMap);

                  let _qWon = false,
                    _qLose = false;
                  if (_rA.isWon === true && _rB.isWon === true) _qWon = true;
                  else if (_rA.isLose === true || _rB.isLose === true) _qLose = true;
                  if (!_qWon && !_qLose) continue;

                  totalPlans++;
                  if (_qWon) {
                    totalWon++;
                    // ★ 赔率缺失时跳过中奖记录，不计算奖金
                    const _hasValidColdOdds =
                      _ca.coldOdds > 0 && _cb.coldOdds > 0 && !isNaN(_ca.coldOdds * _cb.coldOdds);
                    if (!_hasValidColdOdds) continue;
                    const _qpPrize = Math.round(1000 * _ca.coldOdds * _cb.coldOdds);
                    totalIncome += _qpPrize - AMOUNT_SCORE_OR_QUANT;
                    results.push({
                      date: ds,
                      plan: '量化博冷方案 ' + (_qp + 1),
                      status: 'won',
                      matches: [
                        {
                          matchNum: _ca.match.num || '',
                          home: _ca.match.homeName || '',
                          visit: _ca.match.visitName || '',
                          direction: _ca.coldDir,
                          isWon: true,
                          isLose: false,
                        },
                        {
                          matchNum: _cb.match.num || '',
                          home: _cb.match.homeName || '',
                          visit: _cb.match.visitName || '',
                          direction: _cb.coldDir,
                          isWon: true,
                          isLose: false,
                        },
                      ],
                      prize: _qpPrize,
                      income: _qpPrize - AMOUNT_SCORE_OR_QUANT,
                    });
                  } else if (_qLose) {
                    totalIncome -= AMOUNT_SCORE_OR_QUANT;
                    results.push({
                      date: ds,
                      plan: '量化博冷方案 ' + (_qp + 1),
                      status: 'lose',
                      matches: [
                        {
                          matchNum: _ca.match.num || '',
                          home: _ca.match.homeName || '',
                          visit: _ca.match.visitName || '',
                          direction: _ca.coldDir,
                          isWon: _rA.isWon || false,
                          isLose: _rA.isLose || false,
                        },
                        {
                          matchNum: _cb.match.num || '',
                          home: _cb.match.homeName || '',
                          visit: _cb.match.visitName || '',
                          direction: _cb.coldDir,
                          isWon: _rB.isWon || false,
                          isLose: _rB.isLose || false,
                        },
                      ],
                      prize: 0,
                      income: -AMOUNT_SCORE_OR_QUANT,
                    });
                  }
                }
              }
            }

            // === 我的方案 ===（readUserPlans 使用模块级定义）
            if (directionFilter === 'my') {
              const deviceId = (req.headers['x-device-id'] || '').trim();
              if (deviceId) {
                const userPlans = readUserPlans(deviceId) || [];
                let myWon = 0,
                  myIncome = 0,
                  myPlanIdx = 0;
                const cnNums = [
                  '',
                  '一',
                  '二',
                  '三',
                  '四',
                  '五',
                  '六',
                  '七',
                  '八',
                  '九',
                  '十',
                  '十一',
                  '十二',
                  '十三',
                  '十四',
                  '十五',
                  '十六',
                  '十七',
                  '十八',
                  '十九',
                  '二十',
                  '二十一',
                  '二十二',
                  '二十三',
                  '二十四',
                  '二十五',
                  '二十六',
                  '二十七',
                  '二十八',
                  '二十九',
                  '三十',
                ];
                userPlans.forEach(function (p) {
                  // 只统计已结算的方案（isWon 为 true 或 false）
                  if (p.isWon !== true && p.isWon !== false) return;
                  if (planFilter !== 'all') {
                    // 用户方案没有 plan_1~7 分类，按方案名模糊匹配
                    const pName = p.note || p.planName || '';
                    if (pName.indexOf(planFilter) < 0) return;
                  }
                  // 日期过滤
                  const pDate = (p.date || p.createdAt || '').slice(0, 10);
                  if (daysFilter > 0) {
                    if (!pDate || pDate < fmtDate2(startDate) || pDate > fmtDate2(endDate)) return;
                  }
                  myPlanIdx++;
                  const planDisplayName = '方案' + (myPlanIdx <= 30 ? cnNums[myPlanIdx] : String(myPlanIdx));
                  // amount 已是元，与 expert/score/quant 统一以元为单位
                  const amountYuan = Math.round(Number(p.amount) || 0);
                  // 提取 matches 信息（供明细表格展示场次/方向）
                  const matchInfos = (p.matches || []).map(function (mm) {
                    return { matchNum: mm.matchNum || '--', direction: mm.direction || mm.oddsName || '--' };
                  });
                  if (p.isWon) {
                    myWon++;
                    let prize = 0;
                    if (p.resultIncome != null && p.resultIncome !== undefined) {
                      prize = Number(p.resultIncome);
                    } else if (p.totalOdds && amountYuan > 0) {
                      prize = Math.round(Number(p.totalOdds) * amountYuan);
                    } else {
                      prize = amountYuan;
                    }
                    const dayInc = prize - amountYuan;
                    myIncome += dayInc;
                    results.push({
                      date: pDate || '未知',
                      plan: planDisplayName,
                      status: 'won',
                      matches: matchInfos,
                      prize: prize,
                      income: dayInc,
                    });
                  } else {
                    myIncome -= amountYuan;
                    results.push({
                      date: pDate || '未知',
                      plan: planDisplayName,
                      status: 'lose',
                      matches: matchInfos,
                      prize: 0,
                      income: -amountYuan,
                    });
                  }
                });
                totalPlans += results.length;
                totalWon += myWon;
                totalIncome += myIncome;
              }
            }

            // Aggregate by date
            const dateMap = {};
            results.forEach((r) => {
              if (!dateMap[r.date]) dateMap[r.date] = { won: 0, total: 0, income: 0 };
              dateMap[r.date].total++;
              dateMap[r.date].income += r.income;
              if (r.status === 'won') dateMap[r.date].won++;
            });
            const dayRecords = [];
            Object.keys(dateMap)
              .sort()
              .reverse()
              .forEach((ds) => {
                const dr = dateMap[ds];
                dayRecords.push({
                  date: ds,
                  hitCount: dr.won,
                  totalPlans: dr.total,
                  hitRate: dr.total > 0 ? Math.round((dr.won / dr.total) * 100) : 0,
                  income: dr.income,
                });
              });

            const winRate = totalPlans > 0 ? Math.round((totalWon / totalPlans) * 100) : 0;

            // ★ 方案命中明细：从 results 提取每条方案详情
            const detailRows = results.map(function (r) {
              var matchNums = (r.matches || [])
                .map(function (mm) {
                  return mm.matchNum || '--';
                })
                .join(' / ');
              var dirs = (r.matches || [])
                .map(function (mm) {
                  return mm.direction || '--';
                })
                .join(' / ');
              return {
                date: r.date,
                plan: r.plan,
                matchNums: matchNums,
                direction: dirs,
                income: r.income,
              };
            });

            var _incResp = {
              code: 1,
              data: {
                summary: { totalPlans: totalPlans, totalWon: totalWon, totalIncome: totalIncome, winRate: winRate },
                records: dayRecords,
                details: detailRows,
              },
            };
            setCachedResponse('income-stats', _incCacheKey, _incResp);
            return res.json(_incResp);
          } catch (e) {
            return res.json({ code: 0, msg: '获取收入统计失败: ' + e.message });
          }
        }

        case 'filter-stats': {
          try {
            const fs = require('fs');
            const path = require('path');
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};

            let matchCount = 0,
              totalMatches = 0,
              leagueSet = {},
              dirSet = {},
              staleCount = 0,
              partialStaleCount = 0;
            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m) return;
              totalMatches++;
              const raw = rMap['m_' + m.matchId] || rMap[String(m.matchId)] || [];
              if (raw.length === 0) return; // 跳过无推荐的比赛
              const hasResult = raw.some(function (x) {
                return (
                  (x.rs !== undefined ? x.rs : x.result) !== null &&
                  (x.rs !== undefined ? x.rs : x.result) !== undefined
                );
              });
              if (hasResult) {
                matchCount++;
                if (m.leagueName) leagueSet[m.leagueName] = true;
                raw.forEach(function (x) {
                  const t = x.t || x.type;
                  if (t) dirSet[t] = true;
                });
              }
              // 统计待回填：全部推荐结果都是 null/undefined → 真正需要回填
              const allStale =
                raw.length > 0 &&
                raw.every(function (x) {
                  const r = x.rs !== undefined ? x.rs : x.result;
                  return r === null || r === undefined;
                });
              if (allStale) staleCount++;
              else if (!hasResult) {
                // 部分有结果部分没有（不会发生，因为hasResult检查过了所有都无结果的情况）
              }
              // 部分缺失：至少有一条有结果，也至少有一条没结果
              const someStale = raw.some(function (x) {
                const r = x.rs !== undefined ? x.rs : x.result;
                return r === null || r === undefined;
              });
              if (hasResult && someStale) partialStaleCount++;
            });

            return res.json({
              code: 1,
              data: {
                matchCount: matchCount,
                totalMatches: totalMatches,
                leagueCount: Object.keys(leagueSet).length,
                directionCount: Object.keys(dirSet).length,
                leagues: Object.keys(leagueSet).sort(),
                staleCount: staleCount,
                partialStaleCount: partialStaleCount,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '获取统计失败: ' + e.message });
          }
        }

        // ★ 赔率走势：获取竞彩官网赔率时间序列 (sporttery_odds_snapshot)
        case 'odds-trend': {
          try {
            const matchNum = data.matchNum || data.match_num || '';
            const matchId = data.matchId || '';
            if (!matchNum && !matchId) return res.json({ code: 0, msg: '缺少 matchNum 或 matchId' });

            const adp = database.getAdapter();
            if (!adp) return res.json({ code: 0, msg: '数据库未就绪' });

            let rows;
            if (matchNum) {
              rows = adp.execAll(
                'SELECT play_type, snapshot_time, odds_json, trend FROM sporttery_odds_snapshot WHERE match_num = ? ORDER BY play_type, snapshot_time',
                matchNum,
              );
            } else {
              rows = adp.execAll(
                'SELECT play_type, snapshot_time, odds_json, trend FROM sporttery_odds_snapshot WHERE match_id = ? ORDER BY play_type, snapshot_time',
                matchId,
              );
            }

            // 按玩法分组
            const grouped = {};
            (rows || []).forEach(function (r) {
              const pt = r.play_type;
              if (!grouped[pt]) grouped[pt] = [];
              grouped[pt].push({
                time: r.snapshot_time,
                odds: JSON.parse(r.odds_json || '{}'),
                trend: r.trend || '',
              });
            });

            return res.json({ code: 1, data: grouped });
          } catch (e) {
            return res.json({ code: 0, msg: '获取赔率走势失败: ' + e.message });
          }
        }

        // ★ 赛事前瞻：获取竞彩官网 7 大分析模块 (sporttery_preview)
        case 'match-preview': {
          try {
            const matchNum = data.matchNum || data.match_num || '';
            const matchId = data.matchId || data.id || '';
            if (!matchNum && !matchId) return res.json({ code: 0, msg: '缺少 matchNum 或 matchId' });

            const adp = database.getAdapter();
            if (!adp) return res.json({ code: 0, msg: '数据库未就绪' });

            let row;
            if (matchNum) {
              row = adp.execOne('SELECT * FROM sporttery_preview WHERE match_num = ?', matchNum);
            }
            if (!row && matchId) {
              row = adp.execOne('SELECT * FROM sporttery_preview WHERE match_id = ?', matchId);
            }
            if (!row) return res.json({ code: 0, msg: '暂无该比赛的赛事前瞻数据' });

            return res.json({
              code: 1,
              data: {
                matchId: row.match_id,
                matchNum: row.match_num,
                date: row.date,
                homeTeam: row.home_team,
                awayTeam: row.away_team,
                league: row.league,
                featureAnalysis: row.feature_analysis ? JSON.parse(row.feature_analysis) : null,
                h2h: row.h2h_history ? JSON.parse(row.h2h_history) : null,
                standings: row.standings ? JSON.parse(row.standings) : null,
                recentForm: row.recent_form ? JSON.parse(row.recent_form) : null,
                futureMatches: row.future_matches ? JSON.parse(row.future_matches) : null,
                scorers: row.scorers ? JSON.parse(row.scorers) : null,
                injuries: row.injuries ? JSON.parse(row.injuries) : null,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '获取赛事前瞻失败: ' + e.message });
          }
        }

        // ★ 投注弹窗：获取比赛赔率数据 (SPF/RQSPF/BF/JQS/BQC)
        case 'match-odds': {
          try {
            const matchId = data.matchId;
            if (!matchId) return res.json({ code: 0, msg: '缺少 matchId' });

            // 1) 从 data.json 获取比赛信息
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            let match = mMap['m_' + matchId] || mMap[matchId];
            if (!match) {
              // 尝试遍历查找
              Object.keys(mMap).forEach(function (k) {
                const m = mMap[k];
                if (m && String(m.matchId) === String(matchId)) match = m;
              });
            }
            // ★ 兜底: data.json 无当天数据时，从实时 API 获取（与 batch-match-odds 对齐）
            if (!match) {
              try {
                const liveMatches = await ensureData();
                if (liveMatches) {
                  for (let li = 0; li < liveMatches.length; li++) {
                    if (String(liveMatches[li].matchId) === String(matchId)) {
                      match = liveMatches[li];
                      break;
                    }
                  }
                }
              } catch (e2) {
                /* 实时数据获取失败，继续走原有逻辑 */
              }
            }
            // ★ 回退: data.json 无历史比赛时，从 prediction_logs 补全
            if (!match) {
              try {
                const adp = database.getAdapter();
                const predMatch = adp
                  ? adp.execOne(
                      'SELECT matchId, date, homeName, visitName, leagueName, matchNum, handicap FROM prediction_logs WHERE matchId = ? LIMIT 1',
                      matchId,
                    )
                  : null;
                if (predMatch) {
                  match = {
                    matchId: predMatch.matchId,
                    date: predMatch.date,
                    homeName: predMatch.homeName,
                    visitName: predMatch.visitName,
                    leagueName: predMatch.leagueName,
                    num: predMatch.matchNum,
                    handicap: predMatch.handicap,
                  };
                }
              } catch (e3) {}
            }
            if (!match) return res.json({ code: 0, msg: '未找到比赛' });

            const dateStr = (match.date || '').slice(0, 10);
            const matchNum = match.num || '';

            // 2) 从 allplays.json 获取全玩法赔率，缺失时回退到 odds_history
            const allplays = getAllplaysData();
            let dayData = {};
            let isAllplays = true;
            if (dateStr) {
              dayData = allplays[dateStr] || {};
              if (Object.keys(dayData).length === 0) {
                // ★ 回退: allplays.json 缺失当日数据 → 优先 odds_history_v2 SQLite
                isAllplays = false;
                try {
                  const adp = database.getAdapter();
                  const v2Rows = adp ? adp.execAll('SELECT * FROM odds_history_v2 WHERE date = ?', dateStr) : [];
                  if (v2Rows.length > 0) {
                    dayData = {};
                    v2Rows.forEach(function (row) {
                      const n = row.match_num;
                      if (!dayData['num_' + n]) {
                        dayData['num_' + n] = {
                          num: n,
                          homeName: row.home_name,
                          visitName: row.visit_name,
                          handicap: row.handicap,
                        };
                      }
                      const playData = JSON.parse(row.odds_json);
                      const entry = dayData['num_' + n];
                      if (row.play_type === 'spf' || row.play_type === 'rqspf' || row.play_type === 'halfFull') {
                        entry[row.play_type] = playData;
                      } else if (row.play_type === 'totalGoals') {
                        entry.jqs = playData;
                      } else if (row.play_type === 'scores') {
                        entry.bf = playData;
                      }
                    });
                  } else {
                    // ★ fallback to JSON
                    const oddsFile = path.join(__dirname, 'odds_history', dateStr + '.json');
                    if (fs.existsSync(oddsFile)) {
                      const raw = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
                      const oddsMap = raw.odds || {};
                      dayData = {};
                      Object.keys(oddsMap).forEach(function (n) {
                        const o = oddsMap[n];
                        const entry = Object.assign({ num: n }, o);
                        if (o.totalGoals && !o.jqs) entry.jqs = o.totalGoals;
                        if (o.halfFull && !o.bqc) entry.bqc = o.halfFull;
                        dayData['num_' + n] = entry;
                      });
                    }
                  }
                } catch (e) {
                  /* 回退失败不影响 */
                }
              }
            }

            // 按 num_XXX 匹配，再按原始 key 匹配，最后遍历查找
            let oddsEntry = dayData['num_' + matchNum] || dayData[matchNum];
            if (!oddsEntry && dateStr) {
              // 遍历当天所有 key 尝试匹配
              Object.keys(dayData).forEach(function (k) {
                const e = dayData[k];
                if (e && ((e.num && String(e.num) === String(matchNum)) || k === matchNum)) {
                  oddsEntry = e;
                }
              });
            }

            // 3) 构造返回数据
            const result = {
              matchId: matchId,
              date: dateStr,
              num: matchNum,
              // SPF (胜平负)
              spf:
                oddsEntry && oddsEntry.spf
                  ? {
                      home: oddsEntry.spf.home || null,
                      draw: oddsEntry.spf.draw || null,
                      away: oddsEntry.spf.away || null,
                    }
                  : {},
              // RQSPF (让球胜平负) — 多行让球数
              rqspfList: [],
              // BF (比分)
              bf: [],
              // JQS (总进球)
              jqs: [],
              // BQC (半全场)
              bqc: [],
            };

            if (oddsEntry) {
              // 让球胜平负 (多让球数)
              if (oddsEntry.rqspf) {
                const rq = oddsEntry.rqspf;
                // 单个让球对象
                if (typeof rq.home !== 'undefined') {
                  result.rqspfList.push({
                    handicap: rq.handicap != null ? rq.handicap : oddsEntry.handicap != null ? oddsEntry.handicap : 0,
                    home: rq.home || null,
                    draw: rq.draw || null,
                    away: rq.away || null,
                  });
                }
              }
              // 多让球数 (rqspfList)
              if (oddsEntry.rqspfList) {
                oddsEntry.rqspfList.forEach(function (rq) {
                  result.rqspfList.push({
                    handicap: rq.handicap != null ? rq.handicap : oddsEntry.handicap != null ? oddsEntry.handicap : 0,
                    home: rq.home || null,
                    draw: rq.draw || null,
                    away: rq.away || null,
                  });
                });
              }
              // 如果都没有，至少给一个让球0的默认值
              if (result.rqspfList.length === 0 && oddsEntry.rqspf_0) {
                const r0 = oddsEntry.rqspf_0;
                result.rqspfList.push({
                  handicap: 0,
                  home: r0.home || null,
                  draw: r0.draw || null,
                  away: r0.away || null,
                });
              }

              // 比分 (+胜其他/平其他/负其他)
              const scoreOrder = [
                '1:0',
                '2:0',
                '2:1',
                '3:0',
                '3:1',
                '3:2',
                '4:0',
                '4:1',
                '4:2',
                '5:0',
                '5:1',
                '5:2',
                '胜其他',
                '0:0',
                '1:1',
                '2:2',
                '3:3',
                '平其他',
                '0:1',
                '0:2',
                '1:2',
                '0:3',
                '1:3',
                '2:3',
                '0:4',
                '1:4',
                '2:4',
                '0:5',
                '1:5',
                '2:5',
                '负其他',
              ];
              // ★ 比分 — 兼容 bf(数组[{score,odds}]) 和 scores(对象{scores["1:0"]=7.75})
              const bfSource = oddsEntry.bf || oddsEntry.scores;
              if (bfSource) {
                const bfMap = {};
                if (Array.isArray(bfSource)) {
                  bfSource.forEach(function (s) {
                    bfMap[s.score] = s.odds;
                  });
                } else if (typeof bfSource === 'object') {
                  Object.keys(bfSource).forEach(function (k) {
                    bfMap[k] = bfSource[k];
                  });
                }
                scoreOrder.forEach(function (sc) {
                  if (bfMap[sc] != null) {
                    result.bf.push({ score: sc, odds: bfMap[sc] });
                  }
                });
                // 也包含不在标准顺序中的比分
                Object.keys(bfMap).forEach(function (sc) {
                  if (scoreOrder.indexOf(sc) < 0) {
                    result.bf.push({ score: sc, odds: bfMap[sc] });
                  }
                });
              }

              // ★ 总进球 — 兼容 jqs 和 totalGoals 两种 key
              const jqsSource = oddsEntry.jqs || oddsEntry.totalGoals;
              if (jqsSource && typeof jqsSource === 'object' && !Array.isArray(jqsSource)) {
                for (let g = 0; g <= 7; g++) {
                  const key = String(g);
                  if (jqsSource[key] != null) {
                    result.jqs.push({ goals: key, odds: jqsSource[key] });
                  }
                }
                if (jqsSource['7+'] != null || jqsSource['7'] != null) {
                  result.jqs.push({ goals: '7+', odds: jqsSource['7+'] || jqsSource['7'] });
                }
              }

              // ★ 半全场 — 兼容 bqc(数组[{combo,odds}]) 和 halfFull(对象{hh/hd/ha/...})
              const bqcOrder = ['胜胜', '胜平', '胜负', '平胜', '平平', '平负', '负胜', '负平', '负负'];
              const hfToLabel = {
                hh: '胜胜',
                hd: '胜平',
                ha: '胜负',
                dh: '平胜',
                dd: '平平',
                da: '平负',
                ah: '负胜',
                ad: '负平',
                aa: '负负',
              };
              const bqcSource = oddsEntry.bqc || oddsEntry.halfFull;
              if (bqcSource) {
                const bqcMap = {};
                if (Array.isArray(bqcSource)) {
                  bqcSource.forEach(function (b) {
                    bqcMap[b.combo || b.label || b.key] = b.odds;
                  });
                } else if (typeof bqcSource === 'object') {
                  // halfFull 格式: { hh: 2.45, hd: 14.50, ... }
                  Object.keys(bqcSource).forEach(function (k) {
                    const label = hfToLabel[k] || k;
                    bqcMap[label] = bqcSource[k];
                  });
                }
                bqcOrder.forEach(function (c) {
                  if (bqcMap[c] != null) {
                    result.bqc.push({ combo: c, odds: bqcMap[c] });
                  }
                });
              }
            }

            // ★ SPF 兜底：若 SPF 为空，尝试从 RQSPF handicap=0 行补全；再尝试 allplays 数据
            if (!result.spf.home && !result.spf.draw && !result.spf.away) {
              // 1) RQSPF handicap=0 → 等同于 SPF
              const rq0 = result.rqspfList.find(function (r) {
                return Number(r.handicap) === 0;
              });
              if (rq0 && (rq0.home || rq0.draw || rq0.away)) {
                result.spf = { home: rq0.home || null, draw: rq0.draw || null, away: rq0.away || null };
              }
            }
            if (!result.spf.home && !result.spf.draw && !result.spf.away && dateStr) {
              // 2) 尝试 allplays（跨数据源补全 SPF，不一定在 dayData 中且可能日期不同但 matchNum 相同）
              try {
                const allplaysBackup = getAllplaysData();
                const apDay = allplaysBackup[dateStr] || {};
                const apMatch = apDay['num_' + matchNum] || apDay[matchNum];
                if (apMatch && apMatch.spf) {
                  result.spf = {
                    home: apMatch.spf.home || null,
                    draw: apMatch.spf.draw || null,
                    away: apMatch.spf.away || null,
                  };
                }
              } catch (e3) {}
            }
            if (!result.spf.home && !result.spf.draw && !result.spf.away && dateStr && matchNum) {
              // 3) 尝试 odds_spf_rqspf.json（按日期+比赛编号查找）
              try {
                const spfPath = path.join(__dirname, 'ttyingqiu_data', 'odds_spf_rqspf.json');
                if (fs.existsSync(spfPath)) {
                  const spfData = JSON.parse(fs.readFileSync(spfPath, 'utf8'));
                  const daySpf = spfData[dateStr];
                  if (daySpf && typeof daySpf === 'object') {
                    Object.keys(daySpf).forEach(function (idx) {
                      const entry = daySpf[idx];
                      if (entry && entry.num === matchNum && entry.spf) {
                        result.spf = {
                          home: entry.spf.home || null,
                          draw: entry.spf.draw || null,
                          away: entry.spf.away || null,
                        };
                      }
                    });
                  }
                }
              } catch (e4) {}
            }

            // ★★★ P8: sporttery 兜底赔率（统一 odds-provider） ★★★
            if (
              !oddsEntry ||
              (!result.spf.home && !result.spf.draw && !result.spf.away) ||
              result.rqspfList.length === 0
            ) {
              try {
                const fallback = oddsProvider.getSportteryFallback(database, matchNum);
                if (fallback.spf) {
                  result.spf = fallback.spf;
                }
                if (fallback.rqspf && result.rqspfList.length === 0) {
                  result.rqspfList.push({
                    handicap: fallback.handicap != null ? fallback.handicap : 0,
                    home: fallback.rqspf.home || null,
                    draw: fallback.rqspf.draw || null,
                    away: fallback.rqspf.away || null,
                  });
                }
                if (fallback.jqs && result.jqs.length === 0) result.jqs = fallback.jqs;
                if (fallback.bqc && result.bqc.length === 0) result.bqc = fallback.bqc;
                if (fallback.bf && result.bf.length === 0) result.bf = fallback.bf;
                if (fallback.source) result._source = fallback.source;
              } catch (eSporttery) {
                logger.warn('[match-odds] sporttery 兜底失败: ' + eSporttery.message);
              }
            }

            // ★ SPF 未开售状态检测：RQSPF 有数据但 SPF 为空 → 标记"暂未开售"
            if (!result.spf.home && !result.spf.draw && !result.spf.away && result.rqspfList.length > 0) {
              result.spfStatus = 'pending';
              result.spfNote = 'SPF暂未开售';
            }

            return res.json({ code: 1, data: result });
          } catch (e) {
            logger.error('[match-odds] ' + e.message);
            return res.json({ code: 0, msg: '获取赔率失败: ' + e.message });
          }
        }

        // ★ P2-1: 缓存统计端点（运维可观测）
        case 'cache-stats': {
          try {
            // 1) 核心内存缓存统计
            const coreStats = getCoreCacheStats();

            // 2) 功守道缓存管理器统计
            let gsManagerStats = {};
            try {
              const cm = require('./gongshoudao/cache_manager');
              gsManagerStats = cm.getCacheStats ? cm.getCacheStats() : {};
            } catch (e) {
              gsManagerStats = { error: e.message };
            }

            // 3) 文件缓存大小
            const frc = tryRequire;
            const cacheFiles = [
              { name: 'cache.json', path: path.join(__dirname, 'gongshoudao', 'cache.json') },
              { name: 'stats_bank.json', path: path.join(__dirname, 'stats_bank.json') },
              { name: 'jczq_change_cache.json', path: path.join(__dirname, 'jczq_change_cache.json') },
              { name: 'ai_cache.json', path: path.join(__dirname, 'ai_cache.json') },
              { name: 'batch_index.json', path: path.join(__dirname, 'batch_index.json') },
            ];
            const fileSizes = {};
            cacheFiles.forEach(function (cf) {
              try {
                if (fs.existsSync(cf.path)) {
                  const stat = fs.statSync(cf.path);
                  fileSizes[cf.name] = {
                    sizeKB: Math.round(stat.size / 1024),
                    mtime: stat.mtime.toISOString(),
                  };
                } else {
                  fileSizes[cf.name] = null;
                }
              } catch (e) {
                fileSizes[cf.name] = { error: e.message };
              }
            });

            // 4) WebSocket 客户端统计
            let wsStats = { clients: 0 };
            try {
              const ws = require('./websocket');
              wsStats = { clients: ws.getClientCount ? ws.getClientCount() : 'N/A' };
            } catch (e) {}

            return res.json({
              code: 1,
              data: {
                time: new Date().toISOString(),
                memory: coreStats,
                gongshoudao: gsManagerStats,
                files: fileSizes,
                websocket: wsStats,
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '获取缓存统计失败: ' + e.message });
          }
        }

        // P0: AI 健康采样 — force 单场刷新验证优化链路（生产可调）
        case 'ai-health-check': {
          try {
            var d = new Date();
            var targetDate = data.date || (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
            const deepseek = require('./deepseek');
            const doubao = require('./doubao');
            const dataJson = getDataJson();
            const mMap = dataJson.m || {};
            const matches = Object.values(mMap).filter((m) => m && (m.date || '').slice(0, 10) === targetDate);
            if (matches.length === 0) return res.json({ code: 0, msg: '无今日比赛' });

            // 取推荐数最高的一场做采样
            matches.sort((a, b) => (Number(b.recommNum) || 0) - (Number(a.recommNum) || 0));
            var sample = matches[0];
            var mid = String(sample.matchId || '');
            var level =
              (Number(sample.recommNum) || 0) >= 100 ? 'A' : (Number(sample.recommNum) || 0) >= 30 ? 'B' : 'C';

            var info = {
              matchId: mid,
              homeName: sample.homeName,
              visitName: sample.visitName,
              leagueName: sample.leagueName,
              date: sample.date,
              num: sample.num,
            };

            var start = Date.now();
            var results = await Promise.all([
              deepseek.generateAnalysis(info).catch(function (e) {
                return { _err: e.message };
              }),
              doubao.generateAnalysis(info).catch(function (e) {
                return { _err: e.message };
              }),
            ]);
            var elapsed = Math.round((Date.now() - start) / 100) / 10;

            return res.json({
              code: 1,
              data: {
                sample: info.num + ' ' + info.homeName + ' vs ' + info.visitName,
                level: level,
                elapsedSec: elapsed,
                deepseek: results[0]._err ? 'FAIL:' + results[0]._err.slice(0, 40) : 'OK',
                doubao: results[1]._err ? 'FAIL:' + results[1]._err.slice(0, 40) : 'OK',
                dbsize: fs.existsSync(path.join(__dirname, 'midou_data.db'))
                  ? Math.round(fs.statSync(path.join(__dirname, 'midou_data.db')).size / 1024) + 'KB'
                  : 'N/A',
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: 'AI检查失败: ' + e.message });
          }
        }

        // ═══════════════════════════════════════════
        //  用户自定义方案 API（匿名 deviceId 体系）
        // ═══════════════════════════════════════════

        case 'my-plan-save': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId) return res.json({ code: 0, msg: '缺少用户标识' });
            const plan = data.plan || {};
            if (!plan.matches || plan.matches.length === 0) return res.json({ code: 0, msg: '方案不能为空' });
            // ★ 单关校验：BF/JQS/BQC 天生单关，SPF/RQSPF 需要 isSingleGame 标记
            var _uniqueMatchIds = {};
            plan.matches.forEach(function (m) {
              _uniqueMatchIds[m.matchId] = true;
            });
            var _uniqueCount = Object.keys(_uniqueMatchIds).length;
            if (_uniqueCount === 1) {
              var _hasSPF_RQSPF = plan.matches.some(function (m) {
                return m.playType === 'spf' || m.playType === 'rqspf';
              });
              if (_hasSPF_RQSPF && plan.matches[0].isSingleGame !== true) {
                return res.json({ code: 0, msg: '该场比赛未标记为单关场次，不支持单关胜平负投注' });
              }
            }
            // ★ 串关规则：同场比赛只能用同一玩法
            if (_uniqueCount >= 2) {
              var _matchPlayMap = {};
              var _playNames = { spf: '胜平负', rqspf: '让球胜平负', bf: '比分', jqs: '总进球', bqc: '半全场' };
              for (var _mi = 0; _mi < plan.matches.length; _mi++) {
                var _pm = plan.matches[_mi];
                if (!_matchPlayMap[_pm.matchId]) {
                  _matchPlayMap[_pm.matchId] = _pm.playType;
                } else if (_matchPlayMap[_pm.matchId] !== _pm.playType) {
                  return res.json({
                    code: 0,
                    msg:
                      '串关规则：同场比赛只能用同一玩法（' +
                      (_pm.homeName || '') +
                      ' vs ' +
                      (_pm.visitName || '') +
                      ' 同时选择了 ' +
                      (_playNames[_matchPlayMap[_pm.matchId]] || _matchPlayMap[_pm.matchId]) +
                      ' 和 ' +
                      (_playNames[_pm.playType] || _pm.playType) +
                      '）',
                  });
                }
              }
            }
            // ★ 允许串关方案中同场多次选择（比分/总进球/半全场可多选方向）
            const plans = readUserPlans(deviceId);
            const now = new Date().toISOString();
            if (plan.id) {
              // 更新已有方案
              const idx = plans.findIndex(function (p) {
                return p.id === plan.id;
              });
              if (idx >= 0) {
                plan.updatedAt = now;
                plans[idx] = Object.assign({}, plans[idx], plan, { createdAt: plans[idx].createdAt || now });
              } else {
                plan.id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                plan.createdAt = now;
                plan.updatedAt = now;
                plans.push(plan);
              }
            } else {
              plan.id = 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
              plan.createdAt = now;
              plan.updatedAt = now;
              plans.push(plan);
            }
            writeUserPlans(deviceId, plans);
            return res.json({ code: 1, data: { id: plan.id, total: plans.length } });
          } catch (e) {
            logger.error('[my-plan-save] ' + e.message);
            return res.json({ code: 0, msg: '保存失败: ' + e.message });
          }
        }

        case 'my-plan-list': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId)
              return res.json({ code: 1, data: { plans: [], stats: { count: 0, income: 0, hitRate: 0 } } });
            var plans = readUserPlans(deviceId);
            // 按更新时间倒序
            plans.sort(function (a, b) {
              return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
            });
            // ★ 重新计算方案开奖状态（基于最新比赛结果）
            var dirty = false;
            plans = plans.map(function (p) {
              var r = recalcPlanResult(p);
              if (r !== p) dirty = true;
              return r;
            });
            // 如果方案状态有更新，回写到文件
            if (dirty) {
              writeUserPlans(deviceId, plans);
            }
            // 计算统计
            var stats = computeUserPlanStats(plans);
            return res.json({ code: 1, data: { plans: plans, stats: stats } });
          } catch (e) {
            logger.error('[my-plan-list] ' + e.message);
            return res.json({ code: 0, msg: '获取失败: ' + e.message });
          }
        }

        case 'my-plan-reconcile': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId) return res.json({ code: 1, data: { items: {}, total: 0 } });

            var plans = readUserPlans(deviceId) || [];
            var planIds = Array.isArray(data.planIds) ? data.planIds.map(String) : [];
            var planId = data.planId != null ? String(data.planId) : '';

            if (planId && planIds.indexOf(planId) < 0) planIds.push(planId);
            if (planIds.length > 0) {
              var idSet = {};
              for (var ii = 0; ii < planIds.length; ii++) idSet[planIds[ii]] = true;
              plans = plans.filter(function (p) {
                return !!idSet[String(p.id || '')];
              });
            }

            var items = {};
            plans.forEach(function (p) {
              try {
                items[p.id] = buildPlanReconcile(p);
              } catch (innerErr) {
                items[p.id] = { planId: p.id, error: innerErr.message, hasDrift: true };
              }
            });

            return res.json({ code: 1, data: { items: items, total: Object.keys(items).length } });
          } catch (e) {
            logger.error('[my-plan-reconcile] ' + e.message);
            return res.json({ code: 0, msg: '对账失败: ' + e.message });
          }
        }

        case 'my-plan-delete': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            const planId = data.planId;
            if (!deviceId || !planId) return res.json({ code: 0, msg: '缺少参数' });
            var plans = readUserPlans(deviceId);
            var before = plans.length;
            plans = plans.filter(function (p) {
              return p.id !== planId;
            });
            if (plans.length === before) return res.json({ code: 0, msg: '方案不存在' });
            writeUserPlans(deviceId, plans);
            return res.json({ code: 1, data: { deleted: true, total: plans.length } });
          } catch (e) {
            logger.error('[my-plan-delete] ' + e.message);
            return res.json({ code: 0, msg: '删除失败: ' + e.message });
          }
        }

        case 'my-plan-stats': {
          try {
            const deviceId = req.headers['x-device-id'] || data.deviceId;
            if (!deviceId) return res.json({ code: 1, data: { count: 0, income: 0, hitRate: 0 } });
            var plans = readUserPlans(deviceId);
            // ★ 重新计算方案开奖状态
            plans = plans.map(function (p) {
              return recalcPlanResult(p);
            });
            var stats = computeUserPlanStats(plans);
            return res.json({ code: 1, data: stats });
          } catch (e) {
            logger.error('[my-plan-stats] ' + e.message);
            return res.json({ code: 0, msg: '获取统计失败: ' + e.message });
          }
        }

        case 'batch-match-odds': {
          try {
            var matchIds = data.matchIds || [];
            if (!matchIds.length) return res.json({ code: 1, data: {} });
            var result = {};
            var dateStr = data.date || latestDataDate();
            var oddsMap = getOddsHistory(dateStr) || {};
            var dataFile = getDataJson();
            var mMap = (dataFile && dataFile.m) || {};
            // 实时数据兜底（data.json 无当天数据时用 match-list 已缓存的 ensureData）
            var liveMap = null;
            for (var i2 = 0; i2 < matchIds.length; i2++) {
              var mid = matchIds[i2];
              // ★ 兼容 m_ 前缀和无前缀两种 key 格式
              var m = mMap[mid] || mMap['m_' + mid] || mMap[mid.replace(/^m_/, '')];
              if (!m) {
                // 遍历查找匹配（data.json key 可能是 "数字_数字" 格式）
                var midStr = String(mid).replace(/^m_/, '');
                var mKeys = Object.keys(mMap);
                for (var ki = 0; ki < mKeys.length; ki++) {
                  var rawKey = mKeys[ki].replace(/^m_/, '');
                  if (rawKey === midStr) {
                    m = mMap[mKeys[ki]];
                    break;
                  }
                }
              }
              if (!m) {
                // ★ 兜底：data.json 无当天数据时，match-list 已缓存 ensureData 到内存
                if (!liveMap) {
                  try {
                    liveMap = await ensureData();
                  } catch (e2) {
                    liveMap = null;
                  }
                }
                if (liveMap) {
                  var midStr2 = String(mid).replace(/^m_/, '');
                  for (var li = 0; li < liveMap.length; li++) {
                    var lm = liveMap[li];
                    if (String(lm.matchId) === midStr2 || 'm_' + lm.matchId === mid) {
                      m = lm;
                      break;
                    }
                  }
                }
              }
              if (!m) {
                result[mid] = null;
                continue;
              }
              var dateKey = (m.date || '').slice(0, 10);
              // ★ oddsMap 的 key 是竞彩编号（如 "周二201"），需用 m.num 匹配
              var matchNum = m.num || m.matchNum || '';
              // ★ 赔率查找：统一入口（直接匹配 + 去星期前缀匹配）
              var oddsEntry = oddsProvider.findOddsEntryByMatchNum(oddsMap, matchNum);
              if (!oddsEntry && dateKey) {
                var dateOddsMap = getOddsHistory(dateKey);
                if (dateOddsMap) oddsEntry = dateOddsMap[matchNum] || null;
              }
              oddsEntry = oddsEntry || {};
              // ★ B: 扩大多日期赔率扫描 — 主链+dateKey都找不到时扫描最近30天
              if (!oddsEntry.spf && !oddsEntry.rqspf && matchNum) {
                var scanBase = dateKey || dateStr;
                if (scanBase) {
                  var sd2 = localDate(new Date(new Date(scanBase).getTime()));
                  for (var sdi = 0; sdi < 30 && !(oddsEntry.spf || oddsEntry.rqspf); sdi++) {
                    sd2 = localDate(new Date(new Date(sd2).getTime() - 86400000));
                    var scanMap = getOddsHistory(sd2);
                    if (scanMap) {
                      var found2 = oddsProvider.findOddsEntryByMatchNum(scanMap, matchNum);
                      if (found2 && (found2.spf || found2.rqspf)) oddsEntry = found2;
                    }
                  }
                }
              }
              // ★ 赔率变动方向（Delta）
              var isSingleGame = false;
              try {
                var deltaLogs = getDeltaHistory(path.join(__dirname, 'odds_history'), dateKey, matchNum);
                if (deltaLogs && deltaLogs.length > 0) {
                  var last = deltaLogs[deltaLogs.length - 1];
                  if (last.changes) {
                    Object.keys(last.changes).forEach(function (k) {
                      var changeStr = last.changes[k];
                      var parts = changeStr.split('→');
                      if (parts.length === 2) {
                        var oldV = parseFloat(parts[0]);
                        var newV = parseFloat(parts[1]);
                        if (oldV > 0 && newV > 0) {
                          last.changes[k] = newV > oldV ? 'up' : newV < oldV ? 'down' : 'flat';
                        }
                      }
                    });
                  }
                }
                // 读取单关标识（odds_history → data.json → allplays 三级兜底）
                var oddsEntryFull = oddsMap[matchNum] || {};
                // P0: allplays.json 兜底 — 当日 odds_history 缺失时仍可获取单关标记
                var apDayBatch = getAllplaysData()[dateKey] || {};
                var apEntryBatch = apDayBatch[matchNum] || apDayBatch['num_' + matchNum] || null;
                var apIsSingleBatch = !!(apEntryBatch && apEntryBatch.isSingleGame);
                isSingleGame = oddsEntryFull.isSingleGame === true || m.isSingleGame === true || apIsSingleBatch;
              } catch (e) {
                /* delta 读取失败不影响主流程 */
              }

              // ★ 构建按玩法分组的 Delta 摘要 + 方向映射
              var deltaChanges = (deltaLogs && deltaLogs.length > 0 && deltaLogs[deltaLogs.length - 1].changes) || {};
              var groupedDelta = _groupDeltaByPlay(deltaChanges);

              // ★ 构建赔率走势信号（最后 N 次变化的方向趋势）
              var deltaTrend = _buildDeltaTrend(deltaLogs || []);

              // ★★★ 统一 sporttery 兜底（odds-provider）★★★
              var sportteryFallback = oddsProvider.getSportteryFallback(database, matchNum);
              var sportteryRqspf = sportteryFallback.rqspf;
              var sportteryHandicap = sportteryFallback.handicap;
              var sportteryBqc = sportteryFallback.bqc;
              var sportteryBf = sportteryFallback.bf;
              var sportteryJqs = sportteryFallback.jqs;

              var r = {
                matchId: mid,
                homeName: m.homeName || '',
                visitName: m.visitName || '',
                league: m.leagueName || '',
                matchDate: dateKey,
                matchNum: matchNum,
                halfScore: m.half || '',
                spf: oddsEntry.spf || sportteryFallback.spf || null,
                rqspf: oddsEntry.rqspf || sportteryRqspf || null,
                // ★ 转换为前端期望的数组格式
                // ★ 统一降级链：allplays/odds_history → _safeArray(空数组→null) → sporttery_odds_snapshot
                jqs: _safeArray(_convertJqsToArray(oddsEntry.jqs || oddsEntry.totalGoals)) || sportteryJqs,
                bqc: _safeArray(_convertBqcToArray(oddsEntry.bqc || oddsEntry.halfFull)) || sportteryBqc,
                bf: _safeArray(_convertBfToArray(oddsEntry.bf || oddsEntry.scores)) || sportteryBf,
                // ★ 四级降级链 — 顶层handicap → sporttery → rqspf.handicap → match.concede → 0
                handicap:
                  oddsEntry.handicap != null
                    ? oddsEntry.handicap
                    : sportteryHandicap != null
                      ? sportteryHandicap
                      : oddsEntry.rqspf && oddsEntry.rqspf.handicap != null
                        ? oddsEntry.rqspf.handicap
                        : m.concede || 0,
                isSingleGame: isSingleGame,
                oddsDelta: deltaChanges,
                // ★ 赔率走势信号（最近变化趋势，用于前端迷你趋势可视化）
                deltaTrend: deltaTrend,
                // ★ 按玩法分组的 Delta（前端用来渲染各区域的箭头和摘要）
                spfDelta: groupedDelta.spf || {},
                rqspfDelta: groupedDelta.rqspf || {},
                bfDelta: groupedDelta.scores || {},
                jqsDelta: groupedDelta.totalGoals || {},
                bqcDelta: groupedDelta.halfFull || {},
                // ★ 各玩法 Delta 摘要（前端显示 ↑N ↓M →K 趋势）
                spfDeltaSummary: groupedDelta.spfSummary || { up: 0, down: 0, flat: 0 },
                rqspfDeltaSummary: groupedDelta.rqspfSummary || { up: 0, down: 0, flat: 0 },
                bfDeltaSummary: groupedDelta.scoresSummary || { up: 0, down: 0, flat: 0 },
                jqsDeltaSummary: groupedDelta.totalGoalsSummary || { up: 0, down: 0, flat: 0 },
                bqcDeltaSummary: groupedDelta.halfFullSummary || { up: 0, down: 0, flat: 0 },
                concede: m.concede || 0,
                // ★ 推荐方向（用于方案设计页黄色底色标记）
                maxRecommendDirs: getMaxRecommendDirs(dataFile, mid),
              };
              result[mid] = r;
            }
            // ★ SPF 未开售状态检测（逐场检查）
            Object.keys(result).forEach(function (k) {
              var entry = result[k];
              if (!entry) return;
              var spfEmpty = !entry.spf || (!entry.spf.home && !entry.spf.draw && !entry.spf.away);
              if (spfEmpty) {
                entry.spfStatus = 'pending';
                entry.spfNote = 'SPF暂未开售';
              }
            });

            return res.json({ code: 1, data: result });
          } catch (e) {
            logger.error('[batch-match-odds] ' + e.message);
            return res.json({ code: 0, msg: '获取赔率失败: ' + e.message });
          }
        }

        // ★ 蓝图 P0: 多模型预测共识 API
        case 'prediction-fusion': {
          try {
            const { engine } = require('./core/prediction-fusion');
            const { matchId, date } = data;
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};

            // 查找比赛信息
            const key = 'm_' + matchId;
            const match = mMap[key] || mMap[matchId];
            if (!match) return res.json({ code: 0, msg: '比赛未找到' });

            // 获取上下文数据
            const context = {
              dataFile: dataFile,
              gsCache: getGsGlobalMap(),
              odds: getAllplaysData()[match.num] || {},
            };

            const fusionResult = await engine.fuseForMatch(
              { matchId, num: match.num, date: match.date, homeName: match.homeName, visitName: match.visitName },
              context,
            );

            return res.json({ code: 1, data: fusionResult });
          } catch (e) {
            logger.error('[prediction-fusion] ' + e.message);
            return res.json({ code: 0, msg: '预测融合失败: ' + e.message });
          }
        }

        // ★ 蓝图 P1: 模型表现仪表板 API
        case 'model-dashboard': {
          try {
            // ★ P1-3: 5 分钟响应缓存
            var _mdCacheKey = 'md|' + (data.days || '30') + '|' + (data.model || 'all');
            var _mdCached = getCachedResponse('model-dashboard', _mdCacheKey);
            if (_mdCached) return res.json(_mdCached);

            const isAllMd = data.days === 0 || data.days === '0' || data.days === 'all';
            const days = isAllMd ? 3650 : parseInt(data.days) || 30; // 全部=3650天(10年)覆盖2024-2026
            const db = database.getAdapter();
            if (!db) return res.json({ code: 0, msg: '数据库不可用' });

            const { backfiller, INTERNAL_MODEL_NAMES } = require('./core/outcome-backfill');
            const internalModelSql = "'" + INTERNAL_MODEL_NAMES.join("','") + "'";
            let rankings = backfiller.getModelHitRates(db, days);

            // 模型列表
            let models =
              rankings.length > 0
                ? rankings.map((r) => r.modelName)
                : ['功守道', 'PK评分', 'DeepSeek', '豆包', '专家共识', '赔率信号'];

            // ★ 分联赛热力图：从 prediction_outcomes 聚合（不会被 jc-sync 覆盖）
            const leagueHeatmap = {};
            try {
              const leagueRows = db.execAll(
                'SELECT po.match_date as ld, po.model_name as model, ' +
                  'COUNT(*) as total, SUM(po.direction_hit) as hits ' +
                  'FROM prediction_outcomes po ' +
                  'WHERE po.model_name NOT IN (' +
                  internalModelSql +
                  ') ' +
                  'GROUP BY po.match_date, po.model_name ORDER BY po.match_date DESC LIMIT 50',
              );
              // 聚合到模型→联赛映射（match_date as proxy for league grouping）
              const modelMap = {};
              leagueRows.forEach((r) => {
                if (!modelMap[r.model]) modelMap[r.model] = { total: 0, hits: 0 };
                modelMap[r.model].total += r.total || 0;
                modelMap[r.model].hits += r.hits || 0;
              });
              if (Object.keys(modelMap).length > 0) {
                Object.keys(modelMap).forEach((m) => {
                  const v = modelMap[m];
                  leagueHeatmap[m] = { 近30天: v.total > 0 ? Math.round((v.hits / v.total) * 1000) / 10 : 0 };
                });
              }
            } catch (e) {
              logger.error('[md] heatmap query: ' + e.message);
            }

            // ★ 走势图：按日期聚合命中率（从 prediction_outcomes）
            const trendData = [];
            try {
              const trendRows = db.execAll(
                'SELECT match_date, model_name, ' +
                  'COUNT(*) as total, SUM(direction_hit) as hits ' +
                  'FROM prediction_outcomes ' +
                  'WHERE model_name NOT IN (' +
                  internalModelSql +
                  ') ' +
                  'GROUP BY match_date, model_name ORDER BY match_date ASC',
              );
              // Aggregate by model
              const modelSeries = {};
              const allDates = new Set();
              trendRows.forEach((r) => {
                if (!modelSeries[r.model_name]) modelSeries[r.model_name] = {};
                modelSeries[r.model_name][r.match_date] = { t: r.total || 0, h: r.hits || 0 };
                allDates.add(r.match_date);
              });
              const dates = Array.from(allDates).sort();
              Object.keys(modelSeries).forEach((name) => {
                const map = modelSeries[name];
                trendData.push({
                  modelName: name,
                  weeks: dates,
                  values: dates.map((d) => {
                    const v = map[d];
                    return v && v.t > 0 ? Math.round((v.h / v.t) * 1000) / 10 : null;
                  }),
                });
              });
            } catch (e) {
              logger.error('[md] trend query: ' + e.message);
            }

            rankings = enrichModelReliability(rankings, trendData);
            models = rankings.length > 0 ? rankings.map((r) => r.modelName) : models;
            const playMatrix = buildModelPlayMatrix(rankings);
            const reliabilitySummary = buildModelReliabilitySummary(rankings);
            const weightSuggestions = buildReadOnlyWeightSuggestions(rankings);

            var _mdResp = {
              code: 1,
              data: {
                rankings,
                models,
                totalPredictions: rankings.reduce((s, r) => s + r.total, 0),
                topModel: rankings.length > 0 ? rankings[0].modelName : null,
                bestStableModel: reliabilitySummary.bestStableModel,
                leagueHeatmap,
                trendData,
                playMatrix,
                reliabilitySummary,
                weightSuggestions,
              },
            };
            setCachedResponse('model-dashboard', _mdCacheKey, _mdResp);
            return res.json(_mdResp);
          } catch (e) {
            logger.error('[model-dashboard] ' + e.message);
            return res.json({ code: 0, msg: '模型仪表板失败: ' + e.message });
          }
        }

        // ★ P1 Layer 2: 多源赛果核实 API
        case 'verify-results': {
          try {
            const verifier = require('./core/result-verifier');
            const dateStr = data.date || localDate();
            const dataJson = getDataJson();
            const extraSources = []
              .concat(verifier.extractSportterySource ? verifier.extractSportterySource(dateStr) : [])
              .concat(verifier.extractLive500Source ? verifier.extractLive500Source(dateStr) : []);
            const vr = verifier.verifyDate(dateStr, { midouDataJson: dataJson, extraSources: extraSources });
            // 汇总
            var passed = 0,
              lowConf = 0,
              empty = 0;
            vr.results.forEach(function (r) {
              if (r.verified && r.verified.score) {
                if (r.verified.confidence >= 0.67) passed++;
                else lowConf++;
              } else {
                empty++;
              }
            });
            return res.json({
              code: 1,
              data: {
                date: dateStr,
                totalMatches: vr.results.length,
                verifiedPassed: passed,
                verifiedLowConf: lowConf,
                noScore: empty,
                results: vr.results.map(function (r) {
                  return {
                    anchor: r.anchorName,
                    score: r.verified.score,
                    confidence: r.verified.confidence,
                    sources: r.verified.sourceVotes,
                  };
                }),
              },
            });
          } catch (e) {
            return res.json({ code: 0, msg: '核实失败: ' + e.message });
          }
        }

        // ★ 蓝图 P2: 数据健康监控 API
        case 'data-health': {
          try {
            // ★ P1-3: 10 分钟响应缓存
            var _dhCacheKey = 'dh|' + (data.days || '7');
            var _dhCached = getCachedResponse('data-health', _dhCacheKey);
            if (_dhCached) return res.json(_dhCached);
            const db = database.getAdapter();
            const { monitor } = require('./core/data-quality');

            // "全部" → days=0 或 "0" → 365天全覆盖
            const isAll = data.days === 0 || data.days === '0' || data.days === 'all';
            const days = isAll ? 365 : parseInt(data.days) || 1;
            const today = new Date().toISOString().slice(0, 10);
            // 筛选起始日期
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            const targetDate = startDate.toISOString().slice(0, 10);
            let matchCount = 0,
              completenessRate = 0;

            if (db) {
              // Use prediction_logs for historical data coverage stats
              let totalCompleteness = 0;
              let dateCount = 0;
              let totalMatches = 0;
              for (let d = 0; d < days; d++) {
                const checkDate = new Date();
                checkDate.setDate(checkDate.getDate() - d);
                const dateStr = checkDate.toISOString().slice(0, 10);

                // Count completed matches on that date from prediction_logs
                const dayMatch = db.execOne(
                  "SELECT COUNT(*) as cnt FROM prediction_logs WHERE date = ? AND actual_score IS NOT NULL AND actual_score != ''",
                  dateStr,
                );
                const mc = (dayMatch && dayMatch.cnt) || 0;
                totalMatches += mc;

                // Count how many have AI + GS + PK
                const dayComplete = db.execOne(
                  "SELECT COUNT(*) as cnt FROM prediction_logs WHERE date = ? AND actual_score IS NOT NULL AND actual_score != '' AND ai_spf IS NOT NULL AND ai_spf != '' AND gs_top_score IS NOT NULL AND pk_direction IS NOT NULL",
                  dateStr,
                );
                const complete = (dayComplete && dayComplete.cnt) || 0;
                totalCompleteness += mc > 0 ? complete / mc : 0;
                dateCount++;
              }
              matchCount = totalMatches;
              completenessRate = dateCount > 0 ? Math.round((totalCompleteness / dateCount) * 100) : 0;
              if (completenessRate > 100) completenessRate = 100;
            }

            const report = monitor.getReport();

            // 构建数据源状态（跟随筛选范围）
            const fetchSources = {};
            if (db) {
              try {
                // 筛选范围内的 prediction_logs 赛果数
                const filteredPredCount =
                  (
                    db.execOne(
                      "SELECT COUNT(*) as cnt FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != '' AND date >= ?",
                      targetDate,
                    ) || {}
                  ).cnt || 0;
                fetchSources['筛选赛果'] = {
                  total: filteredPredCount,
                  success: filteredPredCount,
                  rate: 1.0,
                  timestamp: new Date().toISOString(),
                };

                // 筛选范围内的三模型齐数
                const filteredTriple =
                  (
                    db.execOne(
                      "SELECT COUNT(*) as cnt FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != '' AND ai_spf IS NOT NULL AND ai_spf != '' AND gs_top_score IS NOT NULL AND pk_direction IS NOT NULL AND date >= ?",
                      targetDate,
                    ) || {}
                  ).cnt || 0;
                fetchSources['三模型齐全'] = {
                  total: filteredPredCount,
                  success: filteredTriple,
                  rate: filteredPredCount > 0 ? Math.round((filteredTriple / filteredPredCount) * 100) / 100 : 0,
                  timestamp: new Date().toISOString(),
                };
              } catch (e) {}
            }
            // 功守道全量缓存（始终显示全部）
            const gsPath = path.join(__dirname, 'gongshoudao', 'cache.json');
            if (fs.existsSync(gsPath)) {
              try {
                const gsData = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
                const gsCount = Object.keys(gsData['_global'] || {}).length;
                fetchSources['功守道缓存'] = {
                  total: gsCount,
                  success: gsCount,
                  rate: 1.0,
                  timestamp: new Date().toISOString(),
                };
              } catch (e) {}
            }

            var _dhResp = {
              code: 1,
              data: {
                fetchSources,
                completeness: Math.round(completenessRate),
                matchCount,
                date: targetDate,
                dateLabel: isAll ? '全部历史' : '近' + days + '天',
                recentAlerts: report.recentAlerts,
                dbSize: {
                  sizeMB: (function () {
                    var p = path.join(__dirname, 'midou_data.db');
                    return fs.existsSync(p) ? Math.round((fs.statSync(p).size / 1048576) * 10) / 10 : 0;
                  })(),
                },
                thresholds: report.thresholds,
              },
            };
            setCachedResponse('data-health', _dhCacheKey, _dhResp);
            return res.json(_dhResp);
          } catch (e) {
            logger.error('[data-health] ' + e.message);
            return res.json({ code: 0, msg: '数据健康失败: ' + e.message });
          }
        }

        // ★ 蓝图：实验对比（Prompt版本A/B对比）
        case 'experiment-compare': {
          try {
            const adp = database.getAdapter();
            if (!adp) return res.json({ code: 0, msg: '数据库不可用' });

            // 按 ai_content 的 hash 分组（近似版本分组）
            const types = ['deepseek', 'doubao', 'ai_combined'];
            const results = {};

            for (const type of types) {
              try {
                const rows = adp.execAll(
                  `SELECT ai_content, ai_version, COUNT(*) as total,
                   SUM(CASE WHEN ai_hit=1 THEN 1 ELSE 0 END) as hits,
                   AVG(CASE WHEN ai_confidence>0 THEN ai_confidence END) as avg_confidence
                   FROM prediction_logs
                   WHERE ai_content IS NOT NULL AND ai_content != '' AND ai_hit IS NOT NULL
                   GROUP BY COALESCE(ai_version, substr(ai_content,1,20))
                   ORDER BY total DESC LIMIT 10`,
                );
                if (rows.length > 0)
                  results[type] = rows.map((r) => ({
                    version: r.ai_version || 'unknown',
                    total: r.total,
                    hits: r.hits,
                    hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 10 : 0,
                    avgConfidence: r.avg_confidence ? Math.round(r.avg_confidence * 100) / 100 : null,
                  }));
              } catch (e) {}
            }

            // Fallback: 从 prediction_logs 查所有记录聚合
            if (Object.keys(results).length === 0) {
              try {
                const allRows = adp.execAll(
                  `SELECT model_version, COUNT(*) as total,
                   SUM(direction_hit) as hits
                   FROM prediction_outcomes
                   WHERE direction_hit IS NOT NULL
                   GROUP BY model_version ORDER BY total DESC LIMIT 10`,
                );
                if (allRows.length > 0) {
                  results.outcomes = allRows.map((r) => ({
                    version: r.model_version || 'unknown',
                    total: r.total,
                    hits: r.hits,
                    hitRate: r.total > 0 ? Math.round((r.hits / r.total) * 1000) / 10 : 0,
                  }));
                }
              } catch (e) {}
            }

            return res.json({ code: 1, data: results });
          } catch (e) {
            return res.json({ code: 0, msg: 'experiment-compare error: ' + e.message });
          }
        }

        // ★ 蓝图：批量共识数据（供 plans.js 过滤用）
        case 'batch-consensus': {
          const batchDate = data.date || latestDataDate();
          try {
            const dataFile = getDataJson();
            const mMap = dataFile.m || {};
            const rMap = dataFile.r || {};
            const gsMap = getGsGlobalMap();
            const results = {};

            Object.keys(mMap).forEach(function (k) {
              const m = mMap[k];
              if (!m || m.date !== batchDate) return;
              const matchId = m.matchId || k.replace(/^m_/, '');
              const key = 'm_' + matchId;
              const recsRaw = rMap[key] || rMap[String(matchId)] || [];
              const gs = gsMap[matchId] || gsMap[key] || {};

              // 简单共识计算
              const models = [];
              if (gs.fusionConsensusType) {
                models.push({
                  model: '功守道',
                  direction: gs.directionAdvantage ? gs.directionAdvantage.direction : null,
                  confidence: gs.directionAdvantage ? gs.directionAdvantage.confidence : null,
                });
              }
              // 专家共识
              if (recsRaw.length > 0) {
                const dirMap = { home: 0, draw: 0, away: 0 };
                let total = 0;
                recsRaw.forEach(function (r) {
                  const n = r.n || r.num || 1;
                  total += n;
                  const t = r.t || r.type || '';
                  if (['胜', '主胜'].includes(t)) dirMap.home += n;
                  else if (['平', '平局'].includes(t)) dirMap.draw += n;
                  else if (['负', '客胜'].includes(t)) dirMap.away += n;
                });
                const top = Object.entries(dirMap).sort(function (a, b) {
                  return b[1] - a[1];
                })[0];
                if (top && top[1] > 0)
                  models.push({ model: '专家', direction: top[0], confidence: Math.round((top[1] / total) * 100) });
              }

              if (models.length === 0) return;
              const dirMap2 = {};
              models.forEach(function (m) {
                if (m.direction) dirMap2[m.direction] = (dirMap2[m.direction] || 0) + 1;
              });
              const main = Object.entries(dirMap2).sort(function (a, b) {
                return b[1] - a[1];
              })[0];
              if (!main) return;
              const ratio = main[1] / models.length;
              results[matchId] = {
                models: models,
                direction: main[0],
                agreeCount: main[1],
                totalCount: models.length,
                consensus: ratio >= 0.8 ? 'strong' : ratio >= 0.6 ? 'weak' : 'neutral',
                gsConsensus: gs.fusionConsensusType || null,
              };
            });
            return res.json({ code: 1, data: results });
          } catch (e) {
            return res.json({ code: 0, msg: 'batch-consensus error: ' + e.message });
          }
        }

        // ★ V9.1: 支付/订阅/返利 action 拦截（由 server/payments/index.js 统一处理）
        case 'payment-create-order':
        case 'payment-query-order':
        case 'plan-catalog':
        case 'subscription-status':
        case 'subscription-renew':
        case 'subscription-cancel-auto-renew':
        case 'subscription-enable-auto-renew':
        case 'vip-gift-claim':
        case 'vip-gift-status':
        case 'admin-subscription-list':
        case 'admin-grant-subscription':
        case 'referral-info':
        case 'referral-account':
        case 'referral-commissions':
        case 'referral-withdraw-submit':
        case 'referral-withdraw-history':
        case 'simulate-pay':
        case 'admin-referral-commissions':
        case 'admin-referral-accounts':
        case 'admin-referral-withdraw-list':
        case 'admin-referral-withdraw-process': {
          // 将 authSession 与解包后的 data 注入 req，供 payments 模块复用
          req.authSession = authSession;
          req.body = data;
          const handled = await payments.handleAction(action, req, res);
          if (handled !== false) return;
          return res.json({ code: 0, msg: `未知 action: ${action}` });
        }

        default:
          return res.json({ code: 0, msg: `未知 action: ${action}` });
      }
    } catch (err) {
      logger.error('API错误: ' + err.message);
      // 尝试清除缓存并重试
      if (err.message.includes('登录') || err.message.includes('token')) {
        cache.token = null;
      }
      return res.json({ code: 0, msg: err.message });
    }
  });

  // ═══ 用户方案存储辅助函数 ═══
  var USER_PLANS_DIR = path.join(__dirname, 'user_plans');
  function getUserPlansPath(deviceId) {
    // 消毒 deviceId，防止路径穿越
    var safe = String(deviceId).replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safe) safe = 'unknown';
    return path.join(USER_PLANS_DIR, safe + '.json');
  }
  function readUserPlans(deviceId) {
    try {
      var fp = getUserPlansPath(deviceId);
      if (fs.existsSync(fp)) {
        return JSON.parse(fs.readFileSync(fp, 'utf8'));
      }
    } catch (e) {
      /* ignore */
    }
    return [];
  }
  function writeUserPlans(deviceId, plans) {
    try {
      if (!fs.existsSync(USER_PLANS_DIR)) fs.mkdirSync(USER_PLANS_DIR, { recursive: true });
      var fp = getUserPlansPath(deviceId);
      fs.writeFileSync(fp, JSON.stringify(plans, null, 2), 'utf8');
    } catch (e) {
      logger.error('[user_plans] 写入失败: ' + e.message);
    }
  }

  function _round2(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
  }

  function _normStatus(v) {
    if (v === true) return 'won';
    if (v === false) return 'lost';
    return 'pending';
  }

  function _resolvePlanMatchOutcome(match, planDate) {
    var dateStr = String(match.matchDate || match.date || planDate || '').slice(0, 10);
    if (!dateStr) return null;
    var overlay = getPlanOutcomeOverlay(dateStr) || { byId: {}, byNum: {} };
    var mid = match.matchId != null ? String(match.matchId).replace(/^m_/, '') : '';
    var num = match.matchNum ? String(match.matchNum) : '';
    var row = (mid && overlay.byId[mid]) || (num && overlay.byNum[num]) || null;
    if (!row || !row.score) return null;
    return {
      score: normalizeScoreText(row.score),
      source: row.source || 'unknown',
      matchStatus: row.matchStatus,
    };
  }

  function _calcPlanOddsRaw(plan) {
    var matches = Array.isArray(plan && plan.matches) ? plan.matches : [];
    if (matches.length === 0) return { totalOdds: 0, passOdds: {}, bestProductK: 0 };

    var grouped = {};
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i] || {};
      var key = String(m.matchId || m.matchNum || 'unknown_' + i);
      var od = Number(m.odds);
      if (!grouped[key]) grouped[key] = [];
      if (!isNaN(od) && od > 0) grouped[key].push(od);
    }

    var matchIds = Object.keys(grouped);
    var maxOdds = {};
    for (var mi = 0; mi < matchIds.length; mi++) {
      var mk = matchIds[mi];
      var arr = grouped[mk] || [];
      maxOdds[mk] = arr.length ? Math.max.apply(null, arr) : 1;
    }

    var passTypes =
      plan && Array.isArray(plan.passTypes) && plan.passTypes.length > 0
        ? plan.passTypes
        : matchIds.length <= 1
          ? [1]
          : [2];

    var passOdds = {};
    var bestProduct = 1;
    var bestProductK = 0;

    for (var pi = 0; pi < passTypes.length; pi++) {
      var k = Number(passTypes[pi]) || 0;
      if (k < 1 || k > matchIds.length) continue;
      var sorted = matchIds
        .map(function (mid) {
          return Number(maxOdds[mid]) || 1;
        })
        .sort(function (a, b) {
          return b - a;
        });
      var product = 1;
      for (var sj = 0; sj < k; sj++) product *= sorted[sj];
      product = _round2(product);
      passOdds[k] = product;
      if (product > bestProduct) {
        bestProduct = product;
        bestProductK = k;
      }
    }

    var betCount = Number(plan && plan.betCount);
    if (!(betCount > 0)) betCount = 1;
    var multiplier = Number(plan && plan.multiplier);
    if (!(multiplier > 0)) multiplier = 1;

    var maxWin = _round2(2 * multiplier * bestProduct);
    var totalOdds = betCount > 0 ? _round2(maxWin / (betCount * 2)) : 0;

    return { totalOdds: totalOdds, passOdds: passOdds, bestProductK: bestProductK };
  }

  function buildPlanReconcile(plan) {
    var safePlan = plan || {};
    var recalc = recalcPlanResult(JSON.parse(JSON.stringify(safePlan)));
    var matches = Array.isArray(safePlan.matches) ? safePlan.matches : [];

    var scoreItems = [];
    var scoreDriftCount = 0;
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i] || {};
      var raw = _resolvePlanMatchOutcome(m, safePlan.date || safePlan.matchDate || '');
      var rawScore = raw && raw.score ? raw.score : '';
      var aggScore = normalizeScoreText(m.actualScore || '');
      var isDrift = rawScore !== aggScore;
      if (isDrift) scoreDriftCount++;
      scoreItems.push({
        matchId: m.matchId || '',
        matchNum: m.matchNum || '',
        rawScore: rawScore || '--',
        aggScore: aggScore || '--',
        source: (raw && raw.source) || '--',
        drift: isDrift,
      });
    }

    var aggStatus = _normStatus(safePlan.isWon);
    var rawStatus = _normStatus(recalc.isWon);
    var aggIncome =
      safePlan.resultIncome != null
        ? _round2(safePlan.resultIncome)
        : aggStatus === 'lost'
          ? 0
          : safePlan.totalOdds && safePlan.amount
            ? _round2(Number(safePlan.totalOdds) * Number(safePlan.amount))
            : null;
    var rawIncome =
      recalc.resultIncome != null
        ? _round2(recalc.resultIncome)
        : rawStatus === 'lost'
          ? 0
          : recalc.totalOdds && recalc.amount
            ? _round2(Number(recalc.totalOdds) * Number(recalc.amount))
            : null;
    var bonusDrift =
      rawStatus !== aggStatus ||
      ((rawIncome != null || aggIncome != null) && _round2(rawIncome || 0) !== _round2(aggIncome || 0));

    var rawOdds = _calcPlanOddsRaw(safePlan);
    var aggTotalOdds = _round2(safePlan.totalOdds || 0);
    var rawTotalOdds = _round2(rawOdds.totalOdds || 0);
    var oddsDrift = aggTotalOdds !== rawTotalOdds;
    var aggPassOdds = {};
    var pPass = safePlan.passOdds || {};
    Object.keys(pPass).forEach(function (k) {
      var val = pPass[k];
      aggPassOdds[k] = _round2(val && val.bestProduct != null ? val.bestProduct : val);
    });
    var rawPassOdds = {};
    var passDrifts = [];
    Object.keys(rawOdds.passOdds || {}).forEach(function (k) {
      rawPassOdds[k] = _round2(rawOdds.passOdds[k]);
    });
    var passKeys = Array.from(new Set(Object.keys(aggPassOdds).concat(Object.keys(rawPassOdds))));
    for (var pk = 0; pk < passKeys.length; pk++) {
      var key = passKeys[pk];
      var aggV = _round2(aggPassOdds[key] || 0);
      var rawV = _round2(rawPassOdds[key] || 0);
      if (aggV !== rawV) {
        oddsDrift = true;
        passDrifts.push({ passType: key, raw: rawV, agg: aggV });
      }
    }

    return {
      planId: safePlan.id || '',
      hasDrift: scoreDriftCount > 0 || bonusDrift || oddsDrift,
      score: {
        driftCount: scoreDriftCount,
        total: scoreItems.length,
        items: scoreItems,
      },
      bonus: {
        rawStatus: rawStatus,
        aggStatus: aggStatus,
        rawIncome: rawIncome,
        aggIncome: aggIncome,
        drift: bonusDrift,
      },
      odds: {
        rawTotalOdds: rawTotalOdds,
        aggTotalOdds: aggTotalOdds,
        rawPassOdds: rawPassOdds,
        aggPassOdds: aggPassOdds,
        passDrifts: passDrifts,
        drift: oddsDrift,
      },
    };
  }

  function computeUserPlanStats(plans) {
    var count = (plans || []).length;
    var income = 0,
      won = 0,
      totalLoss = 0;
    (plans || []).forEach(function (p) {
      if (p.resultIncome != null) income += Number(p.resultIncome) || 0;
      if (p.isWon) won++;
      else if (p.isWon === false) totalLoss += Number(p.amount) || 0;
    });
    // 只统计有结果的方案（已开奖）
    var settled = (plans || []).filter(function (p) {
      return p.isWon === true || p.isWon === false;
    });
    var hitRate = settled.length > 0 ? Math.round((won / settled.length) * 100) : 0;
    return { count: count, income: Math.round(income - totalLoss), hitRate: hitRate };
  }

  // ★ 重新计算单个方案的 isWon / resultIncome（基于最新比赛结果）
  // P0: 支持组合过关（passTypes=[2,3]等）按 C(wonCount, k) 判定中奖
  var _recalcLiveScoresCache = null;
  var _recalcLiveScoresCacheTime = 0;

  function combinations(n, k) {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    var result = 1;
    for (var i = 1; i <= k; i++) {
      result = (result * (n - k + i)) / i;
    }
    return Math.round(result);
  }

  function recalcPlanResult(plan) {
    var matches = plan.matches || [];
    if (matches.length === 0) return plan;

    // 如果方案已经有明确的 isWon 结果，不再重算
    if (plan.isWon === true || plan.isWon === false) return plan;

    var dataFile = getDataJson();
    var mMap = dataFile.m || {};

    // 构建 matchNum 索引（优先 date|num，避免竞彩编号跨日期串写）
    var mByNum = {};
    var mByDateNum = {};
    Object.keys(mMap).forEach(function (k) {
      var entry = mMap[k];
      if (entry && entry.num) {
        var num = String(entry.num);
        var dateStr = String(entry.date || '').slice(0, 10);
        mByNum[num] = entry;
        if (dateStr) mByDateNum[dateStr + '|' + num] = entry;
      }
    });

    // 加载 live_scores.json（1 分钟缓存）
    var now = Date.now();
    if (!_recalcLiveScoresCache || now - _recalcLiveScoresCacheTime > 60000) {
      _recalcLiveScoresCache = { byId: {}, byDateNum: {}, byNum: {} };
      try {
        var lsPath = path.join(__dirname, 'live_scores.json');
        if (fs.existsSync(lsPath)) {
          var lsData = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
          (lsData.matches || []).forEach(function (ls) {
            var lsId = ls && ls.matchId != null ? String(ls.matchId) : '';
            var lsNum = ls && ls.num ? String(ls.num) : '';
            var lsDate = ls && ls.date ? String(ls.date).slice(0, 10) : '';
            if (lsId) _recalcLiveScoresCache.byId[lsId] = ls;
            if (lsNum && lsDate) _recalcLiveScoresCache.byDateNum[lsDate + '|' + lsNum] = ls;
            if (lsNum && !lsDate) _recalcLiveScoresCache.byNum[lsNum] = ls;
          });
        }
      } catch (e) {
        /* ignore */
      }
      _recalcLiveScoresCacheTime = now;
    }
    var liveScores = _recalcLiveScoresCache;

    // 逐场判定 + subResults
    for (var i = 0; i < matches.length; i++) {
      var mm = matches[i];
      var matchNum = mm.matchNum || '';
      var playType = mm.playType || '';
      var direction = mm.direction || '';
      var matchDate = String(mm.matchDate || mm.date || plan.matchDate || '').slice(0, 10);

      // 查找比赛数据
      var matchData = (matchDate && mByDateNum[matchDate + '|' + matchNum]) || mByNum[matchNum] || null;

      // 兜底：live_scores.json
      if (!matchData || !matchData.score) {
        var ls =
          (liveScores.byId && liveScores.byId[String(mm.matchId)]) ||
          (liveScores.byDateNum && matchDate && matchNum ? liveScores.byDateNum[matchDate + '|' + matchNum] : null) ||
          (liveScores.byNum && matchNum ? liveScores.byNum[matchNum] : null);
        if (ls && ls.date && matchDate && String(ls.date).slice(0, 10) !== matchDate) {
          ls = null;
        }
        if (ls && ls.score && ls.matchStatus >= 1) {
          matchData = { score: ls.score, date: ls.date };
        }
      }

      var hasScore = !!(matchData && matchData.score);

      // 获取让球数（RQSPF 需要）
      var handicap = null;
      if (playType === 'rqspf' && hasScore) {
        var matchDate = (matchData.date || '').slice(0, 10);
        if (!matchDate) {
          var recentFiles = [];
          try {
            var ohDir = path.join(__dirname, 'odds_history');
            if (fs.existsSync(ohDir)) {
              recentFiles = fs
                .readdirSync(ohDir)
                .filter(function (f) {
                  return f.match(/^\d{4}-\d{2}-\d{2}\.json$/);
                })
                .sort()
                .reverse();
            }
          } catch (e2) {}
          for (var fi = 0; fi < recentFiles.length; fi++) {
            var odMap = getOddsHistory(recentFiles[fi].replace('.json', ''));
            if (odMap && odMap[matchNum] && odMap[matchNum].rqspf) {
              handicap = odMap[matchNum].rqspf.handicap;
              break;
            }
          }
        } else {
          var oddsMap = getOddsHistory(matchDate);
          if (oddsMap && oddsMap[matchNum] && oddsMap[matchNum].rqspf) {
            handicap = oddsMap[matchNum].rqspf.handicap;
          }
        }
      }

      var scoreStr = '';
      if (hasScore) {
        var rawScore = matchData.score;
        if (typeof rawScore === 'object' && rawScore !== null) {
          scoreStr = (rawScore.home || rawScore.h || '') + ':' + (rawScore.away || rawScore.a || '');
        } else {
          scoreStr = String(rawScore || '');
        }
      }

      // ★ RQSPF 方向映射
      var effectiveDirection = direction;
      if (playType === 'rqspf') {
        if (direction === '胜') effectiveDirection = '让胜';
        else if (direction === '平') effectiveDirection = '让平';
        else if (direction === '负') effectiveDirection = '让负';
      }

      // subResults（支持多方向如 "胜平"）
      var subDirs = effectiveDirection.split(/[、,]/);
      mm.subResults = [];
      for (var sdi = 0; sdi < subDirs.length; sdi++) {
        var sd = subDirs[sdi].trim();
        var sdResult = null;
        if (hasScore && scoreStr) {
          sdResult = _judgeByScore(sd, scoreStr, handicap);
        }
        mm.subResults.push({ direction: sd, result: sdResult === null ? null : sdResult ? 1 : 0 });
      }

      if (!hasScore) {
        mm.isMatchWon = undefined;
        mm.isMatchLose = undefined;
        continue;
      }

      var result = _judgeByScore(effectiveDirection, scoreStr, handicap);
      if (result === true) {
        mm.isMatchWon = true;
        mm.isMatchLose = false;
      } else if (result === false) {
        mm.isMatchWon = false;
        mm.isMatchLose = true;
      } else {
        mm.isMatchWon = undefined;
        mm.isMatchLose = undefined;
      }
    }

    // ★ P0: 组合过关中奖判定 — 按 passType 逐级统计中奖组合
    var matchWinStatus = {};
    for (var i2 = 0; i2 < matches.length; i2++) {
      var m2 = matches[i2];
      var mid = m2.matchId || m2.matchNum || '';
      if (m2.isMatchWon === true) matchWinStatus[mid] = true;
      else if (matchWinStatus[mid] !== true) {
        if (m2.isMatchLose === true) matchWinStatus[mid] = false;
      }
    }
    var wonIds = Object.keys(matchWinStatus).filter(function (k) {
      return matchWinStatus[k] === true;
    });
    var judgedIds = Object.keys(matchWinStatus);
    var wonCount = wonIds.length;
    var totalUnique = new Set(
      matches.map(function (m) {
        return m.matchId || m.matchNum || '';
      }),
    ).size;

    var passTypes = plan.passTypes && plan.passTypes.length > 0 ? plan.passTypes : totalUnique === 1 ? [1] : [2];

    var totalWinCombs = 0;
    for (var pi = 0; pi < passTypes.length; pi++) {
      var passLevel = passTypes[pi];
      if (wonCount >= passLevel) {
        totalWinCombs += combinations(wonCount, passLevel);
      }
    }

    var isPlanWon = totalWinCombs > 0;
    var hasPending = judgedIds.length < totalUnique;

    // 全部开奖 或 已有中奖组合 → 确定结果
    if (!hasPending || isPlanWon) {
      var updated = Object.assign({}, plan);
      if (isPlanWon) {
        updated.isWon = true;
        var totalBets = plan.betCount || Math.max(1, totalWinCombs);
        var winRatio = Math.min(1, totalWinCombs / totalBets);
        updated.resultIncome = Math.round((plan.amount || 0) * (plan.totalOdds || 1) * winRatio);
      } else if (hasPending) {
        updated.isWon = null;
        updated.resultIncome = null;
      } else {
        updated.isWon = false;
        updated.resultIncome = 0;
      }
      // 附加中奖详情
      updated._winDetail = { wonCount: wonCount, totalWinCombs: totalWinCombs, passTypes: passTypes };
      return updated;
    }
    return plan;
  }

  /**
   * 比分直判 — 根据比分判定投注方向是否正确
   * @param {string} direction - 方向（胜/平/负/让胜/让平/让负/胜平/平负/总进球-N）
   * @param {string} scoreStr  - 比分字符串（如 "2:1"）
   * @param {number|null} handicap - 让球数
   * @returns {boolean|null} true=命中, false=未中, null=无法判定
   */
  function _judgeByScore(direction, scoreStr, handicap) {
    if (!scoreStr || !direction) return null;

    // 复合方向（含、号）：分开判定，任一命中即可
    if (direction.indexOf('、') >= 0) {
      var subParts = direction.split(/[、,]/);
      for (var pi = 0; pi < subParts.length; pi++) {
        var subR = _judgeByScore(subParts[pi].trim(), scoreStr, handicap);
        if (subR === true) return true;
      }
      return false;
    }

    var parts = String(scoreStr).replace(/[-:]/g, ':').split(':');
    var hg = parseInt(parts[0]);
    var ag = parseInt(parts[1]);
    if (isNaN(hg) || isNaN(ag)) return null;

    // SPF 基础方向
    if (direction === '胜') return hg > ag;
    if (direction === '平') return hg === ag;
    if (direction === '负') return hg < ag;

    // 双选
    if (direction === '胜平') return hg > ag || hg === ag;
    if (direction === '平负') return hg === ag || hg < ag;

    // RQSPF（需要让球数）
    if (direction === '让胜' || direction === '让平' || direction === '让负') {
      var hcp = handicap != null ? parseFloat(handicap) || 0 : 0;
      var effective = hg + hcp;
      if (direction === '让胜') return effective > ag;
      if (direction === '让平') return effective === ag;
      if (direction === '让负') return effective < ag;
    }

    // 总进球（如 "总进球-2", "总进球-3"）
    var goalMatch = direction.match(/总进球-(\d+)/);
    if (goalMatch) {
      return hg + ag === parseInt(goalMatch[1]);
    }

    // ★ 总进球复合方向子项（如 "3球"、"4球" — "总进球-2、3球" 拆分后）
    var simpleGoalMatch = direction.match(/^(\d+)球$/);
    if (simpleGoalMatch) {
      return hg + ag === parseInt(simpleGoalMatch[1]);
    }

    // ★ 半全场方向（如 "半全场-平平"）
    var hfMatch = direction.match(/^半全场-(.+)$/);
    if (hfMatch) {
      var pattern = hfMatch[1];
      var fullChar = pattern.slice(-1);
      if (fullChar === '胜') return hg > ag;
      if (fullChar === '平') return hg === ag;
      if (fullChar === '负') return hg < ag;
      return null;
    }

    return null;
  }

  // ==================== 前一天推荐命中信息回填 ====================
  let lastBackfillDate = '';
  let _aiBatchGenerating = false; // ★ P0-2: 防止并发触发生成

  async function backfillPreviousDayResults() {
    try {
      const today = new Date();
      const todayStr =
        today.getFullYear() +
        '-' +
        String(today.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(today.getDate()).padStart(2, '0');

      if (lastBackfillDate === todayStr) return;

      // 按日期检查近7天（不依赖matchStatus）
      database.initDatabase();
      const adp = database.getAdapter && database.getAdapter();
      if (!adp || !adp.execOne || !adp.execAll) return; // 数据库不可用时跳过
      const sevenAgo = new Date(today);
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const minDate =
        sevenAgo.getFullYear() +
        '-' +
        String(sevenAgo.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(sevenAgo.getDate()).padStart(2, '0');

      const row = adp.execOne(
        `SELECT COUNT(DISTINCT r.matchId) as cnt FROM recommends r JOIN matches m ON r.matchId=m.matchId WHERE m.date >= ? AND m.date < ? AND r.result IS NULL`,
        minDate,
        todayStr,
      );
      if (!row || row.cnt === 0) return;

      logger.info('[backfill] 近7天有' + row.cnt + '场比赛结果不全, 开始回填...');

      const stale = adp.execAll(
        `
      SELECT DISTINCT r.matchId, m.homeName, m.visitName
      FROM recommends r JOIN matches m ON r.matchId=m.matchId
      WHERE m.date >= ? AND m.date < ? AND r.result IS NULL
      LIMIT 50
    `,
        minDate,
        todayStr,
      );

      if (!stale || stale.length === 0) return;

      // 登录 API
      const { get } = require('./http-utils');
      const CONFIG = {
        MIDOU_BASE: 'https://midou310.com/mdsj',
        MOBILE: process.env.MIDOU_MOBILE,
        PASSWORD: process.env.MIDOU_PASSWORD,
      };
      const loginRes = await get(CONFIG.MIDOU_BASE + '/gduser/login.do', {
        mobile: CONFIG.MIDOU_MOBILE,
        password: CONFIG.MIDOU_PASSWORD,
      });
      if (loginRes.code !== 1) {
        logger.warn('[backfill] 登录失败');
        return;
      }
      const token = loginRes.data.token;

      let updated = 0;
      for (const s of stale) {
        try {
          const recRes = await get(
            CONFIG.MIDOU_BASE + '/score/getExpertRecommData.do',
            { dataId: s.matchId, type: 0 },
            { Cookie: 'token=' + token },
          );
          if (recRes.code === 1 && recRes.data) {
            const fetchDate = todayStr;
            const recomms = recRes.data
              .filter((x) => x && x.type && x.num > 0)
              .map((x) => ({
                matchId: s.matchId,
                type: x.type,
                num: x.num,
                result: x.result !== undefined ? x.result : null,
                fetchDate: fetchDate,
              }));
            database.batchUpsertRecommends(recomms);
            const nulls = recomms.filter((r) => r.result === null).length;
            if (nulls === 0) updated++;
            logger.info('[backfill] ' + s.matchId + ' ' + s.homeName + ' vs ' + s.visitName + ' OK');
          }
        } catch (e) {
          logger.warn('[backfill] ' + s.matchId + ' 失败: ' + e.message);
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      lastBackfillDate = todayStr;
      logger.info('[backfill] 近7天回填完成, 更新' + updated + '场');
    } catch (e) {
      logger.error('[backfill] 回填异常: ' + e.message);
    }
  }

  // ==================== 启动 ====================
  function runWhenDatabaseReady(label, fn, options) {
    const maxAttempts = (options && options.maxAttempts) || 60;
    const delayMs = (options && options.delayMs) || 1000;
    let attempts = 0;

    function tryRun() {
      attempts += 1;
      if (!database.isAvailable || !database.isAvailable()) {
        if (attempts < maxAttempts) {
          return setTimeout(tryRun, delayMs).unref();
        }
        logger.error(label + ' 初始化失败: 数据库适配器超时不可用');
        return;
      }
      try {
        fn();
        logger.info(label + ' 初始化完成');
      } catch (e) {
        logger.error(label + ' 初始化失败: ' + e.message);
      }
    }

    tryRun();
  }

  // 初始化数据库
  try {
    database.initDatabase();
    runWhenDatabaseReady('认证模块', function () {
      authService.ensureBootstrapped();
    });
  } catch (err) {
    logger.error('数据库初始化失败: ' + err.message);
  }

  // ★ 自动回填预测日志（每次启动检测，防止 jc-sync 覆盖）
  (function autoBackfillPredictionLogs() {
    // 等待数据库就绪（sql.js 异步初始化）
    var waited = 0;
    function tryBackfill() {
      if (!database.isAvailable()) {
        if (waited < 60) {
          waited++;
          setTimeout(tryBackfill, 2000).unref();
        }
        return;
      }
      try {
        var adp = database.getAdapter();
        var cnt = adp
          ? (
              adp.execOne(
                "SELECT COUNT(*) as cnt FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != ''",
              ) || {}
            ).cnt || 0
          : 0;
        if (cnt === 0) {
          logger.info('[auto-backfill] prediction_logs 赛果为空，自动触发回填...');
          var cp = require('child_process');
          cp.exec(
            'cd ' + __dirname + ' && node backfill_prediction_logs.js',
            { timeout: 180000 },
            function (err, stdout) {
              if (err) logger.error('[auto-backfill] 回填失败: ' + err.message);
              else logger.info('[auto-backfill] 回填完成: ' + (stdout || '').slice(-200));
            },
          );
        } else {
          logger.info('[auto-backfill] prediction_logs 已有 ' + cnt + ' 条赛果，跳过');
        }
      } catch (e) {
        logger.error('[auto-backfill] 检测失败: ' + e.message);
      }
    }
    setTimeout(tryBackfill, 5000).unref();
  })();

  // ★ P3-1: 使用显式 http.createServer 以便 WebSocket 共用端口
  const http = require('http');
  const server = http.createServer(app);

  // 挂载 WebSocket
  if (wsServer) {
    try {
      wsServer.attachToServer(server);
    } catch (e) {
      logger.warn('[ws] WebSocket 挂载失败: ' + e.message);
    }
  }

  // ★ P2-2: 缓存预热（异步，不阻塞服务启动）
  try {
    const warmer = require('./core/cache-warmer');
    setTimeout(function () {
      warmer.warmUp({
        log: function (msg) {
          logger.info('[cache-warmer] ' + msg);
        },
      });
    }, 500); // 延迟 500ms，让服务器先启动完成
  } catch (e) {
    logger.warn('[cache-warmer] 加载失败: ' + e.message);
  }

  // 初始化支付/订阅/返利模块（sql.js 生产后端为异步初始化，需等待适配器就绪）
  runWhenDatabaseReady('支付模块', function () {
    payments.initPayments();
  });

  server.listen(PORT, () => {
    const banner = [
      '============================================',
      '  竞彩推荐监控系统 v2',
      `  环境: ${process.env.NODE_ENV || 'development'}`,
      `  API:  http://localhost:${PORT}/api`,
      `  WS:   ws://localhost:${PORT}/ws`,
      `  预览: http://localhost:${PORT}/`,
      `  数据源: 米斗数据`,
      `  定时爬取: ${process.env.NODE_ENV === 'production' ? '已启用(5分钟)' : '开发模式未启用'}`,
      `  前一天回填: 已启用(10分钟检查)`,
      '============================================',
    ];
    banner.forEach((line) => logger.info(line));

    // 前一天推荐命中信息定时回填（每10分钟检查一次）
    setInterval(
      () => {
        backfillPreviousDayResults().catch((e) => {});
      },
      10 * 60 * 1000,
    );
    // 启动时立即执行一次
    setTimeout(() => {
      backfillPreviousDayResults().catch((e) => {});
    }, 30000);
  });

  // 导出供 scheduler 使用（必须在 scheduler require 之前）
  module.exports = { fetchMatches, fetchRecommends, login };

  // 生产环境启动定时爬取
  if (process.env.NODE_ENV === 'production') {
    const scheduler = require('./scheduler');
    scheduler.start();

    // ★ P0-1: 启动 AI 定时生成守护进程（每日 11:30 / 16:30）
    const aiDaemon = require('./ai_daemon');
    aiDaemon.start();
  }
}
