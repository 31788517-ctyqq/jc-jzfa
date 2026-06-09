/**
 * 抓取 500.com 专家"冷析先生"(eid=7425) 推荐数据
 *
 * API: POST /transpondsanyol/api/meweb/expert/expert_history_articles
 * 参数: commresource={"channel":"mesport","platform":"pc"}&eid=7425&pn={page}&rn=20
 *
 * 策略: 纯 API 分页，遍历所有历史页直到日期 < 2026-01-01
 *
 * 输出: server/expert_7425_recommendations.json
 * 用法: node scripts/scrape_expert_7425.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  EID: 7425,
  HOST: 'dstd.500.com',
  PAGE_SIZE: 20,
  SINCE: new Date('2026-01-01T00:00:00+08:00'),
  OUTPUT: path.join(__dirname, '..', 'server', 'expert_7425_recommendations.json'),
  DELAY_MIN: 800,
  DELAY_MAX: 2000,
};

const agent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

// ─── HTTP 工具 ────────────────────────────────────────
function httpPost(host, path, body, referer) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: host,
        path,
        agent,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          Accept: 'application/json',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: referer || `https://${host}/zhuanjia/${CONFIG.EID}`,
          Origin: `https://${host}`,
        },
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}

// ─── 抓取一页历史数据 ─────────────────────────────────
async function fetchHistoryPage(pageNum) {
  const commresource = encodeURIComponent(JSON.stringify({ channel: 'mesport', platform: 'pc' }));
  const body = `commresource=${commresource}&eid=${CONFIG.EID}&pn=${pageNum}&rn=${CONFIG.PAGE_SIZE}&articletype=`;

  const text = await httpPost(CONFIG.HOST, '/transpondsanyol/api/meweb/expert/expert_history_articles', body);

  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { error: `JSON parse failed: ${e.message}`, articles: [] };
  }

  if (json.status !== '100') {
    return { error: `status=${json.status} msg=${json.message}`, articles: [] };
  }

  return { articles: json.data && json.data.articles ? json.data.articles : [] };
}

// ─── 解析单篇文章 → 推荐记录 ──────────────────────────
function parseArticle(raw) {
  // 解析 resultcontent JSON
  let rc = null;
  if (raw.resultcontent) {
    try {
      rc = typeof raw.resultcontent === 'string' ? JSON.parse(raw.resultcontent) : raw.resultcontent;
    } catch (e) {}
  }

  const proinfo = (rc && rc.proinfo) || [];
  const gamedetail = raw.gamedetail || [];

  // 构建每条推荐的详细信息
  const recommendations = [];
  if (proinfo.length > 0) {
    for (const m of proinfo) {
      const gd = gamedetail.find((g) => g.gameid === m.gameid || g.matchnum === m.matchnum);
      recommendations.push({
        matchnum: m.matchnum || '',
        home: m.home || (gd ? gd.home : ''),
        away: m.away || (gd ? gd.away : ''),
        league: m.ls || (gd ? gd.ls : ''),
        stime: m.stime || (gd ? gd.stime : ''),
        direction: fmtDirection(m),
        choice: m.choice || '',
        odds: m.pei || '',
        handicap: m.rangqiu || '',
        halfscore: m.halfscore || '',
        score: m.score || '',
        hit: m.result === 1 ? '✓ 命中' : m.result === 0 ? '✗ 错误' : '',
      });
    }
  } else if (gamedetail.length > 0) {
    // 无 proinfo（可能未开奖），仅有比赛列表
    for (const gd of gamedetail) {
      recommendations.push({
        matchnum: gd.matchnum || '',
        home: gd.home || '',
        away: gd.away || '',
        league: gd.ls || '',
        stime: gd.stime || '',
        direction: '未揭晓',
        choice: '',
        odds: '',
        handicap: '',
        score: '',
        hit: '',
      });
    }
  }

  // 整体命中状态
  let overallResult = '待揭晓';
  if (proinfo.length > 0) {
    const hitCount = proinfo.filter((m) => m.result === 1).length;
    const total = proinfo.length;
    if (raw.result === '2') overallResult = `✓ 命中(${hitCount}/${total})`;
    else if (raw.result === '0') overallResult = `✗ 错误(${hitCount}/${total})`;
  }

  return {
    aid: raw.aid,
    nickname: raw.nickname || '冷析先生',
    publishtime: raw.publishtime,
    ggtype: raw.ggtype || '',
    ggtypename: raw.ggtypename || '',
    title: raw.title || '',
    game: raw.game || '',
    paymoney: raw.paymoney || '',
    hits: raw.hits || 0,
    result: overallResult,
    recommendation_count: recommendations.length,
    recommendations: recommendations,
  };
}

function fmtDirection(m) {
  const dirMap = { 3: '主胜', 1: '平局', 0: '客胜' };
  const choice = m.choice || '';
  let dir = dirMap[choice] || choice;
  if (m.rangqiu && m.rangqiu !== '') {
    const rq = parseInt(m.rangqiu) || 0;
    const sign = rq >= 0 ? '+' : '';
    dir += `(让球${sign}${rq})`;
  }
  if (m.tinfo) dir += ` [${m.tinfo}]`;
  return dir;
}

// ─── 主流程 ───────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  冷析先生(eid=7425) 推荐数据抓取            ║');
  console.log('║  时间范围: 2026-01-01 ～ 至今                ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  const allArticles = [];
  const seenAids = new Set();

  let pageNum = 1;
  let consecutiveEmpty = 0;
  const MAX_PAGE = 50;

  while (pageNum <= MAX_PAGE) {
    await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));

    const result = await fetchHistoryPage(pageNum);

    if (result.error) {
      console.log(`  第 ${pageNum} 页: ${result.error}`);
      pageNum++;
      continue;
    }

    const { articles } = result;

    if (articles.length === 0) {
      consecutiveEmpty++;
      console.log(`  第 ${pageNum} 页: 空 (${consecutiveEmpty} 连空)`);
      if (consecutiveEmpty >= 3) break;
      pageNum++;
      continue;
    }

    consecutiveEmpty = 0;
    let newCount = 0;
    let earliest = '';

    for (const raw of articles) {
      if (raw.aid && !seenAids.has(raw.aid)) {
        seenAids.add(raw.aid);
        allArticles.push(parseArticle(raw));
        newCount++;
      }
      if (!earliest || raw.publishtime < earliest) earliest = raw.publishtime;
    }

    console.log(`  第 ${pageNum} 页: ${articles.length} 条 (新增 ${newCount}), 最早 ${earliest}`);

    // 检查是否已越过 2026-01-01
    const last = articles[articles.length - 1];
    if (last && last.publishtime) {
      const d = new Date(last.publishtime.replace(' ', 'T') + '+08:00');
      if (d < CONFIG.SINCE) {
        console.log(`  → 已越过 2026-01-01 (${last.publishtime})，停止`);
        break;
      }
    }

    pageNum++;
  }

  // ── 过滤 2026-01-01 之后 ──
  const filtered = allArticles.filter((a) => {
    if (!a.publishtime) return true;
    return new Date(a.publishtime.replace(' ', 'T') + '+08:00') >= CONFIG.SINCE;
  });

  // 按时间降序
  filtered.sort((a, b) => (b.publishtime || '').localeCompare(a.publishtime || ''));

  // ── 统计 ────────────────────────────────────────────
  const totalRecs = filtered.reduce((s, a) => s + a.recommendation_count, 0);
  const hitArts = filtered.filter((a) => a.result.startsWith('✓'));
  const missArts = filtered.filter((a) => a.result.startsWith('✗'));
  const pending = filtered.filter((a) => a.result === '待揭晓');

  console.log('\n══════ 统计 ══════');
  console.log(`  方案数: ${filtered.length}`);
  console.log(`  场次数: ${totalRecs}`);
  console.log(`  命中: ${hitArts.length}  |  错误: ${missArts.length}  |  待揭晓: ${pending.length}`);
  const hitRate =
    hitArts.length + missArts.length > 0
      ? ((hitArts.length / (hitArts.length + missArts.length)) * 100).toFixed(1)
      : 'N/A';
  console.log(`  命中率: ${hitRate}% (排除待揭晓)`);
  if (filtered.length > 0) {
    console.log(`  时间: ${filtered[filtered.length - 1].publishtime} ~ ${filtered[0].publishtime}`);
  }

  // ── 保存 ────────────────────────────────────────────
  const output = {
    expert: { eid: CONFIG.EID, nickname: '冷析先生' },
    generated_at: new Date().toISOString(),
    since: '2026-01-01',
    summary: {
      total_articles: filtered.length,
      total_recommendations: totalRecs,
      hit_count: hitArts.length,
      miss_count: missArts.length,
      pending_count: pending.length,
      hit_rate: hitRate,
      date_range:
        filtered.length > 0 ? `${filtered[filtered.length - 1].publishtime} ~ ${filtered[0].publishtime}` : 'N/A',
      elapsed_seconds: ((Date.now() - startTime) / 1000).toFixed(1),
    },
    articles: filtered,
  };

  fs.writeFileSync(CONFIG.OUTPUT, JSON.stringify(output, null, 2), 'utf-8');
  const sizeKb = (fs.statSync(CONFIG.OUTPUT).size / 1024).toFixed(1);
  console.log(`\n✅ 已保存: ${CONFIG.OUTPUT} (${sizeKb} KB, 耗时 ${output.summary.elapsed_seconds}s)`);
}

main().catch((err) => {
  console.error('❌ 失败:', err.message);
  process.exit(1);
});
