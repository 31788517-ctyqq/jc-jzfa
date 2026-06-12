/**
 * sync_live_500.js — 500.com 即时比分抓取器
 *
 * 数据源: https://live.500.com/?e=YYYY-MM-DD (无需认证, GBK编码)
 * 字段: 场次 / 状态 / 比分 / 半场 / 黄牌 / 红牌 / FIFA排名
 *
 * 配合 data_sync.js:
 *   - 比分+红黄牌: 500.com (每2分钟)
 *   - 推荐/命中: midou310 (保持不变, 每20分钟)
 *
 * 用法: node server/sync_live_500.js [date]
 *       默认: 今天
 */

const https = require('https');
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const LIVE_URL = 'https://live.500.com/?e=';
const LIVE_FILE = path.join(__dirname, 'live_scores.json');
const DATA_FILE = path.join(__dirname, 'data.json');

// ═══ 工具 ═══
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Referer: 'https://live.500.com/',
          },
          timeout: 10000,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'gbk')));
        },
      )
      .on('error', reject);
  });
}

function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, filePath);
}

// ═══ 解析比赛数据（含红黄牌） ═══
function parse500Live(html) {
  const matches = [];

  // 找到主表格: 包含比赛数据的行
  // 每行格式: 场次 | 赛事 | 轮次 | 时间 | 状态 | 主队(含排名) | 盘口 | 客队(含排名+卡) | 比分 | ...
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const trContent = trMatch[1];
    const tds = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(trContent)) !== null) {
      tds.push(tdMatch[1]);
    }

    if (tds.length < 8) continue;

    // 第0列: 场次编号 (如 "周日201")
    const col0 = tds[0].replace(/<[^>]+>/g, '').trim();
    if (!/^周[一二三四五六日]\d{3}$/.test(col0)) continue;

    const matchNum = col0;

    // ═══ 提取各列 ═══
    // 第4列 (index 4): 状态 (完/中/推迟/取消)
    let statusStr = tds[4] ? tds[4].replace(/<[^>]+>/g, '').trim() : '';
    let matchStatus = 0;
    if (statusStr === '中' || statusStr === '进行' || statusStr === '1') matchStatus = 1;
    else if (statusStr === '完' || statusStr === '结束' || statusStr === '2') matchStatus = 2;
    else if (statusStr === '推迟' || statusStr === '取消' || statusStr === '3') matchStatus = 3;

    // ★ 提取红黄牌: 在球队名列中查找 <span class="yellowcard">/<span class="redcard">
    let homeYellow = '',
      homeRed = '',
      awayYellow = '',
      awayRed = '';

    // 遍历所有td，找含 yellowcard/redcard span 的列
    for (let i = 0; i < tds.length; i++) {
      const tdHTML = tds[i] || '';

      // 提取黄牌
      const ycMatch = tdHTML.match(/<span[^>]*class\s*=\s*["']yellowcard["'][^>]*>\s*(\d+)\s*<\/span>/i);
      // 提取红牌
      const rcMatch = tdHTML.match(/<span[^>]*class\s*=\s*["']redcard["'][^>]*>\s*(\d+)\s*<\/span>/i);

      if (ycMatch || rcMatch) {
        // 判断是主队还是客队侧
        // 主队通常在盘口列(第6列)之前，客队之后
        if (i <= 6) {
          if (ycMatch) homeYellow = ycMatch[1];
          if (rcMatch) homeRed = rcMatch[1];
        } else {
          if (ycMatch) awayYellow = ycMatch[1];
          if (rcMatch) awayRed = rcMatch[1];
        }
      }
    }

    // ═══ 提取球队名和比分 ═══
    // 第5列 (index 5): 主队名+排名
    const col5Text = tds[5]
      ? tds[5]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
      : '';

    // 第7列 (index 7): 客队名+排名+卡牌
    const col7Text = tds[7]
      ? tds[7]
          .replace(/<span[^>]*>.*?<\/span>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
      : '';

    // 第8列 (index 8): 比分 (如 "0 - 0")
    let scoreStr = tds[8] ? tds[8].replace(/<[^>]+>/g, '').trim() : '';
    // 如果第8列不是比分，回退查找
    if (!/\d+\s*[-:：]\s*\d+/.test(scoreStr)) {
      for (let i = 6; i < Math.min(12, tds.length); i++) {
        const t = tds[i] ? tds[i].replace(/<[^>]+>/g, '').trim() : '';
        if (/\d+\s*[-:：]\s*\d+/.test(t)) {
          scoreStr = t;
          break;
        }
      }
    }

    // ═══ 提取球队名 ═══
    // 主队: 从 col5 提取，去掉排名标记和数字
    let homeName = col5Text
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\d+$/g, '')
      .trim();
    // 客队: 从 col7 提取
    let visitName = col7Text
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\d+$/g, '')
      .trim();

    // 如果主队名没找到，用链接中的文字
    if (!homeName) {
      const aMatch = (tds[5] || '').match(/<a[^>]*>([^<]+)<\/a>/);
      if (aMatch) homeName = aMatch[1].trim();
    }
    if (!visitName) {
      const aMatch = (tds[7] || '').match(/<a[^>]*>([^<]+)<\/a>/);
      if (aMatch) visitName = aMatch[1].trim();
    }

    // ═══ 解析比分 ═══
    let homeGoals = -1,
      awayGoals = -1,
      score = '';
    if (scoreStr) {
      const parts = scoreStr.split(/\s*[-:：]\s*/);
      if (parts.length >= 2) {
        const h = parseInt(parts[0].trim());
        const a = parseInt(parts[1].trim());
        if (!isNaN(h) && !isNaN(a)) {
          homeGoals = h;
          awayGoals = a;
          score = h + '-' + a;
        }
      }
    }

    // ═══ 半场比分 ═══
    let halfScore = '';
    for (let i = 9; i < Math.min(tds.length, 11); i++) {
      const t = tds[i] ? tds[i].replace(/<[^>]+>/g, '').trim() : '';
      if (/^\d+\s*[-:：]\s*\d+$/.test(t)) {
        halfScore = t.replace(/\s+/g, '').replace(/[:：]/, '-');
        break;
      }
    }

    // ═══ 比赛进行时间 ═══
    let duration = '';
    for (const td of tds) {
      const t = td.replace(/<[^>]+>/g, '').trim();
      if (/(\d+)\s*['\u2018\u2019′分]/.test(t)) {
        const m = t.match(/(\d+)/);
        if (m) duration = m[1] + "'";
        break;
      }
    }

    // ═══ 比赛时间 ═══
    let startTime = '';
    for (const td of tds.slice(0, 5)) {
      const t = td.replace(/<[^>]+>/g, '').trim();
      if (/^\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(t)) {
        startTime = t.replace('-', '/');
        break;
      }
    }

    matches.push({
      matchNum,
      homeName,
      visitName,
      score,
      homeGoals,
      visitGoals: awayGoals,
      halfScore,
      matchStatus,
      duration,
      startTime,
      yellow: homeYellow || awayYellow ? `${homeYellow || '0'}/${awayYellow || '0'}` : '',
      red: homeRed || awayRed ? `${homeRed || '0'}/${awayRed || '0'}` : '',
    });
  }

  return matches;
}

// ═══ 将比分合并到 data.json ═══
function syncToDataJson(liveMatches, dateStr) {
  let data = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    return 0;
  }

  if (!data.m) data.m = {};

  // 构建 num→key 索引
  const numIndex = {};
  Object.entries(data.m).forEach(([k, m]) => {
    if (m && m.num) numIndex[m.num] = k;
  });

  let updated = 0;
  for (const lm of liveMatches) {
    let key = numIndex[lm.matchNum];
    let old = key ? data.m[key] : null;
    if (!old) continue;

    let changed = false;
    const fields = {
      matchStatus: lm.matchStatus,
      score: lm.score,
      halfScore: lm.halfScore,
      duration: lm.duration,
    };
    // ★ 红黄牌
    if (lm.yellow) fields.yellow = lm.yellow;
    if (lm.red) fields.red = lm.red;

    for (const [field, val] of Object.entries(fields)) {
      if (val !== undefined && val !== null && val !== '' && String(old[field]) !== String(val)) {
        // ★ 已完赛的比赛不因 matchStatus=0 而回退
        //    BUT: 有比分但无 duration → 半场误判修护
        if (field === 'matchStatus' && old.matchStatus >= 2 && val === 0) {
          if (old.score && !old.duration) { /* 半场误判，允许回退 */ }
          else continue;
        }
        old[field] = val;
        changed = true;
      }
    }

    if (changed) updated++;
  }

  if (updated > 0) {
    atomicWrite(DATA_FILE, data);
  }
  return updated;
}

// ═══ 主函数 ═══
async function fetchLive500(dateStr) {
  if (!dateStr) {
    const now = new Date();
    dateStr = now.toISOString().slice(0, 10);
  }

  const url = LIVE_URL + dateStr;
  console.log(`[500live] 抓取 ${dateStr}: ${url}`);

  try {
    const html = await httpGet(url);
    console.log(`[500live] 响应: ${html.length} 字节`);

    const matches = parse500Live(html);
    console.log(`[500live] 解析: ${matches.length} 场比赛`);

    if (matches.length === 0) {
      console.log(`[500live] 无比赛数据`);
      return { success: true, matches: 0 };
    }

    // 写入 live_scores.json
    const liveData = {
      date: dateStr,
      matches: matches.map((m) => ({
        num: m.matchNum,
        homeName: m.homeName,
        visitName: m.visitName,
        score: m.score,
        homeScore: m.homeGoals,
        visitScore: m.visitGoals,
        halfScore: m.halfScore,
        yellow: m.yellow,
        red: m.red,
        matchStatus: m.matchStatus,
        duration: m.duration,
        date: dateStr,
      })),
      updated: new Date().toISOString(),
    };
    atomicWrite(LIVE_FILE, liveData);

    // 合并到 data.json
    const updated = syncToDataJson(matches, dateStr);
    console.log(`[500live] data.json 更新: ${updated} 场`);

    // 摘要
    const liveCount = matches.filter((m) => m.matchStatus === 1).length;
    const finishedCount = matches.filter((m) => m.matchStatus >= 2).length;
    console.log(`[500live] 赛中:${liveCount} 已结束:${finishedCount}`);

    return { success: true, matches: matches.length, live: liveCount, finished: finishedCount, updated };
  } catch (e) {
    console.error(`[500live] 失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

module.exports = { fetchLive500, parse500Live, syncToDataJson, httpGet };

if (require.main === module) {
  const dateArg = process.argv[2] || null;
  fetchLive500(dateArg).then((r) => {
    console.log(`\nResult: ${JSON.stringify(r)}`);
    if (!r.success) process.exit(1);
  });
}
