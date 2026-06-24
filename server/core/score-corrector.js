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

const fs = require('fs');
const path = require('path');

const ODDS_DIR = path.join(__dirname, '..', 'sporttery_odds');
const DATA_FILE = path.join(__dirname, '..', 'data.json');

/**
 * 从 sporttery odds 文件提取指定 matchId 的赛果
 */
function getSportteryScoreByMatchId(matchId) {
  if (!matchId) return null;
  const fPath = path.join(ODDS_DIR, String(matchId) + '.json');
  if (!fs.existsSync(fPath)) return null;

  try {
    const d = JSON.parse(fs.readFileSync(fPath, 'utf8'));

    // lotteryResult.比分 最权威（开奖结果）
    let score = d.score || '';
    if (d.lotteryResult && d.lotteryResult['比分'] && d.lotteryResult['比分'].outcome) {
      score = d.lotteryResult['比分'].outcome;
    }
    score = String(score).replace(/:/g, '-').replace(/：/g, '-').trim();
    if (!score || score === '-:-' || score === '-') return null;

    return {
      score: score,
      halfScore: '', // sporttery 不提供半场
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
  const scores = {};
  if (!fs.existsSync(ODDS_DIR)) return scores;

  const files = fs.readdirSync(ODDS_DIR).filter(function (f) {
    return f.endsWith('.json');
  });

  // 策略1: 每个比赛按 matchId 精确查找
  // 通过 data.json 中的 matchId 定位具体文件

  // 策略2: 扫目录找包含 target date 的文件
  // matchInfo 格式: "2023/2024 常规赛 第19轮 2024-01-06 19:30"
  // 但 2026 的格式可能是 "2026/2027 season"
  // 用更灵活的匹配
  const dateParts = dateStr.split('-'); // ['2026','06','15']
  const y = dateParts[0],
    m = dateParts[1],
    d = dateParts[2];
  const patterns = [
    dateStr, // "2026-06-15"
    y + '/' + dateParts[1] + '/' + dateParts[2], // "2026/06/15"
    y + '-' + m + '-' + d, // "2026-06-15"
  ];

  files.forEach(function (f) {
    try {
      const content = fs.readFileSync(path.join(ODDS_DIR, f), 'utf8');
      let matched = false;
      for (let pi = 0; pi < patterns.length; pi++) {
        if (content.indexOf(patterns[pi]) >= 0) {
          matched = true;
          break;
        }
      }
      if (!matched) return;

      const d = JSON.parse(content);
      const num = String(d.matchNum || '');
      const numM = num.match(/(周[一二三四五六日]\d{3})/);
      if (!numM) return;

      const matchNum = numM[1];
      let score = d.score || '';
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
    } catch (e) {
      /* skip */
    }
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
    try {
      dateStr = require('./datetime').todayCN();
    } catch (e) {}
    if (!dateStr) dateStr = new Date().toISOString().slice(0, 10);
  }

  const corrections = {};

  if (!currentMap) {
    try {
      currentMap = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')).m || {};
    } catch (e) {}
  }

  // 方法1: 按 matchId 精确查 sporttery 文件
  let matchedByFile = 0;
  Object.keys(currentMap).forEach(function (rk) {
    const m = currentMap[rk];
    if (!m || !m.num || m.date.slice(0, 10) !== dateStr) return;
    if (m.matchStatus < 2) return;

    const num = m.num;
    const currentScore = String(m.score || '').replace(/:/g, '-');
    const currentHalf = String(m.halfScore || '').replace(/:/g, '-');

    // 尝试按 matchId 查
    const spResult = getSportteryScoreByMatchId(m.matchId);
    let bestScore = spResult ? spResult.score : '';
    let bestSource = spResult ? 'sporttery' : '';

    // 若 matchId 未命中，尝试按 num 查扫描结果
    if (!bestScore) {
      // 扫描在此日期收集的 sporttery 分数
      const allSp = getSportteryScores(dateStr);
      if (allSp[num]) {
        bestScore = allSp[num].score;
        bestSource = 'sporttery';
      }
    }

    if (bestScore) matchedByFile++;

    if (bestScore && bestScore !== currentScore && bestScore !== '-') {
      const suspectHalftime = currentHalf === currentScore && currentScore !== '0-0';

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

  // ★ L2 fallback: sporttery 无文件时，用 detail.php 获取终场比分
  // 对已完赛但 sporttery 未覆盖的比赛，调用 sync_live_500.fetchDetailScore
  if (matchedByFile === 0) {
    try {
      const syncLive500 = require('../sync_live_500');
      const { fetchDetailScore, parse500Live } = syncLive500;
      const https = require('https');
      const iconv = require('iconv-lite');

      // ★ 辅助：从 500.com live 页面获取 fid 映射（date+num → fid）
      function fetchLiveHtml(date) {
        return new Promise((resolve) => {
          https
            .get(
              'https://live.500.com/?e=' + date,
              {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                rejectUnauthorized: false,
                timeout: 15000,
              },
              (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                  try {
                    resolve(iconv.decode(Buffer.concat(chunks), 'gbk'));
                  } catch (e) {
                    resolve('');
                  }
                });
              },
            )
            .on('error', () => resolve(''));
        });
      }

      const matchesNeedingFix = [];
      Object.keys(currentMap).forEach(function (rk) {
        const m = currentMap[rk];
        if (!m || !m.num || m.date.slice(0, 10) !== dateStr) return;
        if (m.matchStatus < 2) return;
        const currentScore = String(m.score || '').replace(/:/g, '-');
        const currentHalf = String(m.halfScore || '').replace(/:/g, '-');
        // 触发条件：halfScore 为空 或 score===halfScore（非 0-0）
        const needFix = !currentHalf || (currentHalf && currentScore === currentHalf && currentScore !== '0-0');
        if (needFix) {
          matchesNeedingFix.push({ key: rk, match: m });
        }
      });

      if (matchesNeedingFix.length > 0) {
        console.log('[corrector] sporttery 无数据，尝试 detail.php 对 ' + matchesNeedingFix.length + ' 场...');

        // ★ 获取 fid 映射（从 500.com live 页面）
        const fidMap = {};
        const liveHtml = await fetchLiveHtml(dateStr);
        if (liveHtml) {
          const liveMatches = parse500Live(liveHtml, dateStr);
          liveMatches.forEach(function (lm) {
            // parse500Live 返回字段名是 matchNum（不是 num）
            const lmNum = lm.num || lm.matchNum || '';
            if (lmNum && lm.fid) {
              fidMap[lmNum] = lm.fid;
            }
          });
          console.log('[corrector] 从 500.com live 获取 ' + Object.keys(fidMap).length + ' 个 fid 映射');
        }

        // 并发数 2，避免限流
        for (let i = 0; i < matchesNeedingFix.length; i += 2) {
          const batch = matchesNeedingFix.slice(i, i + 2);
          const results = await Promise.all(
            batch.map(function (item) {
              // ★ 优先用 data.json 中的 fid，没有则用 fidMap
              const fid = item.match.fid || fidMap[item.match.num] || '';
              if (!fid) return Promise.resolve({ item: item, result: null });
              return fetchDetailScore(fid).then(function (r) {
                return { item: item, result: r };
              });
            }),
          );
          results.forEach(function (r) {
            if (r.result && r.result.score) {
              const m = r.item.match;
              const currentScore = String(m.score || '').replace(/:/g, '-');
              if (r.result.score !== currentScore) {
                corrections[m.num] = {
                  matchKey: r.item.key,
                  matchId: m.matchId,
                  homeName: m.homeName || '',
                  visitName: m.visitName || '',
                  oldScore: currentScore,
                  newScore: r.result.score,
                  source: 'detail.php',
                  suspectHalftime: true,
                };
              }
            }
          });
        }
      }
    } catch (e) {
      console.error('[corrector] detail.php fallback 异常: ' + e.message);
    }
  }

  return {
    date: dateStr,
    corrected: Object.keys(corrections).length,
    corrections: corrections,
    sourceCounts: {
      sporttery: matchedByFile,
      detailphp: Object.keys(corrections).filter(function (k) {
        return corrections[k].source === 'detail.php';
      }).length,
      total: Object.keys(currentMap).filter(function (k) {
        const m = currentMap[k];
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

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  if (!data.m) data.m = {};

  let applied = 0;
  Object.keys(correctionResult.corrections).forEach(function (num) {
    const cr = correctionResult.corrections[num];
    const m = data.m[cr.matchKey];
    if (!m) return;
    if (m.score === cr.newScore.replace(/-/g, ':')) return;

    m.score = cr.newScore;
    applied++;
    console.log(
      '[corrector] ' +
        num +
        ' ' +
        cr.homeName +
        ' ' +
        cr.oldScore +
        ' → ' +
        cr.newScore +
        ' [' +
        cr.source +
        (cr.suspectHalftime ? ' 半场误判]' : ']'),
    );
  });

  if (applied > 0) {
    const tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    fs.renameSync(tmpFile, DATA_FILE);
    console.log('[corrector] data.json 已更新: ' + applied + ' 场');

    // Sync to matches table
    try {
      const db = require('../database');
      const adp = db.getAdapter();
      if (adp) {
        let dbCnt = 0;
        Object.keys(correctionResult.corrections).forEach(function (num) {
          const cr = correctionResult.corrections[num];
          adp.execRun(
            'UPDATE matches SET score=?, halfScore=? WHERE num=? AND date=?',
            cr.newScore,
            cr.suspectHalftime ? '' : data.m[cr.matchKey] ? data.m[cr.matchKey].halfScore || '' : '',
            num,
            correctionResult.date,
          );
          dbCnt++;
        });
        if (adp && typeof adp.markDirty === 'function') adp.markDirty();
        console.log('[corrector] matches 表已同步: ' + dbCnt + ' 场');
      }
    } catch (e) {
      console.error('[corrector] matches 表同步失败: ' + e.message);
    }
  }

  return applied;
}

module.exports = { getSportteryScores, getSportteryScoreByMatchId, correctDate, applyCorrections };
