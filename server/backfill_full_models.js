/**
 * server/backfill_full_models.js — 三模型全量回填脚本
 *
 * 用法:
 *   node server/backfill_full_models.js --dry              # 试跑全部
 *   node server/backfill_full_models.js                    # 执行全部
 *   node server/backfill_full_models.js --phase=1          # 仅 GS
 *   node server/backfill_full_models.js --phase=2          # 仅 AI
 *   node server/backfill_full_models.js --phase=3          # 仅 PK
 *   node server/backfill_full_models.js --phase=1,2,3      # 组合
 *   node server/backfill_full_models.js --resume           # 从断点恢复
 *
 * 安全机制:
 *   - 自动备份 cache.json / ai_cache.json / midou_data.db
 *   - --dry 模式不修改任何文件
 *   - 增量幂等（已有数据不覆盖）
 *   - 每 50 场写 checkpoint 断点续传
 */

const fs = require('fs');
const path = require('path');

// ═══ 配置 ═══
const DATA_FILE = path.join(__dirname, 'data.json');
const STATS_BANK_FILE = path.join(__dirname, 'stats_bank.json');
const AI_CACHE_FILE = path.join(__dirname, 'ai_cache.json');
const GS_CACHE_FILE = path.join(__dirname, 'gongshoudao', 'cache.json');
const CHECKPOINT_FILE = path.join(__dirname, 'backfill_checkpoint.json');
const BAK_DIR = path.join(__dirname, 'backup_backfill');

const dryRun = process.argv.includes('--dry');
const resumeMode = process.argv.includes('--resume');

let enabledPhases;
const phaseArg = process.argv.find((a) => a.startsWith('--phase='));
if (phaseArg) {
  enabledPhases = new Set(phaseArg.replace('--phase=', '').split(',').map(Number));
} else {
  enabledPhases = new Set([1, 2, 3]);
}
const phase1 = enabledPhases.has(1);
const phase2 = enabledPhases.has(2);
const phase3 = enabledPhases.has(3);

console.log('╔══════════════════════════════════════╗');
console.log('║  三模型全量回填脚本 v1.0             ║');
console.log('║  ' + (dryRun ? 'DRY RUN — 不写入' : '正式执行') + '                     ║');
console.log(
  '║  Phase 1 (GS): ' +
    (phase1 ? '✓' : '✗') +
    '  Phase 2 (AI): ' +
    (phase2 ? '✓' : '✗') +
    '  Phase 3 (PK): ' +
    (phase3 ? '✓' : '✗') +
    '  ║',
);
console.log('╚══════════════════════════════════════╝\n');

// ═══ 备份 ═══
function backupFiles() {
  if (dryRun) return;
  if (!fs.existsSync(BAK_DIR)) fs.mkdirSync(BAK_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const files = [GS_CACHE_FILE, AI_CACHE_FILE, path.join(__dirname, 'midou_data.db')];
  files.forEach((f) => {
    if (fs.existsSync(f)) {
      const dest = path.join(BAK_DIR, path.basename(f) + '.bak_' + ts);
      fs.copyFileSync(f, dest);
      console.log('[备份] ' + path.basename(f) + ' → ' + path.basename(dest));
    }
  });
}

// ═══ 简易队名匹配 ═══
function simpleMatch(apiList, mMap) {
  const result = {};
  const unmatchedApi = new Set();
  apiList.forEach((api) => {
    if (!api.homeTeam || !api.guestTeam) return;
    const hApi = (api.homeTeam || '').replace(/\s/g, '').toLowerCase();
    const vApi = (api.guestTeam || '').replace(/\s/g, '').toLowerCase();
    let found = false;
    Object.entries(mMap).forEach(([mk, m]) => {
      if (!m || !m.homeName || !m.visitName) return;
      const hM = (m.homeName || '').replace(/\s/g, '').toLowerCase();
      const vM = (m.visitName || '').replace(/\s/g, '').toLowerCase();
      if (hApi === hM && vApi === vM) {
        result[m.matchId] = api;
        found = true;
      } else if ((hApi.includes(hM) || hM.includes(hApi)) && (vApi.includes(vM) || vM.includes(vApi))) {
        result[m.matchId] = api;
        found = true;
      }
    });
    if (!found) unmatchedApi.add(hApi + '|' + vApi);
  });
  return { matched: result, unmatched: unmatchedApi };
}

// ═══ Phase 1: GS 回填 ═══
async function phase1GS() {
  console.log('━━━ Phase 1: GS 功守道回填 ━━━\n');

  // 加载模块
  const { computeSingleMatch, computeFallbackMatch, readCache, writeCache } = require('./gongshoudao/index');
  const predLog = require('./prediction_log');
  predLog.autoEnsure();

  // 加载 data.json
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const mMap = data.m || {};
  const finishedMatches = {};
  Object.entries(mMap).forEach(([k, m]) => {
    if (!m || !m.matchId) return;
    if (m.matchStatus >= 2 && m.score && m.score.trim() && m.score !== '-') {
      finishedMatches[m.matchId] = m;
    }
  });
  console.log('完赛比赛: ' + Object.keys(finishedMatches).length + ' 场');

  // 加载现有 GS 缓存
  const cache = readCache();
  const existingGS = cache._global || {};
  const existingCount = Object.keys(existingGS).length;
  console.log('现有 GS 缓存: ' + existingCount + ' keys');

  // 加载 stats_bank.json
  let apiMatched = 0,
    realComputed = 0,
    realSkipped = 0,
    fallbackCount = 0;
  if (fs.existsSync(STATS_BANK_FILE)) {
    const statsBank = JSON.parse(fs.readFileSync(STATS_BANK_FILE, 'utf8'));
    const validBatches = Object.keys(statsBank)
      .filter((k) => k.startsWith('_raw_'))
      .sort();
    console.log('stats_bank 批次: ' + validBatches.length + ' (' + validBatches.join(', ') + ')');

    // 逐批次匹配（后遍历覆盖前遍历 → 最新批次优先）
    const batchMatched = {};
    for (const batchKey of validBatches) {
      const entry = statsBank[batchKey];
      const apiList = Array.isArray(entry) ? entry : entry.data || [];
      if (apiList.length === 0) continue;
      const { matched, unmatched } = simpleMatch(apiList, finishedMatches);
      console.log('  ' + batchKey + ': 匹配 ' + Object.keys(matched).length + ' 场, 未匹配 ' + unmatched.size + ' 队');
      Object.assign(batchMatched, matched); // 后批次覆盖前批次
    }
    apiMatched = Object.keys(batchMatched).length;
    console.log('\nAPI 数据累计匹配: ' + apiMatched + ' 场');

    // 对匹配到的比赛用真实 GS 计算
    for (const [mid, rawStats] of Object.entries(batchMatched)) {
      const existing = existingGS[mid] || existingGS['m_' + mid];
      if (existing && !existing._fallback) {
        realSkipped++;
        continue;
      }
      try {
        const m = finishedMatches[mid];
        if (!m) continue;
        const gs = computeSingleMatch(rawStats, m);
        if (!dryRun) {
          existingGS[mid] = gs;
          existingGS['m_' + mid] = gs;
          predLog.upsertGS(mid.replace(/^m_/, ''), gsFields(gs, m));
        }
        realComputed++;
      } catch (e) {
        console.error('  ✗ ' + mid + ' 真实GS失败: ' + e.message);
      }
    }
  } else {
    console.log('stats_bank.json 不存在，跳过 API 匹配');
  }

  // 降级兜底：所有完赛且无 GS 的比赛
  for (const [mid, m] of Object.entries(finishedMatches)) {
    const existing = existingGS[mid] || existingGS['m_' + mid];
    if (existing && !existing._fallback) continue; // 已有真实 GS
    if (existing && existing._fallback) continue; // 已有降级（不重复生成）
    try {
      const gs = computeFallbackMatch(m);
      if (!dryRun) {
        existingGS[mid] = gs;
        existingGS['m_' + mid] = gs;
        predLog.upsertGS(mid.replace(/^m_/, ''), gsFields(gs, m));
      }
      fallbackCount++;
    } catch (e) {
      console.error('  ✗ ' + mid + ' 降级GS失败: ' + e.message);
    }
  }

  // 写入缓存
  if (!dryRun) {
    cache._global = existingGS;
    writeCache(cache);
  }

  console.log('\nPhase 1 完成:');
  console.log('  API 匹配: ' + apiMatched + ' 场');
  console.log('  真实计算: ' + realComputed + ' 场 (跳过已有: ' + realSkipped + ')');
  console.log('  降级估算: ' + fallbackCount + ' 场');
  console.log('  最终缓存: ' + Object.keys(existingGS).length + ' keys');
}

function gsFields(gs, m) {
  return {
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
  };
}

// ═══ Phase 2: AI 豆包回填 ═══
async function phase2AI() {
  console.log('━━━ Phase 2: AI 豆包回填 ━━━\n');

  const doubao = require('./doubao');
  const predLog = require('./prediction_log');
  predLog.autoEnsure();
  await predLog.asyncEnsure();

  // 加载 data.json
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const mMap = data.m || {};

  // 加载 AI 缓存
  let aiCache = {};
  if (fs.existsSync(AI_CACHE_FILE)) {
    try {
      aiCache = JSON.parse(fs.readFileSync(AI_CACHE_FILE, 'utf8'));
    } catch (e) {}
  }
  console.log('现有 AI 缓存: ' + Object.keys(aiCache).length + ' keys');

  // 检查断点
  let checkpoint = null;
  let startIndex = 0;
  if (resumeMode && fs.existsSync(CHECKPOINT_FILE)) {
    try {
      checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
      startIndex = checkpoint.lastIndex || 0;
      console.log('从断点恢复: index=' + startIndex);
    } catch (e) {}
  }

  // 构建待处理列表
  const toProcess = [];
  Object.entries(mMap).forEach(([k, m]) => {
    if (!m || !m.matchId) return;
    if (m.matchStatus < 2 || !m.score || m.score.trim() === '' || m.score === '-') return;
    const mid = String(m.matchId);
    if (aiCache[mid]) return; // 已有缓存，跳过
    if (predLog.isReady()) {
      const existing = require('./prediction_log');
      // 简单检查（避免重复写入）
    }
    toProcess.push({ mid, m });
  });
  console.log('待回填 AI: ' + toProcess.length + ' 场');

  if (toProcess.length === 0) {
    console.log('Phase 2: 无需处理');
    return;
  }

  let done = 0,
    errors = 0,
    skipped = 0;
  for (let i = startIndex; i < toProcess.length; i++) {
    const { mid, m } = toProcess[i];
    const progress = '[' + (i + 1) + '/' + toProcess.length + ']';

    try {
      const matchInfo = {
        matchId: mid,
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        date: (m.date || '').slice(0, 10),
        num: m.num || '',
      };

      if (dryRun) {
        console.log(progress + ' DRY: ' + matchInfo.homeName + ' vs ' + matchInfo.visitName);
        done++;
      } else {
        const result = await doubao.generateAnalysis(matchInfo);
        if (result && result.content) {
          // 写入 ai_cache.json
          aiCache[mid] = {
            matchId: mid,
            content: result.content,
            confidence: result.confidence || 50,
            date: matchInfo.date,
            homeName: matchInfo.homeName,
            visitName: matchInfo.visitName,
            createdAt: new Date().toISOString(),
          };

          // 写入 prediction_logs
          const aiFields = extractAIFromResult(result, m);
          predLog.upsertAI(mid, aiFields);

          done++;
          console.log(
            progress +
              ' OK: ' +
              matchInfo.homeName +
              ' vs ' +
              matchInfo.visitName +
              ' (conf: ' +
              (result.confidence || '?') +
              ')',
          );
        } else {
          skipped++;
          console.log(progress + ' SKIP: ' + matchInfo.homeName + ' vs ' + matchInfo.visitName + ' (空)');
        }
      }
    } catch (e) {
      errors++;
      console.error(progress + ' FAIL: ' + m.homeName + ' vs ' + m.visitName + ' - ' + e.message);
    }

    // 每 50 场：保存进度 + 写入磁盘
    if ((i + 1) % 50 === 0 && !dryRun) {
      fs.writeFileSync(AI_CACHE_FILE, JSON.stringify(aiCache));
      fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify({ lastIndex: i + 1, done, errors, skipped }));
      console.log('  [checkpoint] 已保存 ' + (i + 1) + '/' + toProcess.length);
    }

    // 间隔 2 秒避免限流
    if (!dryRun && i < toProcess.length - 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // 最终保存
  if (!dryRun) {
    fs.writeFileSync(AI_CACHE_FILE, JSON.stringify(aiCache));
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  }

  console.log('\nPhase 2 完成:');
  console.log('  成功: ' + done + ' 场');
  console.log('  跳过: ' + skipped + ' 场');
  console.log('  失败: ' + errors + ' 场');
  console.log('  最终 AI 缓存: ' + Object.keys(aiCache).length + ' keys');
}

function extractAIFromResult(result, m) {
  const fields = {
    date: (m.date || '').slice(0, 10),
    homeName: m.homeName || '',
    visitName: m.visitName || '',
    leagueName: m.leagueName || '',
    matchNum: m.num || '',
    confidence: result.confidence || 50,
    content: JSON.stringify(result.content),
  };
  if (m.handicap !== undefined) fields.handicap = m.handicap;
  else if (m.rq !== undefined) fields.handicap = m.rq;

  // 从 content 中提取预测建议
  const preds = result.content && result.content['预测建议'] ? result.content['预测建议'] : [];
  preds.forEach((p) => {
    if (p['玩法'] === '胜平负') fields.spf = p['建议方向'];
    if (p['玩法'] === '大小球') fields.overunder = p['建议方向'];
    if (p['玩法'] === '比分预测') fields.score = p['建议方向'];
  });

  return fields;
}

// ═══ Phase 3: PK 回填 ═══
async function phase3PK() {
  console.log('━━━ Phase 3: PK 评分回填 ━━━\n');

  const pk = require('./pk_scorer');
  // ★ 输出当前 PK Scorer 版本
  console.log('  PK Scorer 版本: ' + (pk.PK_SCORER_VERSION || 'pk_v1.0 (default)'));
  const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const mMap = data.m || {};

  // 收集所有完赛日期
  const dates = new Set();
  Object.values(mMap).forEach((m) => {
    if (!m || !m.date) return;
    if (m.matchStatus >= 2 && m.score && m.score.trim() && m.score !== '-') {
      dates.add(m.date.slice(0, 10));
    }
  });
  const sortedDates = [...dates].sort();
  console.log('覆盖日期: ' + sortedDates.length + ' 天');

  if (dryRun) {
    console.log('DRY RUN — 将处理以下日期:');
    sortedDates.forEach((d) => console.log('  ' + d));
    console.log('\nPhase 3 (DRY) 完成');
    return;
  }

  // 确保 prediction_log 就绪
  const predLog = require('./prediction_log');
  predLog.autoEnsure();
  await predLog.asyncEnsure();

  let totalOk = 0;
  for (const date of sortedDates) {
    try {
      const result = await pk.computeAndSave(date);
      console.log('  ' + date + ': ' + JSON.stringify(result));
      if (result && result.ok) totalOk += result.ok;
    } catch (e) {
      console.error('  ✗ ' + date + ' PK 失败: ' + e.message);
    }
  }

  console.log('\nPhase 3 完成: ' + totalOk + ' 场');
}

// ═══ Main ═══
async function main() {
  backupFiles();

  if (phase1) {
    console.time('Phase 1');
    await phase1GS();
    console.timeEnd('Phase 1');
    console.log('');
  }

  if (phase2) {
    console.time('Phase 2');
    await phase2AI();
    console.timeEnd('Phase 2');
    console.log('');
  }

  if (phase3) {
    console.time('Phase 3');
    await phase3PK();
    console.timeEnd('Phase 3');
    console.log('');
  }

  if (dryRun) {
    console.log('═══════════════════════════════════════');
    console.log('  DRY RUN 完成 — 去除 --dry 正式执行');
    console.log('═══════════════════════════════════════');
  } else {
    console.log('═══════════════════════════════════════');
    console.log('  三模型回填全部完成');
    console.log('  下一步: node server/diagnose_gaps.js');
    console.log('═══════════════════════════════════════');
  }
}

main().catch((e) => {
  console.error('脚本异常: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
