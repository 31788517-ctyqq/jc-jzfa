/**
 * ═══ 赛果多源校正器 (Score Corrector) ═══
 * V12: 三源交叉对账 + 自动修正半场误判
 *
 * 数据源（按优先级）:
 *   1. sporttery odds/*.json     — 官方赛果（最权威）
 *   2. trade.500.com/jczq/        — 500.com 结果页（赛果确认页）
 *   3. live.500.com/?e=           — 赛中实时（仅参考）
 *
 * 触发场景:
 *   - backfillResults 回填时
 *   - ingestion-guard 检测到半场=终场时
 *   - 手动触发: node -e "require('./core/score-corrector').correctDate('2026-06-15')"
 */

var fs = require('fs');
var path = require('path');
var https = require('https');
var iconv = require('iconv-lite');

var ODDS_DIR = path.join(__dirname, '..', 'sporttery_odds');
var DATA_FILE = path.join(__dirname, '..', 'data.json');

// ═══ HTTP GET (GBK) ═══
function httpGetGBK(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Referer: 'https://trade.500.com/',
      },
      timeout: 15000,
      rejectUnauthorized: false,
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve(iconv.decode(Buffer.concat(chunks), 'gbk'));
      });
    }).on('error', reject);
  });
}

// ═══ 1. sporttery odds 文件 → score map ═══
function getSportteryScores(dateStr) {
  var scores = {}; // { '周一013': { score, halfScore, source:'sporttery' } }
  if (!fs.existsSync(ODDS_DIR)) return scores;

  var files = fs.readdirSync(ODDS_DIR).filter(function (f) { return f.endsWith('.json'); });
  files.forEach(function (f) {
    try {
      var d = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf8'));
      var dt = String(d.matchInfo || '');
      if (!dt.includes(dateStr)) return;

      var num = String(d.matchNum || '');
      var m = num.match(/(周[一二三四五六日]\d{3})/);
      if (!m) return;

      var matchNum = m[1];
      var score = d.score || '';
      // lotteryResult 更权威（开奖结果）
      if (d.lotteryResult && d.lotteryResult['比分'] && d.lotteryResult['比分'].outcome) {
        score = d.lotteryResult['比分'].outcome;
      }
      score = String(score).replace(/:/g, '-').replace(/：/g, '-').trim();
      if (!score || score === '-:-') return;

      scores[matchNum] = {
        score: score,
        halfScore: '',  // sporttery 不提供半场
        source: 'sporttery',
        confidence: 1.0,
      };
    } catch (e) { /* skip broken files */ }
  });
  return scores;
}

// ═══ 2. trade.500.com/jczq/  → score map ═══
function parse500Results(html) {
  var scores = {}; // { '周一013': { score, halfScore, source:'500res' } }

  // 匹配结果行: <tr> ... <td>场次</td> <td>主队</td> <td>比分</td> <td>客队</td> ...
  // 典型格式: <td>周一013</td><td>西班牙</td><td>0:0</td><td>佛得角</td>
  var trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    var tr = trMatch[1];
    var tds = [];
    var tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    var tdMatch;
    while ((tdMatch = tdRegex.exec(tr)) !== null) {
      tds.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
    }

    // 找场次编号
    var numIdx = -1;
    for (var i = 0; i < tds.length; i++) {
      if (/^周[一二三四五六日]\d{3}$/.test(tds[i])) { numIdx = i; break; }
    }
    if (numIdx < 0) continue;

    var matchNum = tds[numIdx];

    // 找比分（含数字:数字格式）
    var scoreIdx = -1, scoreStr = '';
    for (var j = numIdx + 1; j < tds.length; j++) {
      if (/^\d+\s*[:：-]\s*\d+$/.test(tds[j])) {
        scoreIdx = j;
        scoreStr = tds[j].replace(/\s+/g, '').replace(/[:：]/, '-');
        break;
      }
    }
    if (!scoreStr) continue;

    scores[matchNum] = {
      score: scoreStr,
      halfScore: '',  // trade.500.com 结果页通常无半场
      source: '500results',
      confidence: 0.95,
    };
  }
  return scores;
}

async function get500Results(dateStr) {
  var url = 'https://trade.500.com/jczq/?date=' + dateStr;
  try {
    var html = await httpGetGBK(url);
    return parse500Results(html);
  } catch (e) {
    return {};
  }
}

// ═══ 3. 三源投票 → 修正结果 ═══
/**
 * @param {string} dateStr
 * @param {object} currentMap  当前 data.m 中的记录 { key: matchObject }
 * @returns {object} { corrections: { matchNum: { oldScore, newScore, source } }, corrected: number }
 */
async function correctDate(dateStr, currentMap) {
  if (!dateStr) dateStr = require('./datetime').todayCN();

  var corrections = {};
  var sportteryScores = getSportteryScores(dateStr);
  var res500Scores = {};
  try { res500Scores = await get500Results(dateStr); } catch (e) {}

  if (!currentMap) {
    try { currentMap = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).m || {}; } catch (e) {}
  }

  // 按比赛 num 遍历当前数据
  Object.keys(currentMap).forEach(function (rk) {
    var m = currentMap[rk];
    if (!m || !m.num || m.date.slice(0, 10) !== dateStr) return;
    if (m.matchStatus < 2) return;

    var num = m.num;
    var currentScore = String(m.score || '').replace(/:/g, '-');
    var currentHalf = String(m.halfScore || '').replace(/:/g, '-');

    // 投票：sporttery > 500results > 当前值
    var spScore = sportteryScores[num] ? sportteryScores[num].score : '';
    var r5Score = res500Scores[num] ? res500Scores[num].score : '';

    // 最佳得分：sporttery 优先，否则 500 results
    var bestScore = spScore || r5Score;
    var bestSource = spScore ? 'sporttery' : r5Score ? '500results' : '';

    if (bestScore && bestScore !== currentScore && bestScore !== '-') {
      // 疑似半场误判检测：当前比分=半场比分 != 最佳比分
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
      sporttery: Object.keys(sportteryScores).length,
      '500results': Object.keys(res500Scores).length,
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

module.exports = { getSportteryScores, get500Results, parse500Results, correctDate, applyCorrections };
