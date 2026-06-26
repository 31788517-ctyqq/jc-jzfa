// backfill_plan_results.cjs — 回填所有方案快照的赛果
// 用法: node scripts/backfill_plan_results.cjs (在服务器 /root 目录执行)
var fs = require('fs');
var path = require('path');

var SNAP_DIR = path.join(__dirname, '..', 'server', 'plan_snapshots');
if (!fs.existsSync(SNAP_DIR)) SNAP_DIR = '/root/server/plan_snapshots';

// Load data.json for match results
var DATA_FILE = '/root/server/data.json';
var dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
var mM = dataJson.m || {};
var recs = dataJson.r || {};

// Build result index (including handicap from odds history)
var matchResults = {};
var oddsMap = {};
try {
  var currentOddsFile = '/root/server/odds_history/' + new Date().toISOString().slice(0, 10) + '.json';
  var allOddsFiles = require('fs').readdirSync('/root/server/odds_history').filter(function(f){return f.endsWith('.json')});
} catch(e) { allOddsFiles = []; }

Object.values(mM).forEach(function (v) {
  if (!v || !v.matchId) return;
  matchResults[String(v.matchId)] = {
    score: v.score || '',
    matchStatus: v.matchStatus || 0,
    homeName: v.homeName || '',
    visitName: v.visitName || '',
  };
});

// Find handicap from data.json (stored in m[id].handicap or m[id].hcp)
function getHandicap(mid) {
  var m = mM['m_' + mid] || mM[mid];
  if (m && (m.handicap !== undefined || m.hcp !== undefined)) {
    return Number(m.handicap || m.hcp || 0);
  }
  return 0;
}

// ── Direction judge ──
function judgeDirection(dir, score, hcp) {
  // ★ 允许 0-0 作为有效比分（完赛场次已在上层过滤掉 undefined）
  var parts = String(score||'').split(/[-:]/);
  var home = parseInt(parts[0], 10), away = parseInt(parts[1], 10);
  if (isNaN(home) || isNaN(away)) return null;
  var diff = home - away;

  // SPF
  if (dir === '胜') return home > away;
  if (dir === '平') return diff === 0;
  if (dir === '负') return home < away;

  // RQSPF with handicap
  if (dir === '让胜') return diff + hcp > 0;
  if (dir === '让平') return diff + hcp === 0;
  if (dir === '让负') return diff + hcp < 0;

  // ★ Compound: "平负","胜平","负胜" (half-time/full-time shorthand)
  if (/^[胜负平]{2}$/.test(dir)) {
    var actual = (home > away ? '胜' : home < away ? '负' : '平');
    // "平负" → actual is "负" → dir[1]="负" matches
    if (dir[0] === actual || dir[1] === actual) return true;
    // "胜胜","平平","负负" → both halves same
    if (dir === actual + actual) return true;
    return false;
  }

  // 总进球
  var total = home + away;
  if (dir.indexOf('总进球') >= 0) {
    var nums = [];
    var numMatch = dir.match(/总进球\s*[-:：]?\s*([\d、，,\/]+)/);
    if (numMatch) {
      var ns = numMatch[1].split(/[、，,\/]/);
      ns.forEach(function(n){ var v=parseInt(n.trim(),10); if(!isNaN(v)) nums.push(v) });
      if (nums.length > 0) return nums.indexOf(total) >= 0;
    }
    return null;
  }

  // 比分 (exact score match)
  var scoreMatch = dir.match(/(\d+)\s*[-:：]\s*(\d+)/);
  if (scoreMatch) {
    return home === parseInt(scoreMatch[1]) && away === parseInt(scoreMatch[2]);
  }

  // 半全场
  if (dir.indexOf('半全场') >= 0) {
    var hh = (home > away ? '胜' : home < away ? '负' : '平');
    var dirClean = dir.replace('半全场-', '').replace('半全场', '');
    if (dirClean.indexOf('/') >= 0) {
      return dirClean.split('/').indexOf(hh) >= 0;
    }
    return dirClean === hh;
  }

  return null;
}

// Judge a match direction - returns true if ANY direction wins
// Returns null if can't determine (unknown directions)
// Splits on /,,、to handle compound directions
function judgeMatch(match, score) {
  var hcp = getHandicap(match.matchId);
  var dirClean = (match.direction || '').replace(/\\s+/g, '');
  // Split compound directions: "总进球-2,3球" should stay as one, "胜,平" split
  // Handle: "平、让平", "总进球-2、3球", "让负", etc.
  
  // First, check if this is a single direction type
  if (dirClean.indexOf('总进球') >= 0) {
    return judgeDirection(dirClean, score, hcp);
  }
  if (dirClean.indexOf('半全场') >= 0) {
    return judgeDirection(dirClean, score, hcp);
  }
  
  // For SPF/RQSPF compound: "平、让平" → split by 、or ,
  var dirs = dirClean.split(/[、，]/);
  if (dirs.length > 1) {
    for (var i = 0; i < dirs.length; i++) {
      var r = judgeDirection(dirs[i].trim(), score, hcp);
      if (r === true) return true;
    }
    return false;
  }
  
  return judgeDirection(dirClean, score, hcp);
}

// ── Main ──
var files = fs.readdirSync(SNAP_DIR).filter(function (f) {
  return f.endsWith('.json') && f >= '2026-03-19.json' && f <= '2026-06-21.json';
}).sort();

var totalPlans = 0, updated = 0, won = 0, lose = 0, pending = 0;

files.forEach(function (f) {
  var fp = path.join(SNAP_DIR, f);
  var snap = JSON.parse(fs.readFileSync(fp, 'utf8'));
  var plans = snap.plans || [];
  var changed = false;

  plans.forEach(function (plan) {
    // Reset old judgments — re-evaluate with correct logic
    delete plan.isPlanWon;
    delete plan.isPlanLose;
    totalPlans++;

    var matches = plan.matches || [];
    if (matches.length === 0) return;

    var allWon = true, anyLose = false, anyUnknown = false;

    matches.forEach(function (m) {
      var mid = String(m.matchId || '');
      var mr = matchResults[mid];
      if (!mr || mr.matchStatus < 2) {
        anyUnknown = true;
        allWon = false;
        return;
      }
      // ★ 已完赛但 score 为空或 undefined → 尝试从其他源查找
      if (!mr.score || mr.score === 'undefined') {
        anyUnknown = true;
        allWon = false;
        return;
      }
      var result = judgeMatch(m, mr.score);
      if (result === true) {
        // won this match
      } else if (result === false) {
        anyLose = true;
        allWon = false;
      } else {
        anyUnknown = true;
        allWon = false;
      }
    });

    if (!anyUnknown) {
      plan.isPlanWon = allWon;
      plan.isPlanLose = anyLose;
      changed = true;
      updated++;
      if (allWon) won++;
      else lose++;
    } else {
      pending++;
    }
  });

  if (changed) {
    fs.writeFileSync(fp, JSON.stringify(snap, null, 2), 'utf8');
    console.log(f + ': ' + plans.length + ' plans, updated');
  }
});

console.log('\n=== 完成 ===');
console.log('总方案: ' + totalPlans);
console.log('可用结果: ' + updated + ' (命中: ' + won + ', 未中: ' + lose + ')');
console.log('待开奖: ' + pending);
