/**
 * ttyingqiu.com 专家推荐数据抓取工具
 *
 * 数据流:
 *   1) 从比赛计划页收集专家 ID
 *   2) 调用 AJAX API 获取解读列表（含分页）
 *   3) 访问解读详情页提取完整数据（赔率+方向+分析）
 *
 * API:
 *   解读列表: POST /expert/home/interpretation2/{pageNo}
 *             body: exportId={id}&searchIndex=100&raceTypeId=1
 *             → JSON { page: { dataList, totalPages } }
 *   解读详情: GET /interpretation/detail/{id} → HTML
 *            已完成比赛完全公开，无需登录/付费
 *
 * 输出:
 *   server/ttyingqiu_experts.json
 *   server/ttyingqiu_interpretations.json
 *   server/ttyingqiu_details.json
 *
 * 用法:
 *   node scripts/scrape_ttyingqiu.js --discover    # 发现专家（通过比赛页）
 *   node scripts/scrape_ttyingqiu.js --scrape      # 抓取解读列表
 *   node scripts/scrape_ttyingqiu.js --detail      # 抓取解读详情
 *   node scripts/scrape_ttyingqiu.js --all         # 全流程
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const HOST = 'www.ttyingqiu.com';

// ─── 全局 Cookie 管理 ─────────────────────────────────
let globalCookies = '';

async function initSession() {
  return new Promise((resolve) => {
    https.get({
      hostname: HOST, path: '/',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        globalCookies = (Array.isArray(sc) ? sc : [sc])
          .map(c => c.split(';')[0]).join('; ');
      }
      res.resume();
      resolve();
    }).on('error', () => resolve());
  });
}

// ─── 配置 ────────────────────────────────────────────
const CONFIG = {
  SINCE: '2026-01-01',
  SEARCH_INDEX: 100,
  RACE_TYPE_FOOTBALL: 1,
  RACE_TYPE_BASKETBALL: 2,
  DELAY_MIN: 500,
  DELAY_MAX: 1200,
  MAX_PAGES: 100,
  OUTPUT_DIR: path.join(__dirname, '..', 'server'),

  // ─── 内置专家列表（已验证可通过 API 获取数据）
  BUILTIN_EXPERTS: [
    { id: '212520', name: '杨子墨', raceType: 1 },
  ],

  // ─── 专家发现配置（高密度并行探测）
  EXPERT_ID_RANGE_START: 200000,
  EXPERT_ID_RANGE_END: 300000,      // 10万范围全覆盖
  EXPERT_PROBE_STEP: 1,             // 逐一探测
  EXPERT_PROBE_CONCURRENT: 30,      // 高并发
};

// ─── HTTPS 工具 ──────────────────────────────────────
function httpGet(path, referer) {
  return new Promise((resolve, reject) => {
    https.request({
      method: 'GET',
      hostname: HOST,
      path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Cookie: globalCookies,
        Referer: referer || `https://${HOST}/`,
      },
      timeout: 15000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject).end();
  });
}

function httpPost(path, body, referer) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : new URLSearchParams(body).toString();
    const req = https.request({
      method: 'POST',
      hostname: HOST,
      path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: globalCookies,
        Referer: referer || `https://${HOST}/`,
      },
      timeout: 10000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(a, b) { return a + Math.random() * (b - a); }

// ─── 阶段1: 发现专家 ─────────────────────────────────

/**
 * 通过探测 expert ID 范围来发现活跃专家
 * 简易方式：对已知 ID 区间调用 API，验证是否有数据
 */
async function probeExpert(expertId, raceType) {
  const body = `exportId=${expertId}&searchIndex=${CONFIG.SEARCH_INDEX}&raceTypeId=${raceType}`;
  try {
    const raw = await httpPost(`/expert/home/interpretation2/1`, body);
    const data = JSON.parse(raw);
    if (data.page && data.page.dataList && data.page.dataList.length > 0) {
      const list = data.page.dataList;
      const name = list[0].jcobMember.nickName || '';
      return { id: String(expertId), name, totalPages: data.page.totalPages || 1 };
    }
  } catch (e) {
    // 专家不存在或没有数据
  }
  return null;
}

async function discoverExperts() {
  console.log('══════ 阶段1: 发现专家 ══════\n');
  const step = CONFIG.EXPERT_PROBE_STEP || 3;
  const concurrent = CONFIG.EXPERT_PROBE_CONCURRENT || 20;
  const target = 300;
  console.log(`探测范围: ${CONFIG.EXPERT_ID_RANGE_START}~${CONFIG.EXPERT_ID_RANGE_END}, 步长: ${step}, 并发: ${concurrent}`);
  console.log(`目标: ${target} 位专家\n`);

  const experts = [];
  const ids = [];
  for (let id = CONFIG.EXPERT_ID_RANGE_START; id <= CONFIG.EXPERT_ID_RANGE_END; id += step) {
    ids.push(id);
  }
  console.log(`共 ${ids.length} 个探测点\n`);

  let probed = 0;
  const outPath = path.join(CONFIG.OUTPUT_DIR, 'ttyingqiu_experts.json');

  // 并行探测 + 增量保存
  for (let i = 0; i < ids.length; i += concurrent) {
    const batch = ids.slice(i, i + concurrent);
    const results = await Promise.allSettled(
      batch.map(id => probeExpert(id, CONFIG.RACE_TYPE_FOOTBALL))
    );

    for (const r of results) {
      probed++;
      if (r.status === 'fulfilled' && r.value) {
        experts.push(r.value);
        console.log(`  ✓ #${experts.length} ID ${r.value.id}: ${r.value.name} (${r.value.totalPages}页)`);
      }
    }

    // 增量保存
    fs.writeFileSync(outPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      total: experts.length,
      experts,
    }, null, 2));

    // 达到目标提前结束
    if (experts.length >= target) {
      console.log(`\n✅ 已达到目标 ${target} 位专家！`);
      break;
    }

    if (i + concurrent < ids.length && experts.length < target) {
      process.stdout.write(`\r  进度: ${probed}/${ids.length}, 已发现 ${experts.length}/${target}`);
      await sleep(100);
    }
  }

  console.log(`\n\n发现 ${experts.length} 位活跃专家`);
  console.log(`已保存: ${outPath}\n`);

  return experts;
}

// ─── 阶段2: 抓取解读列表 ──────────────────────────────

function parseOdds(spString) {
  // SP 格式: "11200-62500-130000;24000-37000-22600;..."
  // 第一部分是 SPF (胜平负)，数值/10000 为实际赔率
  if (!spString) return null;
  const parts = spString.split(';')[0]; // 只取第一部分 (SPF)
  const odds = parts.split('-').map(v => parseFloat(v) / 10000);
  if (odds.length >= 3) {
    return { win: odds[0], draw: odds[1], lose: odds[2] };
  }
  return null;
}

function parseInterpretation(raw, expertId) {
  const interp = raw.tjInterpretationSimple || {};
  const races = raw.raceList || [];
  const member = raw.jcobMember || {};

  const matches = races.map(r => ({
    match_name: r.matchName || '',
    match_no: r.matchNo || '',
    home_team: r.homeTeam || r.homeTeamShortName || '',
    away_team: r.guestTeam || r.guestTeamShortName || '',
    match_time: r.matchTime ? new Date(r.matchTime).toISOString() : '',
    status: r.statusStr || '',
    status_code: r.status || 0,
    odds: parseOdds(r.sp),
    handicap: r.handicap || '',
    sp_raw: r.sp || '',
    match_id: r.fxId || '',
  }));

  return {
    interpretation_id: interp.id,
    expert_id: String(expertId),
    expert_name: member.nickName || '',
    create_time: interp.createTime ? new Date(interp.createTime).toISOString() : '',
    game_desc: interp.gameDesc || '',
    improv_status: interp.improvStatus || 0,
    features: interp.features || '',
    race_count: raw.raceCount || matches.length,
    matches,
  };
}

async function fetchInterpretationPage(expertId, raceType, pageNo) {
  const body = `exportId=${expertId}&searchIndex=${CONFIG.SEARCH_INDEX}&raceTypeId=${raceType}`;
  const path = `/expert/home/interpretation2/${pageNo}`;
  const referer = `https://${HOST}/expert/home/${expertId}`;

  const raw = await httpPost(path, body, referer);
  const data = JSON.parse(raw);
  return data.page || null;
}

async function scrapeExpert(expert, index, total) {
  const { id, name, raceType } = expert;
  const rt = raceType || CONFIG.RACE_TYPE_FOOTBALL;
  const prefix = `  [${index}/${total}] ${name}(${id})`;

  const allInterpretations = [];
  let pageNo = 1;
  let totalPages = 1;

  while (pageNo <= Math.min(totalPages, CONFIG.MAX_PAGES)) {
    await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));

    let page;
    try {
      page = await fetchInterpretationPage(id, rt, pageNo);
    } catch (e) {
      if (e.message === 'API_406') {
        console.error(`${prefix}: 406 被拒，跳过`);
        break;
      }
      console.error(`${prefix} 第${pageNo}页错误: ${e.message}`);
      break;
    }

    if (!page || !page.dataList || page.dataList.length === 0) break;

    if (pageNo === 1) totalPages = page.totalPages || 1;

    for (const item of page.dataList) {
      allInterpretations.push(parseInterpretation(item, id));
    }

    process.stdout.write(`\r${prefix}: 第${pageNo}/${totalPages}页, ${allInterpretations.length}条`);

    if (pageNo >= totalPages) break;
    pageNo++;
  }

  process.stdout.write('\n');

  const completed = allInterpretations.filter(i =>
    i.matches.some(m => m.status === '已开奖' || m.status === '已完场')
  );

  return {
    expert_id: String(id),
    expert_name: name,
    interpretations: allInterpretations,
    total_count: allInterpretations.length,
    completed_count: completed.length,
    pages: pageNo,
  };
}

async function batchScrape(experts) {
  console.log('\n══════ 阶段2: 批量抓取解读列表 ══════');
  console.log(`目标: ${experts.length} 位专家\n`);

  const results = [];
  const errors = [];

  for (let i = 0; i < experts.length; i++) {
    try {
      const result = await scrapeExpert(experts[i], i + 1, experts.length);
      results.push(result);
    } catch (e) {
      console.error(`  ✗ ${experts[i].name}(${experts[i].id}): ${e.message}`);
      errors.push({ expert_id: experts[i].id, name: experts[i].name, error: e.message });
    }
  }

  return { results, errors };
}

// ─── 阶段3: 抓取解读详情（已完成比赛）─────────────────

function parseDetailPage(html, interpId) {
  // 去掉标签得到纯文本
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/[\s\n\r]+/g, ' ')
    .trim();

  const matchBlocks = [];

  // 匹配比赛行: 日期 联赛 主队 比分 客队 [单关] 方向 赔率...
  // 如: "2026-05-29 02:45 国际友谊 爱尔兰 1 - 0 卡塔尔 单关 主胜 1.40 平 3.88 客胜 6.35"
  const matchRegex = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(\S+?)\s+(\S+?)\s+(\d+)\s*[-:]\s*(\d+)\s+(\S+)/g;
  let m;
  while ((m = matchRegex.exec(text))) {
    const afterScore = text.substring(m.index + m[0].length, m.index + m[0].length + 100).trim();
    // 提取紧随的方向 (主胜/主负/让胜/让平/让负/客胜/客负/平局)
    const pickMatch = afterScore.match(/^(主[胜负]|客[胜负]|让[胜平负]|平局|\S*[胜负]\S*)/);
    const pick = pickMatch ? pickMatch[1] : '';

    // 提取 SPF 赔率
    const oddsIn = afterScore.match(/(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)/);

    matchBlocks.push({
      time: m[1],
      league: m[2],
      home: m[3],
      home_score: parseInt(m[4]),
      away_score: parseInt(m[5]),
      away: m[6],
      pick: pick,
      spf_odds: oddsIn ? { win: parseFloat(oddsIn[1]), draw: parseFloat(oddsIn[2]), lose: parseFloat(oddsIn[3]) } : null,
    });
  }

  // 提取分析摘要
  const analysisStart = text.indexOf('推荐理由');
  const analysis = analysisStart >= 0
    ? text.substring(analysisStart, analysisStart + 800).trim()
    : text.substring(0, 500);

  return {
    interpretation_id: interpId,
    matches: matchBlocks,
    analysis_summary: analysis,
  };
}

async function fetchDetail(interpId) {
  const html = await httpGet(`/interpretation/detail/${interpId}`,
    `https://${HOST}/expert/home/`);
  return parseDetailPage(html, interpId);
}

async function scrapeDetails(interpretationData) {
  console.log('\n══════ 阶段3: 抓取解读详情 ══════');

  const details = [];
  let completed = 0;
  let failed = 0;

  // 收集所有已完成比赛的解读
  const allCompleted = [];
  for (const expert of interpretationData) {
    for (const interp of (expert.interpretations || expert.data || [])) {
      if (interp.matches && interp.matches.some(m => m.status === '已开奖' || m.status === '已完场')) {
        allCompleted.push(interp);
      }
    }
  }

  console.log(`共 ${allCompleted.length} 条已完成解读可抓取详情\n`);

  for (let i = 0; i < allCompleted.length; i++) {
    const interp = allCompleted[i];
    await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));

    try {
      const detail = await fetchDetail(interp.interpretation_id);
      // 合并两层数据
      details.push({
        ...interp,
        detail_matches: detail.matches,
        spf_odds: detail.spf_odds,
        analysis: detail.analysis,
      });
      completed++;
      if (completed % 10 === 0) {
        process.stdout.write(`\r  已抓取 ${completed} 条详情...`);
      }
    } catch (e) {
      failed++;
    }
  }

  console.log(`\n详情抓取完成: ${completed} 成功, ${failed} 失败`);
  return details;
}

// ─── 保存结果 ─────────────────────────────────────────

function saveInterpretations(results, errors, experts) {
  const outPath = path.join(CONFIG.OUTPUT_DIR, 'ttyingqiu_interpretations.json');

  const flatList = [];
  for (const r of results) {
    for (const i of r.interpretations) {
      flatList.push(i);
    }
  }

  const completed = flatList.filter(i =>
    i.matches && i.matches.some(m => m.status === '已完场')
  );

  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    since: CONFIG.SINCE,
    experts_scanned: experts.length,
    success: results.length,
    errors: errors.length,
    total_interpretations: flatList.length,
    completed_interpretations: completed.length,
    experts: results,
    error_details: errors,
  }, null, 2));

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\n✅ 解读数据已保存: ${outPath} (${sizeKb} KB)`);
}

function saveDetails(details) {
  const outPath = path.join(CONFIG.OUTPUT_DIR, 'ttyingqiu_details.json');

  // 按 interpretation_id 建索引方便合并
  const detailMap = {};
  for (const d of details) {
    detailMap[d.interpretation_id] = d;
  }

  // 读取已有解读数据并合并方向
  const interpPath = path.join(CONFIG.OUTPUT_DIR, 'ttyingqiu_interpretations.json');
  let interpData = null;
  if (fs.existsSync(interpPath)) {
    interpData = JSON.parse(fs.readFileSync(interpPath, 'utf-8'));
    // 回填方向到解读数据
    for (const expert of (interpData.experts || [])) {
      for (const interp of (expert.interpretations || [])) {
        const detail = detailMap[interp.interpretation_id];
        if (detail && detail.matches) {
          for (const dm of detail.matches) {
            // 匹配并填充 pick
            for (const im of (interp.matches || [])) {
              if (im.home_team && dm.home && im.home_team.includes(dm.home) && im.away_team.includes(dm.away)) {
                im.pick = dm.pick || im.pick;
                im.detail_odds = dm.spf_odds || im.detail_odds;
                break;
              }
            }
          }
        }
      }
    }
    // 保存合并后的数据
    fs.writeFileSync(interpPath, JSON.stringify(interpData, null, 2));
  }

  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    total: details.length,
    details,
  }, null, 2));

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✅ 详情已保存并回填方向: ${outPath} (${sizeKb} KB)`);
  console.log(`   解读数据已更新: ${interpPath}`);
}

// ─── 打印统计 ─────────────────────────────────────────

function printSummary(results, errors) {
  const totalInterps = results.reduce((s, r) => s + r.total_count, 0);
  const totalCompleted = results.reduce((s, r) => s + r.completed_count, 0);
  const totalPages = results.reduce((s, r) => s + r.pages, 0);

  console.log('\n══════ 抓取汇总 ══════');
  console.log(`  成功: ${results.length} | 失败: ${errors.length}`);
  console.log(`  总解读: ${totalInterps} | 已完成: ${totalCompleted}`);
  console.log(`  总翻页: ${totalPages}`);
  if (errors.length > 0) {
    console.log('\n  失败列表:');
    errors.forEach(e => console.log(`    ${e.name}(${e.expert_id}): ${e.error}`));
  }
}

// ─── 主入口 ───────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--all';
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  ttyingqiu.com 专家推荐数据抓取工具          ║');
  console.log('║  AJAX API + Cookie 会话                      ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  // 初始化会话
  console.log('建立会话...');
  await initSession();
  console.log('  会话 Cookie: ' + (globalCookies ? 'OK' : '无') + '\n');

  let experts = [];

  // ── 阶段1: 发现专家 ──
  if (mode === '--discover' || mode === '--all') {
    experts = await discoverExperts();
  } else {
    const jsonPath = path.join(CONFIG.OUTPUT_DIR, 'ttyingqiu_experts.json');
    if (fs.existsSync(jsonPath)) {
      const d = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      experts = d.experts || [];
      console.log(`从 ttyingqiu_experts.json 加载 ${experts.length} 位专家`);
    } else {
      experts = CONFIG.BUILTIN_EXPERTS;
      console.log(`使用内置 ${experts.length} 位专家`);
    }
  }

  // ── 阶段2: 抓取解读列表 ──
  let interpResults = [];
  if (mode === '--scrape' || mode === '--all') {
    const { results, errors } = await batchScrape(experts);
    saveInterpretations(results, errors, experts);
    printSummary(results, errors);
    interpResults = results;
  }

  // ── 阶段3: 抓取详情 ──
  if (mode === '--detail' || mode === '--all') {
    if (interpResults.length === 0) {
      const jsonPath = path.join(CONFIG.OUTPUT_DIR, 'ttyingqiu_interpretations.json');
      if (fs.existsSync(jsonPath)) {
        interpResults = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')).experts || [];
      }
    }
    const details = await scrapeDetails(interpResults);
    saveDetails(details);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n总耗时: ${elapsed} 分钟`);
}

main().catch(err => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
