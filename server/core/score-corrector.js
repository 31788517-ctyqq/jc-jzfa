/**
 * ═══ 赛果多源校正器 (Score Corrector) ═══
 * V12: sporttery 官方赛果优先 + 自动修正半场误判
 *
 * 数据源（按优先级）:
 *   1. sporttery_odds/{matchId}.json — 官方赛果（最权威）
 *   2. 当前 data.json 值（保留若无冲突）
 *
 * 注意: live.500.com 对历史日期返回半场比分，不可信!
 *       trade.500.com/jczq 是 SPA，无法服务端抓取
 *
 * 触发场景:
 *   - backfillResults 回填时（自动）
 *   - verifyYesterdayResults 检测到 half_equals_final 时（自动）
 *   - 手动触发: node -e "require('./core/score-corrector').correctDate('2026-06-15')"
 */

var fs = require('fs');
var path = require('path');

var ODDS_DIR = path.join(__dirname, '..', 'sporttery_odds');
var DATA_FILE = path.join(__dirname, '..', 'data.json');

/**
 * 从 sporttery odds 文件提取指定 matchId 的赛果
 */
function getSportteryScoreByMatchId(matchId) {
  if (!matchId) return null;
  var fPath = path.join(ODDS_DIR, String(matchId) + '.json');
  if (!fs.existsSync(fPath)) return null;

  try {
    var d = JSON.parse(fs.readFileSync(fPath, 'utf8'));

    // lotteryResult.比分 最权威（开奖结果）
    var score = d.score || '';
    if (d.lotteryResult && d.lotteryResult['比分'] && d.lotteryResult['比分'].outcome) {
      score = d.lotteryResult['比分'].outcome;
    }
    score = String(score).replace(/:/g, '-').replace(/：/g, '-').trim();
    if (!score || score === '-:-' || score === '-') return null;

    return {
      score: score,
      halfScore: '',  // sporttery 不提供半场
      source: 'sporttery',
      confidence: 1.0,
      matchId: matchId,
    };
  } catch (e) {
    return null;
  }
}

/**
 * 按日期批量提取 sporttery odds 文件中的赛果
 * 扫描 sporttery_odds 目录，找 matchInfo 包含目标日期的文件
 */
function getSportteryScores(dateStr) {
  var scores = {};
  if (!fs.existsSync(ODDS_DIR)) return scores;

  var files = fs.readdirSync(ODDS_DIR).filter(function (f) { return f.endsWith('.json'); });

  // 策略1: 每个比赛按 matchId 精确查找
  // 通过 data.json 中的 matchId 定位具体文件

  // 策略2: 扫目录找包含 target date 的文件
  // matchInfo 格式: "2023/2024 常规赛 第19轮 2024-01-06 19:30"
  // 但 2026 的格式可能是 "2026/2027 season"
  // 用更灵活的匹配
  var dateParts = dateStr.split('-');  // ['2026','06','15']
  var y = dateParts[0], m = dateParts[1], d = dateParts[2];
  var patterns = [
    dateStr,                       // "2026-06-15"
    y + '/' + dateParts[1] + '/' + dateParts[2],  // "2026/06/15"
    y + '-' + m + '-' + d,         // "2026-06-15"
  ];

  files.forEach(function (f) {
    try {
      var content = fs.readFileSync(path.join(ODDS_DIR, f), 'utf8');
      var matched = false;
      for (var pi = 0; pi < patterns.length; pi++) {
        if (content.indexOf(patterns[pi]) >= 0) { matched = true; break; }
      }
      if (!matched) return;

      var d = JSON.parse(content);
      var num = String(d.matchNum || '');
      var numM = num.match(/(周[一二三四五六日]\d{3})/);
      if (!numM) return;

      var matchNum = numM[1];
      var score = d.score || '';
      if (d.lotteryResult && d.lotteryResult['比分'] && d.lotteryResult['比分'].outcome) {
        score = d.lotteryResult['比分'].outcome;
      }
      score = String(score).replace(/:/g, '-').replace(/：/g, '-').trim();
      if (!score || score === '-:-' || score === '-') return;

      scores[matchNum] = {
        score: score,
        halfScore: '',
        source: 'sporttery',
        confidence: 1.0,
      };
    } catch (e) { /* skip */ }
  });
  return scores;
}

/**
 * 多源校正入口
 * @param {string} dateStr  '2026-06-15'
 * @param {object} currentMap  data.m
 * @returns {object} { date, corrected, corrections, sourceCounts }
 */
async function correctDate(dateStr, currentMap) {
  if (!dateStr) {
    try { dateStr = require('./datetime').todayCN(); } catch (e) {}
    if (!dateStr) dateStr = new Date().toISOString().slice(0, 10);
  }

  var corrections = {};

  if (!currentMap) {
    try { currentMap = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).m || {}; } catch (e) {}
  }

  // 方法1: 按 matchId 精确查 sporttery 文件
  var matchedByFile = 0;
  Object.keys(currentMap).forEach(function (rk) {
    var m = currentMap[rk];
    if (!m || !m.num || m.date.slice(0, 10) !== dateStr) return;
    if (m.matchStatus < 2) return;

    var num = m.num;
    var currentScore = String(m.score || '').replace(/:/g, '-');
    var currentHalf = String(m.halfScore || '').replace(/:/g, '-');

    // 尝试按 matchId 查
    var spResult = getSportteryScoreByMatchId(m.matchId);
    var bestScore = spResult ? spResult.score : '';
    var bestSource = spResult ? 'sporttery' : '';

    // 若 matchId 未命中，尝试按 num 查扫描结果
    if (!bestScore) {
      // 扫描在此日期收集的 sporttery 分数
      var allSp = getSportteryScores(dateStr);
      if (allSp[num]) {
        bestScore = allSp[num].score;
        bestSource = 'sporttery';
      }
    }

    if (bestScore) matchedByFile++;

    if (bestScore && bestScore !== currentScore && bestScore !== '-') {
      var suspectHalftime = currentHalf === currentScore && currentScore !== '0-0';

      corrections[num] = {
        matchKey: rk,
        matchId: m.matchId,
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        oldScore: currentScore,
        newScore: bestScore,
        source: bestSource,
        suspectHalftime: suspectHalftime,
      };
    }
  });

  return {
    date: dateStr,
    corrected: Object.keys(corrections).length,
    corrections: corrections,
    sourceCounts: {
      sporttery: matchedByFile,
      total: Object.keys(currentMap).filter(function (k) {
        var m = currentMap[k];
        return m && m.date && m.date.slice(0, 10) === dateStr && m.matchStatus >= 2;
      }).length,
    },
  };
}

/**
 * 应用修正到 data.json 和 matches 表
 */
function applyCorrections(correctionResult) {
  if (!correctionResult || !correctionResult.corrected) return 0;

  var data = {};
  try { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  if (!data.m) data.m = {};

  var applied = 0;
  Object.keys(correctionResult.corrections).forEach(function (num) {
    var cr = correctionResult.corrections[num];
    var m = data.m[cr.matchKey];
    if (!m) return;
    if (m.score === cr.newScore.replace(/-/g, ':')) return;

    m.score = cr.newScore;
    applied++;
    console.log('[corrector] ' + num + ' ' + cr.homeName + ' ' + cr.oldScore + ' → ' + cr.newScore + ' [' + cr.source + (cr.suspectHalftime ? ' 半场误判]' : ']'));
  });

  if (applied > 0) {
    var tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    fs.renameSync(tmpFile, DATA_FILE);
    console.log('[corrector] data.json 已更新: ' + applied + ' 场');

    // Sync to matches table
    try {
      var db = require('../database');
      var adp = db.getAdapter();
      if (adp) {
        var dbCnt = 0;
        Object.keys(correctionResult.corrections).forEach(function (num) {
          var cr = correctionResult.corrections[num];
          adp.execRun(
            'UPDATE matches SET score=?, halfScore=? WHERE num=? AND date=?',
            cr.newScore, cr.suspectHalftime ? '' : (data.m[cr.matchKey] ? (data.m[cr.matchKey].halfScore || '') : ''),
            num, correctionResult.date,
          );
          dbCnt++;
        });
        db.flushCriticalWrites(adp);
        console.log('[corrector] matches 表已同步: ' + dbCnt + ' 场');
      }
    } catch (e) {
      console.error('[corrector] matches 表同步失败: ' + e.message);
    }
  }

  return applied;
}

module.exports = { getSportteryScores, getSportteryScoreByMatchId, correctDate, applyCorrections };
