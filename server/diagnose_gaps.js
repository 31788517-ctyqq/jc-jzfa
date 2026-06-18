/**
 * server/diagnose_gaps.js — 数据缺口诊断脚本
 *
 * 用法：node server/diagnose_gaps.js
 * 输出：完整的缺口报告（data.json 完赛比赛 vs SQLite 中三模型覆盖情况）
 */

const fs = require('fs');
const path = require('path');

// ═══ 配置 ═══
const DATA_FILE = path.join(__dirname, 'data.json');
const AI_CACHE_FILE = path.join(__dirname, 'ai_cache.json');
const GS_CACHE_FILE = path.join(__dirname, 'gongshoudao', 'cache.json');
const START_DATE = '2026-03-19';
const END_DATE = '2026-06-06';

// ═══ 结果容器 ═══
const report = {
  dataSource: {},
  finishedMatches: { total: 0, byDate: {} },
  predictionLogs: { total: 0, withActualScore: 0, withAI: 0, withGS: 0, withPK: 0, withAllThree: 0 },
  unifiedPredictions: { total: 0, byModel: {} },
  predictionOutcomes: { total: 0 },
  sportteryOdds: { snapshots: 0, matches: 0 },
  sportteryPreview: { previews: 0, matches: 0 },
  gaps: {
    noActualScore: [], // 已完赛但 logs 无 actual_score
    noAI: [], // 已完赛但 logs 无 ai_spf
    noGS: [], // 已完赛但 logs 无 gs_top_score
    noPK: [], // 已完赛但 logs 无 pk_direction
    noAnyModel: [], // 已完赛但 logs 三模型全空
    caches: { aiMatchIds: 0, gsMatchIds: 0, aiInRange: 0, gsInRange: 0 },
    dailyMatrix: {}, // 按日期: { finished, actual, ai, gs, pk, allThree }
  },
};

// ═══ 1. 加载 data.json ═══
console.log('[1/8] 加载 data.json ...');
if (!fs.existsSync(DATA_FILE)) {
  console.error('  ✗ data.json 不存在:', DATA_FILE);
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const matchMap = data.m;
if (!matchMap) {
  console.error('  ✗ data.json 没有 m 字段');
  process.exit(1);
}

const allKeys = Object.keys(matchMap);
report.dataSource.totalMatches = allKeys.length;
report.dataSource.file = 'data.json';

// 按日期分组 + 找完赛比赛
const finishedMatchIds = []; // matchId string
const finishedMatchesByDate = {};
const allMatchIdToDate = {}; // matchId → date

allKeys.forEach(function (k) {
  const m = matchMap[k];
  if (!m || !m.matchId) return;
  const mid = String(m.matchId);
  const dt = (m.date || '').slice(0, 10);
  allMatchIdToDate[mid] = dt;

  // 只统计日期范围内的
  if (dt < START_DATE || dt > END_DATE) return;

  // 完赛 + 有比分
  if (m.matchStatus >= 2 && m.score && m.score.trim() && m.score !== '-') {
    finishedMatchIds.push(mid);
    if (!finishedMatchesByDate[dt]) finishedMatchesByDate[dt] = [];
    finishedMatchesByDate[dt].push(mid);
  }
});

report.finishedMatches.total = finishedMatchIds.length;
report.finishedMatches.byDate = finishedMatchesByDate;
report.finishedMatches.datesCount = Object.keys(finishedMatchesByDate).length;

console.log('  data.json 总场次:', allKeys.length);
console.log(
  '  ' + START_DATE + ' ~ ' + END_DATE + ' 已完赛且有比分:',
  finishedMatchIds.length,
  '场 (' + Object.keys(finishedMatchesByDate).length + ' 天)',
);

// ═══ 2. 加载 AI / GS 缓存 ═══
console.log('[2/8] 加载 AI / GS 缓存 ...');
let aiCache = {};
let gsCache = {};

if (fs.existsSync(AI_CACHE_FILE)) {
  try {
    aiCache = JSON.parse(fs.readFileSync(AI_CACHE_FILE, 'utf8'));
    report.gaps.caches.aiMatchIds = Object.keys(aiCache).length;
  } catch (e) {
    console.log('  ⚠ AI 缓存加载失败:', e.message);
  }
} else {
  console.log('  ⚠ AI 缓存文件不存在');
}

if (fs.existsSync(GS_CACHE_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(GS_CACHE_FILE, 'utf8'));
    gsCache = raw._global || raw;
    report.gaps.caches.gsMatchIds = Object.keys(gsCache).length;
  } catch (e) {
    console.log('  ⚠ GS 缓存加载失败:', e.message);
  }
} else {
  console.log('  ⚠ GS 缓存文件不存在');
}

// 统计缓存中日期范围内的覆盖
let aiInRange = 0,
  gsInRange = 0;
finishedMatchIds.forEach(function (mid) {
  if (aiCache[mid] || aiCache['m_' + mid]) aiInRange++;
  if (gsCache[mid] || gsCache['m_' + mid]) gsInRange++;
});
report.gaps.caches.aiInRange = aiInRange;
report.gaps.caches.gsInRange = gsInRange;

console.log('  AI 缓存总 key:', report.gaps.caches.aiMatchIds, '  完赛范围内:', aiInRange);
console.log('  GS 缓存总 key:', report.gaps.caches.gsMatchIds, '  完赛范围内:', gsInRange);

// ═══ 3. 初始化数据库 ═══
console.log('[3/8] 初始化数据库 ...');
const database = require('./database');
database.initDatabase();

function waitForDb(timeout) {
  return new Promise(function (resolve) {
    const start = Date.now();
    function check() {
      if (database.isAvailable()) {
        resolve(database.getAdapter());
        return;
      }
      if (Date.now() - start > timeout) {
        resolve(null);
        return;
      }
      setTimeout(check, 300);
    }
    check();
  });
}

async function main() {
  const adp = await waitForDb(15000);
  if (!adp) {
    console.log('  ⚠ 数据库 15 秒内未就绪，将跳过 SQL 查询\n');

    // 仍输出缓存层面的报告
    console.log('  缓存文件检查:');
    try {
      console.log('    gongshoudao/cache.json: ' + (fs.existsSync(GS_CACHE_FILE) ? '存在' : '不存在'));
    } catch (e) {}
    try {
      console.log('    ai_cache.json: ' + (fs.existsSync(AI_CACHE_FILE) ? '存在' : '不存在'));
    } catch (e) {}
    console.log('\n\n=== 诊断完成（仅缓存层面，无 SQL 数据）===');
    cleanup();
    return;
  }
  console.log('  数据库就绪 ✓');

  // ═══ 4. prediction_logs 表 ═══
  console.log('[4/8] 查询 prediction_logs ...');
  const allLogs = adp.execAll(
    'SELECT matchId, date, actual_score, ai_spf, ai_score, ai_overunder, ai_confidence, gs_top_score, gs_scores_json, gs_top_percent, pk_direction, pk_composite_score, pk_hcp_direction, pk_goal_direction, pk_fusion_consensus, pk_value_score, pk_ev_home FROM prediction_logs',
  );
  report.predictionLogs.total = allLogs.length;

  // 建立 matchId → row 索引
  const logsByMatch = {};
  allLogs.forEach(function (r) {
    const mid = String(r.matchId || '').replace(/^m_/, '');
    logsByMatch[mid] = r;
  });

  // 统计覆盖
  let withActual = 0,
    withAI = 0,
    withGS = 0,
    withPK = 0,
    withAllThree = 0;
  const noActual = [],
    noAI = [],
    noGS = [],
    noPK = [],
    noAny = [];
  const dateMatrix = {};

  finishedMatchIds.forEach(function (mid) {
    const dt = allMatchIdToDate[mid] || 'unknown';
    if (!dateMatrix[dt]) {
      dateMatrix[dt] = { finished: 0, actual: 0, ai: 0, gs: 0, pk: 0, allThree: 0 };
    }
    dateMatrix[dt].finished++;

    const row = logsByMatch[mid];
    if (!row) {
      noActual.push(mid);
      noAI.push(mid);
      noGS.push(mid);
      noPK.push(mid);
      noAny.push(mid);
      return;
    }

    const hasActual = row.actual_score && row.actual_score.trim();
    const hasAI = row.ai_spf && row.ai_spf.trim();
    const hasGS = (row.gs_top_score && row.gs_top_score.trim()) || (row.gs_scores_json && row.gs_scores_json.trim());
    const hasPK = row.pk_direction && row.pk_direction.trim();

    if (hasActual) {
      withActual++;
      dateMatrix[dt].actual++;
    } else {
      noActual.push(mid);
    }
    if (hasAI) {
      withAI++;
      dateMatrix[dt].ai++;
    } else {
      noAI.push(mid);
    }
    if (hasGS) {
      withGS++;
      dateMatrix[dt].gs++;
    } else {
      noGS.push(mid);
    }
    if (hasPK) {
      withPK++;
      dateMatrix[dt].pk++;
    } else {
      noPK.push(mid);
    }
    if (hasActual && hasAI && hasGS && hasPK) {
      withAllThree++;
      dateMatrix[dt].allThree++;
    }
    if (!hasAI && !hasGS && !hasPK) {
      noAny.push(mid);
    }
  });

  report.predictionLogs.withActualScore = withActual;
  report.predictionLogs.withAI = withAI;
  report.predictionLogs.withGS = withGS;
  report.predictionLogs.withPK = withPK;
  report.predictionLogs.withAllThree = withAllThree;
  report.gaps.noActualScore = noActual;
  report.gaps.noAI = noAI;
  report.gaps.noGS = noGS;
  report.gaps.noPK = noPK;
  report.gaps.noAnyModel = noAny;
  report.gaps.dailyMatrix = dateMatrix;

  console.log('  prediction_logs 总记录:', allLogs.length);
  console.log('  有 actual_score:', withActual, '/', finishedMatchIds.length, '(缺口:', noActual.length, ')');
  console.log('  有 AI 预测:', withAI, '/', finishedMatchIds.length, '(缺口:', noAI.length, ')');
  console.log('  有 GS 预测:', withGS, '/', finishedMatchIds.length, '(缺口:', noGS.length, ')');
  console.log('  有 PK 预测:', withPK, '/', finishedMatchIds.length, '(缺口:', noPK.length, ')');
  console.log('  三模型齐全:', withAllThree, '/', finishedMatchIds.length);

  // ═══ 5. unified_predictions 表 ═══
  console.log('[5/8] 查询 unified_predictions ...');
  const allUP = adp.execAll('SELECT model_name, prediction_id, direction FROM unified_predictions');
  report.unifiedPredictions.total = allUP.length;
  const upByModel = {};
  allUP.forEach(function (r) {
    const mn = r.model_name || 'unknown';
    upByModel[mn] = (upByModel[mn] || 0) + 1;
  });
  report.unifiedPredictions.byModel = upByModel;
  console.log('  unified_predictions:', allUP.length, '条');
  Object.keys(upByModel).forEach(function (mn) {
    console.log('    ' + mn + ': ' + upByModel[mn]);
  });

  // ═══ 6. prediction_outcomes 表 ═══
  console.log('[6/8] 查询 prediction_outcomes ...');
  const outcomesRow = adp.execOne('SELECT COUNT(*) as cnt FROM prediction_outcomes');
  report.predictionOutcomes.total = outcomesRow ? outcomesRow.cnt : 0;
  console.log('  prediction_outcomes:', report.predictionOutcomes.total, '条');

  // ═══ 7. sporttery 表 ═══
  console.log('[7/8] 查询 sporttery_odds_snapshot / sporttery_preview ...');
  try {
    const odRow = adp.execOne(
      'SELECT COUNT(*) as cnt, COUNT(DISTINCT match_id) as matches FROM sporttery_odds_snapshot',
    );
    report.sportteryOdds.snapshots = odRow ? odRow.cnt : 0;
    report.sportteryOdds.matches = odRow ? odRow.matches : 0;
  } catch (e) {
    console.log('  ⚠ sporttery_odds_snapshot 不存在或查询失败');
  }

  try {
    const pvRow = adp.execOne('SELECT COUNT(*) as cnt, COUNT(DISTINCT match_id) as matches FROM sporttery_preview');
    report.sportteryPreview.previews = pvRow ? pvRow.cnt : 0;
    report.sportteryPreview.matches = pvRow ? pvRow.matches : 0;
  } catch (e) {
    console.log('  ⚠ sporttery_preview 不存在或查询失败');
  }

  console.log(
    '  sporttery_odds_snapshot:',
    report.sportteryOdds.snapshots,
    '条快照 (' + report.sportteryOdds.matches + ' 场比赛)',
  );
  console.log(
    '  sporttery_preview:',
    report.sportteryPreview.previews,
    '条前瞻 (' + report.sportteryPreview.matches + ' 场比赛)',
  );

  // ═══ 8. 输出报告 ═══
  console.log('[8/8] 生成诊断报告...\n');
  printFullReport();

  // 保存 JSON 报告
  const reportPath = path.join(__dirname, 'diagnose_gaps_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('\n报告已保存至: ' + reportPath);

  cleanup();
}

function printFullReport() {
  const F = report.finishedMatches.total;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        JC-ZJFA 数据诊断报告  ' + START_DATE + ' → ' + END_DATE + '          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  // ── 1. 数据源概况 ──
  console.log('║ 一、数据源概况                                              ║');
  console.log('║   data.json 总场次:  ' + padR(String(allKeys.length), 6) + '                              ║');
  console.log(
    '║   ' +
      START_DATE +
      ' ~ ' +
      END_DATE +
      ' 完赛比赛: ' +
      padR(String(F), 6) +
      ' (' +
      String(report.finishedMatches.datesCount) +
      ' 天)          ║',
  );
  console.log(
    '║   AI 缓存可覆盖:   ' +
      padR(String(report.gaps.caches.aiInRange) + '/' + String(F), 6) +
      '                              ║',
  );
  console.log(
    '║   GS 缓存可覆盖:   ' +
      padR(String(report.gaps.caches.gsInRange) + '/' + String(F), 6) +
      '                              ║',
  );
  console.log('║                                                              ║');

  // ── 2. prediction_logs 覆盖 ──
  console.log('║ 二、prediction_logs 覆盖（vs ' + F + ' 场完赛）                 ║');
  console.log('║   赛果(actual_score): ' + bar(report.predictionLogs.withActualScore, F) + ' ║');
  console.log('║   AI  预测:           ' + bar(report.predictionLogs.withAI, F) + ' ║');
  console.log('║   GS  预测:           ' + bar(report.predictionLogs.withGS, F) + ' ║');
  console.log('║   PK  预测:           ' + bar(report.predictionLogs.withPK, F) + ' ║');
  console.log('║   三模型齐:           ' + bar(report.predictionLogs.withAllThree, F) + ' ║');
  console.log('║                                                              ║');

  // ── 3. 缺口统计 ──
  console.log('║ 三、缺口明细                                                ║');
  console.log(
    '║   缺赛果:  ' + padR(String(report.gaps.noActualScore.length), 6) + ' 场                              ║',
  );
  console.log('║   缺 AI:   ' + padR(String(report.gaps.noAI.length), 6) + ' 场                              ║');
  console.log('║   缺 GS:   ' + padR(String(report.gaps.noGS.length), 6) + ' 场                              ║');
  console.log('║   缺 PK:   ' + padR(String(report.gaps.noPK.length), 6) + ' 场                              ║');
  console.log('║   三模型全缺: ' + padR(String(report.gaps.noAnyModel.length), 4) + ' 场                         ║');
  console.log('║                                                              ║');

  // ── 4. 统一预测 & 赛果表 ──
  console.log('║ 四、统一预测 & 赛果表                                        ║');
  console.log(
    '║   unified_predictions: ' + padR(String(report.unifiedPredictions.total), 6) + ' 条                    ║',
  );
  const upModels = report.unifiedPredictions.byModel;
  Object.keys(upModels)
    .sort()
    .forEach(function (mn) {
      console.log('║     ' + padR(mn + ':', 14) + padR(String(upModels[mn]), 6) + '                         ║');
    });
  console.log(
    '║   prediction_outcomes: ' + padR(String(report.predictionOutcomes.total), 6) + ' 条                    ║',
  );
  console.log('║                                                              ║');

  // ── 5. sporttery 数据 ──
  console.log('║ 五、Sporttery 数据桥接                                       ║');
  console.log(
    '║   odds_snapshot: ' +
      padR(String(report.sportteryOdds.snapshots) + ' 条 (' + report.sportteryOdds.matches + ' 场)', 28) +
      '      ║',
  );
  console.log(
    '║   preview:       ' +
      padR(String(report.sportteryPreview.previews) + ' 条 (' + report.sportteryPreview.matches + ' 场)', 28) +
      '      ║',
  );
  console.log('╠══════════════════════════════════════════════════════════════╣');

  // ── 6. 按日期缺口矩阵 ──
  console.log('║ 六、按日期缺口矩阵（F=完赛 A=赛果 I=AI G=GS P=PK 齐=三模型）║');
  console.log('╠══════════════════════════════════════════════════════════════╣');

  const dm = report.gaps.dailyMatrix;
  const sortedDates = Object.keys(dm).sort();
  sortedDates.forEach(function (dt) {
    const r = dm[dt];
    const f = r.finished;
    const missStat = function (cover) {
      return cover < f ? '-' + (f - cover) : '✓';
    };

    const aStr = missStat(r.actual);
    const iStr = missStat(r.ai);
    const gStr = missStat(r.gs);
    const pStr = missStat(r.pk);
    const tStr = missStat(r.allThree);

    // 颜色标记：有缺口用 ◇，全齐用 ◆
    const flag = r.actual < f || r.ai < f || r.gs < f || r.pk < f ? '◇' : '◆';

    console.log(
      '║ ' +
        flag +
        ' ' +
        dt +
        '  F=' +
        padR(String(f), 3) +
        ' A=' +
        padR(aStr, 4) +
        ' AI=' +
        padR(iStr, 4) +
        ' GS=' +
        padR(gStr, 4) +
        ' PK=' +
        padR(pStr, 4) +
        ' 齐=' +
        padR(tStr, 4) +
        '║',
    );
  });

  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ── 7. 关键缺口摘要 ──
  console.log('\n━━━ 关键缺口摘要 ━━━');

  const gapDays = sortedDates.filter(function (dt) {
    const r = dm[dt];
    return r.actual < r.finished || r.ai < r.finished || r.gs < r.finished || r.pk < r.finished;
  });

  console.log('  有缺口的天数: ' + gapDays.length + '/' + sortedDates.length);
  if (gapDays.length > 0) {
    console.log('  缺口日期: ' + gapDays.slice(0, 30).join(', ') + (gapDays.length > 30 ? ' ...' : ''));
  }

  // 基于缓存的额外分析
  const cacheOnlyAI = report.gaps.caches.aiInRange - report.predictionLogs.withAI;
  const cacheOnlyGS = report.gaps.caches.gsInRange - report.predictionLogs.withGS;
  if (cacheOnlyAI > 0) {
    console.log('  ⚡ AI 缓存有数据但未写入 prediction_logs: ~' + cacheOnlyAI + ' 场 (可补全)');
  }
  if (cacheOnlyGS > 0) {
    console.log('  ⚡ GS 缓存有数据但未写入 prediction_logs: ~' + cacheOnlyGS + ' 场 (可补全)');
  }

  // sporttery 桥接建议
  if (report.sportteryOdds.snapshots === 0) {
    console.log('  ⚠ sporttery_odds_snapshot 表为空 → 需运行: node scripts/bridge_sporttery_to_odds.js');
  }
  if (report.sportteryPreview.previews === 0) {
    console.log('  ⚠ sporttery_preview 表为空 → 需运行: node scripts/bridge_sporttery_to_odds.js');
  }

  // unified_predictions 建议
  if (report.unifiedPredictions.total === 0 && report.predictionLogs.withActualScore > 0) {
    console.log('  ⚡ unified_predictions 为空 → 需运行: node server/backfill_unified_predictions.js');
  }

  // prediction_outcomes 建议
  if (report.predictionOutcomes.total === 0 && report.unifiedPredictions.total > 0) {
    console.log('  ⚡ prediction_outcomes 为空 → 需运行 outcome-backfill');
  }
}

function bar(covered, total) {
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
  const n = Math.round(pct / 10);
  let bar = '';
  for (let i = 0; i < 10; i++) bar += i < n ? '█' : '░';
  return bar + ' ' + padR(String(pct) + '%', 5) + ' (' + padR(String(covered) + '/' + String(total), 8) + ')';
}

function padR(s, len) {
  const str = String(s);
  if (str.length >= len) return str;
  return str + ' '.repeat(len - str.length);
}

function cleanup() {
  try {
    fs.unlinkSync(path.join(__dirname, '_tmp_check.js'));
  } catch (_) {}
}

main().catch(function (e) {
  console.error('诊断脚本异常:', e.message);
  console.error(e.stack);
  cleanup();
  process.exit(1);
});
