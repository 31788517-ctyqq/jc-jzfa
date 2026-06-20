/**
 * ═══ 500.com 详情页比分回填 ═══
 * P0-B: 对 2026-03 起被污染的比分，用 500.com detail.php 回填正确全场比分
 *
 * 用法:
 *   node scripts/backfill_500_scores.js --date 2026-06-17        # 单日回填
 *   node scripts/backfill_500_scores.js --from 2026-03-20          # 从指定日期开始全量回填
 *   node scripts/backfill_500_scores.js --dry-run                  # 只检查不写入
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const LIVE_URL = 'https://live.500.com/?e=';
const DETAIL_URL = 'https://live.500.com/detail.php?fid=';

const AGENT = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const DELAY = 500; // 请求间隔 ms
const CONCURRENCY = 2;

// ── 工具 ──
function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function log(msg) { console.log('[' + now() + '] ' + msg); }

function get(url, encoding) {
  return new Promise(function(resolve, reject) {
    var req = https.get(url, { agent: AGENT, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'zh-CN', Referer: 'https://live.500.com/' }, timeout: 10000 }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var buf = Buffer.concat(chunks);
        var html = encoding === 'gbk' ? iconv.decode(buf, 'gbk') : buf.toString('utf8');
        resolve(html);
      });
    });
    req.on('error', function(e) { reject(e); });
    req.end();
  });
}

function getDetailScore(fid) {
  if (!fid) return Promise.resolve(null);
  var url = DETAIL_URL + fid;
  return get(url, 'gbk').then(function(html) {
    var m = html.match(/<span class="score"[^>]*>\s*(\d+)\s*[-:：]\s*(\d+)\s*<\/span>/);
    if (m) return { score: m[1] + '-' + m[2], home: parseInt(m[1]), away: parseInt(m[2]) };
    return null;
  }).catch(function() { return null; });
}

// ── 解析 live.500.com 页面，提取 fid 映射 ──
function parseLivePage(html) {
  var map = {}; // matchNum -> { fid, homeName, visitName, score, halfScore }
  var trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  var trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    var trContent = trMatch[1];

    // 提取场次编号 (第0列)
    var col0m = trContent.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
    if (!col0m) continue;
    var col0 = col0m[1].replace(/<[^>]+>/g, '').trim();
    if (!/^周[一二三四五六日]\d{3}$/.test(col0)) continue;

    var matchNum = col0;

    // 提取 fid
    var fid = '';
    var fidMatch = trContent.match(/detail\.php\?fid=(\d+)/);
    if (fidMatch) fid = fidMatch[1];

    // 提取比分 (可能含半场)
    var scoreRaw = '';
    var halfScoreRaw = '';
    var scoreSpan = trContent.match(/<span class="score"[^>]*>([^<]*)<\/span>/);
    if (scoreSpan) scoreRaw = scoreSpan[1].trim();
    // 若有 score2 (半场)
    var score2Span = trContent.match(/<span class="score2"[^>]*>([^<]*)<\/span>/);
    if (score2Span) halfScoreRaw = score2Span[1].replace(/半场\s*[:：]?/, '').trim();

    map[matchNum] = {
      fid: fid,
      score: scoreRaw || '',
      halfScore: halfScoreRaw || '',
    };
  }
  return map;
}

// ── 主流程 ──
async function backfillDate(dateStr, options) {
  options = options || {};
  var dryRun = options.dryRun || false;

  log('Processing: ' + dateStr);

  // 1. 读取 data.json
  var data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    log('ERROR reading data.json: ' + e.message);
    return { date: dateStr, updated: 0, error: e.message };
  }
  var mMap = data.m || {};

  // 2. 找到该日期所有完赛且缺比分的比赛
  var needBackfill = [];
  Object.keys(mMap).forEach(function(k) {
    var m = mMap[k];
    if (!m || !m.num) return;
    if (String(m.date || '').slice(0, 10) !== dateStr) return;
    if (m.matchStatus < 2) return;
    if (m.score && m.score.trim() && m.score !== '-') return; // 已有比分

    needBackfill.push({ key: k, match: m });
  });

  if (needBackfill.length === 0) {
    log('  No matches need backfill');
    return { date: dateStr, updated: 0 };
  }

  log('  Matches to backfill: ' + needBackfill.length);

  // 3. 抓取 live.500.com 页面获取 fid 映射
  var liveUrl = LIVE_URL + dateStr;
  var liveHtml;
  try {
    liveHtml = await get(liveUrl, 'gbk');
  } catch (e) {
    log('  ERROR fetching live page: ' + e.message);
    return { date: dateStr, updated: 0, error: e.message };
  }

  var liveMap = parseLivePage(liveHtml);
  log('  Parsed ' + Object.keys(liveMap).length + ' matches from live page');

  // 4. 匹配 fid 并抓取详情页
  var pending = [];
  needBackfill.forEach(function(item) {
    var info = liveMap[item.match.num];
    if (info && info.fid) {
      pending.push({ key: item.key, match: item.match, fid: info.fid, liveScore: info.score });
    }
  });

  log('  Found fids for ' + pending.length + '/' + needBackfill.length + ' matches');

  // 5. 并发抓取详情页比分
  var updated = 0;
  for (var i = 0; i < pending.length; i += CONCURRENCY) {
    var batch = pending.slice(i, i + CONCURRENCY);
    var results = await Promise.all(batch.map(function(p) {
      return getDetailScore(p.fid).then(function(detail) { return { p: p, detail: detail }; });
    }));

    for (var j = 0; j < results.length; j++) {
      var r = results[j];
      var m = r.p.match;
      var liveScore = r.p.liveScore;

      if (r.detail && r.detail.score) {
        var newScore = r.detail.score.replace(/:/g, '-').replace(/：/g, '-');
        var oldScore = m.score || '(empty)';

        if (!dryRun) {
          m.score = newScore;
          m.homeScore = r.detail.home;
          m.visitScore = r.detail.away;
          m.scoreSource = '500detail'; // ★ P1: 标记来源，区分优先级
        }

        updated++;
        log('    ' + m.num + ' ' + (m.homeName || m.hometeam || '') + ' vs ' + (m.visitName || m.awayteam || '') +
          ': ' + oldScore + ' -> ' + newScore + (dryRun ? ' [DRY-RUN]' : ''));
      } else if (liveScore) {
        // 降级：使用 live 页面的比分（可能是半场！检查一下）
        var ls = liveScore.replace(/[:：]/g, '-').trim();
        var hasHalfMatch = ls.match(/(\d+).*?(\d+)/);
        if (hasHalfMatch && ls !== '-') {
          log('    ' + m.num + ' detail.php no score, fallback live: ' + ls + ' [CHECK]');
        }
      } else {
        log('    ' + m.num + ' NO score found (fid=' + r.p.fid + ')');
      }
    }

    if (i + CONCURRENCY < pending.length) await sleep(DELAY);
  }

  // 6. 保存
  if (!dryRun && updated > 0) {
    var tmpFile = DATA_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data));
    fs.renameSync(tmpFile, DATA_FILE);
    log('  Saved: ' + updated + ' scores updated in data.json');
  }

  return { date: dateStr, updated: updated, total: needBackfill.length };
}

// ── CLI ──
async function main() {
  var args = process.argv.slice(2);
  var dryRun = args.includes('--dry-run');
  var targetDate = null;
  var fromDate = null;

  var di = args.indexOf('--date');
  if (di >= 0) targetDate = args[di + 1];

  var fi = args.indexOf('--from');
  if (fi >= 0) fromDate = args[fi + 1];

  if (!targetDate && !fromDate) {
    targetDate = new Date().toISOString().slice(0, 10).replace(/-/g, '-'); // today
    log('Default: backfill today (' + targetDate + ')');
  }

  // Build date list
  var dates = [];
  if (targetDate) {
    dates = [targetDate];
  } else if (fromDate) {
    var d = new Date(fromDate);
    var today = new Date();
    while (d <= today) {
      var ds = d.toISOString().slice(0, 10);
      dates.push(ds);
      d.setDate(d.getDate() + 1);
    }
  }

  log('Mode: ' + (dryRun ? 'DRY-RUN' : 'WRITE'));
  log('Dates: ' + dates.length);

  var totalUpdated = 0;
  for (var i = 0; i < dates.length; i++) {
    try {
      var result = await backfillDate(dates[i], { dryRun: dryRun });
      totalUpdated += result.updated;
    } catch (e) {
      log('ERROR ' + dates[i] + ': ' + e.message);
    }
    if (i < dates.length - 1) await sleep(1000); // rate limit between dates
  }

  log('DONE: ' + totalUpdated + ' scores updated across ' + dates.length + ' dates');

  // Notify reload
  if (!dryRun && totalUpdated > 0) {
    try {
      require('child_process').execSync('pm2 sendSignal SIGUSR2 jc-zjfa', { timeout: 3000 });
    } catch (e) {}
  }
}

main().catch(function(e) { console.error(e); process.exit(1); });
