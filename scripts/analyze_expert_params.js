/**
 * scripts/analyze_expert_params.js
 * 专家博热方案参数探测：测试不同 dayMatchCount 和 expertCount 组合的盈亏
 *
 * 用法: node scripts/analyze_expert_params.js
 *
 * 两个参数：
 *   1. minDayCount  — 当天比赛场次门槛（往上调整）
 *   2. minExpertCnt — findBest 选中的比赛需要的最少专家数（新增门槛）
 *
 * 结果判断：使用 data.json rMap 中的 rs 字段 (0=未中, 1=命中, 其他=未知)
 * 赔率来源：server/odds_history/*.json
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const AMOUNT = 1000; // 每注 1000 元

// ── 工具函数 ──
function fmtDate2(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

// ── 加载 data.json ──
console.log('[1/4] Loading data.json...');
const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const mMap = raw.m || {};
const rMap = raw.r || {};

// ── 构建日期索引 ──
const dateMap = {}; // dateStr -> [matchObj, ...]
Object.keys(mMap).forEach((k) => {
  const m = mMap[k];
  const ds = (m.date || '').slice(0, 10);
  if (!ds) return;
  if (!dateMap[ds]) dateMap[ds] = [];
  dateMap[ds].push(m);
});
const allDates = Object.keys(dateMap).sort();
console.log('  dates:', allDates.length, 'matches:', Object.keys(mMap).length);

// ── 预加载所有 odds_history ──
console.log('[2/4] Loading odds_history...');
const oddsCache = {};
let oddsLoaded = 0;
for (const ds of allDates) {
  const file = path.join(ODDS_DIR, ds + '.json');
  if (fs.existsSync(file)) {
    try {
      const od = JSON.parse(fs.readFileSync(file, 'utf8'));
      oddsCache[ds] = od;
      oddsLoaded++;
    } catch (e) {
      /* skip */
    }
  }
}
console.log('  loaded:', oddsLoaded, '/', allDates.length);

// ── ods_history 封装赔率查找 ──
function getOddsForMatch(ds, matchNum) {
  const od = oddsCache[ds];
  if (!od || !od.odds) return null;
  return od.odds[matchNum] || null;
}

// ── 核心分析函数 ──
/**
 * @param {number} minDayCount  当天比赛最少场数
 * @param {number} minExpertCnt findBest 需要的最低专家数
 */
function analyzeParams(minDayCount, minExpertCnt) {
  let totalPlans = 0,
    totalWon = 0,
    totalIncome = 0;

  for (const ds of allDates) {
    const mList = dateMap[ds];
    const dayMatchCount = mList.length;

    // ★ 参数1: 当天比赛场次门槛
    if (dayMatchCount < minDayCount) continue;

    // 构建 matchDataMap（与线上逻辑一致）
    const matchDataMap = {};
    for (const mm of mList) {
      const recsRaw = rMap[String(mm.matchId)] || [];
      // 规范化 recs
      const recs = recsRaw.map((x) => ({
        type: x.t || x.type || '',
        num: x.n || x.num || 0,
        result: x.rs === 0 || x.rs === 1 ? x.rs : null,
      }));

      // 从 odds_history 加载赔率
      const num = mm.num || '';
      const oddsObjRaw = getOddsForMatch(ds, num);
      let oddsObj = null;
      if (oddsObjRaw) {
        oddsObj = {
          spf: oddsObjRaw.spf || null,
          rqspf: oddsObjRaw.rqspf || null,
          totalGoals: oddsObjRaw.totalGoals || null,
          halfFull: oddsObjRaw.halfFull || null,
          isSingleGame: oddsObjRaw.isSingleGame || false,
        };
      }

      matchDataMap[mm.matchId] = {
        match: mm,
        recs: recs,
        odds: oddsObj,
      };
    }

    // ── findBest（与线上逻辑一致，增加专家数门槛）──
    function findBest(directions, excludeIds) {
      let best = null,
        bestCount = 0;
      for (const mm of mList) {
        if (excludeIds && excludeIds.indexOf(mm.matchId) >= 0) continue;
        const md = matchDataMap[mm.matchId];
        if (!md || !md.odds) continue;
        let total = 0;
        for (const r of md.recs) {
          if (directions.indexOf(r.type) >= 0) total += r.num || 0;
        }
        if (total > bestCount) {
          bestCount = total;
          best = mm;
        }
      }
      // ★ 参数2: 专家数最低门槛
      if (best && bestCount < minExpertCnt) return null;
      return best;
    }

    // ── 生成方案（与线上 plan-list 逻辑完全一致）──
    const dayPlans = [];

    // 方案一
    const m1a = findBest(['平', '让平']);
    const m1b = findBest(['让负'], m1a ? [m1a.matchId] : null);
    if (m1a && m1b)
      dayPlans.push({
        name: 'plan_1',
        matches: [
          { m: m1a, dir: '平、让平' },
          { m: m1b, dir: '让负' },
        ],
      });

    // 方案二
    const m2a = findBest(['总进球-2、3球']);
    const m2b = findBest(['让负'], m2a ? [m2a.matchId] : null);
    if (m2a && m2b)
      dayPlans.push({
        name: 'plan_2',
        matches: [
          { m: m2a, dir: '总进球-2、3球' },
          { m: m2b, dir: '让负' },
        ],
      });

    // 方案三
    const m3a = findBest(['胜']);
    const m3b = findBest(['让负'], m3a ? [m3a.matchId] : null);
    if (m3a && m3b)
      dayPlans.push({
        name: 'plan_3',
        matches: [
          { m: m3a, dir: '胜' },
          { m: m3b, dir: '让负' },
        ],
      });

    // 方案六: dayMatchCount >= 4
    if (dayMatchCount >= 4) {
      const targetParts = ['半全场-胜胜', '半全场-平胜'];
      let bestM6 = null,
        bestCount6 = 0;
      for (const k of Object.keys(matchDataMap)) {
        const md = matchDataMap[k];
        let total6 = 0;
        for (const r of md.recs) {
          for (const tp of targetParts) if ((r.type || '') === tp) total6 += r.num || 0;
        }
        if (total6 > bestCount6) {
          bestCount6 = total6;
          bestM6 = md.match;
        }
      }
      if (bestM6 && bestCount6 >= minExpertCnt) {
        dayPlans.push({ name: 'plan_6', matches: [{ m: bestM6, dir: '半全场-胜胜、平胜' }] });
      }
    }

    // 方案四/五: dayMatchCount >= 6
    if (dayMatchCount >= 6) {
      const m4a = findBest(['平', '让平']);
      const m4b = findBest(['胜'], m4a ? [m4a.matchId] : null);
      if (m4a && m4b)
        dayPlans.push({
          name: 'plan_4',
          matches: [
            { m: m4a, dir: '平、让平' },
            { m: m4b, dir: '胜' },
          ],
        });

      const m5a = findBest(['平', '让平']);
      const m5b = findBest(['总进球-2、3球'], m5a ? [m5a.matchId] : null);
      if (m5a && m5b)
        dayPlans.push({
          name: 'plan_5',
          matches: [
            { m: m5a, dir: '平、让平' },
            { m: m5b, dir: '总进球-2、3球' },
          ],
        });
    }

    // 裁切: dayMatchCount < 5 时只保留前2个
    if (dayMatchCount < 5 && dayPlans.length > 2) {
      dayPlans.splice(2);
    }

    // ── 计算每个方案的盈亏 ──
    for (const pp of dayPlans) {
      if (pp.matches.length === 0) continue;

      // extractRecResult: 从 rMap 查找某个方向是否命中
      function extractRecResult(matchId, direction) {
        const md = matchDataMap[matchId];
        const recs = md ? md.recs : [];

        // 拆分复合方向
        const subDirs = direction.split(/[、,]/);
        let anyWon = false,
          anyLose = false,
          anyUnknown = false;

        for (const sd of subDirs) {
          const s = sd.trim();
          let found = false;
          for (const r of recs) {
            // 全匹配
            if (r.type === s) {
              found = true;
              if (r.result === 1) anyWon = true;
              else if (r.result === 0) anyLose = true;
              else anyUnknown = true;
              break;
            }
          }
          if (!found) {
            // 尝试拆分 rec 的 type（rec 中的 type 可能是 "总进球-2、3球"）
            for (const r of recs) {
              const recSubs = (r.type || '').split(/[、,]/);
              if (recSubs.some((rs) => rs.trim() === s) || r.type === s) {
                found = true;
                if (r.result === 1) anyWon = true;
                else if (r.result === 0) anyLose = true;
                else anyUnknown = true;
                break;
              }
            }
          }
          if (!found) {
            // 总进球特殊处理
            const gm = s.match(/^总进球-(\d+)球?$/);
            if (gm) {
              for (const r of recs) {
                if (r.type === s || r.type === '总进球-' + gm[1]) {
                  found = true;
                  if (r.result === 1) anyWon = true;
                  else if (r.result === 0) anyLose = true;
                  else anyUnknown = true;
                  break;
                }
              }
            }
          }
          if (!found) {
            // 半全场特殊处理
            const hf = s.match(/^半全场-(.+)$/);
            if (hf) {
              for (const r of recs) {
                if (r.type === s || r.type === hf[1]) {
                  found = true;
                  if (r.result === 1) anyWon = true;
                  else if (r.result === 0) anyLose = true;
                  else anyUnknown = true;
                  break;
                }
              }
            }
          }
          if (!found) anyUnknown = true;
        }

        if (anyUnknown) return { won: null };
        if (anyWon) return { won: true };
        return { won: !anyLose }; // anyLose=true → false; all ok but unknown → should've been caught
      }

      // 多场联合判定
      let allWon = true,
        anyUnknown = false;
      for (const mi of pp.matches) {
        const res = extractRecResult(mi.m.matchId, mi.dir);
        if (res.won === null) {
          anyUnknown = true;
          break;
        }
        if (!res.won) allWon = false;
      }
      if (anyUnknown) continue; // 跳过结果未知的方案

      totalPlans++;
      if (allWon) {
        totalWon++;
        // 计算奖金：荷兰式赔率
        let prize = 0;
        if (pp.matches.length === 1) {
          // 单关
          const md = matchDataMap[pp.matches[0].m.matchId];
          const odds = extractIndividualOdds(md ? md.odds : null, pp.matches[0].dir);
          const eff = dutchOdds(odds);
          prize = eff > 0 ? Math.round(AMOUNT * eff) : Math.round(AMOUNT * 2.5);
        } else {
          // 2串1
          let product = 1;
          let hasOdds = true;
          for (const mi of pp.matches) {
            const md = matchDataMap[mi.m.matchId];
            const odds = extractIndividualOdds(md ? md.odds : null, mi.dir);
            const eff = dutchOdds(odds);
            if (eff <= 0) {
              hasOdds = false;
              break;
            }
            product *= eff;
          }
          prize = hasOdds ? Math.round(AMOUNT * product) : Math.round(AMOUNT * 4);
        }
        totalIncome += prize - AMOUNT;
      } else {
        totalIncome -= AMOUNT;
      }
    }
  }

  const winRate = totalPlans > 0 ? ((totalWon / totalPlans) * 100).toFixed(1) : '0.0';
  return { totalPlans, totalWon, winRate: parseFloat(winRate), totalIncome };
}

// ── 赔率提取（与线上 extractIndividualOdds 一致）──
function extractOddsVal(oddsObj, direction) {
  if (!oddsObj) return null;
  if (direction === '平') return oddsObj.spf ? oddsObj.spf.draw : null;
  if (direction === '让平') return oddsObj.rqspf ? oddsObj.rqspf.draw : null;
  if (direction === '让负') return oddsObj.rqspf ? oddsObj.rqspf.away : null;
  if (direction === '让胜') return oddsObj.rqspf ? oddsObj.rqspf.home : null;
  if (direction === '胜') return oddsObj.spf ? oddsObj.spf.home : null;
  if (direction === '负') return oddsObj.spf ? oddsObj.spf.away : null;
  if (direction === '胜平') return oddsObj.spf ? oddsObj.spf.home : null;
  if (direction === '平负') return oddsObj.spf ? oddsObj.spf.away : null;
  const hfMap = {
    胜胜: 'hh',
    平胜: 'dh',
    胜负: 'ha',
    胜平: 'hd',
    平平: 'dd',
    平负: 'da',
    负胜: 'ah',
    负平: 'ad',
    负负: 'aa',
  };
  if (direction.indexOf('半全场-') === 0 && oddsObj.halfFull) {
    const hfName = direction.replace('半全场-', '');
    const hfKey = hfMap[hfName];
    if (hfKey && oddsObj.halfFull[hfKey] !== undefined) return oddsObj.halfFull[hfKey];
  }
  if (oddsObj.halfFull && hfMap[direction] !== undefined) {
    const hfKey = hfMap[direction];
    if (oddsObj.halfFull[hfKey] !== undefined) return oddsObj.halfFull[hfKey];
  }
  return null;
}

function extractIndividualOdds(oddsObj, direction) {
  if (!oddsObj) return [];
  if (direction.indexOf('总进球-') === 0) {
    const tg = oddsObj.totalGoals;
    if (!tg) return [];
    const nums = direction.replace('总进球-', '').split(/[、,]/);
    const vals = [];
    for (const n of nums) {
      const v = n.replace(/球/g, '').trim();
      if (tg[v] !== undefined) vals.push(tg[v]);
    }
    return vals;
  }
  if (direction.indexOf('、') >= 0 || direction.indexOf(',') >= 0) {
    const parts = direction.split(/[、,]/);
    const vals = [];
    for (const p of parts) {
      const sv = extractOddsVal(oddsObj, p.trim());
      if (sv !== null) vals.push(sv);
    }
    return vals;
  }
  if (direction === '胜平' && oddsObj.spf) return [oddsObj.spf.home, oddsObj.spf.draw];
  if (direction === '平负' && oddsObj.spf) return [oddsObj.spf.draw, oddsObj.spf.away];
  const sv = extractOddsVal(oddsObj, direction);
  return sv !== null ? [sv] : [];
}

function dutchOdds(subOdds) {
  if (subOdds.length === 0) return 0;
  if (subOdds.length === 1) return subOdds[0];
  const invSum = subOdds.reduce((s, o) => s + 1 / o, 0);
  return invSum > 0 ? 1 / invSum : 0;
}

// ═══════════════════ 主程序：网格扫描 ═══════════════════
console.log('[3/4] Starting grid scan...');
console.log('');

const DAY_THRESHOLDS = [4, 5, 6, 8, 10, 12, 15, 20];
const EXPERT_THRESHOLDS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100];

const results = [];
const totalCombos = DAY_THRESHOLDS.length * EXPERT_THRESHOLDS.length;
let comboDone = 0;

for (const minDay of DAY_THRESHOLDS) {
  for (const minExp of EXPERT_THRESHOLDS) {
    comboDone++;
    process.stdout.write('\r  Scanning ' + comboDone + '/' + totalCombos + ' ...');
    const r = analyzeParams(minDay, minExp);
    results.push({ minDay, minExp, ...r });
  }
}

console.log('');
console.log('[4/4] Results:');
console.log('');
console.log('='.repeat(80));
console.log('  minDayMatches | minExpertCount | 方案数 | 命中数 | 命中率  | 总盈利(元)');
console.log('-'.repeat(80));

for (const r of results) {
  const sign = r.totalIncome >= 0 ? '+' : '';
  console.log(
    '  ' +
      String(r.minDay).padStart(13) +
      ' | ' +
      String(r.minExp).padStart(14) +
      ' | ' +
      String(r.totalPlans).padStart(6) +
      ' | ' +
      String(r.totalWon).padStart(6) +
      ' | ' +
      String(r.winRate).padStart(5) +
      '%' +
      '  | ' +
      sign +
      r.totalIncome,
  );
}

// ── 汇总 ──
console.log('');
console.log('='.repeat(80));
results.sort((a, b) => b.totalIncome - a.totalIncome);
const best = results[0];
const profitable = results.filter((r) => r.totalIncome > 0);

console.log(
  '  Best: dayMatchCount>=' +
    best.minDay +
    ', expert>=' +
    best.minExp +
    '  →  ' +
    best.totalPlans +
    ' plans, ' +
    best.winRate +
    '% hit, +' +
    best.totalIncome +
    ' 元',
);

if (profitable.length > 0) {
  console.log('');
  console.log('  Profitable combinations (' + profitable.length + '/' + results.length + '):');
  console.log('  Rank | day>= | expert>= | Plans | HitRate | Profit');
  console.log('  ' + '-'.repeat(55));
  profitable.slice(0, 10).forEach((r, i) => {
    console.log(
      '  ' +
        String(i + 1).padStart(4) +
        ' | ' +
        String(r.minDay).padStart(5) +
        ' | ' +
        String(r.minExp).padStart(8) +
        ' | ' +
        String(r.totalPlans).padStart(5) +
        ' | ' +
        String(r.winRate).padStart(6) +
        '% | +' +
        r.totalIncome,
    );
  });
} else {
  console.log('  WARNING: No profitable combination found!');
  console.log('  Best loss: day>=' + best.minDay + ', expert>=' + best.minExp + '  →  ' + best.totalIncome);
}

// 建议
console.log('');
console.log('='.repeat(80));
console.log('  RECOMMENDATION:');
if (profitable.length > 0) {
  // 找方案数适中的最佳组合
  const good = profitable.filter((r) => r.totalPlans >= 20);
  if (good.length > 0) {
    good.sort((a, b) => b.totalIncome - a.totalIncome);
    const g = good[0];
    console.log('  Set dayMatchCount >= ' + g.minDay + ', expert >= ' + g.minExp);
    console.log('  Expected: ' + g.totalPlans + ' plans, ' + g.winRate + '% hit rate, +' + g.totalIncome + ' profit');
  } else {
    const g = profitable[0];
    console.log('  Set dayMatchCount >= ' + g.minDay + ', expert >= ' + g.minExp);
    console.log('  Expected: ' + g.totalPlans + ' plans, ' + g.winRate + '% hit rate, +' + g.totalIncome + ' profit');
  }
} else {
  console.log('  All combinations show negative profit. The core algorithm may need revision.');
}

console.log('='.repeat(80));
