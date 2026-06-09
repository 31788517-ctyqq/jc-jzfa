/**
 * server/core/bet-scheme-filters.js
 * 投注方案多维度筛选体系 — 从 bet_scheme_service 移植增强
 *
 * 在现有 plan-generator.js 筛选基础上增加：
 *   1. AI 置信度门槛 (confidence_min)
 *   2. Edge 值门槛 (edge_min)
 *   3. 赔率区间 (odds_min / odds_max)
 *   4. 联赛黑白名单 (league_whitelist / league_blacklist)
 *   5. 价值门控 (value_gate_mode: edge_only / ev_only / edge_and_ev / edge_or_ev)
 *   6. 每场最大选数 (max_selection_per_match)
 *   7. 单票最大金额 (max_ticket_count / max_amount)
 *   8. 异常数据排除 (exclude_fallback / only_ai_recommended)
 *   9. 组合结构约束 (streak_max / breakpoint / AC值)
 *  10. 组配额 & 组隔离 (group_quota / group_isolation)
 */

const FILTER_DEFAULTS = {
  valueGateMode: 'off',
  evProbabilitySource: 'model_probability',
  confidenceCalibratedMissingStrategy: 'fallback_confidence',
  firstSecondOddsRelation: 'off',
  groupQuotaField: 'none',
  groupIsolation: false,
  groupIsolationField: 'none',
};

const KNOWN_FILTER_KEYS = new Set([
  'confidenceMin',
  'edgeMin',
  'oddsMin',
  'oddsMax',
  'maxSelectionPerMatch',
  'maxTicketCount',
  'maxAmount',
  'leagueWhitelist',
  'leagueBlacklist',
  'excludeFallback',
  'onlyAiRecommended',
  'valueGateMode',
  'evMin',
  'valueEdgeMin',
  'evProbabilitySource',
  'confidenceCalibratedMin',
  'confidenceCalibratedMissingStrategy',
  'firstSecondOddsRelation',
  'firstOddsSumMin',
  'firstOddsSumMax',
  'firstOddsProductMin',
  'firstOddsProductMax',
  'groupQuotaField',
  'groupQuotaLimit',
  'groupIsolation',
  'groupIsolationField',
  'breakpointCountMin',
  'breakpointCountMax',
  'oddEvenBreakpointCountMin',
  'oddEvenBreakpointCountMax',
  'streakMax',
  'acValueMin',
  'acValueMax',
]);

const SELECTION_LABELS = { home: '主胜', draw: '平', away: '客胜' };
const BASE_BET_COST = 2.0;
const PASSWAY_SEQUENCE = ['single', '2x1', '3x1', '4x1', '5x1', '6x1', '7x1', '8x1'];

// ═══ 工具函数 ═══

function safeFloat(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function safeInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(v);
  return isNaN(n) ? null : n;
}

function safeBool(v) {
  if (typeof v === 'boolean') return v;
  const t = String(v || '')
    .trim()
    .toLowerCase();
  return t === '1' || t === 'true' || t === 'yes' || t === 'on';
}

function listTokenSet(v) {
  if (Array.isArray(v)) {
    return new Set(
      v
        .map(function (i) {
          return String(i).trim().toLowerCase();
        })
        .filter(Boolean),
    );
  }
  if (v == null) return new Set();
  const text = String(v).trim();
  if (!text) return new Set();
  return new Set(
    text
      .split(',')
      .map(function (s) {
        return s.trim().toLowerCase();
      })
      .filter(Boolean),
  );
}

function normalizeSelectionCode(v) {
  const t = String(v || '')
    .trim()
    .toLowerCase();
  return t === 'home' || t === 'draw' || t === 'away' ? t : '';
}

function selectionScore(sel) {
  const rec = sel.recommended ? 1.0 : 0.0;
  const conf = safeFloat(sel.confidence) || 0;
  const edge = safeFloat(sel.edgeValue) || safeFloat(sel.edge_value) || 0;
  const odds = safeFloat(sel.odds) || 0;
  return [rec, conf, edge, odds];
}

function _parseMatchSequence(row) {
  const token = String(row.matchNo || row.num || '').trim();
  const digits = token.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits) : 9999;
}

// ═══ 筛选规则实现 ═══

/**
 * 1. 基础阈值筛选
 */
function matchesBaseFilters(selection, filters) {
  const reasons = [];

  const confMin = safeFloat(filters.confidenceMin);
  if (confMin != null && safeFloat(selection.confidence || 0) < confMin) {
    reasons.push('confidence_below_min');
  }

  const edgeMin = safeFloat(filters.edgeMin);
  const edgeVal = safeFloat(selection.edgeValue) || safeFloat(selection.edge_value) || 0;
  if (edgeMin != null && edgeVal < edgeMin) {
    reasons.push('edge_below_min');
  }

  const oddsMin = safeFloat(filters.oddsMin);
  const odds = safeFloat(selection.odds) || 0;
  if (oddsMin != null && odds < oddsMin) reasons.push('odds_below_min');

  const oddsMax = safeFloat(filters.oddsMax);
  if (oddsMax != null && odds > oddsMax) reasons.push('odds_above_max');

  const whitelist = listTokenSet(filters.leagueWhitelist);
  const blacklist = listTokenSet(filters.leagueBlacklist);
  const league = String(selection.league || selection.leagueName || '')
    .trim()
    .toLowerCase();
  if (whitelist.size > 0 && !whitelist.has(league)) reasons.push('league_not_allowed');
  if (blacklist.size > 0 && blacklist.has(league)) reasons.push('league_blocked');

  if (safeBool(filters.excludeFallback)) {
    const ctx = selection.context || selection.contextJson || {};
    if (ctx.fallback) reasons.push('fallback_selection');
  }

  if (safeBool(filters.onlyAiRecommended) && !selection.recommended) {
    reasons.push('not_ai_recommended');
  }

  return reasons;
}

/**
 * 2. 价值门控筛选
 */
function matchesValueGate(selection, filters) {
  const mode = String(filters.valueGateMode || 'off')
    .trim()
    .toLowerCase();
  if (!mode || mode === 'off') return [];

  const reasons = [];
  const edgeThresh = safeFloat(filters.valueEdgeMin || filters.edgeMin) || 0;
  const evMinVal = safeFloat(filters.evMin) || 0;
  const edgeVal = safeFloat(selection.edgeValue || selection.edge_value) || 0;
  const odds = safeFloat(selection.odds) || 0;

  // 获取概率
  const ctx = selection.context || selection.contextJson || {};
  const source = String(filters.evProbabilitySource || 'model_probability')
    .trim()
    .toLowerCase();
  let prob = safeFloat(ctx.modelProbability || ctx.model_probability);
  if (source === 'calibrated_probability') {
    prob = safeFloat(ctx.confidenceCalibrated || ctx.confidence_calibrated);
  } else if (source === 'selection_confidence') {
    prob = safeFloat(selection.confidence);
  } else if (source === 'max_model_calibrated') {
    prob = Math.max(
      safeFloat(ctx.modelProbability || ctx.model_probability) || 0,
      safeFloat(ctx.confidenceCalibrated || ctx.confidence_calibrated) || 0,
      safeFloat(selection.confidence) || 0,
    );
  }
  if (prob == null) prob = safeFloat(selection.confidence) || null;

  const evVal = prob != null && odds > 0 ? prob * odds - 1.0 : null;
  const edgePass = edgeVal >= edgeThresh;
  const evPass = evVal != null && evVal >= evMinVal;

  if (mode === 'edge_only') {
    if (!edgePass) reasons.push('value_gate_edge_below_min');
  } else if (mode === 'ev_only') {
    if (evVal == null) reasons.push('value_gate_ev_unavailable');
    else if (!evPass) reasons.push('value_gate_ev_below_min');
  } else if (mode === 'edge_or_ev') {
    if (!edgePass && !evPass) {
      if (evVal == null) reasons.push('value_gate_ev_unavailable');
      reasons.push('value_gate_edge_or_ev_failed');
    }
  } else {
    // edge_and_ev (default)
    if (!edgePass) reasons.push('value_gate_edge_below_min');
    if (evVal == null) reasons.push('value_gate_ev_unavailable');
    else if (!evPass) reasons.push('value_gate_ev_below_min');
  }

  return reasons;
}

/**
 * 3. 校准置信度筛选
 */
function matchesCalibratedConfidence(selection, filters) {
  const threshold = safeFloat(filters.confidenceCalibratedMin);
  if (threshold == null) return [];

  const ctx = selection.context || selection.contextJson || {};
  let calibrated = safeFloat(ctx.confidenceCalibrated || ctx.confidence_calibrated);
  const strategy = String(filters.confidenceCalibratedMissingStrategy || 'fallback_confidence')
    .trim()
    .toLowerCase();

  if (calibrated == null) {
    if (strategy === 'keep') return [];
    if (strategy === 'drop') return ['confidence_calibrated_missing'];
    calibrated = safeFloat(selection.confidence); // fallback_confidence
  }

  if (calibrated == null) return ['confidence_calibrated_missing'];
  if (calibrated < threshold) return ['confidence_calibrated_below_min'];
  return [];
}

/**
 * 4. 首赔赔率关系筛选
 */
function matchesOddsRelation(selection, filters) {
  const relation = String(filters.firstSecondOddsRelation || 'off')
    .trim()
    .toLowerCase();
  const sumMin = safeFloat(filters.firstOddsSumMin);
  const sumMax = safeFloat(filters.firstOddsSumMax);
  const prodMin = safeFloat(filters.firstOddsProductMin);
  const prodMax = safeFloat(filters.firstOddsProductMax);

  if (
    (!relation || relation === 'off') &&
    [sumMin, sumMax, prodMin, prodMax].every(function (v) {
      return v == null;
    })
  ) {
    return [];
  }

  const meta = selection._matchOddsMeta;
  if (!meta) return ['odds_relation_context_missing'];

  const reasons = [];
  const rank = safeInt(meta.rank);
  const totalCount = safeInt(meta.totalCount) || 0;

  if (relation === 'first_only' && rank !== 1) reasons.push('odds_rank_not_first');
  else if (relation === 'first_or_second' && (rank == null || rank > 2)) reasons.push('odds_rank_not_first_or_second');
  else if (relation === 'exclude_last' && rank != null && totalCount > 0 && rank >= totalCount)
    reasons.push('odds_rank_is_last');

  const firstSum = safeFloat(meta.firstOddsSum);
  const firstProd = safeFloat(meta.firstOddsProduct);
  if (sumMin != null && (firstSum == null || firstSum < sumMin)) reasons.push('first_odds_sum_below_min');
  if (sumMax != null && (firstSum == null || firstSum > sumMax)) reasons.push('first_odds_sum_above_max');
  if (prodMin != null && (firstProd == null || firstProd < prodMin)) reasons.push('first_odds_product_below_min');
  if (prodMax != null && (firstProd == null || firstProd > prodMax)) reasons.push('first_odds_product_above_max');

  return reasons;
}

// ═══ 组合结构分析 ═══

function _structureMetrics(rows) {
  const grouped = {};
  rows.forEach(function (r) {
    const mid = String(r.matchId || '');
    if (!grouped[mid]) grouped[mid] = [];
    grouped[mid].push(r);
  });

  const anchors = [];
  Object.keys(grouped).forEach(function (mid) {
    const items = grouped[mid];
    if (!items.length) return;
    const top = items.slice().sort(function (a, b) {
      const sa = selectionScore(a),
        sb = selectionScore(b);
      for (var i = 0; i < sa.length; i++) {
        if (sa[i] !== sb[i]) return sb[i] - sa[i];
      }
      return 0;
    })[0];
    anchors.push({
      selectionCode: normalizeSelectionCode(top.selectionCode || top.selection_code),
      matchNo: top.matchNo || top.num,
    });
  });

  anchors.sort(function (a, b) {
    return _parseMatchSequence(a) - _parseMatchSequence(b);
  });

  const seq = anchors
    .map(function (a) {
      if (a.selectionCode === 'home') return 1;
      if (a.selectionCode === 'draw') return 2;
      if (a.selectionCode === 'away') return 3;
      return 0;
    })
    .filter(function (v) {
      return v > 0;
    });

  if (!seq.length)
    return { sequenceLength: 0, breakpointCount: 0, oddEvenBreakpointCount: 0, streakMax: 0, acValue: 0 };

  let breakpoints = 0,
    oddEven = 0,
    streakMax = 1,
    currentStreak = 1;
  for (var i = 1; i < seq.length; i++) {
    if (seq[i] !== seq[i - 1]) {
      breakpoints++;
      currentStreak = 1;
    } else {
      currentStreak++;
      streakMax = Math.max(streakMax, currentStreak);
    }
    if (seq[i] % 2 !== seq[i - 1] % 2) oddEven++;
  }

  const diffSet = new Set();
  for (var l = 0; l < seq.length; l++) {
    for (var r = l + 1; r < seq.length; r++) {
      const d = Math.abs(seq[r] - seq[l]);
      if (d > 0) diffSet.add(d);
    }
  }
  const acValue = Math.max(0, diffSet.size - (seq.length - 1));

  return {
    sequenceLength: seq.length,
    breakpointCount: breakpoints,
    oddEvenBreakpointCount: oddEven,
    streakMax: streakMax,
    acValue: acValue,
  };
}

function structureReasons(rows, filters) {
  const m = _structureMetrics(rows);
  const reasons = [];

  const bpMin = safeInt(filters.breakpointCountMin);
  const bpMax = safeInt(filters.breakpointCountMax);
  const obpMin = safeInt(filters.oddEvenBreakpointCountMin);
  const obpMax = safeInt(filters.oddEvenBreakpointCountMax);
  const strkMax = safeInt(filters.streakMax);
  const acMin = safeFloat(filters.acValueMin);
  const acMax = safeFloat(filters.acValueMax);

  if (bpMin != null && m.breakpointCount < bpMin) reasons.push('breakpoint_count_below_min');
  if (bpMax != null && m.breakpointCount > bpMax) reasons.push('breakpoint_count_above_max');
  if (obpMin != null && m.oddEvenBreakpointCount < obpMin) reasons.push('odd_even_breakpoint_count_below_min');
  if (obpMax != null && m.oddEvenBreakpointCount > obpMax) reasons.push('odd_even_breakpoint_count_above_max');
  if (strkMax != null && m.streakMax > strkMax) reasons.push('streak_max_exceeded');
  if (acMin != null && m.acValue < acMin) reasons.push('ac_value_below_min');
  if (acMax != null && m.acValue > acMax) reasons.push('ac_value_above_max');

  return { reasons: reasons, metrics: m };
}

// ═══ 组配额/隔离 ═══

function _resolveGroupKey(row, groupField) {
  const nf = String(groupField || '')
    .trim()
    .toLowerCase();
  if (!nf || nf === 'none' || nf === 'off') return 'match:' + (row.matchId || '');
  if (nf === 'league')
    return (
      String(row.league || row.leagueName || '')
        .trim()
        .toLowerCase() || 'league:unknown'
    );
  if (nf === 'odds_bucket') {
    const o = safeFloat(row.odds) || 0;
    if (o <= 0) return 'odds_unknown';
    if (o < 1.8) return 'odds_low';
    if (o < 2.6) return 'odds_mid';
    return 'odds_high';
  }
  if (nf === 'kickoff_slot') {
    const kt = String(row.kickoffAt || row.startTime || '');
    if (kt) {
      try {
        var h = new Date(kt.replace('T', ' ')).getHours();
        return 'slot:' + Math.floor(h / 6);
      } catch (e) {}
    }
    return 'slot:unknown';
  }
  if (nf === 'match_no_block') {
    const seq = _parseMatchSequence(row);
    return 'match_block:' + (seq < 9999 ? Math.floor(seq / 10) : 'unknown');
  }
  return (
    nf +
    ':' +
    (String(row[nf] || '')
      .trim()
      .toLowerCase() || 'unknown')
  );
}

// ═══ 赔率排序元数据 ═══

function enrichMatchOddsMeta(grouped) {
  const enriched = {};
  Object.keys(grouped).forEach(function (mid) {
    const rows = grouped[mid];
    const oddsRows = rows
      .map(function (r) {
        return { row: r, odds: safeFloat(r.odds) || 0 };
      })
      .filter(function (o) {
        return o.odds > 0;
      })
      .sort(function (a, b) {
        return a.odds - b.odds;
      });

    const total = oddsRows.length;
    const firstOdds = total >= 1 ? oddsRows[0].odds : null;
    const secondOdds = total >= 2 ? oddsRows[1].odds : null;
    const rankMap = {};
    oddsRows.forEach(function (item, idx) {
      rankMap[idx] = idx + 1;
    });

    enriched[mid] = rows.map(function (r) {
      const next = Object.assign({}, r);
      const oddsIdx = oddsRows.findIndex(function (o) {
        return o.row === r;
      });
      next._matchOddsMeta = {
        totalCount: total,
        rank: oddsIdx >= 0 ? rankMap[oddsIdx] : null,
        firstOdds: firstOdds,
        secondOdds: secondOdds,
        firstOddsSum: firstOdds != null && secondOdds != null ? firstOdds + secondOdds : null,
        firstOddsProduct: firstOdds != null && secondOdds != null ? firstOdds * secondOdds : null,
      };
      return next;
    });
  });
  return enriched;
}

// ═══ 方案估算 ═══

function groupSelections(selections) {
  const groups = {};
  selections.forEach(function (s) {
    const mid = String(s.matchId || '').trim();
    const code = normalizeSelectionCode(s.selectionCode || s.selection_code);
    if (!mid || !code) return;
    const norm = Object.assign({}, s);
    norm.selectionCode = code;
    norm.selectionName = norm.selectionName || SELECTION_LABELS[code] || code;
    if (!groups[mid]) groups[mid] = [];
    groups[mid].push(norm);
  });
  return groups;
}

function allowedPassways(matchCount) {
  const result = [];
  if (matchCount >= 1) result.push('single');
  for (var s = 2; s <= Math.min(8, matchCount); s++) result.push(s + 'x1');
  return result;
}

function estimateScheme(selections, passways, multiplier) {
  const grouped = groupSelections(selections);
  const matchCount = Object.keys(grouped).length;
  const mult = Math.max(1, parseInt(multiplier) || 1);

  let ticketCount = 0,
    maxBonus = 0;
  const matchGroups = Object.values(grouped);

  matchGroups.forEach(function (group) {
    group.forEach(function (sel) {
      const odds = safeFloat(sel.odds) || 1.0;
      if (passways && passways.length > 0) {
        passways.forEach(function (pw) {
          const pn = parseInt(pw) || 1;
          if (pn <= matchGroups.length) {
            ticketCount += 1;
            maxBonus += odds * 2 * mult;
          }
        });
      } else {
        ticketCount += 1;
        maxBonus += odds * 2 * mult;
      }
    });
  });

  return {
    matchCount: matchCount,
    selectionCount: selections.length,
    passways: passways || ['single'],
    multiplier: mult,
    baseBetCost: BASE_BET_COST,
    ticketCount: ticketCount,
    amount: +(ticketCount * BASE_BET_COST * mult).toFixed(2),
    maxBonus: +maxBonus.toFixed(2),
  };
}

// ═══ 主入口：应用所有筛选 ═══

function _normalizeFilters(filters) {
  const normalized = Object.assign({}, FILTER_DEFAULTS);
  const unknown = [];

  Object.keys(filters || {}).forEach(function (key) {
    if (!KNOWN_FILTER_KEYS.has(key)) {
      unknown.push(key);
      return;
    }
    normalized[key] = filters[key];
  });

  return { normalized, unknown };
}

function _dropPayload(row, reasons) {
  return {
    matchId: row.matchId,
    selectionId: row.selectionId || row.selection_id,
    selectionCode: row.selectionCode || row.selection_code,
    selectionName:
      row.selectionName || row.selection_name || SELECTION_LABELS[row.selectionCode || row.selection_code] || '',
    reasons: reasons,
  };
}

function applySchemeFilters(selections, passways, filters, multiplier) {
  multiplier = Math.max(1, parseInt(multiplier) || 1);
  const { normalized, unknown } = _normalizeFilters(filters);
  const grouped = groupSelections(selections);
  const enriched = enrichMatchOddsMeta(grouped);
  const allRows = [];
  Object.keys(enriched).forEach(function (mid) {
    allRows.push.apply(allRows, enriched[mid]);
  });

  const beforeSummary = estimateScheme(allRows, passways, multiplier);
  let currentRows = allRows.slice();
  const droppedItems = [];
  const ruleImpacts = [];

  function _applyRowRule(ruleName, enabled, matcher) {
    if (!enabled) return;
    const before = estimateScheme(currentRows, passways, multiplier);
    const kept = [],
      dropped = [];
    currentRows.forEach(function (row) {
      const reasons = matcher(row);
      if (reasons.length > 0) dropped.push(_dropPayload(row, reasons));
      else kept.push(row);
    });
    currentRows = kept;
    droppedItems.push.apply(droppedItems, dropped);
    const after = estimateScheme(currentRows, passways, multiplier);
    ruleImpacts.push({
      rule: ruleName,
      enabled: true,
      beforeTicketCount: before.ticketCount,
      afterTicketCount: after.ticketCount,
      deltaTicketCount: after.ticketCount - before.ticketCount,
      beforeAmount: before.amount,
      afterAmount: after.amount,
      deltaAmount: +(after.amount - before.amount).toFixed(2),
      droppedCount: dropped.length,
    });
  }

  // 基础阈值
  const baseEnabled = [
    'confidenceMin',
    'edgeMin',
    'oddsMin',
    'oddsMax',
    'leagueWhitelist',
    'leagueBlacklist',
    'excludeFallback',
    'onlyAiRecommended',
  ].some(function (k) {
    return (
      normalized[k] != null &&
      normalized[k] !== '' &&
      normalized[k] !== false &&
      (!Array.isArray(normalized[k]) || normalized[k].length > 0)
    );
  });
  _applyRowRule('base_thresholds', baseEnabled, function (row) {
    return matchesBaseFilters(row, normalized);
  });

  // 价值门控
  const vgEnabled = String(normalized.valueGateMode || 'off') !== 'off';
  _applyRowRule('value_gate', vgEnabled, function (row) {
    return matchesValueGate(row, normalized);
  });

  // 校准置信度
  const ccEnabled = normalized.confidenceCalibratedMin != null;
  _applyRowRule('calibrated_confidence', ccEnabled, function (row) {
    return matchesCalibratedConfidence(row, normalized);
  });

  // 赔率关系
  const orEnabled =
    normalized.firstSecondOddsRelation !== 'off' ||
    [
      normalized.firstOddsSumMin,
      normalized.firstOddsSumMax,
      normalized.firstOddsProductMin,
      normalized.firstOddsProductMax,
    ].some(function (v) {
      return v != null;
    });
  _applyRowRule('odds_relation', orEnabled, function (row) {
    return matchesOddsRelation(row, normalized);
  });

  // 每场最大选数
  const maxSelPerMatch = safeInt(normalized.maxSelectionPerMatch);
  if (maxSelPerMatch != null && maxSelPerMatch > 0) {
    const before = estimateScheme(currentRows, passways, multiplier);
    const byMatch = {};
    currentRows.forEach(function (row) {
      var mid = String(row.matchId || '');
      if (!byMatch[mid]) byMatch[mid] = [];
      byMatch[mid].push(row);
    });
    const kept = [],
      dropped = [];
    Object.values(byMatch).forEach(function (rows) {
      rows.sort(function (a, b) {
        var sa = selectionScore(a),
          sb = selectionScore(b);
        for (var i = 0; i < sa.length; i++) {
          if (sa[i] !== sb[i]) return sb[i] - sa[i];
        }
        return 0;
      });
      kept.push.apply(kept, rows.slice(0, maxSelPerMatch));
      rows.slice(maxSelPerMatch).forEach(function (r) {
        dropped.push(_dropPayload(r, ['max_selection_per_match']));
      });
    });
    currentRows = kept;
    droppedItems.push.apply(droppedItems, dropped);
    const after = estimateScheme(currentRows, passways, multiplier);
    ruleImpacts.push({
      rule: 'max_selection_per_match',
      enabled: true,
      beforeTicketCount: before.ticketCount,
      afterTicketCount: after.ticketCount,
      deltaTicketCount: after.ticketCount - before.ticketCount,
      beforeAmount: before.amount,
      afterAmount: after.amount,
      deltaAmount: +(after.amount - before.amount).toFixed(2),
      droppedCount: dropped.length,
    });
  }

  // 组配额
  const gpField = String(normalized.groupQuotaField || 'none')
    .trim()
    .toLowerCase();
  const gpLimit = safeInt(normalized.groupQuotaLimit);
  const gpEnabled = gpField && gpField !== 'none' && gpField !== 'off' && gpLimit != null && gpLimit > 0;
  if (gpEnabled) {
    const before = estimateScheme(currentRows, passways, multiplier);
    const byGroup = {};
    currentRows.forEach(function (row) {
      var gk = _resolveGroupKey(row, gpField);
      if (!byGroup[gk]) byGroup[gk] = [];
      byGroup[gk].push(row);
    });
    const kept = [],
      dropped = [];
    Object.values(byGroup).forEach(function (rows) {
      rows.sort(function (a, b) {
        var sa = selectionScore(a),
          sb = selectionScore(b);
        for (var i = 0; i < sa.length; i++) {
          if (sa[i] !== sb[i]) return sb[i] - sa[i];
        }
        return 0;
      });
      kept.push.apply(kept, rows.slice(0, gpLimit));
      rows.slice(gpLimit).forEach(function (r) {
        dropped.push(_dropPayload(r, ['group_quota_exceeded']));
      });
    });
    currentRows = kept;
    droppedItems.push.apply(droppedItems, dropped);
    const after = estimateScheme(currentRows, passways, multiplier);
    ruleImpacts.push({
      rule: 'group_quota',
      enabled: true,
      beforeTicketCount: before.ticketCount,
      afterTicketCount: after.ticketCount,
      deltaTicketCount: after.ticketCount - before.ticketCount,
      beforeAmount: before.amount,
      afterAmount: after.amount,
      deltaAmount: +(after.amount - before.amount).toFixed(2),
      droppedCount: dropped.length,
    });
  }

  // 组隔离
  const isoEnabled = safeBool(normalized.groupIsolation);
  let isoField = String(normalized.groupIsolationField || 'none')
    .trim()
    .toLowerCase();
  if (isoEnabled) {
    if (!isoField || isoField === 'none' || isoField === 'off') {
      isoField = gpField && gpField !== 'none' && gpField !== 'off' ? gpField : 'league';
    }
    const before = estimateScheme(currentRows, passways, multiplier);
    const byGroup = {};
    currentRows.forEach(function (row) {
      var gk = _resolveGroupKey(row, isoField);
      if (!byGroup[gk]) byGroup[gk] = [];
      byGroup[gk].push(row);
    });
    const kept = [],
      dropped = [];
    Object.values(byGroup).forEach(function (rows) {
      rows.sort(function (a, b) {
        var sa = selectionScore(a),
          sb = selectionScore(b);
        for (var i = 0; i < sa.length; i++) {
          if (sa[i] !== sb[i]) return sb[i] - sa[i];
        }
        return 0;
      });
      kept.push(rows[0]);
      rows.slice(1).forEach(function (r) {
        dropped.push(_dropPayload(r, ['group_isolation_exceeded']));
      });
    });
    currentRows = kept;
    droppedItems.push.apply(droppedItems, dropped);
    const after = estimateScheme(currentRows, passways, multiplier);
    ruleImpacts.push({
      rule: 'group_isolation',
      enabled: true,
      beforeTicketCount: before.ticketCount,
      afterTicketCount: after.ticketCount,
      deltaTicketCount: after.ticketCount - before.ticketCount,
      beforeAmount: before.amount,
      afterAmount: after.amount,
      deltaAmount: +(after.amount - before.amount).toFixed(2),
      droppedCount: dropped.length,
    });
  }

  // 结构约束
  const structEnabled = [
    'breakpointCountMin',
    'breakpointCountMax',
    'oddEvenBreakpointCountMin',
    'oddEvenBreakpointCountMax',
    'streakMax',
    'acValueMin',
    'acValueMax',
  ].some(function (k) {
    return normalized[k] != null;
  });
  if (structEnabled) {
    const before = estimateScheme(currentRows, passways, multiplier);
    const dropped = [];
    var mutableRows = currentRows.slice();
    var fail = structureReasons(mutableRows, normalized);
    while (mutableRows.length > 0 && fail.reasons.length > 0) {
      mutableRows.sort(function (a, b) {
        var sa = selectionScore(a),
          sb = selectionScore(b);
        for (var i = 0; i < sa.length; i++) {
          if (sa[i] !== sb[i]) return sa[i] - sb[i];
        }
        return 0;
      });
      var removed = mutableRows.shift();
      dropped.push(_dropPayload(removed, fail.reasons));
      fail = structureReasons(mutableRows, normalized);
    }
    currentRows = mutableRows;
    droppedItems.push.apply(droppedItems, dropped);
    const after = estimateScheme(currentRows, passways, multiplier);
    ruleImpacts.push({
      rule: 'structure_complexity',
      enabled: true,
      beforeTicketCount: before.ticketCount,
      afterTicketCount: after.ticketCount,
      deltaTicketCount: after.ticketCount - before.ticketCount,
      beforeAmount: before.amount,
      afterAmount: after.amount,
      deltaAmount: +(after.amount - before.amount).toFixed(2),
      droppedCount: dropped.length,
    });
  }

  // 预算裁减
  var afterSummary = estimateScheme(currentRows, passways, multiplier);
  const maxTickets = safeInt(normalized.maxTicketCount);
  const maxAmt = safeFloat(normalized.maxAmount);
  const budgetEnabled = (maxTickets != null && maxTickets > 0) || (maxAmt != null && maxAmt >= 0);
  if (budgetEnabled) {
    const before = Object.assign({}, afterSummary);
    const dropped = [];
    while (
      currentRows.length > 0 &&
      ((maxTickets != null && afterSummary.ticketCount > maxTickets) ||
        (maxAmt != null && afterSummary.amount > maxAmt))
    ) {
      currentRows.sort(function (a, b) {
        var sa = selectionScore(a),
          sb = selectionScore(b);
        for (var i = 0; i < sa.length; i++) {
          if (sa[i] !== sb[i]) return sa[i] - sb[i];
        }
        return 0;
      });
      var removed = currentRows.shift();
      dropped.push(_dropPayload(removed, ['budget_trim']));
      afterSummary = estimateScheme(currentRows, passways, multiplier);
    }
    droppedItems.push.apply(droppedItems, dropped);
    ruleImpacts.push({
      rule: 'budget_trim',
      enabled: true,
      beforeTicketCount: before.ticketCount,
      afterTicketCount: afterSummary.ticketCount,
      deltaTicketCount: afterSummary.ticketCount - before.ticketCount,
      beforeAmount: before.amount,
      afterAmount: afterSummary.amount,
      deltaAmount: +(afterSummary.amount - before.amount).toFixed(2),
      droppedCount: dropped.length,
    });
  }

  // 统计丢弃原因
  const reasonCounter = {};
  droppedItems.forEach(function (item) {
    (item.reasons || []).forEach(function (r) {
      reasonCounter[r] = (reasonCounter[r] || 0) + 1;
    });
  });

  return {
    filters: normalized,
    beforeSummary: beforeSummary,
    afterSummary: afterSummary,
    keptSelections: currentRows,
    droppedItems: droppedItems,
    dropReasons: Object.keys(reasonCounter)
      .sort(function (a, b) {
        return reasonCounter[b] - reasonCounter[a];
      })
      .map(function (r) {
        return { reason: r, count: reasonCounter[r] };
      }),
    retentionRatio:
      beforeSummary.selectionCount > 0 ? +(afterSummary.selectionCount / beforeSummary.selectionCount).toFixed(4) : 0,
    ruleImpacts: ruleImpacts,
    unknownFilters: unknown,
  };
}

// ═══ 导出 ═══
module.exports = {
  FILTER_DEFAULTS,
  KNOWN_FILTER_KEYS,
  safeFloat,
  safeInt,
  safeBool,
  listTokenSet,
  normalizeSelectionCode,
  selectionScore,
  matchesBaseFilters,
  matchesValueGate,
  matchesCalibratedConfidence,
  matchesOddsRelation,
  groupSelections,
  allowedPassways,
  estimateScheme,
  applySchemeFilters,
  SELECTION_LABELS,
  BASE_BET_COST,
};
