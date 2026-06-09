/**
 * server/core/market-overlay.js
 * 市场叠加证据系统 — 从 market_overlay_evidence 移植
 *
 * 15维综合评分体系，在功守道分析之上增加"市场面"维度：
 *   基础面 (basic): 阵容强度、战术成熟度、教练能力
 *   状态面 (form):   近期表现、数据质量、状态稳定性
 *   动力面 (motivation): 动力强度、赛程适配度、轮换风险
 *   对阵面 (matchup): 节奏控制、风格克制、关键对决
 *   市场面 (market): 市场热度偏差、盘口公平度、陷阱风险
 */

const OVERLAY_SCORE_FIELDS = [
  'basic_lineup_strength',
  'basic_tactics_maturity',
  'basic_coach_ability',
  'form_recent_performance',
  'form_data_quality',
  'form_stability',
  'motivation_intensity',
  'motivation_schedule_fitness',
  'motivation_rotation_risk',
  'matchup_tempo_control',
  'matchup_style_counter',
  'matchup_key_duel',
  'market_heat_bias',
  'market_line_fairness',
  'market_trap_risk',
];

const OVERLAY_SCORE_EXPLAIN_DEFAULT = '待补支撑解释信息';
const OVERLAY_EVIDENCE_RULE_VERSION = 'overlay_evidence_contract_v1';
const OVERLAY_MAX_EVIDENCE_PER_FIELD = 5;

// ═══ 标签映射（中文） ═══

const FIELD_LABELS = {
  basic_lineup_strength: '阵容强度',
  basic_tactics_maturity: '战术成熟度',
  basic_coach_ability: '教练能力',
  form_recent_performance: '近期表现',
  form_data_quality: '数据质量',
  form_stability: '状态稳定性',
  motivation_intensity: '动力强度',
  motivation_schedule_fitness: '赛程适配度',
  motivation_rotation_risk: '轮换风险',
  matchup_tempo_control: '节奏控制',
  matchup_style_counter: '风格克制',
  matchup_key_duel: '关键对决',
  market_heat_bias: '市场热度偏差',
  market_line_fairness: '盘口公平度',
  market_trap_risk: '陷阱风险',
};

const FIELD_CATEGORIES = {
  basic: ['basic_lineup_strength', 'basic_tactics_maturity', 'basic_coach_ability'],
  form: ['form_recent_performance', 'form_data_quality', 'form_stability'],
  motivation: ['motivation_intensity', 'motivation_schedule_fitness', 'motivation_rotation_risk'],
  matchup: ['matchup_tempo_control', 'matchup_style_counter', 'matchup_key_duel'],
  market: ['market_heat_bias', 'market_line_fairness', 'market_trap_risk'],
};

// ═══ 工具函数 ═══

function safeFloat(v) {
  if (v == null) return null;
  const n = parseFloat(v);
  return isNaN(n) || !isFinite(n) ? null : n;
}

function safeRound(v, digits) {
  if (v == null) return null;
  if (!isFinite(v)) return null;
  return +parseFloat(v).toFixed(digits || 4);
}

function nowISO() {
  return new Date().toISOString().replace('+00:00', 'Z');
}

function cleanText(v) {
  var text = String(v || '');
  text = text.replace(/https?:\/\/\S+/g, ' ');
  text = text.replace(/\[[^\]]+\]|\([^)]+\)/g, ' ');
  text = text.replace(/[`*_#~]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// ═══ 证据行构建 ═══

/**
 * 构建单条证据行
 */
function buildEvidenceRow(opts) {
  const source = String(opts.source || '').trim();
  if (!source) return null;

  const value = cleanText(opts.value || '');
  const capturedAt = String(opts.capturedAt || opts.default_captured_at || nowISO());
  const requestId = String(opts.requestId || opts.default_request_id || 'overlay-evidence:' + Date.now());
  const ruleVersion = String(opts.ruleVersion || opts.default_rule_version || OVERLAY_EVIDENCE_RULE_VERSION);

  // 生成 source_hash
  const crypto = require('crypto');
  const hashPayload = [source, value || '-', capturedAt, requestId, ruleVersion].join('|');
  const sourceHash = opts.sourceHash || crypto.createHash('sha1').update(hashPayload, 'utf8').digest('hex');

  return {
    source: source,
    value: (value || '-').slice(0, 160),
    captured_at: capturedAt,
    request_id: requestId,
    source_hash: sourceHash,
    rule_version: ruleVersion,
  };
}

// ═══ 评分解释解析 ═══

/**
 * 解析评分解释 payload
 * @param {Object|string} raw - JSON 对象或字符串
 * @returns {Object} 各字段的标准化解释
 */
function parseScoreExplain(raw) {
  const payload =
    typeof raw === 'string'
      ? (function () {
          try {
            return JSON.parse(raw);
          } catch (e) {
            return null;
          }
        })()
      : raw;
  if (!payload || typeof payload !== 'object') return {};

  const normalized = {};
  OVERLAY_SCORE_FIELDS.forEach(function (fieldKey) {
    const entry = payload[fieldKey];
    if (!entry || typeof entry !== 'object') return;

    const explainText = String(entry.explain_text || entry.explainText || '').trim();
    const confidence = safeFloat(entry.confidence);
    const updatedBy = String(entry.updated_by || entry.updatedBy || '').trim() || null;
    const updatedAt = String(entry.updated_at || entry.updatedAt || '').trim() || null;

    var evidenceRows = [];
    const rawEvidence = entry.evidence;
    if (Array.isArray(rawEvidence)) {
      rawEvidence.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        const row = buildEvidenceRow({
          source: item.source,
          value: item.value,
          capturedAt: item.captured_at || item.capturedAt,
          requestId: item.request_id || item.requestId,
          sourceHash: item.source_hash || item.sourceHash,
          ruleVersion: item.rule_version || item.ruleVersion,
          default_captured_at: updatedAt || nowISO(),
          default_request_id: 'overlay-score-explain:' + fieldKey,
          default_rule_version: OVERLAY_EVIDENCE_RULE_VERSION,
        });
        if (row) evidenceRows.push(row);
      });
    }
    evidenceRows = evidenceRows.slice(0, OVERLAY_MAX_EVIDENCE_PER_FIELD);

    normalized[fieldKey] = {
      explain_text: explainText || OVERLAY_SCORE_EXPLAIN_DEFAULT,
      evidence: evidenceRows,
      confidence: safeRound(confidence, 4),
      updated_by: updatedBy || 'system',
      updated_at: updatedAt || null,
    };
  });

  return normalized;
}

/**
 * 确保所有15维字段存在
 */
function ensureScoreFields(payload, opts) {
  opts = opts || {};
  const current = payload || {};
  const normalized = {};

  OVERLAY_SCORE_FIELDS.forEach(function (fieldKey) {
    const entry = current[fieldKey];
    const explainText =
      (entry && typeof entry === 'object' ? String(entry.explain_text || entry.explainText || '') : '') ||
      OVERLAY_SCORE_EXPLAIN_DEFAULT;
    const confidence = entry && typeof entry === 'object' ? safeFloat(entry.confidence) : null;
    const evidence = entry && typeof entry === 'object' ? entry.evidence || [] : [];
    const evidenceRows = Array.isArray(evidence)
      ? evidence.filter(function (r) {
          return r && typeof r === 'object';
        })
      : [];
    const updatedBy =
      (entry && typeof entry === 'object' ? String(entry.updated_by || entry.updatedBy || '') : '') ||
      opts.default_updated_by ||
      'system';
    const updatedAt =
      (entry && typeof entry === 'object' ? String(entry.updated_at || entry.updatedAt || '') : '') ||
      opts.default_updated_at ||
      null;

    const normEvidence = [];
    evidenceRows.forEach(function (row) {
      const nr = buildEvidenceRow({
        source: row.source,
        value: row.value,
        capturedAt: row.captured_at || row.capturedAt,
        requestId: row.request_id || row.requestId,
        sourceHash: row.source_hash || row.sourceHash,
        ruleVersion: row.rule_version || row.ruleVersion,
        default_captured_at: updatedAt || nowISO(),
        default_request_id: 'overlay-score-explain:' + fieldKey,
        default_rule_version: OVERLAY_EVIDENCE_RULE_VERSION,
      });
      if (nr) normEvidence.push(nr);
    });

    normalized[fieldKey] = {
      explain_text: explainText,
      evidence: normEvidence.slice(0, OVERLAY_MAX_EVIDENCE_PER_FIELD),
      confidence: safeRound(confidence, 4),
      updated_by: updatedBy,
      updated_at: updatedAt,
    };
  });

  return normalized;
}

/**
 * 检查是否有场外证据
 */
function hasOffFieldEvidence(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const evidence = entry.evidence;
  if (!Array.isArray(evidence)) return false;
  return evidence.some(function (item) {
    if (!item || typeof item !== 'object') return false;
    const src = String(item.source || '')
      .trim()
      .toLowerCase();
    const val = String(item.value || '').trim();
    return src.startsWith('offfield.') && val && val !== '-';
  });
}

// ═══ 评分引擎 ═══

/**
 * 从功守道数据推断市场叠加评分
 * @param {Object} gs - 功守道缓存数据
 * @param {Object} context - 额外上下文（lineup/injury/schedule）
 * @returns {Object} 15维评分
 */
function inferOverlayScores(gs, context) {
  gs = gs || {};
  context = context || {};

  const scores = {};

  // ── 基础面 inference ──
  // 阵容强度：从 attackAdvantage/defenseAdvantage 推断
  const att = Math.abs(safeFloat(gs.attackAdvantageRaw) || 0);
  const def = Math.abs(safeFloat(gs.defenseAdvantageRaw) || 0);
  scores.basic_lineup_strength = clamp(50 + (att + def) * 30, 10, 95);

  // 战术成熟度：从 stabilityOverall 推断
  scores.basic_tactics_maturity = clamp(safeFloat(gs.stabilityOverall) || 50, 10, 95);

  // 教练能力：从 fusionConsensus 推断
  const consensus = gs.fusionConsensus || '';
  scores.basic_coach_ability = consensus === 'strong' ? 75 : consensus === 'weak' ? 50 : 60;

  // ── 状态面 inference ──
  scores.form_recent_performance = clamp((safeFloat(gs.xgHome) || 0) * 20 + 30, 10, 90);
  scores.form_data_quality = clamp(safeFloat(gs.stabilityOverall) || 50, 10, 95);
  scores.form_stability = clamp(safeFloat(gs.stabilityOverall) || 50, 10, 95);

  // ── 动力面 inference ──
  scores.motivation_intensity = clamp(50 + (safeFloat(gs.bigBallRatio) || 50) * 0.3, 10, 95);
  scores.motivation_schedule_fitness = 55;
  scores.motivation_rotation_risk = 40;

  // ── 对阵面 inference ──
  const pwScore = safeFloat(gs.pwScore) || 0;
  const absPW = Math.abs(pwScore);
  scores.matchup_tempo_control = clamp(50 + absPW * 25, 10, 95);
  scores.matchup_style_counter = clamp(50 + absPW * 20, 10, 90);
  scores.matchup_key_duel = clamp(50 + absPW * 15, 10, 85);

  // ── 市场面 inference ──
  const hi = safeFloat(gs.heatIndex);
  if (hi != null && hi > 0) {
    const delta = Math.abs(1.0 - hi);
    scores.market_heat_bias = clamp(100 - 100 * Math.pow(delta, 1.5), 10, 95);
  } else {
    scores.market_heat_bias = 50;
  }
  scores.market_line_fairness = clamp(safeFloat(gs.stabilityOverall) || 50, 10, 95);
  scores.market_trap_risk = hi != null && hi > 1.5 ? 70 : hi != null && hi < 0.85 ? 40 : 25;

  return scores;
}

function clamp(v, min, max) {
  return Math.round(Math.max(min, Math.min(max, v || 50)));
}

// ═══ 综合评估 ═══

/**
 * 按类别聚合评分
 * @param {Object} scores - 15维评分 { fieldKey: score }
 * @returns {Object} 分类 + 综合评分
 */
function aggregateScores(scores) {
  const result = { categories: {}, total: 0, fieldScores: {} };

  const weights = {
    basic: { w: 0.2, fields: FIELD_CATEGORIES.basic },
    form: { w: 0.2, fields: FIELD_CATEGORIES.form },
    motivation: { w: 0.15, fields: FIELD_CATEGORIES.motivation },
    matchup: { w: 0.2, fields: FIELD_CATEGORIES.matchup },
    market: { w: 0.25, fields: FIELD_CATEGORIES.market },
  };

  let totalWeighted = 0,
    totalWeight = 0;
  Object.keys(weights).forEach(function (cat) {
    const { w, fields: catFields } = weights[cat];
    let sum = 0,
      count = 0;
    catFields.forEach(function (field) {
      const s = scores[field];
      if (s != null) {
        sum += s;
        count++;
        result.fieldScores[field] = s;
      }
    });
    const avg = count > 0 ? sum / count : 50;
    result.categories[cat] = { label: getCategoryLabel(cat), score: Math.round(avg), weight: w };
    totalWeighted += avg * w;
    totalWeight += w;
  });

  result.total = Math.round(totalWeight > 0 ? totalWeighted / totalWeight : 50);
  result.overlayVersion = OVERLAY_EVIDENCE_RULE_VERSION;

  return result;
}

function getCategoryLabel(cat) {
  const labels = {
    basic: '基础面',
    form: '状态面',
    motivation: '动力面',
    matchup: '对阵面',
    market: '市场面',
  };
  return labels[cat] || cat;
}

/**
 * 对比主客队 overlay 评分差异
 */
function compareOverlayScore(homeScores, awayScores) {
  const comparison = {};

  OVERLAY_SCORE_FIELDS.forEach(function (field) {
    const h = homeScores[field] || 50;
    const a = awayScores[field] || 50;
    comparison[field] = {
      home: h,
      away: a,
      diff: h - a,
      advantage: h > a + 3 ? 'home' : a > h + 3 ? 'away' : 'neutral',
    };
  });

  const homeAgg = aggregateScores(homeScores);
  const awayAgg = aggregateScores(awayScores);
  const totalDiff = homeAgg.total - awayAgg.total;

  return {
    fieldComparison: comparison,
    homeAggregation: homeAgg,
    awayAggregation: awayAgg,
    totalDiff: totalDiff,
    overallAdvantage: totalDiff > 5 ? 'home' : totalDiff < -5 ? 'away' : 'neutral',
  };
}

// ═══ 导出 ═══
module.exports = {
  OVERLAY_SCORE_FIELDS,
  FIELD_LABELS,
  FIELD_CATEGORIES,
  OVERLAY_SCORE_EXPLAIN_DEFAULT,
  OVERLAY_EVIDENCE_RULE_VERSION,
  buildEvidenceRow,
  parseScoreExplain,
  ensureScoreFields,
  hasOffFieldEvidence,
  inferOverlayScores,
  aggregateScores,
  compareOverlayScore,
  getCategoryLabel,
};
