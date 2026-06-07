/**
 * 将 prediction_logs（已含 actual_score 的 992 条）回填到 unified_predictions + prediction_outcomes
 *
 * 策略：逐条生成 3 个模型的预测记录（AI预测 / 功守道 / PK评分）
 *
 * 用法：node server/backfill_unified_predictions.js [--dry]
 */
const database = require('./database');

const dryRun = process.argv.includes('--dry');
if (dryRun) console.log('*** DRY RUN — 不会实际写入 ***\n');

// 等待数据库初始化（兼容 sql.js 异步加载）
function waitForDb() {
  return new Promise(function (resolve) {
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
      setTimeout(check, 500).unref();
    }
    check();
  });
}

// Wrap main logic in async
(async function () {
  const adp = await waitForDb();
  if (!adp) {
    console.error('数据库不可用');
    process.exit(1);
  }

  // 读取所有有实际赛果的 prediction_logs
  const rows = adp.execAll(
    "SELECT * FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score != '' ORDER BY date, matchNum",
  );

  console.log(`prediction_logs 中有赛果的记录: ${rows.length} 条\n`);

  if (rows.length === 0) {
    console.log('无需回填');
    process.exit(0);
  }

  // 方向映射：中文 → 英文（覆盖豆包API全部输出格式）
  function mapDirection(cn) {
    if (!cn) return null;
    // 主胜方向: 主胜, 主胜或平, 主队不败, 胜平, 胜/平双选
    if (cn === '主胜' || cn.startsWith('主胜') || cn === '主队不败' || cn === '胜平' || cn === '胜/平双选')
      return 'home';
    // 客胜方向: 客胜, 客队不败, 客队胜, 平负, 平/局或客胜
    if (
      cn === '客胜' ||
      cn.startsWith('客胜') ||
      cn === '客队不败' ||
      cn === '客队胜' ||
      cn === '平负' ||
      cn.includes('客胜')
    )
      return 'away';
    // 纯平: 平, 平局
    if (cn === '平' || cn === '平局') return 'draw';
    // 模糊/无法判断: 胜平负皆有可能, 无, 胜平负, 球队名+胜 → 跳过
    return null;
  }

  // 从比分推断方向
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

  function mapOverUnder(s) {
    if (!s) return null;
    if (s.includes('大球') || s.includes('over')) return 'over';
    if (s.includes('小球') || s.includes('under')) return 'under';
    return null;
  }

  let total = 0,
    skipped = 0,
    errors = 0;
  const modelsWritten = [];

  for (const row of rows) {
    const mid = (row.matchId || '').replace(/^m_/, '');
    const date = row.date || '';
    const num = row.matchNum || '';

    // ── 模型1: AI预测 (DeepSeek/豆包合并) ──
    const aiDir = mapDirection(row.ai_spf);
    if (aiDir) {
      try {
        const predId = `ai_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (existing) {
          skipped++;
        } else {
          if (!dryRun) {
            adp.execRun(
              `INSERT INTO unified_predictions 
             (match_num, match_date, match_id, model_name, model_version, prediction_id,
              direction, direction_confidence, over_under, predicted_score,
              raw_output_json, consensus_tag, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              num,
              date,
              mid,
              'AI预测',
              'v1.0',
              predId,
              aiDir,
              row.ai_confidence || 50,
              mapOverUnder(row.ai_overunder),
              row.ai_score || '',
              row.ai_content || null,
              null,
              row.created_at || date,
            );
          }
          total++;
          modelsWritten.push('AI预测');
        }
      } catch (e) {
        errors++;
      }
    }

    // ── 模型2: 功守道 ──
    if (row.gs_top_score || row.gs_scores_json) {
      try {
        // 从 gs_top_score 推断方向（比分如 "2-0" → home, "1-1" → draw）
        let gsDir = scoreToDirection(row.gs_top_score);

        // 从 ladder_label 或 scores_json 中提取最可能比分的方向
        if (!gsDir && row.gs_scores_json) {
          try {
            const sj = JSON.parse(row.gs_scores_json);
            if (Array.isArray(sj) && sj.length > 0) {
              gsDir = scoreToDirection(sj[0].score);
            }
          } catch (_) {}
        }

        const predId = `gs_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (existing) {
          skipped++;
        } else {
          const gsConf = row.gs_top_percent || 50;
          if (gsDir && !dryRun) {
            adp.execRun(
              `INSERT INTO unified_predictions
             (match_num, match_date, match_id, model_name, model_version, prediction_id,
              direction, direction_confidence, over_under, predicted_score,
              raw_output_json, consensus_tag, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              num,
              date,
              mid,
              '功守道',
              'v1.0',
              predId,
              gsDir,
              gsConf,
              null,
              null,
              row.gs_scores_json || null,
              row.pk_fusion_consensus || null,
              row.created_at || date,
            );
            total++;
            modelsWritten.push('功守道');
          } else if (dryRun && gsDir) {
            total++;
            modelsWritten.push('功守道 (dry)');
          }
        }
      } catch (e) {
        errors++;
      }
    }

    // ── 模型3: PK评分 ──
    const pkDir = mapDirection(row.pk_direction);
    if (pkDir) {
      try {
        const predId = `pk_${mid}_${date}`;
        const existing = adp.execOne('SELECT id FROM unified_predictions WHERE prediction_id = ?', predId);
        if (existing) {
          skipped++;
        } else {
          if (!dryRun) {
            adp.execRun(
              `INSERT INTO unified_predictions
             (match_num, match_date, match_id, model_name, model_version, prediction_id,
              direction, direction_confidence, over_under, predicted_score,
              raw_output_json, consensus_tag, computed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              num,
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
                hcp: row.pk_hcp_direction,
                value: row.pk_value_score,
                ev_home: row.pk_ev_home,
                ev_draw: row.pk_ev_draw,
                ev_away: row.pk_ev_away,
              }),
              row.pk_fusion_consensus || null,
              row.created_at || date,
            );
          }
          total++;
          modelsWritten.push('PK评分');
        }
      } catch (e) {
        errors++;
      }
    }
  }

  console.log(`写入 unified_predictions: ${total} 条 (跳过 ${skipped})`);
  if (errors > 0) console.log(`错误: ${errors}`);

  const modelCounts = {};
  modelsWritten.forEach((m) => (modelCounts[m] = (modelCounts[m] || 0) + 1));
  console.log('模型分布:', JSON.stringify(modelCounts));

  if (dryRun) {
    console.log('\n*** DRY RUN 完成，去掉 --dry 正式执行 ***');
    process.exit(0);
  }

  console.log('\n--- 运行 OutcomeBackfill ---');
  const { backfiller } = require('./core/outcome-backfill');
  try {
    const bfResult = await backfiller.backfill(adp, { dryRun: false });
    console.log('OutcomeBackfill 结果:', JSON.stringify(bfResult));
  } catch (e) {
    console.log('OutcomeBackfill 错误:', e.message);
  }

  const outcomesCount = adp.execOne('SELECT COUNT(*) as cnt FROM prediction_outcomes');
  console.log(`prediction_outcomes: ${outcomesCount.cnt} 条`);

  const rankings = backfiller.getModelHitRates(adp, 30);
  console.log(`模型排名 (${rankings.length} 个):`);
  rankings.forEach((r) => console.log(`  ${r.modelName}: ${r.directionRate}% (${r.total}场)`));

  console.log('完成');
})();
