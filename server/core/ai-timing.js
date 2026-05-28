/**
 * server/core/ai-timing.js
 * AI 计时统计 — 预估等待时间，辅助前端 loading 展示
 */
const fs = require('fs');
const path = require('path');

const TIMING_PATH = path.join(__dirname, '..', 'ai_timing.json');

/** 获取预估等待时间（默认 45 秒） */
function getEstimatedWaitTime() {
  try {
    if (fs.existsSync(TIMING_PATH)) {
      const timing = JSON.parse(fs.readFileSync(TIMING_PATH, 'utf8'));
      if (timing.total_estimated_sec && timing.sample_count > 0) {
        return timing.total_estimated_sec;
      }
    }
  } catch (e) {}
  return 45;
}

/** 更新计时统计（移动平均） */
function updateTimingStats(deepseekMs, doubaoMs, mergeMs) {
  try {
    let timing = {
      deepseek_avg_ms: 0, doubao_avg_ms: 0, merge_avg_ms: 0,
      total_estimated_sec: 45, sample_count: 0, last_updated: ''
    };
    if (fs.existsSync(TIMING_PATH)) {
      try { timing = JSON.parse(fs.readFileSync(TIMING_PATH, 'utf8')); } catch (e) {}
    }
    const n = timing.sample_count || 0;
    const decay = n > 5 ? 0.9 : (n > 0 ? 0.7 : 0);
    timing.deepseek_avg_ms = decay > 0
      ? Math.round(timing.deepseek_avg_ms * decay + deepseekMs * (1 - decay)) : deepseekMs;
    timing.doubao_avg_ms = decay > 0
      ? Math.round(timing.doubao_avg_ms * decay + doubaoMs * (1 - decay)) : doubaoMs;
    timing.merge_avg_ms = mergeMs;
    timing.sample_count = n + 1;
    timing.total_estimated_sec = Math.ceil(
      (Math.max(timing.deepseek_avg_ms, timing.doubao_avg_ms) + timing.merge_avg_ms) / 1000
    ) + 3;
    timing.last_updated = new Date().toISOString();
    fs.writeFileSync(TIMING_PATH, JSON.stringify(timing));
  } catch (e) {}
}

module.exports = { getEstimatedWaitTime, updateTimingStats };
