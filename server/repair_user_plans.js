/**
 * 用户方案修复脚本 — 重新计算所有方案的 subResults + 串关判定
 * 在服务器上执行: node server/repair_user_plans.js
 */
var fs = require('fs');
var path = require('path');

var PLANS_DIR = path.join(__dirname, 'user_plans');
if (!fs.existsSync(PLANS_DIR)) {
  console.log('[SKIP] user_plans 目录不存在');
  process.exit(0);
}

// 复制 recalcPlanResult 和 _judgeByScore 逻辑（不引用 index.js 避免启动整个服务器）
var dataJson = {};
try { dataJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8')); } catch (e) {}
var mMap = dataJson.m || {};
var mByNum = {};
Object.keys(mMap).forEach(function (k) {
  var entry = mMap[k];
  if (entry && entry.num) mByNum[entry.num] = entry;
});

function getOddsHistory(dateStr) {
  try {
    var fp = path.join(__dirname, 'odds_history', dateStr + '.json');
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {}
  return null;
}

function _judgeByScore(direction, scoreStr, handicap) {
  if (!scoreStr || !direction) return null;
  if (direction.indexOf('、') >= 0) {
    var subParts = direction.split(/[、,]/);
    for (var sp = 0; sp < subParts.length; sp++) {
      var r = _judgeByScore(subParts[sp].trim(), scoreStr, handicap);
      if (r === true) return true;
    }
    return false;
  }
  var parts = scoreStr.split(':');
  if (parts.length !== 2) return null;
  var hg = parseInt(parts[0], 10);
  var ag = parseInt(parts[1], 10);
  if (isNaN(hg) || isNaN(ag)) return null;
  var hdcp = Number(handicap) || 0;

  // RQSPF
  if (direction === '让胜') return (hg + hdcp) > ag;
  if (direction === '让平') return (hg + hdcp) === ag;
  if (direction === '让负') return (hg + hdcp) < ag;
  // SPF
  if (direction === '胜') return hg > ag;
  if (direction === '平') return hg === ag;
  if (direction === '负') return hg < ag;
  // BF
  var bfMatch = direction.match(/^(\d+):(\d+)$/);
  if (bfMatch) return parseInt(bfMatch[1]) === hg && parseInt(bfMatch[2]) === ag;
  // JQS
  var jqsMatch = direction.match(/^(\d+)\+?球/);
  if (jqsMatch) {
    var threshold = parseInt(jqsMatch[1]);
    if (direction.indexOf('+') >= 0) return (hg + ag) >= threshold;
    return (hg + ag) === threshold;
  }
  var tgMatch = direction.match(/^(\d+)\+?$/);
  if (tgMatch) {
    var th = parseInt(tgMatch[1]);
    if (direction.indexOf('+') >= 0) return (hg + ag) >= th;
    return (hg + ag) === th;
  }
  // BQC
  var bqcMap = { '胜胜': '33', '平胜': '13', '胜负': '03', '胜平': '31', '平平': '11', '平负': '01', '负胜': '30', '负平': '10', '负负': '00' };
  var bqcKey = bqcMap[direction];
  if (bqcKey) {
    var hf = hg > ag ? '3' : hg === ag ? '1' : '0';
    var af = '0'; // simplified - can't determine second half result from final score alone
    return (hf + af) === bqcKey;
  }
  return null;
}

function combinations(n, k) {
  if (k > n || k < 0) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  var result = 1;
  for (var i = 1; i <= k; i++) {
    result = result * (n - k + i) / i;
  }
  return Math.round(result);
}

function recalcPlanResult(plan) {
  var matches = plan.matches || [];
  if (matches.length === 0) return plan;

  for (var i = 0; i < matches.length; i++) {
    var mm = matches[i];
    var matchNum = mm.matchNum || '';
    var playType = mm.playType || '';
    var direction = mm.direction || '';

    var matchData = mByNum[matchNum] || null;
    var hasScore = matchData && matchData.score;

    // handicap
    var handicap = null;
    if (playType === 'rqspf' && hasScore) {
      var matchDate = (matchData.date || '').slice(0, 10);
      if (matchDate) {
        var oddsMap = getOddsHistory(matchDate);
        if (oddsMap && oddsMap[matchNum] && oddsMap[matchNum].rqspf) {
          handicap = oddsMap[matchNum].rqspf.handicap;
        }
      } else {
        try {
          var ohDir = path.join(__dirname, 'odds_history');
          var recentFiles = fs.readdirSync(ohDir).filter(function (f) { return /^\d{4}-\d{2}-\d{2}\.json$/.test(f); }).sort().reverse();
          for (var fi = 0; fi < recentFiles.length; fi++) {
            var odMap = getOddsHistory(recentFiles[fi].replace('.json', ''));
            if (odMap && odMap[matchNum] && odMap[matchNum].rqspf) { handicap = odMap[matchNum].rqspf.handicap; break; }
          }
        } catch (e) {}
      }
    }

    var scoreStr = '';
    if (hasScore) {
      var rawScore = matchData.score;
      if (typeof rawScore === 'object' && rawScore !== null) {
        scoreStr = (rawScore.home || rawScore.h || '') + ':' + (rawScore.away || rawScore.a || '');
      } else {
        scoreStr = String(rawScore || '');
      }
    }

    var effectiveDirection = direction;
    if (playType === 'rqspf') {
      if (direction === '胜') effectiveDirection = '让胜';
      else if (direction === '平') effectiveDirection = '让平';
      else if (direction === '负') effectiveDirection = '让负';
    }

    // subResults
    var subDirs = effectiveDirection.split(/[、,]/);
    mm.subResults = [];
    for (var sdi = 0; sdi < subDirs.length; sdi++) {
      var sd = subDirs[sdi].trim();
      var sdResult = null;
      if (hasScore && scoreStr) {
        sdResult = _judgeByScore(sd, scoreStr, handicap);
      }
      mm.subResults.push({ direction: sd, result: sdResult === null ? null : sdResult ? 1 : 0 });
    }

    if (!hasScore) { mm.isMatchWon = undefined; mm.isMatchLose = undefined; continue; }

    var result = _judgeByScore(effectiveDirection, scoreStr, handicap);
    if (result === true) { mm.isMatchWon = true; mm.isMatchLose = false; }
    else if (result === false) { mm.isMatchWon = false; mm.isMatchLose = true; }
    else { mm.isMatchWon = undefined; mm.isMatchLose = undefined; }
  }

  // 串关中奖判定
  var matchWinStatus = {};
  for (var i2 = 0; i2 < matches.length; i2++) {
    var m2 = matches[i2];
    var mid = m2.matchId || m2.matchNum || '';
    if (m2.isMatchWon === true) matchWinStatus[mid] = true;
    else if (matchWinStatus[mid] !== true) {
      if (m2.isMatchLose === true) matchWinStatus[mid] = false;
    }
  }
  var wonIds = Object.keys(matchWinStatus).filter(function (k) { return matchWinStatus[k] === true; });
  var judgedIds = Object.keys(matchWinStatus);
  var wonCount = wonIds.length;
  var totalUnique = (new Set(matches.map(function(m){return m.matchId||m.matchNum||''}))).size;

  var passTypes = plan.passTypes && plan.passTypes.length > 0 ? plan.passTypes : (totalUnique === 1 ? [1] : [2]);

  var totalWinCombs = 0;
  for (var pi = 0; pi < passTypes.length; pi++) {
    var passLevel = passTypes[pi];
    if (wonCount >= passLevel) {
      totalWinCombs += combinations(wonCount, passLevel);
    }
  }

  var isPlanWon = totalWinCombs > 0;

  // Only update if all matches are settled
  var hasPending = judgedIds.length < totalUnique;
  if (!hasPending || isPlanWon) {
    var updated = Object.assign({}, plan);
    if (isPlanWon) {
      updated.isWon = true;
      var totalBets = plan.betCount || Math.max(1, totalWinCombs);
      var winRatio = Math.min(1, totalWinCombs / totalBets);
      updated.resultIncome = Math.round((plan.amount || 0) * (plan.totalOdds || 1) * winRatio);
    } else if (hasPending) {
      // 还有未开奖场次，保持 None
      updated.isWon = null;
      updated.resultIncome = null;
    } else {
      updated.isWon = false;
      updated.resultIncome = 0;
    }
    return updated;
  }
  return plan;
}

// ── 处理所有方案文件 ──
var files = fs.readdirSync(PLANS_DIR).filter(function (f) { return f.endsWith('.json'); });
console.log('Files found: ' + files.length);

var fixedCount = 0;
var filesWritten = 0;

files.forEach(function (fname) {
  var fp = path.join(PLANS_DIR, fname);
  try {
    var data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    var plans = Array.isArray(data) ? data : (data.plans || []);
    if (plans.length === 0) return;

    var changed = false;
    plans = plans.map(function (p) {
      var r = recalcPlanResult(p);
      if (r !== p) changed = true;
      // Check if subResults were populated
      var hasSubs = (r.matches || []).every(function (m) { return m.subResults && m.subResults.length > 0; });
      if (hasSubs && (!p.matches || !p.matches[0] || !p.matches[0].subResults || p.matches[0].subResults.length === 0)) {
        changed = true;
      }
      return r;
    });

    if (changed) {
      var out = Array.isArray(data) ? plans : Object.assign({}, data, { plans: plans });
      fs.writeFileSync(fp, JSON.stringify(out, null, 2), 'utf8');
      fixedCount++;
      filesWritten++;
      console.log('  FIXED: ' + fname + ' (' + plans.length + ' plans)');
      plans.forEach(function (p, i) {
        var subs = (p.matches || []).filter(function (m) { return m.subResults && m.subResults.length > 0; }).length;
        var won = (p.matches || []).filter(function (m) { return m.isMatchWon; }).length;
        console.log('    [' + i + '] isWon=' + p.isWon + ' subs=' + subs + '/' + (p.matches||[]).length + ' won=' + won + ' income=' + p.resultIncome);
      });
    } else {
      // Still has subResults? Already good
      var hasSubs = plans.every(function (p) { return (p.matches || []).every(function (m) { return m.subResults && m.subResults.length > 0; }); });
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
