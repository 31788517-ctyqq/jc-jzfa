/**
 * 用户方案修复脚本 — 重新计算所有方案的 subResults + 串关判定
 * 在服务器上执行: node server/repair_user_plans.js
 */
const fs = require('fs');
const path = require('path');

const PLANS_DIR = path.join(__dirname, 'user_plans');
if (!fs.existsSync(PLANS_DIR)) {
  console.log('[SKIP] user_plans 目录不存在');
  process.exit(0);
}

// 复制 recalcPlanResult 和 _judgeByScore 逻辑（不引用 index.js 避免启动整个服务器）
let dataJson = {};
try {
  dataJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
} catch (e) {}
const mMap = dataJson.m || {};
const mByNum = {};
const mByDateNum = {};
Object.keys(mMap).forEach(function (k) {
  const entry = mMap[k];
  if (!entry || !entry.num) return;
  const num = String(entry.num);
  const dateStr = String(entry.date || '').slice(0, 10);
  mByNum[num] = entry;
  if (dateStr) mByDateNum[dateStr + '|' + num] = entry;
});

function getOddsHistory(dateStr) {
  try {
    const fp = path.join(__dirname, 'odds_history', dateStr + '.json');
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {}
  return null;
}

function _judgeByScore(direction, scoreStr, handicap, halfScoreStr) {
  if (!scoreStr || !direction) return null;
  if (direction.indexOf('、') >= 0) {
    const subParts = direction.split(/[、,]/);
    for (let sp = 0; sp < subParts.length; sp++) {
      const r = _judgeByScore(subParts[sp].trim(), scoreStr, handicap, halfScoreStr);
      if (r === true) return true;
    }
    return false;
  }
  const parts = scoreStr.split(':');
  if (parts.length !== 2) return null;
  const hg = parseInt(parts[0], 10);
  const ag = parseInt(parts[1], 10);
  if (isNaN(hg) || isNaN(ag)) return null;
  const hdcp = Number(handicap) || 0;

  // RQSPF
  if (direction === '让胜') return hg + hdcp > ag;
  if (direction === '让平') return hg + hdcp === ag;
  if (direction === '让负') return hg + hdcp < ag;
  // SPF
  if (direction === '胜') return hg > ag;
  if (direction === '平') return hg === ag;
  if (direction === '负') return hg < ag;
  if (direction === '胜平') return hg > ag || hg === ag;
  if (direction === '平负') return hg === ag || hg < ag;

  // 归一化前缀
  if (/^总进球-\d+球?$/.test(direction)) direction = direction.replace(/^总进球-/, '').replace(/球$/, '');
  if (/^半全场-/.test(direction)) direction = direction.replace(/^半全场-/, '');

  // BF
  const bfMatch = direction.match(/^(\d+):(\d+)$/);
  if (bfMatch) return parseInt(bfMatch[1]) === hg && parseInt(bfMatch[2]) === ag;
  // JQS / 总进球
  const jqsMatch = direction.match(/^(\d+)\+?球?$/);
  if (jqsMatch) {
    const threshold = parseInt(jqsMatch[1], 10);
    if (direction.indexOf('+') >= 0) return hg + ag >= threshold;
    return hg + ag === threshold;
  }

  // BQC（半全场）
  const bqcMap = {
    胜胜: '3',
    平胜: '3',
    胜负: '0',
    胜平: '1',
    平平: '1',
    平负: '0',
    负胜: '3',
    负平: '1',
    负负: '0',
  };
  const fullKey = bqcMap[direction];
  if (fullKey) {
    const full = hg > ag ? '3' : hg === ag ? '1' : '0';
    // 有半场比分时精确判定半场部分
    if (halfScoreStr) {
      const hParts = String(halfScoreStr).replace(/[-:]/g, ':').split(':');
      const hHg = parseInt(hParts[0], 10);
      const hAg = parseInt(hParts[1], 10);
      if (!isNaN(hHg) && !isNaN(hAg)) {
        const halfChar = direction.charAt(0);
        let halfResult = null;
        if (halfChar === '胜') halfResult = hHg > hAg;
        else if (halfChar === '平') halfResult = hHg === hAg;
        else if (halfChar === '负') halfResult = hHg < hAg;
        if (halfResult === null) return null;
        return halfResult && full === fullKey;
      }
    }
    // 无半场比分：仅判全场部分（近似）
    return full === fullKey;
  }
  return null;
}

function combinations(n, k) {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result = (result * (n - k + i)) / i;
  }
  return Math.round(result);
}

function _round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function _calcEffectiveOdds(list) {
  const odds = Array.isArray(list)
    ? list
        .map(function (x) {
          return Number(x);
        })
        .filter(function (x) {
          return x > 0;
        })
    : [];
  if (odds.length === 0) return 0;
  if (odds.length === 1) return _round2(odds[0]);
  let invSum = 0;
  for (let i = 0; i < odds.length; i++) invSum += 1 / odds[i];
  return invSum > 0 ? _round2(1 / invSum) : 0;
}

function _calcPlanOddsRaw(plan) {
  const matches = Array.isArray(plan && plan.matches) ? plan.matches : [];
  if (matches.length === 0) return { totalOdds: 0, passOdds: {}, bestProductK: 0, maxWin: 0 };

  const grouped = {};
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i] || {};
    const key = String(m.matchId || m.matchNum || 'unknown_' + i);
    const od = Number(m.odds);
    if (!grouped[key]) grouped[key] = [];
    if (!isNaN(od) && od > 0) grouped[key].push(od);
  }

  const matchIds = Object.keys(grouped);
  const effectiveMap = {};
  for (let mi = 0; mi < matchIds.length; mi++) {
    const mk = matchIds[mi];
    effectiveMap[mk] = _calcEffectiveOdds(grouped[mk] || []);
  }

  const passTypes = plan.passTypes && plan.passTypes.length > 0 ? plan.passTypes : matchIds.length === 1 ? [1] : [2];
  let multiplier = Number(plan.multiplier) || 1;
  if (!(multiplier > 0)) multiplier = 1;

  const passOdds = {};
  let bestProduct = 0;
  let bestProductK = 0;
  for (let pi = 0; pi < passTypes.length; pi++) {
    const k = Number(passTypes[pi]) || 0;
    if (k < 1 || k > matchIds.length) continue;
    const sorted = matchIds
      .map(function (mid) {
        return Number(effectiveMap[mid]) || 0;
      })
      .filter(function (x) {
        return x > 0;
      })
      .sort(function (a, b) {
        return b - a;
      });
    if (sorted.length < k) continue;
    let product = 1;
    for (let sj = 0; sj < k; sj++) product *= sorted[sj];
    product = _round2(product);
    passOdds[k] = { bestProduct: product, maxWinPerNote: _round2(2 * multiplier * product) };
    if (product > bestProduct) {
      bestProduct = product;
      bestProductK = k;
    }
  }

  const betCount = Number(plan.betCount) || 1;
  let amount = Number(plan.amount);
  if (!(amount > 0)) amount = betCount * 2 * multiplier;
  const maxWin = _round2(2 * multiplier * bestProduct);
  const totalOdds = amount > 0 ? _round2(maxWin / amount) : 0;
  return { totalOdds: totalOdds, passOdds: passOdds, bestProductK: bestProductK, maxWin: maxWin };
}

function recalcPlanResult(plan) {
  const matches = plan.matches || [];
  if (matches.length === 0) return plan;

  for (let i = 0; i < matches.length; i++) {
    const mm = matches[i];
    const matchNum = mm.matchNum || '';
    const playType = mm.playType || '';
    const direction = mm.direction || '';
    var matchDate = String(mm.matchDate || mm.date || plan.matchDate || '').slice(0, 10);

    const matchData = (matchDate && mByDateNum[matchDate + '|' + matchNum]) || mByNum[matchNum] || null;
    const hasScore = matchData && matchData.score;

    // handicap
    let handicap = null;
    if (playType === 'rqspf' && hasScore) {
      var matchDate = (matchData.date || '').slice(0, 10);
      if (matchDate) {
        const oddsMap = getOddsHistory(matchDate);
        if (oddsMap && oddsMap[matchNum] && oddsMap[matchNum].rqspf) {
          handicap = oddsMap[matchNum].rqspf.handicap;
        }
      } else {
        try {
          const ohDir = path.join(__dirname, 'odds_history');
          const recentFiles = fs
            .readdirSync(ohDir)
            .filter(function (f) {
              return /^\d{4}-\d{2}-\d{2}\.json$/.test(f);
            })
            .sort()
            .reverse();
          for (let fi = 0; fi < recentFiles.length; fi++) {
            const odMap = getOddsHistory(recentFiles[fi].replace('.json', ''));
            if (odMap && odMap[matchNum] && odMap[matchNum].rqspf) {
              handicap = odMap[matchNum].rqspf.handicap;
              break;
            }
          }
        } catch (e) {}
      }
    }

    let scoreStr = '';
    if (hasScore) {
      const rawScore = matchData.score;
      if (typeof rawScore === 'object' && rawScore !== null) {
        scoreStr = (rawScore.home || rawScore.h || '') + ':' + (rawScore.away || rawScore.a || '');
      } else {
        scoreStr = String(rawScore || '');
      }
    }

    let effectiveDirection = direction;
    if (playType === 'rqspf') {
      if (direction === '胜') effectiveDirection = '让胜';
      else if (direction === '平') effectiveDirection = '让平';
      else if (direction === '负') effectiveDirection = '让负';
    }

    // subResults
    const subDirs = effectiveDirection.split(/[、,]/);
    mm.subResults = [];
    for (let sdi = 0; sdi < subDirs.length; sdi++) {
      const sd = subDirs[sdi].trim();
      let sdResult = null;
      if (hasScore && scoreStr) {
        sdResult = _judgeByScore(sd, scoreStr, handicap, (matchData && matchData.halfScore) || '');
      }
      mm.subResults.push({ direction: sd, result: sdResult === null ? null : sdResult ? 1 : 0 });
    }

    if (!hasScore) {
      mm.isMatchWon = undefined;
      mm.isMatchLose = undefined;
      continue;
    }

    const result = _judgeByScore(effectiveDirection, scoreStr, handicap, (matchData && matchData.halfScore) || '');
    if (result === true) {
      mm.isMatchWon = true;
      mm.isMatchLose = false;
    } else if (result === false) {
      mm.isMatchWon = false;
      mm.isMatchLose = true;
    } else {
      mm.isMatchWon = undefined;
      mm.isMatchLose = undefined;
    }
  }

  // 串关中奖判定
  const matchWinStatus = {};
  for (let i2 = 0; i2 < matches.length; i2++) {
    const m2 = matches[i2];
    const mid = m2.matchId || m2.matchNum || '';
    if (m2.isMatchWon === true) matchWinStatus[mid] = true;
    else if (matchWinStatus[mid] !== true) {
      if (m2.isMatchLose === true) matchWinStatus[mid] = false;
    }
  }
  const wonIds = Object.keys(matchWinStatus).filter(function (k) {
    return matchWinStatus[k] === true;
  });
  const judgedIds = Object.keys(matchWinStatus);
  const wonCount = wonIds.length;
  const totalUnique = new Set(
    matches.map(function (m) {
      return m.matchId || m.matchNum || '';
    }),
  ).size;

  const passTypes = plan.passTypes && plan.passTypes.length > 0 ? plan.passTypes : totalUnique === 1 ? [1] : [2];

  let totalWinCombs = 0;
  for (let pi = 0; pi < passTypes.length; pi++) {
    const passLevel = passTypes[pi];
    if (wonCount >= passLevel) {
      totalWinCombs += combinations(wonCount, passLevel);
    }
  }

  const isPlanWon = totalWinCombs > 0;

  // Only update if all matches are settled
  const hasPending = judgedIds.length < totalUnique;
  const recalcOdds = _calcPlanOddsRaw(plan);
  const resolvedTotalOdds = Number(recalcOdds.totalOdds) || Number(plan.totalOdds) || 0;
  const resolvedMaxPrize = Number(recalcOdds.maxWin) || _round2((Number(plan.amount) || 0) * resolvedTotalOdds);

  if (!hasPending || isPlanWon) {
    const updated = Object.assign({}, plan);
    if (isPlanWon) {
      updated.isWon = true;
      const totalBets = plan.betCount || Math.max(1, totalWinCombs);
      const winRatio = Math.min(1, totalWinCombs / totalBets);
      updated.resultIncome = _round2(resolvedMaxPrize * winRatio);
    } else if (hasPending) {
      // 还有未开奖场次，保持 None
      updated.isWon = null;
      updated.resultIncome = null;
    } else {
      updated.isWon = false;
      updated.resultIncome = 0;
    }
    updated.totalOdds = _round2(resolvedTotalOdds);
    updated.passOdds = recalcOdds.passOdds;
    updated.bestProductK = recalcOdds.bestProductK;
    updated.expectedMaxPrize = _round2(resolvedMaxPrize);
    updated.settledPrize =
      updated.isWon === true ? _round2(updated.resultIncome || 0) : updated.isWon === false ? 0 : null;
    return updated;
  }

  return Object.assign({}, plan, {
    totalOdds: _round2(resolvedTotalOdds),
    passOdds: recalcOdds.passOdds,
    bestProductK: recalcOdds.bestProductK,
    expectedMaxPrize: _round2(resolvedMaxPrize),
    settledPrize: null,
  });
}

// ── 处理所有方案文件 ──
const files = fs.readdirSync(PLANS_DIR).filter(function (f) {
  return f.endsWith('.json');
});
console.log('Files found: ' + files.length);

let fixedCount = 0;
let filesWritten = 0;

files.forEach(function (fname) {
  const fp = path.join(PLANS_DIR, fname);
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    let plans = Array.isArray(data) ? data : data.plans || [];
    if (plans.length === 0) return;

    let changed = false;
    plans = plans.map(function (p) {
      const r = recalcPlanResult(p);
      if (r !== p) changed = true;
      // Check if subResults were populated
      const hasSubs = (r.matches || []).every(function (m) {
        return m.subResults && m.subResults.length > 0;
      });
      if (
        hasSubs &&
        (!p.matches || !p.matches[0] || !p.matches[0].subResults || p.matches[0].subResults.length === 0)
      ) {
        changed = true;
      }
      return r;
    });

    if (changed) {
      const out = Array.isArray(data) ? plans : Object.assign({}, data, { plans: plans });
      fs.writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
      fixedCount++;
      filesWritten++;
      console.log('  FIXED: ' + fname + ' (' + plans.length + ' plans)');
      plans.forEach(function (p, i) {
        const subs = (p.matches || []).filter(function (m) {
          return m.subResults && m.subResults.length > 0;
        }).length;
        const won = (p.matches || []).filter(function (m) {
          return m.isMatchWon;
        }).length;
        console.log(
          '    [' +
            i +
            '] isWon=' +
            p.isWon +
            ' subs=' +
            subs +
            '/' +
            (p.matches || []).length +
            ' won=' +
            won +
            ' income=' +
            p.resultIncome,
        );
      });
    } else {
      // Still has subResults? Already good
      const hasSubs = plans.every(function (p) {
        return (p.matches || []).every(function (m) {
          return m.subResults && m.subResults.length > 0;
        });
      });
      if (hasSubs) {
        fixedCount++;
        console.log('  OK: ' + fname + ' (' + plans.length + ' plans)');
      }
    }
  } catch (e) {
    console.log('  ERROR: ' + fname + ' - ' + e.message);
  }
});

console.log('\n=== DONE ===');
console.log('Files fixed: ' + filesWritten);
console.log('Total OK: ' + fixedCount + '/' + files.length);
