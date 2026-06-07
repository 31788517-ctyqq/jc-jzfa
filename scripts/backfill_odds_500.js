/**
 * 从 500.com 补全 odds_history 中缺失的 halfFull / totalGoals / scores
 * 范围: 2026-03-19 ~ 今天
 *
 * 用法:
 *   node scripts/backfill_odds_500.js          # 全量
 *   node scripts/backfill_odds_500.js --dry    # 仅检查，不写入
 *   node scripts/backfill_odds_500.js --date 2026-05-31  # 单日
 */

const fs = require('fs');
const path = require('path');
const { fetchOdds } = require('../server/fetch_500odds');

const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const ALLPLAYS_PATH = path.join(__dirname, '..', 'server', 'ttyingqiu_data', 'odds_500_allplays.json');
const DRY_RUN = process.argv.includes('--dry');

// ═══ 参数解析 ═══
const dateArgIdx = process.argv.indexOf('--date');
const SINGLE_DATE = dateArgIdx >= 0 ? process.argv[dateArgIdx + 1] : null;

// ═══ 日期生成 ═══
function generateDates(startStr, endStr) {
  const dates = [];
  const cur = new Date(startStr);
  const last = new Date(endStr);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══ 核心逻辑 ═══
async function backfillDate(dateStr, allplaysData) {
  // 读取现有 odds_history
  const historyPath = path.join(ODDS_DIR, dateStr + '.json');
  let existing = {};
  if (fs.existsSync(historyPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    } catch (e) {
      console.log(`  [WARN] 读取 ${dateStr} 失败: ${e.message}`);
      return { updated: 0, skipped: 0 };
    }
  }

  const odds = existing.odds || existing;
  const keys = Object.keys(odds).filter(function (k) {
    return k !== 'date' && odds[k] && typeof odds[k] === 'object';
  });

  // 检查哪些条目缺 halfFull / totalGoals
  let missingHF = 0,
    missingTG = 0;
  for (const k of keys) {
    const e = odds[k];
    if (!e.halfFull || Object.keys(e.halfFull || {}).length === 0) missingHF++;
    if (!e.totalGoals || Object.keys(e.totalGoals || {}).length === 0) missingTG++;
  }

  // 先抓取 500.com 数据，判断是否需要补全
  let fetched;
  try {
    fetched = await fetchOdds(dateStr);
  } catch (e) {
    console.log(`  [FAIL] ${dateStr}: fetchOdds 失败 - ${e.message}`);
    return { updated: 0, skipped: keys.length };
  }

  if (!fetched || Object.keys(fetched).length === 0) {
    console.log(`  [EMPTY] ${dateStr}: 500.com 无数据`);
    return { updated: 0, skipped: keys.length };
  }

  // ★ 如果本地 odds_history 没有这个日期的文件，直接用 500.com 数据创建
  if (keys.length === 0) {
    if (DRY_RUN) {
      console.log(`  [DRY] ${dateStr}: 将创建 ${Object.keys(fetched).length} 场次 (dry-run)`);
      return { updated: Object.keys(fetched).length, skipped: 0 };
    }
    const toSave = { date: dateStr, odds: fetched };
    fs.writeFileSync(historyPath, JSON.stringify(toSave, null, 2), 'utf8');
    console.log(`  [CREATE] ${dateStr}: 新建 ${Object.keys(fetched).length} 场次`);
    return { updated: Object.keys(fetched).length, skipped: 0 };
  }

  if (missingHF === 0 && missingTG === 0) {
    console.log(`  [OK] ${dateStr}: ${keys.length} 场次，halfFull/totalGoals 完整`);
    return { updated: 0, skipped: keys.length };
  }

  console.log(`  [FETCH] ${dateStr}: ${keys.length} 场次, 缺 halfFull=${missingHF} totalGoals=${missingTG}`);

  // 合并：以 matchNum 匹配
  let updated = 0;
  for (const k of keys) {
    const e = odds[k];
    const f = fetched[k];

    if (!f) continue;

    let changed = false;

    if ((!e.halfFull || Object.keys(e.halfFull || {}).length === 0) && f.halfFull) {
      e.halfFull = f.halfFull;
      changed = true;
    }
    if ((!e.totalGoals || Object.keys(e.totalGoals || {}).length === 0) && f.totalGoals) {
      e.totalGoals = f.totalGoals;
      changed = true;
    }
    // ★ 比分赔率 (scores)
    if ((!e.scores || Object.keys(e.scores || {}).length === 0) && f.scores) {
      e.scores = f.scores;
      changed = true;
    }

    if (changed) updated++;
  }

  // 写入
  if (!DRY_RUN && updated > 0) {
    const toSave = existing.odds ? existing : { date: dateStr, odds };
    fs.writeFileSync(historyPath, JSON.stringify(toSave, null, 2), 'utf8');
    console.log(`  [SAVE] ${dateStr}: 更新 ${updated} 场次`);
  } else if (updated > 0) {
    console.log(`  [DRY] ${dateStr}: 将更新 ${updated} 场次 (dry-run)`);
  }

  // 同时更新 allplays 缓存 (如果存在此日期)
  if (!DRY_RUN && allplaysData && allplaysData[dateStr]) {
    const day = allplaysData[dateStr];
    for (const k of keys) {
      if (!day[k]) continue;
      const e = odds[k];
      if (e.halfFull && (!day[k].halfFull || Object.keys(day[k].halfFull).length === 0)) {
        day[k].halfFull = e.halfFull;
      }
      if (e.totalGoals && (!day[k].totalGoals || Object.keys(day[k].totalGoals).length === 0)) {
        day[k].totalGoals = e.totalGoals;
      }
    }
  }

  return { updated, skipped: keys.length - updated };
}

// ═══ 对比分赔率的专项抓取 (playid=271) ═══
async function fetchScoresFrom500(dateStr) {
  // 比分赔率在 500.com 上需要 playid=271
  // 复用 fetch_500odds 中的 fetchPage 函数
  const { fetchOdds: fo } = require('../server/fetch_500odds');
  // fetchOdds 默认用 playid=312 获取基础数据
  // 我们还需要单独 fetch playid=271 获取比分赔率
  return null; // 比分赔率在下述主线流程中一并处理
}

// ═══ Main ═══
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  从 500.com 补全 odds_history 赔率     ║');
  console.log('║  目标: halfFull / totalGoals / scores   ║');
  console.log('╚══════════════════════════════════════════╝');
  if (DRY_RUN) console.log('>>> DRY RUN 模式（不写入文件）\n');

  // 加载 allplays 缓存
  let allplaysData = null;
  if (fs.existsSync(ALLPLAYS_PATH)) {
    try {
      allplaysData = JSON.parse(fs.readFileSync(ALLPLAYS_PATH, 'utf8'));
      console.log('[allplays] 已加载, ' + Object.keys(allplaysData).length + ' 个日期');
    } catch (e) {
      console.log('[allplays] 加载失败: ' + e.message);
    }
  }

  // 日期范围
  const today = new Date().toISOString().slice(0, 10);
  const dates = SINGLE_DATE ? [SINGLE_DATE] : generateDates('2026-03-19', today);
  console.log(`目标: ${dates.length} 天 (${dates[0]} ~ ${dates[dates.length - 1]})\n`);

  let totalUpdated = 0,
    totalSkipped = 0,
    failCount = 0;

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    try {
      const r = await backfillDate(d, allplaysData);
      totalUpdated += r.updated;
      totalSkipped += r.skipped;
    } catch (e) {
      console.log(`  [ERROR] ${d}: ${e.message}`);
      failCount++;
    }
    // 限速
    if (i < dates.length - 1) await sleep(600);
  }

  // 保存 allplays 更新
  if (!DRY_RUN && allplaysData && totalUpdated > 0) {
    fs.writeFileSync(ALLPLAYS_PATH, JSON.stringify(allplaysData, null, 2), 'utf8');
    console.log(`\n[allplays] 已更新保存`);
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║  完成: 更新 ${totalUpdated} 场次, 跳过 ${totalSkipped} 场次, 失败 ${failCount} 天  ║`);
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(function (e) {
  console.error('FATAL:', e);
  process.exit(1);
});
