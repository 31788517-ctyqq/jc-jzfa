/**
 * 500.com 专家推荐数据 — 存储方案 & 批量抓取
 *
 * 数据流:
 *   1) 从 article_list API 发现专家 (含人气排名/eid)
 *   2) 筛选人气前200的专家
 *   3) 逐专家抓取 expert_history_articles → 入库
 *
 * API:
 *   专家发现: POST /transpondsanyol/api/meweb/article/article_list (pn, rn, articletype=0)
 *   历史推荐: POST /transpondsanyol/api/meweb/expert/expert_history_articles (eid, pn, rn)
 *
 * 输出:
 *   server/midou_data.db → expert_profiles + expert_recommendations 表
 *
 * 用法:
 *   # 第一步: 发现专家 (收集人气前200)
 *   node scripts/scrape_experts_batch.js --discover
 *
 *   # 第二步: 批量抓取历史推荐 (对已发现的专家)
 *   node scripts/scrape_experts_batch.js --scrape
 *
 *   # 全流程 (发现 + 抓取)
 *   node scripts/scrape_experts_batch.js --all
 *
 *   # 增量更新 (抓取新推荐)
 *   node scripts/scrape_experts_batch.js --update
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'dstd.500.com';
const AGENT = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

// ─── 配置 ────────────────────────────────────────────
const CONFIG = {
  DISCOVER_PAGES: 30, // 发现专家时最多翻页数
  DISCOVER_PER_PAGE: 20, // 每页文章数
  TARGET_EXPERTS: 200, // 目标专家数
  HISTORY_PAGE_SIZE: 20, // 历史推荐每页数
  SINCE: '2026-01-01', // 抓取起始日期
  DELAY_MIN: 800,
  DELAY_MAX: 2000,
  DISCOVER_DELAY_MIN: 500,
  DISCOVER_DELAY_MAX: 1200,
  DB_PATH: path.join(__dirname, '..', 'server', 'midou_data.db'),
  OUTPUT: path.join(__dirname, '..', 'server', 'expert_discovery.json'),
};

// ─── HTTPS 工具 ──────────────────────────────────────
function httpPost(host, path, body, referer) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'POST',
        hostname: host,
        path,
        agent: AGENT,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: referer || `https://${host}/`,
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

// ─── 阶段1: 发现专家 ─────────────────────────────────
async function fetchArticlePage(pn) {
  const body = `commresource=${encodeURIComponent(JSON.stringify({ channel: 'mesport', platform: 'pc' }))}&articletype=0&pn=${pn}&rn=${CONFIG.DISCOVER_PER_PAGE}`;
  const text = await httpPost(HOST, '/transpondsanyol/api/meweb/article/article_list', body);
  try {
    const j = JSON.parse(text);
    if (j.status === '100' && j.data && j.data.articles) return j.data.articles;
  } catch (e) {}
  return [];
}

function extractExpertFromArticle(article) {
  if (!article || !article.eid) return null;
  // 提取人气排名
  let hotRank = 9999;
  const boards = article.billboard || [];
  for (const b of boards) {
    if (b.name === 'hot' && b.type === 'jz') {
      hotRank = Math.min(hotRank, b.index || 9999);
    }
  }
  // 提取近N单收益
  let recentReturn = '';
  if (article.targetsnew_v2) {
    for (const t of article.targetsnew_v2) {
      const m = (t || '').match(/近(\d+单)\+(\d+)%/);
      if (m) {
        recentReturn = m[0];
        break;
      }
    }
  }
  // 提取连红数
  let streak = 0;
  const streakM = (article.targetsnew_v2 || []).find((t) => (t || '').includes('竞足连中'));
  if (streakM) {
    const sm = streakM.match(/^(\d+)/);
    if (sm) streak = parseInt(sm[1]);
  }
  // 提取命中率
  let hitRate = 0;
  const hrM = (article.targetsnew_v2 || []).find((t) => (t || '').includes('近') && (t || '').includes('中'));
  if (hrM) {
    const hm = hrM.match(/近(\d+)中(\d+)/);
    if (hm) hitRate = Math.round((parseInt(hm[2]) / parseInt(hm[1])) * 100);
  }
  return {
    eid: String(article.eid),
    nickname: article.nickname || '',
    hot_rank: hotRank,
    hit_rate: hitRate,
    streak: streak,
    recent_return: recentReturn,
    headimg: article.headimg || '',
    verify: article.verify || '0',
    identity: article.identity || '',
  };
}

async function discoverExperts() {
  console.log('══════ 阶段1: 发现专家 ══════');
  console.log('从 article_list API 提取专家及人气排名...\n');

  const expertMap = {}; // eid → expert info
  let pageNum = 1;
  let emptyCount = 0;

  while (pageNum <= CONFIG.DISCOVER_PAGES) {
    // 如果已收集足够专家，提前结束
    if (Object.keys(expertMap).length >= CONFIG.TARGET_EXPERTS) {
      console.log(`  已收集 ${Object.keys(expertMap).length} 位专家，提前结束`);
      break;
    }

    await sleep(rand(CONFIG.DISCOVER_DELAY_MIN, CONFIG.DISCOVER_DELAY_MAX));
    const articles = await fetchArticlePage(pageNum);

    if (articles.length === 0) {
      emptyCount++;
      if (emptyCount >= 3) break;
      pageNum++;
      continue;
    }

    emptyCount = 0;
    let newExperts = 0;
    for (const art of articles) {
      const expert = extractExpertFromArticle(art);
      if (!expert) continue;
      const key = expert.eid;
      if (!expertMap[key]) {
        expertMap[key] = expert;
        newExperts++;
      } else {
        // 更新人气排名（取最优排名即最小数字）
        if (expert.hot_rank < expertMap[key].hot_rank) {
          expertMap[key].hot_rank = expert.hot_rank;
        }
        // 更新连红数
        if (expert.streak > expertMap[key].streak) {
          expertMap[key].streak = expert.streak;
        }
        if (expert.hit_rate > expertMap[key].hit_rate) {
          expertMap[key].hit_rate = expert.hit_rate;
        }
      }
    }

    console.log(
      `  第 ${pageNum} 页: ${articles.length} 篇文章, 新增 ${newExperts} 位专家, 累计 ${Object.keys(expertMap).length}`,
    );

    if (newExperts === 0) {
      const realNew = articles.filter((a) => a.eid && !expertMap[String(a.eid)]).length;
      if (realNew === 0) {
        console.log('  本页无新专家');
      }
    }

    pageNum++;
  }

  // 按人气排名排序
  const experts = Object.values(expertMap).sort((a, b) => a.hot_rank - b.hot_rank);

  // 排名前200
  const top200 = experts.slice(0, CONFIG.TARGET_EXPERTS);

  console.log(`\n── 发现结果 ──`);
  console.log(`  总发现: ${experts.length} 位专家`);
  console.log(`  入选 Top ${CONFIG.TARGET_EXPERTS}: ${top200.length} 位`);
  console.log(`  人气排名范围: ${top200[0]?.hot_rank} ~ ${top200[top200.length - 1]?.hot_rank}`);
  console.log(`  有明确人气排名: ${experts.filter((e) => e.hot_rank < 9999).length} 位`);
  console.log(`  无排名(兜底): ${experts.filter((e) => e.hot_rank >= 9999).length} 位`);

  // 兜底: 如果没有足够的有排名的专家，把无排名的也加进来
  const selected = [];
  // 先加有排名的 (hot_rank < 9999)
  for (const e of top200) {
    if (e.hot_rank < 9999) selected.push(e);
  }
  // 如果不够200，补充无排名的
  if (selected.length < CONFIG.TARGET_EXPERTS) {
    const unranked = top200.filter((e) => e.hot_rank >= 9999);
    for (const e of unranked) {
      if (selected.length >= CONFIG.TARGET_EXPERTS) break;
      selected.push(e);
    }
  }

  // 保存
  fs.writeFileSync(
    CONFIG.OUTPUT,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total_found: experts.length,
        selected_count: selected.length,
        experts: selected,
      },
      null,
      2,
    ),
  );

  console.log(`\n  最终入选: ${selected.length} 位 (已保存到 ${CONFIG.OUTPUT})`);

  return selected;
}

// ─── 阶段2: 批量抓取推荐 ─────────────────────────────
async function fetchExpertHistory(eid, pn) {
  const body = `commresource=${encodeURIComponent(JSON.stringify({ channel: 'mesport', platform: 'pc' }))}&eid=${eid}&pn=${pn}&rn=${CONFIG.HISTORY_PAGE_SIZE}&articletype=`;
  const text = await httpPost(
    HOST,
    '/transpondsanyol/api/meweb/expert/expert_history_articles',
    body,
    `https://${HOST}/zhuanjia/${eid}`,
  );
  try {
    const j = JSON.parse(text);
    if (j.status === '100' && j.data && j.data.articles) return j.data.articles;
  } catch (e) {}
  return [];
}

function parseArticle(raw, eid) {
  let rc = null;
  if (raw.resultcontent) {
    try {
      rc = typeof raw.resultcontent === 'string' ? JSON.parse(raw.resultcontent) : raw.resultcontent;
    } catch (e) {}
  }
  const proinfo = (rc && rc.proinfo) || [];
  const gamedetail = raw.gamedetail || [];

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
        choice: m.choice || '',
        odds: m.pei || '',
        handicap: m.rangqiu || '',
        score: m.score || '',
        halfscore: m.halfscore || '',
        tinfo: m.tinfo || '',
        result: m.result,
        saiguo: m.saiguo || '',
      });
    }
  }

  let overallHit = null;
  if (proinfo.length > 0) {
    if (raw.result === '2') overallHit = 1;
    else if (raw.result === '0') overallHit = 0;
  }

  return {
    expert_eid: String(eid),
    article_aid: raw.aid,
    article_title: raw.title || '',
    nickname: raw.nickname || '',
    publishtime: raw.publishtime,
    ggtype: raw.ggtype || '',
    ggtypename: raw.ggtypename || '',
    paymoney: raw.paymoney || '',
    hits: raw.hits || 0,
    overall_hit: overallHit,
    rec_count: proinfo.length,
    recommendations: recommendations,
  };
}

async function scrapeExpert(eid, index, total) {
  console.log(`[${index}/${total}] 抓取专家 eid=${eid}...`);

  const allArticles = [];
  const seenAids = new Set();
  let pn = 1;
  let emptyCount = 0;
  const since = new Date(CONFIG.SINCE + 'T00:00:00+08:00');

  while (pn <= 50) {
    await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));
    const arts = await fetchExpertHistory(eid, pn);

    if (arts.length === 0) {
      emptyCount++;
      if (emptyCount >= 2) break;
      pn++;
      continue;
    }

    emptyCount = 0;
    let newCount = 0;
    let earliest = '';

    for (const raw of arts) {
      if (raw.aid && !seenAids.has(raw.aid)) {
        seenAids.add(raw.aid);
        allArticles.push(parseArticle(raw, eid));
        newCount++;
      }
      if (!earliest || raw.publishtime < earliest) earliest = raw.publishtime;
    }

    const last = arts[arts.length - 1];
    if (last && last.publishtime) {
      const d = new Date(last.publishtime.replace(' ', 'T') + '+08:00');
      if (d < since) break;
    }

    pn++;
  }

  // 过滤 2026年后的
  const filtered = allArticles.filter((a) => {
    if (!a.publishtime) return true;
    return new Date(a.publishtime.replace(' ', 'T') + '+08:00') >= since;
  });

  // 统计
  const totalRecs = filtered.reduce((s, a) => s + a.rec_count, 0);
  const hits = filtered.filter((a) => a.overall_hit === 1).length;
  const misses = filtered.filter((a) => a.overall_hit === 0).length;
  const rate = hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : 'N/A';

  console.log(`  → ${filtered.length} 条方案, ${totalRecs} 场推荐, 命中率 ${rate}%`);

  return {
    eid: String(eid),
    article_count: filtered.length,
    recommendation_count: totalRecs,
    hit_count: hits,
    miss_count: misses,
    hit_rate: rate,
    date_range:
      filtered.length > 0 ? `${filtered[filtered.length - 1].publishtime} ~ ${filtered[0].publishtime}` : 'N/A',
    articles: filtered,
  };
}

async function batchScrape(experts) {
  console.log('\n══════ 阶段2: 批量抓取推荐 ══════');
  console.log(`目标: ${experts.length} 位专家\n`);

  const results = [];
  const errors = [];

  for (let i = 0; i < experts.length; i++) {
    const expert = experts[i];
    try {
      const result = await scrapeExpert(expert.eid, i + 1, experts.length);
      result.nickname = expert.nickname;
      result.hot_rank = expert.hot_rank;
      results.push(result);
    } catch (e) {
      console.error(`  错误: eid=${expert.eid} ${expert.nickname} - ${e.message}`);
      errors.push({ eid: expert.eid, nickname: expert.nickname, error: e.message });
    }
  }

  return { results, errors };
}

// ─── 阶段3: 保存到 JSON ──────────────────────────────
function saveResults(results, errors, experts) {
  const expertsMap = {};
  for (const e of experts) {
    expertsMap[e.eid] = e;
  }

  const fullData = [];
  for (const r of results) {
    const info = expertsMap[r.eid] || {};
    fullData.push({
      eid: r.eid,
      nickname: r.nickname || info.nickname || '',
      hot_rank: r.hot_rank || info.hot_rank || 9999,
      hit_rate: r.hit_rate,
      headimg: info.headimg || '',
      article_count: r.article_count,
      recommendation_count: r.recommendation_count,
      hit_count: r.hit_count,
      miss_count: r.miss_count,
      date_range: r.date_range,
      articles: r.articles,
    });
  }

  const outputPath = path.join(__dirname, '..', 'server', 'experts_batch_2026.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        since: CONFIG.SINCE,
        total_experts_scanned: experts.length,
        success_count: results.length,
        error_count: errors.length,
        total_articles: fullData.reduce((s, e) => s + e.article_count, 0),
        total_recommendations: fullData.reduce((s, e) => s + e.recommendation_count, 0),
        experts: fullData,
        errors: errors,
      },
      null,
      2,
    ),
  );

  const sizeKb = (fs.statSync(outputPath).size / 1024).toFixed(1);
  console.log(`\n✅ 数据已保存: ${outputPath} (${sizeKb} KB)`);

  // 汇总输出
  console.log('\n══════ 批量抓取汇总 ══════');
  console.log(`  成功: ${results.length} | 失败: ${errors.length}`);
  console.log(`  总方案: ${fullData.reduce((s, e) => s + e.article_count, 0)}`);
  console.log(`  总场次: ${fullData.reduce((s, e) => s + e.recommendation_count, 0)}`);
  console.log(
    `  平均命中率: ${(fullData.reduce((s, e) => s + parseFloat(e.hit_rate || 0), 0) / fullData.filter((e) => parseFloat(e.hit_rate) > 0).length || 0).toFixed(1)}%`,
  );
}

// ─── 增量更新 ─────────────────────────────────────────
async function updateExperts() {
  // 读取已有专家列表，只抓取新推荐
  const discoveryPath = CONFIG.OUTPUT;
  if (!fs.existsSync(discoveryPath)) {
    console.log('请先运行 --discover 发现专家');
    return;
  }
  const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf-8'));
  const experts = discovery.experts;
  console.log(`增量更新: ${experts.length} 位专家`);

  const results = [];
  const errors = [];

  for (let i = 0; i < experts.length; i++) {
    const expert = experts[i];
    try {
      // 只抓第一页最新数据
      const arts = await fetchExpertHistory(expert.eid, 1);
      const newArts = arts.map((raw) => parseArticle(raw, expert.eid));
      const since = new Date(CONFIG.SINCE + 'T00:00:00+08:00');
      const filtered = newArts.filter((a) => {
        if (!a.publishtime) return true;
        return new Date(a.publishtime.replace(' ', 'T') + '+08:00') >= since;
      });

      const totalRecs = filtered.reduce((s, a) => s + a.rec_count, 0);
      const hits = filtered.filter((a) => a.overall_hit === 1).length;
      const misses = filtered.filter((a) => a.overall_hit === 0).length;
      const rate = hits + misses > 0 ? ((hits / (hits + misses)) * 100).toFixed(1) : 'N/A';

      results.push({
        eid: String(expert.eid),
        nickname: expert.nickname,
        hot_rank: expert.hot_rank,
        article_count: filtered.length,
        recommendation_count: totalRecs,
        hit_count: hits,
        miss_count: misses,
        hit_rate: rate,
        articles: filtered,
      });

      console.log(`[${i + 1}/${experts.length}] ${expert.nickname}: ${filtered.length}条, 命中率 ${rate}%`);

      await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));
    } catch (e) {
      errors.push({ eid: expert.eid, nickname: expert.nickname, error: e.message });
    }
  }

  saveResults(results, errors, experts);
}

// ─── 主入口 ───────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--all';
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  500.com 专家推荐批量抓取工具                ║');
  console.log('║  目标: 人气前200专家, 2026年推荐数据         ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  let experts = [];

  // 阶段1: 发现专家
  if (mode === '--discover' || mode === '--all') {
    experts = await discoverExperts();
  }

  // 阶段2: 批量抓取
  if (mode === '--scrape' || mode === '--all') {
    if (experts.length === 0) {
      // 从文件读取
      if (fs.existsSync(CONFIG.OUTPUT)) {
        const d = JSON.parse(fs.readFileSync(CONFIG.OUTPUT, 'utf-8'));
        experts = d.experts;
        console.log(`从 ${CONFIG.OUTPUT} 加载 ${experts.length} 位专家`);
      } else {
        console.log('请先运行 --discover');
        return;
      }
    }
    const { results, errors } = await batchScrape(experts);
    saveResults(results, errors, experts);
  }

  // 增量更新
  if (mode === '--update') {
    await updateExperts();
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n总耗时: ${elapsed} 分钟`);
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
