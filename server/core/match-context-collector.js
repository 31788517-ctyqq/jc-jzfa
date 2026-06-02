/**
 * server/core/match-context-collector.js
 * 比赛上下文采集器 — 从 match_context_collector 移植简化版
 *
 * 为 AI 预测提供阵容、伤病、赛程三大上下文数据：
 *   - lineup:    首发/替补/预测阵容、阵型
 *   - injury:    伤病信息、缺阵影响
 *   - schedule:  赛程密度、体能、旅行距离
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ═══ 常量 ═══

const SOURCE_IDS = ['lineup', 'injury', 'schedule'];
const SOURCE_LABELS = {
  lineup: '阵容信息',
  injury: '伤病情报',
  schedule: '赛程上下文',
};

// ═══ 工具函数 ═══

function safeFloat(v, defaultVal) {
  if (v == null || v === '') return defaultVal != null ? defaultVal : null;
  const n = parseFloat(v);
  return isNaN(n) ? (defaultVal != null ? defaultVal : null) : n;
}

function safeInt(v, defaultVal) {
  if (v == null || v === '') return defaultVal != null ? defaultVal : null;
  const n = parseInt(v);
  return isNaN(n) ? (defaultVal != null ? defaultVal : null) : n;
}

function safeBool(v, defaultVal) {
  if (typeof v === 'boolean') return v;
  const t = String(v || '').trim().toLowerCase();
  if (t === '1' || t === 'true' || t === 'yes' || t === 'on') return true;
  if (t === '0' || t === 'false' || t === 'no' || t === 'off') return false;
  return defaultVal != null ? defaultVal : false;
}

function nowISO() {
  return new Date().toISOString().replace('+00:00', 'Z');
}

function normalizeToken(v) {
  var text = String(v || '').trim().toLowerCase();
  if (!text) return '';
  text = text.replace(/\s+/g, '');
  text = text.replace(/[^\w\u4e00-\u9fff]+/g, '');
  return text;
}

function takeFirst(obj, ...keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (var i = 0; i < keys.length; i++) {
    if (obj[keys[i]] != null) return obj[keys[i]];
  }
  return null;
}

// ═══ 球员解析 ═══

/**
 * 解析单个球员信息
 */
function parsePlayer(item) {
  if (!item || typeof item !== 'object') return null;
  const playerName = String(takeFirst(item, 'player_name', 'playerName', 'name', 'player', 'athlete') || '').trim();
  if (!playerName) return null;

  const result = {
    player_name: playerName,
    role: String(takeFirst(item, 'role', 'position') || '').trim() || null,
    status: String(takeFirst(item, 'status', 'availability') || 'available').trim() || 'available',
    starter: safeBool(takeFirst(item, 'starter', 'is_starter', 'isStarter', 'confirmed_starter'), false),
  };

  const importance = safeFloat(takeFirst(item, 'importance', 'weight', 'impact'));
  if (importance != null) result.importance = +Math.max(0, Math.min(importance, 1.5)).toFixed(4);

  return result;
}

/**
 * 解析球员列表
 */
function parsePlayers(items) {
  if (!Array.isArray(items)) return [];
  return items.map(parsePlayer).filter(Boolean);
}

// ═══ 阵容解析 ═══

/**
 * 解析阵容信息
 */
function parseLineup(item) {
  if (!item || typeof item !== 'object') return {};

  const confirmed = safeBool(takeFirst(item, 'confirmed', 'is_confirmed', 'isConfirmed'), false);
  const formation = String(takeFirst(item, 'formation', 'shape') || '').trim() || null;

  var starters, predicted, bench;
  var hasStarters, startersValue, hasPredicted, predictedValue, hasBench, benchValue;

  if ('confirmed_starters' in item || 'confirmedStarters' in item || 'starters' in item || 'starting_xi' in item) {
    startersValue = takeFirst(item, 'confirmed_starters', 'confirmedStarters', 'starters', 'starting_xi');
    hasStarters = true;
  }
  if ('predicted_starters' in item || 'predictedStarters' in item || 'predicted' in item) {
    predictedValue = takeFirst(item, 'predicted_starters', 'predictedStarters', 'predicted', 'expected_starters');
    hasPredicted = true;
  }
  if ('bench' in item || 'substitutes' in item) {
    benchValue = takeFirst(item, 'bench', 'substitutes');
    hasBench = true;
  }

  starters = hasStarters ? parsePlayers(startersValue) : [];
  predicted = hasPredicted ? parsePlayers(predictedValue) : [];
  bench = hasBench ? parsePlayers(benchValue) : [];

  // 如果已确认但无首发，则清空预测
  if (hasStarters && starters.length === 0 && confirmed) {
    predicted = [];
  }

  const result = {
    confirmed: confirmed,
    formation: formation,
    confirmed_starters: starters,
    predicted_starters: predicted,
    bench: bench,
  };

  const continuity = safeFloat(takeFirst(item, 'continuity_from_prev', 'continuity', 'stability'));
  if (continuity != null) result.continuity_from_prev = +Math.max(0, Math.min(continuity, 1.0)).toFixed(4);

  return result;
}

/**
 * 检查阵容是否有有效数据
 */
function lineupHasValues(lineup) {
  if (!lineup || typeof lineup !== 'object') return false;
  return (
    (Array.isArray(lineup.confirmed_starters) && lineup.confirmed_starters.length > 0) ||
    (Array.isArray(lineup.predicted_starters) && lineup.predicted_starters.length > 0) ||
    (Array.isArray(lineup.bench) && lineup.bench.length > 0) ||
    lineup.formation != null
  );
}

// ═══ 伤病解析 ═══

/**
 * 计算伤病影响分数 (0-6)
 */
function calcInjuryScore(injuries, side) {
  if (!Array.isArray(injuries)) return 0;

  let total = 0;
  injuries.forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    const status = String(item.status || '').trim().toLowerCase();
    let factor = 0.25;
    if (status === 'out' || status === 'injured' || status === 'suspended' || status === 'absent' || status === 'unavailable') {
      factor = 1.0;
    } else if (status === 'questionable' || status === 'doubtful') {
      factor = 0.65;
    } else if (status === 'probable' || status === 'limited') {
      factor = 0.4;
    }

    const importance = safeFloat(item.importance, item.starter ? 1.0 : 0.6);
    total += factor * Math.max(0.2, Math.min(importance, 1.5));
  });

  return Math.min(total, 6.0);
}

/**
 * 检查伤病是否有有效数据
 */
function injuryHasValues(injuries) {
  return Array.isArray(injuries) && injuries.length > 0;
}

// ═══ 赛程解析 ═══

/**
 * 解析赛程信息
 */
function parseSchedule(item) {
  if (!item || typeof item !== 'object') return {};

  const result = {};

  const scalarFields = {
    rest_days_override: ['rest_days_override', 'restDaysOverride', 'rest_days'],
    recent_matches_3d: ['recent_matches_3d', 'recentMatches3d', 'match_density_3d'],
    recent_matches_7d: ['recent_matches_7d', 'recentMatches7d', 'match_density_7d'],
    recent_matches_14d: ['recent_matches_14d', 'recentMatches14d', 'match_density_14d'],
    travel_distance_km: ['travel_distance_km', 'travelDistanceKm', 'travel_km'],
    timezone_shift_hours: ['timezone_shift_hours', 'timezoneShiftHours', 'timezone_shift'],
    altitude_m: ['altitude_m', 'altitudeM', 'altitude'],
  };

  Object.keys(scalarFields).forEach(function (target) {
    const aliases = scalarFields[target];
    const value = safeFloat(takeFirst(item, ...aliases));
    if (value != null) result[target] = +Math.max(0, value).toFixed(4);
  });

  if ('cross_border' in item || 'crossBorder' in item || 'is_cross_border' in item) {
    result.cross_border = safeBool(takeFirst(item, 'cross_border', 'crossBorder', 'is_cross_border'), false);
  }

  return result;
}

/**
 * 检查赛程是否有有效数据
 */
function scheduleHasValues(schedule) {
  if (!schedule || typeof schedule !== 'object') return false;
  return Object.keys(schedule).length > 0;
}

// ═══ 上下文聚合 ═══

/**
 * 从数据记录中提取部分上下文
 * @param {Object} record - 原始数据记录
 * @param {string} kind - lineup | injury | schedule
 */
function extractPartialContext(record, kind) {
  if (!record || typeof record !== 'object') return null;

  const payload = {
    captured_at: String(takeFirst(record, 'captured_at', 'capturedAt', 'updated_at', 'timestamp', 'kickoff') || nowISO()),
    quality_score: safeFloat(takeFirst(record, 'quality_score', 'qualityScore', 'quality', 'score')),
    notes: [],
  };

  var rawNotes = takeFirst(record, 'notes', 'note');
  if (Array.isArray(rawNotes)) {
    payload.notes = rawNotes.map(function (n) { return String(n).trim(); }).filter(Boolean);
  } else if (rawNotes) {
    payload.notes = [String(rawNotes).trim()];
  }

  var hasPayload = false;

  // 阵容
  if (kind === 'lineup' || kind === 'combined' || kind === 'all') {
    ['home_lineup', 'away_lineup'].forEach(function (key) {
      if (key in record) { payload[key] = parseLineup(record[key]); hasPayload = true; }
      else if ((key + 's') in record && record[key + 's'] && record[key + 's'][key.replace('_lineup', '')]) {
        payload[key] = parseLineup(record[key + 's'][key.replace('_lineup', '')]);
        hasPayload = true;
      }
    });
  }

  // 伤病
  if (kind === 'injury' || kind === 'combined' || kind === 'all') {
    ['home_injuries', 'away_injuries'].forEach(function (key) {
      if (key in record) { payload[key] = parsePlayers(record[key]); hasPayload = true; }
      else if ((key.replace('s', '') in record || key in record) && Array.isArray(record[key])) {
        payload[key] = parsePlayers(record[key]);
        hasPayload = true;
      }
    });
  }

  // 赛程
  if (kind === 'schedule' || kind === 'combined' || kind === 'all') {
    ['home_schedule', 'away_schedule'].forEach(function (key) {
      if (key in record) { payload[key] = parseSchedule(record[key]); hasPayload = true; }
    });
  }

  if (payload.notes.length > 0) hasPayload = true;
  if (payload.quality_score != null) hasPayload = true;

  return hasPayload ? payload : null;
}

/**
 * 合并上下文 (新数据覆盖)
 */
function mergeContext(existing, partial, opts) {
  opts = opts || {};
  const merged = {
    matchId: opts.matchId || '',
    sourceType: opts.sourceType || 'real',
    provider: opts.provider || 'unknown',
    capturedAt: partial.captured_at || (existing ? existing.capturedAt : null) || nowISO(),
    qualityScore: partial.quality_score != null ? partial.quality_score : (existing ? existing.qualityScore : null),
  };

  // 合并阵容
  ['home_lineup', 'away_lineup'].forEach(function (key) {
    const partialVal = partial[key];
    const existingVal = existing ? existing[key.replace(/_lineup/, 'Lineup')] : null;
    merged[key] = partialVal != null ? partialVal : (existingVal != null ? existingVal : {});
  });

  // 合并伤病
  ['home_injuries', 'away_injuries'].forEach(function (key) {
    const partialVal = partial[key];
    const existingVal = existing ? existing[key.replace(/_injuries/, 'Injuries')] : null;
    merged[key] = partialVal != null ? partialVal : (existingVal != null ? existingVal : []);
  });

  // 合并赛程
  ['home_schedule', 'away_schedule'].forEach(function (key) {
    const partialVal = partial[key];
    const existingVal = existing ? existing[key.replace(/_schedule/, 'Schedule')] : null;
    merged[key] = partialVal != null ? partialVal : (existingVal != null ? existingVal : {});
  });

  // 合并备注
  const notes = [];
  if (existing && Array.isArray(existing.notes)) notes.push.apply(notes, existing.notes);
  if (Array.isArray(partial.notes)) notes.push.apply(notes, partial.notes);
  merged.notes = notes.slice(0, 20);

  return merged;
}

// ═══ 上下文检查 ═══

function contextHasLineup(ctx) {
  if (!ctx) return false;
  return lineupHasValues(ctx.home_lineup) || lineupHasValues(ctx.away_lineup);
}

function contextHasInjury(ctx) {
  if (!ctx) return false;
  return injuryHasValues(ctx.home_injuries) || injuryHasValues(ctx.away_injuries);
}

function contextHasSchedule(ctx) {
  if (!ctx) return false;
  return scheduleHasValues(ctx.home_schedule) || scheduleHasValues(ctx.away_schedule);
}

// ═══ 从本地文件加载上下文 ═══

/**
 * 从本地缓存加载比赛上下文
 * @param {string} matchId - 比赛 ID
 * @param {string} baseDir - 上下文文件目录 (默认 server/match_context/)
 */
function loadContextFromFile(matchId, baseDir) {
  baseDir = baseDir || path.join(__dirname, '..', 'match_context');
  const results = {};

  SOURCE_IDS.forEach(function (sourceId) {
    const filePath = path.join(baseDir, sourceId, matchId + '.json');
    try {
      if (fs.existsSync(filePath)) {
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const partial = extractPartialContext(raw, sourceId);
        results[sourceId] = partial;
      }
    } catch (e) {
      // silently skip
    }
  });

  return results;
}

/**
 * 合并所有来源的上下文为完整上下文
 */
function mergeAllSources(sourceContexts, opts) {
  opts = opts || {};
  var merged = null;

  SOURCE_IDS.forEach(function (sourceId) {
    const partial = sourceContexts[sourceId];
    if (!partial) return;
    merged = mergeContext(merged, partial, opts);
  });

  return merged || {
    matchId: opts.matchId || '',
    sourceType: opts.sourceType || 'real',
    capturedAt: nowISO(),
    notes: [],
  };
}

// ═══ 上下文用于 AI 分析 ═══

/**
 * 将上下文转为 AI prompt 可用的文本摘要
 * @param {Object} context - 合并后的上下文
 * @returns {string} AI prompt 文本
 */
function toAIPrompt(context) {
  if (!context) return '';

  var parts = [];

  // 阵容
  if (contextHasLineup(context)) {
    parts.push('## 阵容信息');
    ['home_lineup', 'away_lineup'].forEach(function (key, idx) {
      const lineup = context[key];
      if (!lineup || !lineupHasValues(lineup)) return;
      const side = idx === 0 ? '主队' : '客队';
      parts.push('### ' + side);
      if (lineup.formation) parts.push('- 阵型: ' + lineup.formation);
      if (lineup.confirmed) parts.push('- 状态: 已确认');
      if (lineup.confirmed_starters && lineup.confirmed_starters.length > 0) {
        parts.push('- 首发 (' + lineup.confirmed_starters.length + '人): ' +
          lineup.confirmed_starters.map(function (p) { return p.player_name; }).join('、'));
      }
      if (lineup.predicted_starters && lineup.predicted_starters.length > 0 && !lineup.confirmed) {
        parts.push('- 预测首发 (' + lineup.predicted_starters.length + '人): ' +
          lineup.predicted_starters.map(function (p) { return p.player_name; }).join('、'));
      }
    });
  }

  // 伤病
  if (contextHasInjury(context)) {
    parts.push('## 伤病情报');
    ['home_injuries', 'away_injuries'].forEach(function (key, idx) {
      const injuries = context[key];
      if (!injuries || !injuryHasValues(injuries)) return;
      const side = idx === 0 ? '主队' : '客队';
      const score = calcInjuryScore(injuries, idx === 0 ? 'home' : 'away');
      parts.push('- ' + side + '伤病影响: ' + score.toFixed(1) + '/6.0');
      injuries.forEach(function (inj) {
        if (!inj) return;
        var line = '  - ' + inj.player_name;
        if (inj.role) line += ' (' + inj.role + ')';
        line += ': ' + inj.status;
        if (inj.importance != null) line += ' [重要度:' + inj.importance + ']';
        parts.push(line);
      });
    });
  }

  // 赛程
  if (contextHasSchedule(context)) {
    parts.push('## 赛程上下文');
    ['home_schedule', 'away_schedule'].forEach(function (key, idx) {
      const schedule = context[key];
      if (!schedule || !scheduleHasValues(schedule)) return;
      const side = idx === 0 ? '主队' : '客队';
      var items = [];
      if (schedule.rest_days_override != null) items.push('休息天数: ' + schedule.rest_days_override);
      if (schedule.travel_distance_km != null) items.push('旅行距离: ' + schedule.travel_distance_km + 'km');
      if (schedule.recent_matches_3d != null) items.push('近3天比赛: ' + schedule.recent_matches_3d);
      if (schedule.recent_matches_7d != null) items.push('近7天比赛: ' + schedule.recent_matches_7d);
      if (items.length > 0) parts.push('- ' + side + ': ' + items.join(', '));
    });
  }

  return parts.join('\n\n');
}

// ═══ 导出 ═══
module.exports = {
  SOURCE_IDS,
  SOURCE_LABELS,
  parsePlayer,
  parsePlayers,
  parseLineup,
  lineupHasValues,
  calcInjuryScore,
  injuryHasValues,
  parseSchedule,
  scheduleHasValues,
  extractPartialContext,
  mergeContext,
  contextHasLineup,
  contextHasInjury,
  contextHasSchedule,
  loadContextFromFile,
  mergeAllSources,
  toAIPrompt,
};
