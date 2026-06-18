/**
 * ============================================================
 * 回填三阶段 — Phase 2: GS 功守道 + PK 评分预测
 * ============================================================
 *
 * 前提: Phase 1 已完成（matches 表 + data.json + prediction_logs 元数据已就绪）
 *
 * 流程:
 *   2A: GS 功守道 fallback 模式（基于联赛基线 + 让球信息）
 *   2B: PK 评分（逐日计算 composite/power/goal/heat 评分）
 *
 * 用法:
 *   node server/backfill_phase2_predict.js [--dry] [--phase=gs|pk|all]
 */

const fs = require('fs');
const path = require('path');

const START_DATE = '2024-01-01';
const END_DATE = '2026-03-18';
const DATA_FILE = path.join(__dirname, 'data.json');
const GS_CACHE_FILE = path.join(__dirname, 'gongshoudao', 'cache.json');

const dryRun = process.argv.includes('--dry');
const phaseArg = process.argv.find(function (a) {
  return a.startsWith('--phase=');
});
const runGS = !phaseArg || phaseArg.includes('gs') || phaseArg.includes('all');
const runPK = !phaseArg || phaseArg.includes('pk') || phaseArg.includes('all');

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  Phase 2: GS + PK 预测回填           ║');
  console.log('║  ' + (dryRun ? 'DRY RUN' : '正式执行') + '                  ║');
  console.log('║  GS: ' + (runGS ? '✓' : '✗') + '  PK: ' + (runPK ? '✓' : '✗') + '              ║');
  console.log('╚══════════════════════════════════════╝\n');

  if (!fs.existsSync(DATA_FILE)) {
    console.error('错误: data.json 不存在，请先运行 Phase 1');
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const mMap = data.m || {};
  const allMatches = [];
  Object.values(mMap).forEach(function (m) {
    if (m && m.matchId && m.date >= START_DATE && m.date <= END_DATE) allMatches.push(m);
  });
  console.log('data.json 中目标时间段比赛: ' + allMatches.length + ' 场');

  const withScore = allMatches.filter(function (m) {
    return m.score && m.score.trim() && m.score !== '-';
  });
  console.log('  有比分: ' + withScore.length + ' 场, 无比分: ' + (allMatches.length - withScore.length) + ' 场');

  // ═══ Phase 2A: GS 功守道 fallback ═══
  if (runGS) {
    console.log('\n━━━ Phase 2A: GS 功守道 fallback ━━━\n');

    const gsMod = require('./gongshoudao/index');
    const computeFallbackMatch = gsMod.computeFallbackMatch;
    const readCache = gsMod.readCache;
    const writeCache = gsMod.writeCache;

    const predLog = require('./prediction_log');
    predLog.autoEnsure();

    const cache = readCache();
    const existingGS = cache._global || {};
    const startExisting = Object.keys(existingGS).length;
    console.log('现有 GS 缓存: ' + startExisting + ' keys');

    let newGS = 0,
      skippedGS = 0,
      errorsGS = 0;
    const batchSize = 100;

    for (let i = 0; i < allMatches.length; i++) {
      const m = allMatches[i];
      const mid = String(m.matchId);

      const existing = existingGS[mid] || existingGS['m_' + mid];
      if (existing && !existing._fallback) {
        skippedGS++;
        if (skippedGS % 200 === 0) process.stdout.write('\r  跳过 ' + skippedGS + ' ...');
        continue;
      }

      try {
        const gs = computeFallbackMatch(m);
        if (!dryRun) {
          existingGS[mid] = gs;
          existingGS['m_' + mid] = gs;
          predLog.upsertGS(mid, {
            scoresJson: JSON.stringify(gs.scores || []),
            topScore: gs.scores && gs.scores[0] ? gs.scores[0].score : '',
            topPercent: gs.scores && gs.scores[0] ? parseFloat(gs.scores[0].percent) || 0 : 0,
            ladderLabel: gs.ladderLabel || '',
            ladderLevel: gs.ladderLevel || 0,
            date: (m.date || '').slice(0, 10),
            homeName: m.homeName || '',
            visitName: m.visitName || '',
            leagueName: m.leagueName || '',
            matchNum: m.num || '',
            handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
            modelATotal: gs.gsModelATotal || gs.modelATotal || null,
            modelBTotal: gs.gsModelBTotal || gs.modelBTotal || null,
            modelCTotal: gs.gsModelCTotal || gs.modelCTotal || null,
          });
        }
        newGS++;
      } catch (e) {
        errorsGS++;
        if (errorsGS <= 5) console.log('  ✗ GS ' + mid + ': ' + e.message);
      }

      if ((i + 1) % batchSize === 0 && !dryRun) {
        cache._global = existingGS;
        writeCache(cache);
        process.stdout.write(
          '\r  [' + Math.round(((i + 1) / allMatches.length) * 100) + '%] GS: ' + newGS + ' 新, ' + skippedGS + ' 跳过',
        );
      }
    }

    if (!dryRun) {
      cache._global = existingGS;
      writeCache(cache);
    }

    console.log('\nGS 完成: ' + newGS + ' 新增, ' + skippedGS + ' 跳过, ' + errorsGS + ' 失败');
    console.log('  最终缓存: ' + Object.keys(existingGS).length + ' keys');
  }

  // ═══ Phase 2B: PK 评分 ═══
  if (runPK) {
    console.log('\n━━━ Phase 2B: PK 评分回填 ━━━\n');

    const pk = require('./pk_scorer');
    const predLog2 = require('./prediction_log');
    predLog2.autoEnsure();
    await new Promise(function (r) {
      setTimeout(r, 500);
    });

    const dates = [
      ...new Set(
        allMatches.map(function (m) {
          return (m.date || '').slice(0, 10);
        }),
      ),
    ].sort();
    console.log('覆盖日期: ' + dates.length + ' 天');

    if (dryRun) {
      console.log('DRY RUN — 将处理以下日期 (前10):');
      dates.slice(0, 10).forEach(function (d) {
        console.log('  ' + d);
      });
      if (dates.length > 10) console.log('  ... 共 ' + dates.length + ' 天');
      console.log('Phase 2B DRY 完成');
    } else {
      let totalOk = 0,
        totalErrors = 0;
      for (let j = 0; j < dates.length; j++) {
        const d = dates[j];
        try {
          const result = await pk.computeAndSave(d);
          if (result && result.ok) totalOk += result.ok;
          if (j % 10 === 0 || j === dates.length - 1) {
            console.log(
              '  [' +
                Math.round(((j + 1) / dates.length) * 100) +
                '%] ' +
                d +
                ': ' +
                JSON.stringify(result) +
                ' (累计: ' +
                totalOk +
                ')',
            );
          }
        } catch (e) {
          totalErrors++;
          console.log('  ✗ ' + d + ': ' + e.message);
        }
      }
      console.log('\nPK 完成: ' + totalOk + ' 场, 错误: ' + totalErrors);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  Phase 2 完成!');
  console.log('  下一步: node server/backfill_phase3_outcomes.js');
  console.log('═══════════════════════════════════════');
}

main().catch(function (e) {
  console.error('脚本异常: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
