/**
 * ============================================================
 * 回填三阶段 — Phase 3: outcomes 回填 + unified_predictions 同步
 * ============================================================
 *
 * 前提: Phase 1 + Phase 2 已完成（prediction_logs 有 GS/PK 预测 + actual_score）
 *
 * 流程:
 *   3A: prediction_logs → unified_predictions (GS/PK 两模型)
 *   3B: outcome-backfill → prediction_outcomes (命中判定)
 *   3C: 计算模型命中率汇总
 *
 * 用法:
 *   node server/backfill_phase3_outcomes.js [--dry]
 *     --dry  试运行
 */

const fs = require('fs');
const path = require('path');
const database = require('./database');

const dryRun = process.argv.includes('--dry');
const START_DATE = '2024-01-01';
const END_DATE = '2026-03-18';

console.log('╔══════════════════════════════════════╗');
console.log('║  Phase 3: outcomes 回填              ║');
console.log('║  ' + (dryRun ? 'DRY RUN' : '正式执行') + '                  ║');
console.log('╚══════════════════════════════════════╝\n');

// 等待数据库
function waitForDb() {
  return new Promise((resolve) => {
    database.initDatabase();
    if (database.isAvailable()) {
      resolve(database.getAdapter());
      return;
    }
    const start = Date.now();
    function check() {
      if (database.isAvailable()) {
        resolve(database.getAdapter());
        return;
      }
      if (Date.now() - start > 30000) {
        console.error('数据库初始化超时');
        process.exit(1);
      }
      setTimeout(check, 500);
    }
    check();
  });
}

(async function () {
  const adp = await waitForDb();

  // ═══ Step 3A: 读取 prediction_logs 写入 unified_predictions ═══
  console.log('── Step 3A: prediction_logs → unified_predictions ──\n');

  const rows = adp.execAll(
    `SELECT * FROM prediction_logs WHERE date >= ? AND date <= ? ORDER BY date, matchNum`,
    START_DATE,
    END_DATE,
  );
  console.log(`  符合条件的 prediction_logs: ${rows.length} 条`);

  // 统计: 有多少有 actual_score
  const withScore = rows.filter((r) => r.actual_score && r.actual_score.trim());
  console.log(`  有比分: ${withScore.length} 条`);

  // 统计: 有多少有 GS 预测
  const withGS = rows.filter((r) => r.gs_top_score || r.gs_scores_json);
  console.log(`  有 GS: ${withGS.length} 条`);

  // 统计: 有多少有 PK 预测
  const withPK = rows.filter((r) => r.pk_composite_score !== null && r.pk_composite_score !== undefined);
  console.log(`  有 PK: ${withPK.length} 条`);

  // 方向映射
  function scoreToDirection(score) {
    if (!score) return null;
    const parts = String(score).split(/[-:：]/);
    if (parts.length < 2) return null;
    const h = parseInt(parts[0]),
      a = parseInt(parts[1]);
    if (isNaN(h) || isNaN(a)) return null;
    if (h > a) return 'home';
    if (h < a) return 'away';
    return 'draw';
  }

  let uniTotal = 0,
    uniSkipped = 0,
    uniErrors = 0;
  const modelCounts = {};

  for (const row of rows) {
    const mid = (row.matchId || '').replace(/^m_/, '');
    const date = row.date || '';

    // ── 模型1: 功守道 ──
    if (row.gs_top_score || row.gs_scores_json) {
      let gsDir = scoreToDirection(row.gs_top_score);
      if (!gsDir && row.gs_scores_json) {
        try {
          const sj = JSON.parse(row.gs_scores_json);
          if (Array.isArray(sj) && sj.length > 0) gsDir = scoreToDirection(sj[0].score);
        } catch (_) {}
      }

      if (gsDir) {
        const predId = `gs_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (existing) {
          uniSkipped++;
        } else if (!dryRun) {
          try {
            adp.execRun(
              `INSERT INTO unified_predictions
               (match_num, match_date, match_id, model_name, model_version, prediction_id,
                direction, direction_confidence, predicted_score, raw_output_json, consensus_tag, computed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              row.matchNum || '',
              date,
              mid,
              '功守道',
              'v1.0',
              predId,
              gsDir,
              row.gs_top_percent || 50,
              row.gs_top_score || null,
              row.gs_scores_json || null,
              row.pk_fusion_consensus || null,
              row.created_at || date,
            );
            uniTotal++;
            modelCounts['功守道'] = (modelCounts['功守道'] || 0) + 1;
          } catch (e) {
            uniErrors++;
          }
        } else {
          uniTotal++;
          modelCounts['功守道'] = (modelCounts['功守道'] || 0) + 1;
        }
      }
    }

    // ── 模型2: PK评分 ──
    if (row.pk_composite_score !== null && row.pk_composite_score !== undefined && row.pk_direction) {
      let pkDir = mapDirection(row.pk_direction);
      if (pkDir) {
        const predId = `pk_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (existing) {
          uniSkipped++;
        } else if (!dryRun) {
          try {
            adp.execRun(
              `INSERT INTO unified_predictions
               (match_num, match_date, match_id, model_name, model_version, prediction_id,
                direction, direction_confidence, over_under, predicted_score,
                raw_output_json, consensus_tag, computed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              row.matchNum || '',
              date,
              mid,
              'PK评分',
              'v1.0',
              predId,
              pkDir,
              row.pk_composite_score || 50,
              mapOverUnder(row.pk_goal_direction),
              null,
              JSON.stringify({
                composite: row.pk_composite_score,
                power: row.pk_power_score,
                goal: row.pk_goal_score,
                heat: row.pk_heat_score,
                stability: row.pk_stability_score,
                value: row.pk_value_score,
                ev_home: row.pk_ev_home,
                ev_draw: row.pk_ev_draw,
                ev_away: row.pk_ev_away,
              }),
              row.pk_fusion_consensus || null,
              row.created_at || date,
            );
            uniTotal++;
            modelCounts['PK评分'] = (modelCounts['PK评分'] || 0) + 1;
          } catch (e) {
            uniErrors++;
          }
        } else {
          uniTotal++;
          modelCounts['PK评分'] = (modelCounts['PK评分'] || 0) + 1;
        }
      }
    }
  }

  console.log(`\nunified_predictions: ${uniTotal} 新写入`);
  console.log(`  跳过已有: ${uniSkipped}`);
  if (uniErrors) console.log(`  错误: ${uniErrors}`);
  console.log('  模型分布:', JSON.stringify(modelCounts));

  // ═══ Step 3B: outcome-backfill ═══
  if (dryRun) {
    console.log('\n*** DRY RUN 完成，去掉 --dry 正式执行 ***');
    process.exit(0);
  }

  console.log('\n── Step 3B: outcome-backfill ──\n');

  const { backfiller } = require('./core/outcome-backfill');
  try {
    const bfResult = await backfiller.backfill(adp, { dryRun: false });
    console.log('OutcomeBackfill 结果:', JSON.stringify(bfResult));
  } catch (e) {
    console.log('OutcomeBackfill 错误:', e.message);
  }

  // ═══ Step 3C: 命中率汇总 ═══
  console.log('\n── Step 3C: 命中率汇总 ──\n');

  // 按模型统计
  const modelStats = adp.execAll(`
    SELECT model_name, COUNT(*) as total, SUM(direction_hit) as hits
    FROM prediction_outcomes
    GROUP BY model_name
    ORDER BY total DESC
  `);
  modelStats.forEach((s) => {
    const rate = s.total > 0 ? ((s.hits / s.total) * 100).toFixed(1) : '0.0';
    console.log(`  ${s.model_name}: ${rate}% (${s.hits}/${s.total})`);
  });

  // 全时间段汇总
  const outcomesTotal = adp.execOne('SELECT COUNT(*) as cnt FROM prediction_outcomes');
  console.log(`\nprediction_outcomes 总数: ${outcomesTotal.cnt}`);

  const uniTotal2 = adp.execOne('SELECT COUNT(*) as cnt FROM unified_predictions');
  console.log(`unified_predictions 总数: ${uniTotal2.cnt}`);

  console.log('\n═══════════════════════════════════════');
  console.log('  Phase 3 完成!');
  console.log('  三阶段回填全部完成 🎉');
  console.log('═══════════════════════════════════════');
})();

// ═══ 辅助函数 ═══
function mapDirection(cn) {
  if (!cn) return null;
  if (cn === '主胜' || cn.startsWith('主胜') || cn === '主队不败' || cn === '胜平' || cn === '胜/平双选') return 'home';
  if (
    cn === '客胜' ||
    cn.startsWith('客胜') ||
    cn === '客队不败' ||
    cn === '客队胜' ||
    cn === '平负' ||
    cn.includes('客胜')
  )
    return 'away';
  if (cn === '平' || cn === '平局') return 'draw';
  return null;
}

function mapOverUnder(s) {
  if (!s) return null;
  if (s.includes('大球') || s.includes('over')) return 'over';
  if (s.includes('小球') || s.includes('under')) return 'under';
  return null;
}
