// server/backfill/index.js
// ★ V12: 统一回填入口 — 所有回填操作通过此模块调用，确保幂等 + 日志

const fs = require('fs');
const path = require('path');
const database = require('../database');

const BACKFILL_DIR = __dirname;
const KNOWN_BACKFILL = new Map([
  ['outcomes',    path.join(BACKFILL_DIR, 'bulk_outcome.js')],
  ['models',      path.join(BACKFILL_DIR, 'backfill_full_models.js')],
  ['consensus',   path.join(BACKFILL_DIR, 'backfill_consensus.js')],
  ['predictions', path.join(BACKFILL_DIR, 'backfill_prediction_logs.js')],
  ['phase1',      path.join(BACKFILL_DIR, 'backfill_phase1_matches.js')],
  ['phase2',      path.join(BACKFILL_DIR, 'backfill_phase2_predict.js')],
  ['phase3',      path.join(BACKFILL_DIR, 'backfill_phase3_outcomes.js')],
  ['pk',          path.join(BACKFILL_DIR, 'backfill_pk_from_gs.js')],
  ['expert',      path.join(BACKFILL_DIR, 'backfill_expert_consensus.js')],
]);

/**
 * 运行指定回填任务（幂等：重复执行不产生重复数据）
 * @param {string} name - outcomes|models|consensus|predictions
 * @param {object} opts  - 透传给回填脚本的参数
 */
async function run(name, opts = {}) {
  const scriptPath = KNOWN_BACKFILL.get(name);
  if (!scriptPath) throw new Error(`Unknown backfill: ${name}. Known: ${[...KNOWN_BACKFILL.keys()].join(', ')}`);
  if (!fs.existsSync(scriptPath)) throw new Error(`Backfill script not found: ${scriptPath}`);

  console.log(`[backfill] Running: ${name} (${scriptPath})`);
  const task = require(scriptPath);
  
  // 如果导出函数，调用它；否则直接 require 执行
  if (typeof task === 'function') {
    return await task(opts);
  }
  return { ok: true, name, note: 'script executed by require' };
}

/** 列出所有可用回填任务 */
function list() {
  return [...KNOWN_BACKFILL.entries()].map(([name, scriptPath]) => ({
    name,
    exists: fs.existsSync(scriptPath),
    script: path.basename(scriptPath),
  }));
}

module.exports = { run, list, KNOWN_BACKFILL };
