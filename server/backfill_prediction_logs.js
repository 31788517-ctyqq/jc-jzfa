/**
 * 一次性历史数据回填脚本 — 将 data.json 中所有已结束比赛的赛果写入 prediction_logs
 *
 * 用途：补齐数据库中没有 actual_score 的记录，使回测页面能查询到历史数据
 *
 * 用法：
 *   开发环境: node server/backfill_prediction_logs.js [--dry]
 *   生产环境: cd /root/server && node backfill_prediction_logs.js [--dry]
 *
 *   --dry  试运行，只输出会更新哪些记录，不实际写入
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const dryRun = process.argv.includes('--dry');

if (dryRun) {
  console.log('*** DRY RUN — 不会实际写入 ***\n');
}

// 加载 data.json
if (!fs.existsSync(DATA_FILE)) {
  console.error('错误: data.json 不存在: ' + DATA_FILE);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
if (!data.m) {
  console.log('data.json 中没有比赛数据 (data.m 为空)');
  process.exit(0);
}

// 初始化 prediction_log 模块
const predictionLog = require('./prediction_log');
const database = require('./database');
predictionLog.autoEnsure();

// ★ P1-2: 加载 AI 缓存和功守道缓存，用于补写预测数据
let aiCache = {};
const AI_CACHE_FILE = path.join(__dirname, 'ai_cache.json');
if (fs.existsSync(AI_CACHE_FILE)) {
  try {
    aiCache = JSON.parse(fs.readFileSync(AI_CACHE_FILE, 'utf8'));
    console.log('已加载 AI 缓存: ' + Object.keys(aiCache).length + ' 条');
  } catch (e) {
    console.log('AI 缓存加载失败: ' + e.message);
  }
}

let gsCache = {};
const GS_CACHE_FILE = path.join(__dirname, 'gongshoudao', 'cache.json');
if (fs.existsSync(GS_CACHE_FILE)) {
  try {
    const raw = JSON.parse(fs.readFileSync(GS_CACHE_FILE, 'utf8'));
    gsCache = raw['_global'] || {};
    console.log('已加载 GS 缓存: ' + Object.keys(gsCache).length + ' 条');
  } catch (e) {
    console.log('GS 缓存加载失败: ' + e.message);
  }
}

// ★ P1-2: 辅助函数 — 从 AI cache 提取预测字段
function extractAIPrediction(mid, m) {
  const entry = aiCache[mid] || aiCache['m_' + mid];
  if (!entry || !entry.content) return null;
  const preds = entry.content['预测建议'] || [];
  const aiFields = {
    confidence: entry.confidence || 0,
    content: JSON.stringify(entry.content),
  };
  if (m.date) aiFields.date = m.date.slice(0, 10);
  if (m.homeName) aiFields.homeName = m.homeName;
  if (m.visitName) aiFields.visitName = m.visitName;
  if (m.leagueName) aiFields.leagueName = m.leagueName;
  if (m.num) aiFields.matchNum = m.num;
  if (m.handicap !== undefined) aiFields.handicap = m.handicap;
  else if (m.rq !== undefined) aiFields.handicap = m.rq;
  preds.forEach(function (p) {
    if (p['玩法'] === '胜平负') aiFields.spf = p['建议方向'];
    if (p['玩法'] === '大小球') aiFields.overunder = p['建议方向'];
    if (p['玩法'] === '比分预测') aiFields.score = p['建议方向'];
  });
  return aiFields;
}

// ★ P1-2: 辅助函数 — 从 GS cache 提取预测字段
function extractGSPrediction(mid, m) {
  const clean = String(mid).replace(/^m_/, '');
  const gs = gsCache[mid] || gsCache['m_' + mid] || gsCache[clean];
  if (!gs || !gs.scores) return null;
  return {
    date: (m.date || '').slice(0, 10),
    homeName: m.homeName || '',
    visitName: m.visitName || '',
    leagueName: m.leagueName || '',
    matchNum: m.num || '',
    scoresJson: JSON.stringify(gs.scores),
    topScore: gs.scores && gs.scores[0] ? gs.scores[0].score : '',
    topPercent: gs.scores && gs.scores[0] ? parseFloat(gs.scores[0].percent) || 0 : 0,
    ladderLabel: gs.ladderLabel || '',
    ladderLevel: gs.ladderLevel || 0,
    handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
  };
}

// 等待数据库就绪
function waitForDB(timeout) {
  return new Promise(function (resolve) {
    const start = Date.now();
    function check() {
      if (predictionLog.isReady()) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeout) {
        resolve(false);
        return;
      }
      setTimeout(check, 300);
    }
    check();
  });
}

async function main() {
  console.log('等待数据库就绪...');
  const ready = await waitForDB(10000);
  if (!ready) {
    console.error('数据库未能在 10 秒内就绪，请检查 midou_data.db');
    process.exit(1);
  }
  console.log('数据库就绪 ✓');

  const matchMap = data.m;
  const allKeys = Object.keys(matchMap);

  let total = 0;
  let skipped = 0; // 比赛未结束或无比分
  let updated = 0;
  let errors = 0;
  let aiWritten = 0; // ★ P1-2: AI 预测写入数
  let gsWritten = 0; // ★ P1-2: GS 预测写入数
  const details = [];

  // ★ V9: 使用数据库事务批量写入，避免每次写盘触发 _saveToFile 全量导出
  const adp = database.getAdapter();
  const useTx = adp && typeof adp.transaction === 'function' && !dryRun;

  if (useTx) {
    adp.transaction(function () {
      for (const k of allKeys) {
        const m = matchMap[k];
        if (!m || !m.matchId) continue;

        total++;

        // 跳过未结束的比赛（但有比分则视为已完赛）
        if (m.matchStatus >= 2) { /* 正常完赛 */ }
        else if (m.score && m.score.trim() && m.score !== '-') { /* 有比分，按完赛处理 */ }
        else { skipped++; continue; }

        // 跳过没有比分的比赛
        if (!m.score || !m.score.trim() || m.score === '-') {
          skipped++;
          continue;
        }

        const mid = String(m.matchId);
        const scoreStr = m.score.replace('-', ':');
        const parts = scoreStr.split(':');
        const homeGoals = parseInt(parts[0]);
        const awayGoals = parseInt(parts[1]);

        if (isNaN(homeGoals) || isNaN(awayGoals)) {
          skipped++;
          continue;
        }

        // 推断胜平负
        let actualSpf = '';
        if (homeGoals > awayGoals) actualSpf = '主胜';
        else if (homeGoals < awayGoals) actualSpf = '客胜';
        else actualSpf = '平';

        // 推断大小球（以 2.5 盘口为准）
        const totalGoals = homeGoals + awayGoals;
        let actualOverunder = '';
        if (totalGoals > 2) actualOverunder = '大球';
        else if (totalGoals < 2) actualOverunder = '小球';
        else actualOverunder = '走';

        const fields = {
          actualScore: m.score,
          actualHalfScore: m.halfScore || '',
          homeGoals: homeGoals,
          awayGoals: awayGoals,
          actualSpf: actualSpf,
          actualOverunder: actualOverunder,
          handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
        };

        try {
          predictionLog.backfillResult(mid, fields);
          const aiFields = extractAIPrediction(mid, m);
          if (aiFields) {
            try { predictionLog.upsertAI(mid, aiFields); aiWritten++; } catch (e) {}
          }
          const gsFields = extractGSPrediction(mid, m);
          if (gsFields) {
            try { predictionLog.upsertGS(mid.replace(/^m_/, ''), gsFields); gsWritten++; } catch (e) {}
          }
          updated++;
        } catch (e) {
          errors++;
          console.error('  ✗ ' + mid + ' 写入失败: ' + e.message);
        }
      }
    })();
  } else {
    // 非事务模式（dry run 或适配器不支持事务）
    for (const k of allKeys) {
      const m = matchMap[k];
      if (!m || !m.matchId) continue;

      total++;

      if (m.matchStatus < 2 && !(m.score && m.score.trim() && m.score !== '-')) { skipped++; continue; }
      if (!m.score || !m.score.trim() || m.score === '-') { skipped++; continue; }

      const mid = String(m.matchId);
      const scoreStr = m.score.replace('-', ':');
      const parts = scoreStr.split(':');
      const homeGoals = parseInt(parts[0]);
      const awayGoals = parseInt(parts[1]);

      if (isNaN(homeGoals) || isNaN(awayGoals)) { skipped++; continue; }

      let actualSpf = '';
      if (homeGoals > awayGoals) actualSpf = '主胜';
      else if (homeGoals < awayGoals) actualSpf = '客胜';
      else actualSpf = '平';

      const totalGoals = homeGoals + awayGoals;
      let actualOverunder = '';
      if (totalGoals > 2) actualOverunder = '大球';
      else if (totalGoals < 2) actualOverunder = '小球';
      else actualOverunder = '走';

      const fields = {
        actualScore: m.score, actualHalfScore: m.halfScore || '',
        homeGoals: homeGoals, awayGoals: awayGoals,
        actualSpf: actualSpf, actualOverunder: actualOverunder,
        handicap: m.handicap !== undefined ? m.handicap : m.rq !== undefined ? m.rq : undefined,
      };
      const info = { mid: mid, num: m.num || '', match: (m.homeName || '?') + ' vs ' + (m.visitName || '?'), score: m.score, spf: actualSpf, ou: actualOverunder };

      if (dryRun) {
        details.push(info); updated++;
      } else {
        try {
          predictionLog.backfillResult(mid, fields);
          const aiFields = extractAIPrediction(mid, m);
          if (aiFields) { try { predictionLog.upsertAI(mid, aiFields); aiWritten++; } catch (e) {} }
          const gsFields = extractGSPrediction(mid, m);
          if (gsFields) { try { predictionLog.upsertGS(mid.replace(/^m_/, ''), gsFields); gsWritten++; } catch (e) {} }
          updated++; details.push(info);
        } catch (e) { errors++; console.error('  ✗ ' + mid + ' 写入失败: ' + e.message); }
      }
    }
  }

  // 输出汇总
  console.log('\n════════════════════════════════════════');
  console.log('  数据回填完成' + (dryRun ? ' (DRY RUN)' : ''));
  console.log('════════════════════════════════════════');
  console.log('  总比赛数: ' + total);
  console.log('  跳过 (未结束/无比分): ' + skipped);
  console.log('  已' + (dryRun ? '标记' : '回填') + ': ' + updated);
  console.log('  其中 AI 预测写入: ' + aiWritten);
  console.log('  其中 GS 预测写入: ' + gsWritten);
  if (errors > 0) console.log('  失败: ' + errors);

  // 按日期汇总
  const dateCount = {};
  details.forEach(function (d) {
    // 从 matchId 反查日期（遍历 data.m）
    const mk = 'm_' + d.mid;
    const m = matchMap[mk];
    const dt = m && m.date ? m.date.slice(0, 10) : '未知';
    if (!dateCount[dt]) dateCount[dt] = [];
    dateCount[dt].push(d);
  });

  console.log('\n  按日期分布:');
  Object.keys(dateCount)
    .sort()
    .forEach(function (dt) {
      console.log('    ' + dt + ': ' + dateCount[dt].length + ' 场');
      if (dateCount[dt].length <= 10) {
        dateCount[dt].forEach(function (d) {
          console.log('      ' + d.num + ' ' + d.match + ' → ' + d.score + ' (' + d.spf + ', ' + d.ou + ')');
        });
      }
    });

  console.log('\n  验证回测查询...');
  const totalCount = predictionLog.getTotalCount();
  console.log('  prediction_logs 中有赛果的记录: ' + totalCount + ' 条');

  console.log('\n≈ 完成 ≈');
  if (dryRun) {
    console.log('  提示: 去掉 --dry 参数重新运行以实际写入');
    console.log('  node server/backfill_prediction_logs.js');
  }
}

main().catch(function (e) {
  console.error('脚本异常: ' + e.message);
  console.error(e.stack);
  process.exit(1);
});
