/**
 * okooo.com 专家推荐数据抓取工具
 *
 * 数据流:
 *   1) 从 /gaoshou/ + /jinnang/daren/ + /jinnang/shijianke/ 发现专家
 *   2) 逐专家遍历态度列表 /member/{id}/?entity_type=attitude&page={N}
 *   3) 提取 note ID + 基本信息（对阵、方向、比分）
 *   4) 访问笔记详情页 /soccer/note/{id}/ → 完整数据（赔率、分析）
 *
 * API 路径:
 *   专家发现: GET /gaoshou/ → HTML
 *   态度列表: GET /member/{id}/?entity_type=attitude&page={N} → HTML
 *   笔记详情: GET /soccer/note/{note_id}/ → HTML（已完成比赛完全公开）
 *
 * 输出:
 *   server/okooo_experts.json        — 专家列表
 *   server/okooo_attitudes_batch.json — 态度数据 + 笔记详情合并
 *
 * 用法:
 *   node scripts/scrape_okooo.js --discover     # 阶段1: 发现专家
 *   node scripts/scrape_okooo.js --scrape       # 阶段2: 批量抓取
 *   node scripts/scrape_okooo.js --all          # 全流程
 *   node scripts/scrape_okooo.js --detail       # 阶段3: 抓笔记详情（依赖态度数据）
 *   node scripts/scrape_okooo.js --update       # 增量更新（最新1页态度）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const HOST = 'www.okooo.com';
const AGENT = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

// ─── 全局 Cookie 管理 ─────────────────────────────────
let globalCookies = '';

// ─── 配置 ────────────────────────────────────────────
const CONFIG = {
  SINCE: '2026-03-01', // 抓取起始日期（okooot 平台仅保留 ~3 个月数据）
  ATTITUDE_PAGE_SIZE: 10, // 态度列表每页数
  MAX_ATTITUDE_PAGES: 45, // 最大翻页数
  MAX_NOTE_DETAILS: 0, // 笔记详情最大数（0=不限）
  DELAY_MIN: 1200,
  DELAY_MAX: 2500,
  OUTPUT_DIR: path.join(__dirname, '..', 'server'),
  EXPERTS_JSON: 'okooo_experts.json',
  ATTITUDES_JSON: 'okooo_attitudes_batch.json',
  // ─── 预置专家（若跳过 discover）
  BUILTIN_EXPERTS: [
    { id: '30067671', name: '语末Yumo' },
    { id: '30179958', name: '朱锦宸' },
    { id: '31552690', name: '红单韬略' },
    { id: '30743247', name: '天机师' },
    { id: '23768214', name: '球探胜平负' },
    { id: '30086132', name: '渣叔析球' },
    { id: '21845924', name: '冰冰精析' },
    { id: '23301776', name: '世界有多大' },
    { id: '20919120', name: '龙翔浅底ZS' },
    { id: '30244453', name: '何老师聊球' },
    { id: '30354825', name: '伟哥侃球' },
    { id: '30608679', name: '雄霸足球' },
    { id: '31852342', name: '大婶与大神' },
    { id: '22289383', name: '竞猜神魔' },
    { id: '8772071', name: '银煌银三' },
    { id: '9269584', name: '老马看盘专家' },
    { id: '130262', name: '大个玩竞球' },
    { id: '22465578', name: '加文兄弟' },
    { id: '32782850', name: '财神有胆' },
    { id: '23308921', name: '足球福尔摩斯' },
    { id: '710265', name: 'FC_胜负师_' },
    { id: '22246438', name: '正推反推真心推' },
    { id: '24422458', name: '失落神殿' },
    { id: '24259339', name: '花前月下re' },
    { id: '373117', name: 'Galileo解盘' },
    { id: '31905461', name: '季老师篮球' },
    { id: '32491110', name: '罗本8878' },
    { id: '21977561', name: '老帅侃球' },
    { id: '23982273', name: '格桑推球' },
  ],
};

// ─── HTTPS 工具 ──────────────────────────────────────
function httpGet(host, path, referer) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      Referer: referer || `https://${host}/`,
      Origin: `https://${host}`,
    };
    if (globalCookies) {
      headers.Cookie = globalCookies;
    }
    const req = https.request(
      {
        method: 'GET',
        hostname: host,
        path,
        agent: AGENT,
        headers,
        timeout: 20000,
      },
      (res) => {
        // 保存 Cookie
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          const newCookies = (Array.isArray(setCookie) ? setCookie : [setCookie])
            .map((c) => c.split(';')[0])
            .join('; ');
          if (newCookies) {
            const existing = globalCookies.split('; ').filter(Boolean);
            for (const nc of newCookies.split('; ')) {
              const key = nc.split('=')[0];
              const idx = existing.findIndex((c) => c.startsWith(key + '='));
              if (idx >= 0) existing[idx] = nc;
              else existing.push(nc);
            }
            globalCookies = existing.join('; ');
          }
        }

        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          // 检测 WAF 拦截页面
          const rawStr = raw.toString('utf-8', 0, Math.min(raw.length, 500));
          if (rawStr.includes('aliyun_waf') || rawStr.includes('__aliyun') || rawStr.includes('challenge')) {
            console.error(`  ⚠ WAF 拦截: ${path}`);
            reject(new Error('WAF_BLOCK'));
            return;
          }
          // 检测 charset，优先 GBK（okooot.com 默认编码）
          const contentType = (res.headers['content-type'] || '').toLowerCase();
          let html;
          if (contentType.includes('gbk') || contentType.includes('gb2312') || contentType.includes('gb18030')) {
            html = iconv.decode(raw, 'gbk');
          } else {
            try {
              html = raw.toString('utf-8');
              if (html.includes('\ufffd')) {
                html = iconv.decode(raw, 'gbk');
              }
            } catch (e) {
              html = iconv.decode(raw, 'gbk');
            }
          }
          resolve(html);
        });
      },
    );
    req.on('error', reject);
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
async function fetchGaoshouPage() {
  const html = await httpGet(HOST, '/gaoshou/');
  return html;
}

async function fetchDarenPage() {
  const html = await httpGet(HOST, '/jinnang/daren/');
  return html;
}

async function fetchShijiankePage() {
  const html = await httpGet(HOST, '/jinnang/shijianke/');
  return html;
}

function extractExpertsFromHtml(html) {
  const experts = [];
  const seen = {};
  // 匹配所有 /member/{数字}/ 链接
  const linkRegex = /href="\/member\/(\d+)\/"/g;
  let m;
  while ((m = linkRegex.exec(html))) {
    const id = m[1];
    if (id === '315100151' || seen[id]) continue;
    seen[id] = true;
    experts.push({ id, name: '' }); // 名字稍后从内置列表匹配
  }

  // 尝试从链接周围提取名字
  const namedRegex = /<a[^>]*href="\/member\/(\d+)\/"[\s\S]*?>\s*(\d+\s+)?([^<\n]{2,30}?)\s*(?:近|每|Ta|<\s*\/a)/g;
  while ((m = namedRegex.exec(html))) {
    const id = m[1];
    let name = (m[3] || '').replace(/[\s\n\r\t]+/g, ' ').trim();
    if (name && name.length >= 2 && name.length < 20) {
      // 更新已有记录的名字
      const existing = experts.find((e) => e.id === id);
      if (existing && !existing.name) {
        existing.name = name;
      }
    }
  }

  return experts;
}

function mergeWithBuiltin(scraped) {
  // 以内置列表为基础，补充新发现的专家
  const merged = {};
  for (const e of CONFIG.BUILTIN_EXPERTS) {
    merged[e.id] = { ...e };
  }
  // 补充新发现的专家
  for (const e of scraped) {
    if (!merged[e.id]) {
      merged[e.id] = e;
    }
  }
  return Object.values(merged);
}

async function discoverExperts() {
  console.log('══════ 阶段1: 发现专家 ══════\n');

  const allExperts = {};

  // 先加载内置列表作为基础
  console.log(`内置专家: ${CONFIG.BUILTIN_EXPERTS.length} 位\n`);

  // 来源1: 高手榜
  console.log('来源1: /gaoshou/ (高手榜)');
  try {
    const html = await httpGet(HOST, '/gaoshou/');
    const scraped = extractExpertsFromHtml(html);
    for (const e of scraped) {
      if (!allExperts[e.id]) allExperts[e.id] = e;
    }
    console.log(`  → ${scraped.length} 位专家 (member IDs)`);
  } catch (e) {
    console.error(`  错误: ${e.message}`);
  }
  await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));

  // 来源2: 连红达人
  console.log('来源2: /jinnang/daren/ (连红达人)');
  try {
    const html = await httpGet(HOST, '/jinnang/daren/');
    const scraped = extractExpertsFromHtml(html);
    let added = 0;
    for (const e of scraped) {
      if (!allExperts[e.id]) {
        allExperts[e.id] = e;
        added++;
      }
    }
    console.log(`  → ${scraped.length} 位专家 (新增 ${added})`);
  } catch (e) {
    console.error(`  错误: ${e.message}`);
  }
  await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));

  // 来源3: 十剑客
  console.log('来源3: /jinnang/shijianke/ (十剑客)');
  try {
    const html = await httpGet(HOST, '/jinnang/shijianke/');
    const scraped = extractExpertsFromHtml(html);
    let added = 0;
    for (const e of scraped) {
      if (!allExperts[e.id]) {
        allExperts[e.id] = e;
        added++;
      }
    }
    console.log(`  → ${scraped.length} 位专家 (新增 ${added})`);
  } catch (e) {
    console.error(`  错误: ${e.message}`);
  }

  // 与内置列表合并
  const scrapedList = Object.values(allExperts);
  const merged = mergeWithBuiltin(scrapedList);

  console.log(`\n── 发现结果 ──`);
  console.log(`  内置: ${CONFIG.BUILTIN_EXPERTS.length} | 抓取: ${scrapedList.length} | 合并: ${merged.length}`);

  // 填充缺失的名字
  for (const e of merged) {
    if (!e.name || e.name.length < 2) {
      // 尝试从其他来源查找名字
      const builtin = CONFIG.BUILTIN_EXPERTS.find((b) => b.id === e.id);
      if (builtin) e.name = builtin.name;
    }
  }

  // 保存
  const outPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.EXPERTS_JSON);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total: merged.length,
        sources: ['builtin', 'gaoshou', 'daren', 'shijianke'],
        experts: merged,
      },
      null,
      2,
    ),
  );
  console.log(`  已保存: ${outPath}`);

  return merged;
}

// ─── 阶段2: 抓取态度列表 ──────────────────────────────
/**
 * 从态度列表 HTML 中提取一条态度数据
 */
function parseAttitudeItem(html_snippet) {
  // 提取比赛对阵+比分: "MM-DD HH:MM 主队 比分 客队"
  const matchLineRegex = /(\d{2}-\d{2}\s+\d{2}:\d{2})\s+(\S+?)\s+(\d+-\d+|\d+:\d+|-)\s+(\S+)/;
  const matchLine = html_snippet.match(matchLineRegex);

  // 提取联赛 - 在整个 item 片段中搜索 [联赛名] 标记
  let league = '';
  // 去掉 style 属性和 class 属性的干扰，只保留文本中的 []
  const cleanText = html_snippet
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ') // 先转成纯文本
    .replace(/[\s\n\r]+/g, ' ');
  const leagueMatches = cleanText.match(/\[([^\]]{1,20})\]/g);
  if (leagueMatches) {
    for (const lm of leagueMatches) {
      const raw = lm.replace(/[\[\]]/g, '').trim();
      // 只接受中文/英文联赛名，过滤数字/路径/JS代码片段
      if (
        raw.length >= 2 &&
        /[\u4e00-\u9fff]/.test(raw) &&
        !raw.includes('object') &&
        !raw.includes('function') &&
        !raw.includes('http')
      ) {
        league = raw;
        break;
      }
    }
    // 回退：接受纯英文联赛名
    if (!league) {
      for (const lm of leagueMatches) {
        const raw = lm.replace(/[\[\]]/g, '').trim();
        if (raw.length >= 2 && raw.length <= 10 && /^[A-Za-z\s]+$/.test(raw)) {
          league = raw;
          break;
        }
      }
    }
  }

  // 提取推荐方向 — 兼容多种格式: 单选:方向 / 表态：方向 / 表态：方向 @赔率
  // 排除"付费可见"占位符
  const pickMatch = html_snippet.match(/(?:单选|表态)[:：]\s*([^\s<@]+)/);
  const pick = pickMatch && pickMatch[1].trim() !== '付费可见' ? pickMatch[1].trim() : '';

  // 提取串关类型
  const typeMatch = html_snippet.match(/(\d+串\d+|单场)/);

  // 提取笔记链接 ID
  const noteIdMatch = html_snippet.match(/\/soccer\/note\/([a-f0-9]+)\//);

  // 提取比分（如果已完成）
  const scoreLine = matchLine ? matchLine[3].replace(':', '-') : '';
  const isCompleted = scoreLine && /\d+-\d+/.test(scoreLine);

  return {
    league,
    match_time: matchLine ? matchLine[1] : '',
    home_team: matchLine ? matchLine[2].trim() : '',
    away_team: matchLine ? matchLine[4].trim() : '',
    score: scoreLine,
    is_completed: isCompleted,
    pick: pick,
    bet_type: typeMatch ? typeMatch[1] : '',
    note_id: noteIdMatch ? noteIdMatch[1] : null,
  };
}

async function fetchAttitudePage(expertId, page) {
  const path = `/member/${expertId}/?entity_type=attitude&page=${page}`;
  const html = await httpGet(HOST, path, `https://${HOST}/member/${expertId}/`);
  return html;
}

async function scrapeExpertAttitudes(expert, index, total) {
  const { id, name } = expert;
  const prefix = `  [${index}/${total}] ${name}(${id})`;

  const allAttitudes = [];
  const seenIds = new Set();
  let pageNum = 1;
  let emptyCount = 0;
  const since = new Date(CONFIG.SINCE + 'T00:00:00+08:00');

  while (pageNum <= CONFIG.MAX_ATTITUDE_PAGES) {
    await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));
    let html;
    try {
      html = await fetchAttitudePage(id, pageNum);
    } catch (e) {
      if (e.message === 'WAF_BLOCK') {
        throw e; // 向上传播到 batchScrapeAttitudes
      }
      console.error(`${prefix} 第${pageNum}页请求失败: ${e.message}`);
      emptyCount++;
      if (emptyCount >= 2) break;
      pageNum++;
      continue;
    }

    // 检查是否有内容
    if (!html.includes('caiyouquan_citem')) {
      emptyCount++;
      if (emptyCount >= 2) break;
      pageNum++;
      continue;
    }

    // 分割每一条态度
    const items = html.split(/<div[^>]*class="caiyouquan_citem[^"]*"[^>]*>/i).slice(1);
    if (items.length === 0) {
      emptyCount++;
      if (emptyCount >= 2) break;
      pageNum++;
      continue;
    }

    emptyCount = 0;
    let newCount = 0;
    let earliestDate = '';

    for (const itemHtml of items) {
      const parsed = parseAttitudeItem(itemHtml);

      // 去重（通过 note_id）
      const dedupKey = parsed.note_id || `${parsed.home_team}_${parsed.away_team}_${parsed.match_time}`;
      if (!dedupKey || seenIds.has(dedupKey)) continue;
      seenIds.add(dedupKey);

      // 检查日期是否早于截止日期
      if (parsed.match_time) {
        const yearMatch = html.match(/(\d{4}-\d{2}-\d{2})/);
        // 从上下文推断完整日期
        let fullDate = yearMatch ? yearMatch[1] : '';
        if (parsed.match_time.length <= 11 && fullDate) {
          // 短格式如 "05-12 18:30" → 合并年份
          const mmdd = parsed.match_time.split(' ')[0];
          if (mmdd && !parsed.match_time.startsWith('20')) {
            fullDate = fullDate.substring(0, 5) + parsed.match_time;
          }
        }
        if (!earliestDate || parsed.match_time < earliestDate) {
          earliestDate = parsed.match_time;
        }
      }

      parsed.expert_id = id;
      parsed.expert_name = name;
      allAttitudes.push(parsed);
      newCount++;
    }

    if (newCount === 0) {
      emptyCount++;
      if (emptyCount >= 2) break;
      pageNum++;
      continue;
    }

    pageNum++;
  }

  // 统计
  const completed = allAttitudes.filter((a) => a.is_completed);
  const withPick = allAttitudes.filter((a) => a.pick);

  return {
    expert_id: id,
    expert_name: name,
    attitudes: allAttitudes,
    total_count: allAttitudes.length,
    completed_count: completed.length,
    with_pick_count: withPick.length,
    pages_visited: pageNum - 1,
  };
}

async function initSession() {
  // 先访问一次主页建立 session
  console.log('建立会话 Cookie...');
  try {
    await httpGet(HOST, '/', `https://${HOST}/`);
    console.log('  会话已建立');
  } catch (e) {
    console.log('  会话初始化失败（将继续尝试）: ' + e.message);
  }
  await sleep(2000);
}

async function batchScrapeAttitudes(experts) {
  console.log('\n══════ 阶段2: 批量抓取态度 ══════');
  console.log(`目标: ${experts.length} 位专家\n`);

  // 先初始化会话
  await initSession();

  const results = [];
  const errors = [];
  let wafBlockCount = 0;

  for (let i = 0; i < experts.length; i++) {
    try {
      const result = await scrapeExpertAttitudes(experts[i], i + 1, experts.length);
      const a = result.attitudes;
      console.log(
        `  → ${a.length}条态度 (${result.completed_count}已完成, ${result.with_pick_count}有方向), ${result.pages_visited}页`,
      );
      results.push(result);
    } catch (e) {
      if (e.message === 'WAF_BLOCK') {
        wafBlockCount++;
        console.error(`  ⚠ ${experts[i].name}(${experts[i].id}): WAF 拦截 (#${wafBlockCount})`);
        if (wafBlockCount >= 3) {
          console.error('\n  ❌ WAF 连续拦截 3 次，停止抓取。请稍后重试。');
          break;
        }
        // 等待更长时间后重试
        console.log('  等待 10 秒后继续...');
        await sleep(10000);
      } else {
        console.error(`  ✗ ${experts[i].name}(${experts[i].id}): ${e.message}`);
      }
      errors.push({ expert_id: experts[i].id, name: experts[i].name, error: e.message });
    }
  }

  return { results, errors };
}

// ─── 阶段3: 抓取笔记详情（已完成比赛） ───────────────
/**
 * 从笔记详情页提取完整数据
 */
function parseNoteDetail(html) {
  // 提取所有比赛块
  const matchBlocks = [];
  // 比赛块模式: 编号 + 联赛 + 主队 + 比分 + 客队 + 让球 + SPF赔率
  const matchRegex =
    /周[一二三四五六日]\d+\s+(\S+)\s+(\S+?)\s+(\d+:\d+|\d+-\d+|-)\s+(\S+?)\s+([\s\S]*?)(?=周[一二三四五六日]\d+|【|$)/g;
  let m;
  while ((m = matchRegex.exec(html))) {
    const block = m[5] || '';
    const handicapMatch = block.match(/(-?\d+)/);
    const oddsMatches = block.matchAll(/(\d+\.\d+)/g);
    const odds = [];
    for (const om of oddsMatches) {
      odds.push(parseFloat(om[1]));
    }
    // odds通常为 [胜, 平, 负]
    matchBlocks.push({
      league: m[1].trim(),
      home: m[2].trim(),
      score: m[3].replace(':', '-'),
      away: m[4].trim(),
      handicap: handicapMatch ? handicapMatch[1] : '',
      spf_odds: odds.length >= 3 ? { win: odds[0], draw: odds[1], lose: odds[2] } : null,
    });
  }

  // 提取分析文本中的推荐方向
  const analysisText = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\s\n\r]+/g, ' ')
    .trim();

  // 提取各项推荐方向
  const directions = [];
  const dirPatterns = [
    /参考[：:]*\s*(\S+?)(?:[，,。\.\s]|$)/g,
    /(?:单选|表态)[:：]\s*(\S+)/g,
    /组合参考[：:]*\s*([^。]+)/g,
  ];

  // 提取笔记标题
  const titleMatch = html.match(/【([^】]+)】/);
  const title = titleMatch ? titleMatch[1] : '';

  // 提取发布时间
  const publishTimeMatch = html.match(/(\d{2}-\d{2}\s+\d{2}:\d{2})发布/);
  const publishTime = publishTimeMatch ? publishTimeMatch[1] : '';

  // 提取价格和购买数
  const priceMatch = html.match(/￥(\d+\.?\d*)/);
  const buyCountMatch = html.match(/(\d+)人付费/);

  return {
    title,
    publish_time: publishTime,
    price: priceMatch ? parseFloat(priceMatch[1]) : 0,
    buy_count: buyCountMatch ? parseInt(buyCountMatch[1]) : 0,
    matches: matchBlocks,
    analysis_summary: analysisText.substring(0, 500),
  };
}

async function fetchNoteDetail(noteId) {
  const html = await httpGet(HOST, `/soccer/note/${noteId}/`, `https://${HOST}/jinnang/`);
  return html;
}

async function scrapeNoteDetails(attitudesData) {
  console.log('\n══════ 阶段3: 抓取笔记详情（已完成比赛） ══════');

  const allResults = [];
  let enriched = 0;
  let skipped = 0;

  for (const expert of attitudesData) {
    const { expert_id, expert_name, attitudes } = expert;
    const completedAttitudes = attitudes.filter((a) => a.is_completed && a.note_id);
    console.log(`\n  ${expert_name}(${expert_id}): ${completedAttitudes.length}条已完成笔记`);

    for (let i = 0; i < completedAttitudes.length; i++) {
      const att = completedAttitudes[i];
      if (CONFIG.MAX_NOTE_DETAILS > 0 && enriched >= CONFIG.MAX_NOTE_DETAILS) break;

      await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));

      try {
        const html = await fetchNoteDetail(att.note_id);
        const detail = parseNoteDetail(html);

        // 合并态度信息 + 笔记详情
        allResults.push({
          expert_id,
          expert_name: att.expert_name,
          note_id: att.note_id,
          // 态度层信息
          league: att.league,
          match_time: att.match_time,
          home_team: att.home_team,
          away_team: att.away_team,
          score: att.score,
          pick: att.pick,
          bet_type: att.bet_type,
          // 笔记详情层信息
          title: detail.title,
          publish_time: detail.publish_time,
          price: detail.price,
          buy_count: detail.buy_count,
          matches: detail.matches,
          analysis_summary: detail.analysis_summary,
        });

        enriched++;
        if (enriched % 5 === 0) {
          process.stdout.write(`\r    已抓取 ${enriched} 条笔记详情...`);
        }
      } catch (e) {
        console.error(`\n    ✗ note_id=${att.note_id}: ${e.message}`);
        skipped++;
      }
    }
  }

  console.log(`\n  笔记详情抓取完成: ${enriched} 条成功, ${skipped} 条失败`);
  return allResults;
}

// ─── 保存结果 ─────────────────────────────────────────
function saveAttitudes(results, errors, experts) {
  // 展平所有态度为单层列表
  const allAttitudes = [];
  for (const r of results) {
    for (const a of r.attitudes) {
      allAttitudes.push(a);
    }
  }

  const outPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.ATTITUDES_JSON);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        since: CONFIG.SINCE,
        total_experts_scanned: experts.length,
        success_count: results.length,
        error_count: errors.length,
        total_attitudes: allAttitudes.length,
        completed_attitudes: allAttitudes.filter((a) => a.is_completed).length,
        with_pick_attitudes: allAttitudes.filter((a) => a.pick).length,
        experts: results,
        errors: errors,
      },
      null,
      2,
    ),
  );

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`\n✅ 态度数据已保存: ${outPath} (${sizeKb} KB)`);
}

function saveNoteDetails(details) {
  const outPath = path.join(CONFIG.OUTPUT_DIR, 'okooo_note_details.json');
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        total: details.length,
        details,
      },
      null,
      2,
    ),
  );

  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✅ 笔记详情已保存: ${outPath} (${sizeKb} KB)`);
}

// ─── 增量更新 ─────────────────────────────────────────
async function updateAttitudes(experts) {
  console.log(`\n══════ 增量更新 ══════`);
  console.log(`${experts.length} 位专家，每人最新1页\n`);

  const results = [];
  for (let i = 0; i < experts.length; i++) {
    try {
      const html = await fetchAttitudePage(experts[i].id, 1);
      const items = html.split(/<div[^>]*class="caiyouquan_citem[^"]*"[^>]*>/i).slice(1);
      const attitudes = [];
      for (const itemHtml of items) {
        const parsed = parseAttitudeItem(itemHtml);
        parsed.expert_id = experts[i].id;
        parsed.expert_name = experts[i].name;
        attitudes.push(parsed);
      }
      console.log(`  ${experts[i].name}: ${attitudes.length}条最新态度`);
      results.push({
        expert_id: experts[i].id,
        expert_name: experts[i].name,
        attitudes,
        total_count: attitudes.length,
      });
      await sleep(rand(CONFIG.DELAY_MIN, CONFIG.DELAY_MAX));
    } catch (e) {
      console.error(`  ${experts[i].name}: ${e.message}`);
    }
  }

  return results;
}

// ─── 打印统计 ─────────────────────────────────────────
function printSummary(results, errors) {
  const totalAttitudes = results.reduce((s, r) => s + r.total_count, 0);
  const totalCompleted = results.reduce((s, r) => s + r.completed_count, 0);
  const totalWithPick = results.reduce((s, r) => s + r.with_pick_count, 0);
  const totalPages = results.reduce((s, r) => s + r.pages_visited, 0);

  console.log('\n══════ 抓取汇总 ══════');
  console.log(`  成功专家: ${results.length} | 失败: ${errors.length}`);
  console.log(`  总态度数: ${totalAttitudes}`);
  console.log(`  已完成: ${totalCompleted} | 有方向: ${totalWithPick}`);
  console.log(`  总翻页: ${totalPages}`);
  if (errors.length > 0) {
    console.log(`\n  失败列表:`);
    errors.forEach((e) => console.log(`    ${e.name}(${e.expert_id}): ${e.error}`));
  }
}

// ─── 主入口 ───────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--all';
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  okooo.com 专家推荐数据抓取工具               ║');
  console.log('║  目标: 29位专家, 态度+笔记详情               ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  let experts = [];

  // ── 阶段1: 发现专家 ──
  if (mode === '--discover' || mode === '--all') {
    experts = await discoverExperts();
  } else {
    // 从文件或内置列表加载
    const jsonPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.EXPERTS_JSON);
    if (fs.existsSync(jsonPath)) {
      const d = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      experts = d.experts;
      console.log(`从 ${CONFIG.EXPERTS_JSON} 加载 ${experts.length} 位专家`);
    } else {
      experts = CONFIG.BUILTIN_EXPERTS;
      console.log(`使用内置 ${experts.length} 位专家列表`);
    }
  }

  // ── 阶段2: 抓取态度 ──
  let attitudeResults = [];
  if (mode === '--scrape' || mode === '--all') {
    const { results, errors } = await batchScrapeAttitudes(experts);
    saveAttitudes(results, errors, experts);
    printSummary(results, errors);
    attitudeResults = results;
  }

  // ── 增量更新 ──
  if (mode === '--update') {
    attitudeResults = await updateAttitudes(experts);
    const allAttitudes = attitudeResults.reduce((s, r) => s + r.total_count, 0);
    console.log(`\n增量更新: ${allAttitudes} 条最新态度`);
    fs.writeFileSync(
      path.join(CONFIG.OUTPUT_DIR, 'okooo_attitudes_update.json'),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          experts: attitudeResults,
        },
        null,
        2,
      ),
    );
  }

  // ── 阶段3: 笔记详情 ──
  if (mode === '--detail') {
    // 从文件读取态度数据
    const attPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.ATTITUDES_JSON);
    if (!fs.existsSync(attPath)) {
      console.log('请先运行 --scrape 抓取态度数据');
      return;
    }
    const attData = JSON.parse(fs.readFileSync(attPath, 'utf-8'));
    const details = await scrapeNoteDetails(attData.experts);
    saveNoteDetails(details);
  }

  // ── 全流程（含详情） ──
  if (mode === '--all') {
    const details = await scrapeNoteDetails(attitudeResults);
    saveNoteDetails(details);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n总耗时: ${elapsed} 分钟`);
}

main().catch((err) => {
  console.error('❌ 失败:', err);
  process.exit(1);
});
