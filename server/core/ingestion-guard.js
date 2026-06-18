/**
 * ═══ 数据摄入门禁 (Ingestion Guard) ═══
 * P0 Layer 1: 统一 midou 数据进入 data.json 前的质量校验
 *
 * 规则集中管理，替代分散在 data_sync.js / sync_live_500.js 的重复过滤
 */

/**
 * 校验一条 live match 数据是否可信、是否存在半场误判
 * @param {object} old  - data.json 中的旧记录 (null 表示新比赛)
 * @param {object} lm   - live API 返回的当前数据
 * @param {object} opts - 可选配置
 * @returns {object} { ok, fields, flags }
 *   ok:     是否通过门禁
 *   fields: 应该写入 data.json 的字段（已修正）
 *   flags:  标记集合 { suspectHalftime, scoreStale, statusConflict }
 */
function validateLiveMatch(old, lm, opts) {
  opts = opts || {};
  const flags = {};
  const fields = {};

  // ── 1. 基础字段提取 ──
  const liveStatus = lm.matchStatus;
  const liveScore = lm.score || '';
  const liveDur = lm.duration || '';
  const durNum = parseInt(liveDur) || 0;

  fields.matchStatus = liveStatus;
  fields.score = liveScore;
  fields.halfScore = lm.halfScore || '';
  fields.duration = liveDur;
  fields.yellow = lm.yellow || '';
  fields.red = lm.red || '';
  fields.recommNum = lm.recommNum;

  // ── 2. duration 完整性哨兵 ──
  // 比赛被标记为完赛(status>=2)但 duration 不完整 → 疑似半场误判
  if (liveStatus >= 2 && liveScore && durNum < 60) {
    flags.suspectHalftime = true;
    if (old && old.matchStatus >= 2 && old.score && old.duration === '完') {
      // 旧数据更可信（已完整完赛），保留旧数据
      return { ok: true, fields: null, flags: { statusConflict: true }, note: '旧数据更完整，跳过覆盖' };
    }
    // 标记但不丢弃 — 如果后续 live 数据跟进了全场比分会自然覆盖
  }

  // ── 3. matchStatus 锁定规则 ──
  if (old && old.matchStatus >= 2 && liveStatus === 0) {
    // 旧数据已是完赛，新数据报未开始 → 需要判断可信度
    if (!liveScore && liveDur === '') {
      // 新数据完全空白 → 保留旧数据
      return { ok: true, fields: null, flags: { statusConflict: true }, note: '旧完赛数据更可信' };
    }
    if (liveScore && durNum > 0 && durNum < 60) {
      // 有比分但 duration 表明仍在赛中 → 半场误判，允许状态回退
      flags.suspectHalftime = true;
      fields.matchStatus = liveStatus; // 允许回退
    } else if (liveScore && old.score !== liveScore) {
      // 比分不同 → 可能是新轮次/修正，允许更新
      fields.matchStatus = liveStatus;
    } else {
      // 无强证据推翻旧完赛状态 → 保留
      return { ok: true, fields: null, flags: { statusConflict: true }, note: '无证据推翻旧完赛记录' };
    }
  }

  // ── 4. 比分单调性检查 ──
  if (old && old.score && liveScore && old.score !== liveScore) {
    const oldParts = old.score.replace(/[-:]/, ':').split(':').map(Number);
    const newParts = liveScore.replace(/[-:]/, ':').split(':').map(Number);
    const oldTotal = (oldParts[0] || 0) + (oldParts[1] || 0);
    const newTotal = (newParts[0] || 0) + (newParts[1] || 0);
    if (newTotal < oldTotal && liveStatus === 0) {
      // 新比分总进球更少 + 状态未开始 → 可能是旧轮次数据
      flags.scoreStale = true;
      fields.score = old.score; // 保留旧比分
    }
  }

  return { ok: true, fields: fields, flags: flags };
}

/**
 * 批量校验 live_scores.json 中的所有比赛
 * @returns {{ passed, flagged, skipped }}
 */
function batchGuard(oldMap, liveMatches) {
  const result = { passed: 0, flagged: [], skipped: 0 };

  liveMatches.forEach(function (lm) {
    let key = lm.matchId ? 'm_' + lm.matchId : null;
    if (!key && lm.num && lm.date) {
      // 仅允许 date|num 联合回查，禁止纯 num 跨日匹配
      const lmDate = String(lm.date).slice(0, 10);
      const found = Object.keys(oldMap || {}).find(function (k) {
        const old = oldMap[k] || {};
        return old.num === lm.num && String(old.date || '').slice(0, 10) === lmDate;
      });
      if (found) key = found;
    }
    const old = key ? oldMap[key] : null;
    const v = validateLiveMatch(old, lm);

    if (v.fields === null) {
      result.skipped++;
      v.matchId = lm.matchId;
      v.num = lm.num;
      result.flagged.push(v);
    } else {
      result.passed++;
    }
  });

  return result;
}

/**
 * 赛后一致性校验 — 确认已经完赛的比赛数据完整
 */
function postMatchAudit(match) {
  const issues = [];
  if (!match || !match.matchStatus || match.matchStatus < 2) return issues;

  if (!match.score || match.score === '-') {
    issues.push({ type: 'missing_score', matchId: match.matchId, num: match.num });
  }
  if (!match.duration || match.duration === '') {
    issues.push({ type: 'missing_duration', matchId: match.matchId, num: match.num });
  }
  if (match.halfScore && match.halfScore === match.score && match.score !== '0:0' && match.score !== '0-0') {
    // ★ V12: 半场=全场 且非0:0 → 高概率半场比分被当终场，触发多源复核
    issues.push({
      type: 'half_equals_final_non_zero',
      matchId: match.matchId,
      num: match.num,
      score: match.score,
      halfScore: match.halfScore,
      date: match.date ? match.date.slice(0, 10) : '',
      severity: 'P1', // 需要多源复核修正
    });
  }

  return issues;
}

module.exports = {
  validateLiveMatch: validateLiveMatch,
  batchGuard: batchGuard,
  postMatchAudit: postMatchAudit,
};
