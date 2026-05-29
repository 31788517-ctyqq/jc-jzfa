/**
 * 合并静态HTML抓取 + Selenium抓取 → 统一 shuju 数据
 * 
 * 输入:
 *   server/shuju_data/shuju_{date}.json    (静态: 近10场全联赛+同联赛)
 *   server/shuju_data/shuju_selenium_{date}.json (Selenium: 近6场含百分比)
 * 
 * 输出:
 *   server/shuju_data/shuju_merged_{date}.json   (合并后完整数据)
 * 
 * 用法: node server/merge_shuju.js [date]
 */
const fs = require('fs');
const path = require('path');

const SHUJU_DIR = path.join(__dirname, 'shuju_data');

function mergeShuju(dateStr) {
  const staticFile = path.join(SHUJU_DIR, `shuju_${dateStr}.json`);
  const selFile = path.join(SHUJU_DIR, `shuju_selenium_${dateStr}.json`);
  const outFile = path.join(SHUJU_DIR, `shuju_merged_${dateStr}.json`);

  let staticData = {};
  let selData = {};

  // 读取静态数据
  if (fs.existsSync(staticFile)) {
    try { staticData = JSON.parse(fs.readFileSync(staticFile, 'utf8')); } catch (e) {
      console.log('[merge] 静态数据读取失败: ' + e.message);
    }
  }

  // 读取 Selenium 数据
  if (fs.existsSync(selFile)) {
    try { selData = JSON.parse(fs.readFileSync(selFile, 'utf8')); } catch (e) {
      console.log('[merge] Selenium数据读取失败: ' + e.message);
    }
  }

  const staticMatches = (staticData.matches || {});
  const selMatches = (selData.matches || {});

  const merged = {};

  // 合并两个数据源
  const allNums = new Set([
    ...Object.keys(staticMatches),
    ...Object.keys(selMatches)
  ]);

  allNums.forEach(num => {
    const s = staticMatches[num] || {};
    const se = selMatches[num] || {};

    // 近10场数据（来自静态抓取）
    const ad = s.attackDefense || {};
    const h10 = (ad.home || {}).recent10 || {};
    const a10 = (ad.away || {}).recent10 || {};
    const h10L = (ad.home || {}).recent10League || {};
    const a10L = (ad.away || {}).recent10League || {};

    // 近6场数据（来自Selenium）
    const h6 = (se.recent6 || {}).home || {};
    const a6 = (se.recent6 || {}).away || {};

    merged[num] = {
      matchNum: num,
      shujuId: s.shujuId || se.shujuId || '',
      homeTeam: s.homeTeam || se.homeTeam || '',
      awayTeam: s.awayTeam || se.awayTeam || '',
      leagueName: s.leagueName || '',

      // 近期战绩对比
      recentForm: {
        // 近10场 - 所有联赛
        last10: {
          home: cleanStats(h10),
          away: cleanStats(a10)
        },
        // 近10场 - 同联赛
        last10League: {
          home: cleanStats(h10L),
          away: cleanStats(a10L)
        },
        // 近6场 - Selenium JS渲染
        last6: {
          home: cleanStats(h6, true),
          away: cleanStats(a6, true)
        }
      }
    };
  });

  // 写出
  const output = {
    date: dateStr,
    source: '500.com fenxi/shuju (merged: static + selenium)',
    matchesCount: Object.keys(merged).length,
    matches: merged,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`[merge] ${dateStr}: ${Object.keys(merged).length} 场 → ${outFile}`);
  return merged;
}

/** 清理统计数据，移除空值 */
function cleanStats(obj, isLast6) {
  const result = {};
  const fields = ['wins', 'draws', 'losses', 'goals', 'conceded'];
  const pctFields = ['winPct', 'handicapPct', 'overPct'];

  fields.forEach(f => {
    if (obj[f] !== undefined && obj[f] !== null) result[f] = obj[f];
  });
  pctFields.forEach(f => {
    if (obj[f] !== undefined && obj[f] !== null) result[f] = obj[f];
  });

  return result;
}

/** 加载已合并的数据 */
function loadMergedShuju(dateStr) {
  const file = path.join(SHUJU_DIR, `shuju_merged_${dateStr}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

// CLI 调用
if (require.main === module) {
  const dateStr = process.argv[2] || new Date().toISOString().slice(0, 10);
  mergeShuju(dateStr);
}

module.exports = { mergeShuju, loadMergedShuju };
