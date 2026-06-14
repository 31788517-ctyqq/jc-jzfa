/**
 * server/core/match-data-pack.js
 * 统一比赛数据包（P1）
 *
 * 目标：为 AI / PK / 闭环任务提供统一读取入口，避免各模块各取各源。
 */

const fs = require('fs');
const path = require('path');
const database = require('../database');
const spAdapter = require('./sp_data_adapter');
const dataFusion = require('./data-fusion');

const DATA_FILE = path.join(__dirname, '..', 'data.json');
const AI_CACHE_FILE = path.join(__dirname, '..', 'ai_cache.json');
const GS_CACHE_FILE = path.join(__dirname, '..', 'gongshoudao', 'cache.json');

let _cache = {
  ts: 0,
  dataJson: null,
  aiCache: null,
  gsCache: null,
};
const CACHE_TTL = 30 * 1000;

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function loadCaches() {
  const now = Date.now();
  if (_cache.dataJson && now - _cache.ts < CACHE_TTL) return _cache;

  _cache = {
    ts: now,
    dataJson: safeReadJson(DATA_FILE, { m: {}, r: {} }),
    aiCache: safeReadJson(AI_CACHE_FILE, {}),
    gsCache: safeReadJson(GS_CACHE_FILE, {}),
  };
  return _cache;
}

function normalizeMatchId(matchId) {
  return String(matchId || '').replace(/^m_/, '');
}

function normalizeMatchNum(num) {
  return String(num || '').trim();
}

function normalizeDate(dateStr) {
  return String(dateStr || '').slice(0, 10);
}

function findMatchFromDataJson(input) {
  const c = loadCaches();
  const mMap = (c.dataJson && c.dataJson.m) || {};

  if (input && input.match && input.match.matchId) return input.match;

  const targetDate = normalizeDate((input && input.date) || '');
  const targetNum = normalizeMatchNum((input && input.num) || '');
  const targetMid = normalizeMatchId((input && input.matchId) || '');

  let hit = null;
  Object.keys(mMap).forEach(function (k) {
    const m = mMap[k];
    if (!m || hit) return;
    const md = normalizeDate(m.date || '');
    const mid = normalizeMatchId(m.matchId || '');
    const num = normalizeMatchNum(m.num || '');

    if (targetMid && mid === targetMid) {
      if (!targetDate || targetDate === md) hit = m;
      return;
    }

    if (targetDate && targetNum && md === targetDate && num === targetNum) hit = m;
  });

  return hit;
}

function resolveGsEntry(gsCache, matchId) {
  const global = (gsCache && gsCache._global) || gsCache || {};
  const mid = normalizeMatchId(matchId);
  return global[mid] || global['m_' + mid] || null;
}

function resolvePkRow(adp, dateStr, matchId) {
  if (!adp) return null;
  const mid = normalizeMatchId(matchId);
  return (
    adp.execOne(
      'SELECT pk_direction, pk_composite_score, pk_batch_date, pk_feature_snapshot_id, pk_final_direction FROM prediction_logs WHERE date = ? AND matchId IN (?, ?) ORDER BY updated_at DESC LIMIT 1',
      dateStr,
      mid,
      'm_' + mid,
    ) || null
  );
}

function calcCompleteness(coverage) {
  const weights = {
    hasSchedule: 0.2,
    hasOdds: 0.2,
    hasStats: 0.2,
    hasMarket: 0.15,
    hasGS: 0.1,
    hasAI: 0.1,
    hasPK: 0.05,
  };
  let score = 0;
  Object.keys(weights).forEach(function (k) {
    if (coverage[k]) score += weights[k];
  });
  return Math.round(score * 100);
}

function getMatchDataPack(input) {
  const c = loadCaches();
  const match = findMatchFromDataJson(input);
  if (!match) return null;

  const dateStr = normalizeDate(match.date || (input && input.date) || '');
  const matchNum = normalizeMatchNum(match.num || (input && input.num) || '');
  const matchId = normalizeMatchId(match.matchId || (input && input.matchId) || '');

  const fullSP = spAdapter.getFullSPData(matchNum, dateStr) || {};
  const spOdds = fullSP.odds || null;
  const spPreview = fullSP.preview || null;

  const numDigits = String(matchNum).replace(/^[^\d]*/, '');
  const basic = numDigits ? database.getJczqBasic(dateStr, numDigits) : null;

  const gs = resolveGsEntry(c.gsCache, matchId);
  const ai = c.aiCache ? c.aiCache[matchId] || c.aiCache['m_' + matchId] : null;

  const adp = database.getAdapter();
  const pk = resolvePkRow(adp, dateStr, matchId);

  const market = {
    impliedProb: basic ? dataFusion.spImpliedProb(basic) : null,
    discreteWarning: basic ? dataFusion.discreteWarning(null, basic) : null,
    asiaWater: basic ? dataFusion.asiaWaterChange(basic) : null,
  };

  const coverage = {
    hasSchedule: !!match,
    hasOdds: !!(spOdds && (spOdds.spf || spOdds.rqspf || spOdds.jqs || spOdds.bqc)),
    hasStats: !!(basic || (spPreview && (spPreview.recentForm || spPreview.h2h || spPreview.standings))),
    hasMarket: !!(market && (market.impliedProb || market.discreteWarning || market.asiaWater)),
    hasGS: !!gs,
    hasAI: !!(ai && ai.content),
    hasPK: !!(pk && (pk.pk_direction || pk.pk_final_direction)),
    missingReasons: [],
  };

  if (!coverage.hasOdds) coverage.missingReasons.push('odds_missing');
  if (!coverage.hasStats) coverage.missingReasons.push('stats_missing');
  if (!coverage.hasGS) coverage.missingReasons.push('gs_missing');
  if (!coverage.hasAI) coverage.missingReasons.push('ai_missing');
  if (!coverage.hasPK) coverage.missingReasons.push('pk_missing');
  coverage.completenessScore = calcCompleteness(coverage);

  const sourceSnapshot = {
    schedule: match.source || 'data.json',
    odds: coverage.hasOdds ? 'sp_or_fallback' : 'missing',
    stats: basic ? 'jczq_basic' : spPreview ? 'sporttery_preview' : 'missing',
    market: coverage.hasMarket ? 'jczq_basic_fusion' : 'missing',
    gs: coverage.hasGS ? 'gongshoudao_cache' : 'missing',
    ai: coverage.hasAI ? 'ai_cache' : 'missing',
    pk: coverage.hasPK ? 'prediction_logs' : 'missing',
  };

  return {
    identity: {
      matchId,
      date: dateStr,
      num: matchNum,
      homeName: match.homeName || '',
      visitName: match.visitName || '',
      leagueName: match.leagueName || '',
      startTime: match.startTime || '',
      sourcePriority: ['sporttery', 'midou', '500'],
    },
    schedule: {
      source: match.source || 'data.json',
      quality: match.source === 'sp_schedule' ? 'official' : 'merged',
      data: match,
    },
    odds: spOdds,
    stats: {
      basic: basic,
      preview: spPreview,
    },
    market: market,
    models: {
      gongshoudao: gs || null,
      ai: ai || null,
      pk: pk || null,
    },
    sourceSnapshot: sourceSnapshot,
    coverage: coverage,
  };
}

function getDailyMatchDataPacks(dateStr) {
  const c = loadCaches();
  const mMap = (c.dataJson && c.dataJson.m) || {};
  const d = normalizeDate(dateStr);
  const list = [];

  Object.keys(mMap).forEach(function (k) {
    const m = mMap[k];
    if (!m || normalizeDate(m.date) !== d) return;
    const pack = getMatchDataPack({ match: m, date: d });
    if (pack) list.push(pack);
  });

  return list;
}

function buildCoverageReport(dateStr) {
  const packs = getDailyMatchDataPacks(dateStr);
  const report = {
    date: normalizeDate(dateStr),
    total: packs.length,
    hasSchedule: 0,
    hasOdds: 0,
    hasStats: 0,
    hasMarket: 0,
    hasGS: 0,
    hasAI: 0,
    hasPK: 0,
    avgCompleteness: 0,
  };

  if (packs.length === 0) return report;

  let totalCompleteness = 0;
  packs.forEach(function (p) {
    const c = p.coverage || {};
    if (c.hasSchedule) report.hasSchedule++;
    if (c.hasOdds) report.hasOdds++;
    if (c.hasStats) report.hasStats++;
    if (c.hasMarket) report.hasMarket++;
    if (c.hasGS) report.hasGS++;
    if (c.hasAI) report.hasAI++;
    if (c.hasPK) report.hasPK++;
    totalCompleteness += Number(c.completenessScore || 0);
  });

  report.avgCompleteness = Math.round(totalCompleteness / packs.length);
  report.rates = {
    gs: Math.round((report.hasGS / report.total) * 100),
    ai: Math.round((report.hasAI / report.total) * 100),
    pk: Math.round((report.hasPK / report.total) * 100),
    odds: Math.round((report.hasOdds / report.total) * 100),
  };

  return report;
}

module.exports = {
  getMatchDataPack,
  getDailyMatchDataPacks,
  buildCoverageReport,
};
