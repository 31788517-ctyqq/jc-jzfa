/**
 * server/fetch_shuju.js — Node.js 版 500.com 分析数据抓取 (P1: 替代 Python)
 *
 * 功能:
 *   1. 读取 shuju_map_{date}.json 获取 shuju ID 列表
 *   2. 抓取每个 odds.500.com/fenxi/shuju-{id}.shtml 页面 (GBK)
 *   3. 提取队名、联赛名等基础信息
 *   4. 写入 shuju_data/shuju_{date}.json (不依赖 Python)
 *
 * 用法:
 *   const { fetchShujuData } = require('./fetch_shuju');
 *   await fetchShujuData('2026-05-30');
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const SHUJU_DIR = path.join(__dirname, 'shuju_data');

// UA 池
const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
];

function randomUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function jitter(base) {
  return Math.floor(base * (0.5 + Math.random() * 1.5));
}

/**
 * 抓取单个分析页面
 */
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': randomUA(),
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        timeout: 20000,
        rejectUnauthorized: false,
      },
      (res) => {
        if (res.statusCode >= 400) {
          req.destroy();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const html = iconv.decode(Buffer.concat(chunks), 'gbk');
            resolve(html);
          } catch (e) {
            reject(new Error('decode: ' + e.message));
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

/**
 * 解析分析页面 HTML，提取基础信息
 */
function parseAnalysisPage(html, matchNum, shujuId) {
  // 提取 title 中的队名 (格式: "主队 vs 客队")
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  let homeTeam = '',
    awayTeam = '';

  if (titleMatch) {
    const title = titleMatch[1].replace(/[_\-\s]*500.*$/, '').trim();
    const vsIdx = title.search(/\s*(?:vs|VS|Vs|vS|对\s*阵|对\s*战)\s*/);
    if (vsIdx > 0) {
      homeTeam = title.substring(0, vsIdx).trim();
      awayTeam = title.substring(vsIdx + title.substring(vsIdx).search(/\S/)).trim();
      // 清理后缀标记
      awayTeam = awayTeam.split(/\s+/)[0];
    } else if (title.includes(' vs ')) {
      const parts = title.split(' vs ');
      homeTeam = parts[0].trim();
      awayTeam = (parts[1] || '').trim();
    }
  }

  // 提取联赛名 (从 title 或 breadcrumb)
  let leagueName = '';
  const leagueMatch = html.match(/<a[^>]*href="\/zuqiu-\d+\/[^"]*"[^>]*>([^<]+)<\/a>/);
  if (!leagueMatch) {
    const leagueMatch2 = html.match(/联赛[：:]\s*(\S+)/);
    if (leagueMatch2) leagueName = leagueMatch2[1];
  } else {
    leagueName = leagueMatch[1].trim();
  }

  // ★ 解析近10场战绩 (4个实例: 主全联赛/客全联赛/主同赛事/客同赛事)
  const rec10Pattern =
    /([\u4e00-\u9fa5a-zA-Z]+)\s*近10场战绩\s*(\d+)\s*胜\s*(\d+)\s*平\s*(\d+)\s*负\s*进\s*(\d+)\s*球\s*失\s*(\d+)\s*球/g;
  let rec10match;
  const rec10Results = [];
  while ((rec10match = rec10Pattern.exec(html)) !== null) {
    rec10Results.push({
      team: rec10match[1].trim(),
      wins: parseInt(rec10match[2]) || 0,
      draws: parseInt(rec10match[3]) || 0,
      losses: parseInt(rec10match[4]) || 0,
      goals: parseInt(rec10match[5]) || 0,
      conceded: parseInt(rec10match[6]) || 0,
    });
  }

  // Map 4 instances → homeAll, awayAll, homeLeague, awayLeague
  const stats = { homeAll: {}, awayAll: {}, homeLeague: {}, awayLeague: {} };
  const statKeys = ['homeAll', 'awayAll', 'homeLeague', 'awayLeague'];
  rec10Results.forEach(function (r, idx) {
    if (idx < 4) stats[statKeys[idx]] = r;
  });

  // ★ 解析交锋数据 (H2H)
  const h2hPattern = /近\s*(\d+)\s*场交战[^<]*主队\s*(\d+)\s*胜[^<]*平\s*(\d+)[^<]*客队\s*(\d+)\s*胜/;
  const h2hMatch = html.match(h2hPattern);
  let h2h = null;
  if (h2hMatch) {
    h2h = {
      matches: parseInt(h2hMatch[1]) || 0,
      homeWins: parseInt(h2hMatch[2]) || 0,
      draws: parseInt(h2hMatch[3]) || 0,
      awayWins: parseInt(h2hMatch[4]) || 0,
    };
  }

  // ★ 解析胜率/赢盘率/大球率
  const ratePattern = /胜率[：:]?\s*([\d.]+)%[^<]*赢盘率[：:]?\s*([\d.]+)%[^<]*大球率[：:]?\s*([\d.]+)%/g;
  const rates = [];
  let rateMatch;
  while ((rateMatch = ratePattern.exec(html)) !== null) {
    rates.push({
      winRate: parseFloat(rateMatch[1]) || 0,
      coverRate: parseFloat(rateMatch[2]) || 0,
      overRate: parseFloat(rateMatch[3]) || 0,
    });
  }
  if (rates.length > 0 && stats.homeAll.wins !== undefined) {
    stats.homeAll.winRate = rates[0] ? rates[0].winRate : null;
  }
  if (rates.length > 1 && stats.awayAll.wins !== undefined) {
    stats.awayAll.winRate = rates[1] ? rates[1].winRate : null;
  }

  return {
    shujuId: shujuId,
    matchNum: matchNum,
    homeTeam: homeTeam,
    awayTeam: awayTeam,
    leagueName: leagueName,
    htmlSize: html.length,
    stats: {
      homeAll: stats.homeAll,
      awayAll: stats.awayAll,
      homeLeague: stats.homeLeague,
      awayLeague: stats.awayLeague,
      h2h: h2h,
    },
    _fetched: true,
  };
}

/**
 * 主函数: 为指定日期抓取所有比赛的 shuju 数据
 */
async function fetchShujuData(dateStr, maxRetries) {
  maxRetries = maxRetries || 2;

  const mapFile = path.join(__dirname, 'shuju_map_' + dateStr + '.json');
  if (!fs.existsSync(mapFile)) {
    console.log('[fetch_shuju] ' + dateStr + ' shuju_map 不存在，跳过');
    return null;
  }

  let shujuMap;
  try {
    shujuMap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  } catch (e) {
    console.log('[fetch_shuju] ' + dateStr + ' shuju_map 读取失败');
    return null;
  }

  // 检查是否已有数据且完整
  const outFile = path.join(SHUJU_DIR, 'shuju_' + dateStr + '.json');
  if (fs.existsSync(outFile) && fs.statSync(outFile).size > 500) {
    try {
      const existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      if (existing.matches && Object.keys(existing.matches).length >= Object.keys(shujuMap).length * 0.5) {
        console.log('[fetch_shuju] ' + dateStr + ' 已有 ' + Object.keys(existing.matches).length + ' 场比赛数据，跳过');
        return existing;
      }
    } catch (e) {}
  }

  const entries = Object.entries(shujuMap).filter(([k, v]) => v && v.shujuId);
  if (entries.length === 0) {
    console.log('[fetch_shuju] ' + dateStr + ' 无有效 shuju ID');
    return null;
  }

  console.log('[fetch_shuju] ' + dateStr + ' 开始抓取 ' + entries.length + ' 场比赛分析数据...');

  const results = {};
  let ok = 0,
    fail = 0;

  for (let i = 0; i < entries.length; i++) {
    const [matchNum, info] = entries[i];
    const sid = info.shujuId;
    const url =
      info.url && info.url.includes('500.com') ? info.url : 'https://odds.500.com/fenxi/shuju-' + sid + '.shtml';

    let success = false;
    for (let retry = 0; retry <= maxRetries && !success; retry++) {
      try {
        const html = await fetchPage(url);
        if (html && html.length > 500) {
          results[matchNum] = parseAnalysisPage(html, matchNum, sid);
          ok++;
          success = true;
        }
      } catch (e) {
        if (retry < maxRetries) {
          await sleep(jitter(2000));
        }
      }
    }

    if (!success) {
      results[matchNum] = { shujuId: sid, matchNum: matchNum, _error: true };
      fail++;
    }

    if ((i + 1) % 5 === 0 || i + 1 === entries.length) {
      console.log(
        '[fetch_shuju] ' + dateStr + ' 进度: ' + (i + 1) + '/' + entries.length + ' (ok=' + ok + ' fail=' + fail + ')',
      );
    }

    if ((i + 1) % 3 === 0) {
      await sleep(jitter(500));
    }
  }

  // 保存
  if (!fs.existsSync(SHUJU_DIR)) fs.mkdirSync(SHUJU_DIR, { recursive: true });

  const output = {
    date: dateStr,
    source: '500.com fenxi/shuju (Node.js fetcher)',
    matches: results,
    _meta: { total: entries.length, ok: ok, fail: fail, generatedAt: new Date().toISOString() },
  };

  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  const outSize = fs.statSync(outFile).size;
  console.log('[fetch_shuju] ' + dateStr + ' 完成: ' + ok + '/' + entries.length + ' (' + outSize + 'B)');

  return output;
}

module.exports = { fetchShujuData, fetchPage, parseAnalysisPage };
