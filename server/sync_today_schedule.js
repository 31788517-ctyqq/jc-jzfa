/**
 * sync_today_schedule.js — 今日赛程高频检查器
 *
 * 需求: 官网有赛程 → 页面立刻展示
 *
 * 数据源优先级:
 *   1. 500.com 赔率页 (最快, 纯HTTP, GBK, 赔率开盘即有数据 → 通常前一天晚上)
 *   2. SP官方 schedule 缓存 (Playwright 抓取, 上午更新)
 *   3. midou310 API (Token认证, 兜底)
 *
 * 调度: 每5分钟检查一次 (6:00~12:00), 首次获取到数据后立即写入 data.json
 *
 * 用法: node server/sync_today_schedule.js [date]
 *       模块导出供 data_sync.js 调用
 */

const https = require('https');
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_DIR = path.join(__dirname, 'odds_history');

function fmtLocal(dd) {
  return (
    dd.getFullYear() + '-' + String(dd.getMonth() + 1).padStart(2, '0') + '-' + String(dd.getDate()).padStart(2, '0')
  );
}

// ═══ 源1: 500.com 赔率页 → 提取赛程 ═══
function fetch500Page(dateStr) {
  return new Promise((resolve, reject) => {
    // 使用开奖详情页 (比 trade 页更早出数据)
    const url = 'https://trade.500.com/jczq/';
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Referer: 'https://trade.500.com/',
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

/** 从 500.com 赔率 HTML 提取所有比赛的场次编号 */
function extractMatchNumsFrom500(html) {
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const matchRegex = new RegExp('(' + weekDays.join('|') + ')(\\d{3})', 'g');
  const nums = [];
  let m;
  while ((m = matchRegex.exec(html)) !== null) {
    const num = m[1] + m[2];
    if (!nums.includes(num)) nums.push(num);
  }
  return nums;
}

/** 从 odds_history 获取指定日期的赔率数据 (已有) */
function getCachedOdds(dateStr) {
  const fp = path.join(ODDS_DIR, dateStr + '.json');
  if (fs.existsSync(fp) && fs.statSync(fp).size > 100) {
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'));
    } catch (e) {}
  }
  return null;
}

/** 从 500.com 赔率数据提取赛程信息 */
function oddsToSchedule(oddsData, dateStr) {
  const matches = [];
  const odds = oddsData.odds || {};

  Object.entries(odds).forEach(([num, data]) => {
    if (!data || !num) return;
    // 只处理竞彩编号格式的 key
    if (!/^周[一二三四五六日]\d{3}$/.test(num)) return;

    matches.push({
      num,
      homeName: data.homeName || '',
      visitName: data.visitName || '',
      leagueName: data.leagueName || '',
      date: dateStr,
      source: '500_odds',
      // 生成稳定的 matchId
      matchId: 'f500_' + dateStr.replace(/-/g, '') + '_' + num.replace(/周[一二三四五六日]/, ''),
    });
  });

  return matches;
}

// ═══ 源2: SP 官方 schedule 缓存 ═══
function getCachedSchedule() {
  const scheduleDir = path.join(__dirname, 'sporttery_schedule');
  if (!fs.existsSync(scheduleDir)) return null;

  const files = fs
    .readdirSync(scheduleDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  for (const f of files.slice(0, 3)) {
    // 只看最近3个
    try {
      const data = JSON.parse(fs.readFileSync(path.join(scheduleDir, f), 'utf8'));
      const text = data.text || '';

      // 解析日期和比赛数
      const dateGroups = [];
      const pat = /(周[一二三四五六日]) (\d{4}-\d{2}-\d{2}) 共(\d+)场/g;
      let m;
      while ((m = pat.exec(text)) !== null) {
        dateGroups.push({ dow: m[1], date: m[2], count: parseInt(m[3]) });
      }
      if (dateGroups.length > 0) {
        return { file: f, dates: dateGroups, text };
      }
    } catch (e) {}
  }
  return null;
}

// ═══ 核心: 合并赛程到 data.json ═══
function mergeScheduleToData(matches) {
  let data = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  if (!data.m) data.m = {};

  // 构建 num→key 索引
  const numIndex = {};
  Object.entries(data.m).forEach(([k, m]) => {
    if (m && m.num) numIndex[m.num] = k;
  });

  let added = 0,
    skipped = 0,
    updated = 0;
  const now = new Date().toISOString();

  for (const sp of matches) {
    const existingKey = numIndex[sp.num];

    if (existingKey) {
      // 已有记录，只补充信息
      const old = data.m[existingKey];
      let changed = false;
      if (!old.homeName || old.homeName === '') {
        old.homeName = sp.homeName;
        changed = true;
      }
      if (!old.visitName || old.visitName === '') {
        old.visitName = sp.visitName;
        changed = true;
      }
      if (!old.leagueName || old.leagueName === '') {
        old.leagueName = sp.leagueName;
        changed = true;
      }
      if (!old.matchId) {
        old.matchId = sp.matchId;
        changed = true;
      }
      if (changed) updated++;
      else skipped++;
      if (!changed) continue;
    } else {
      // 新记录: 生成唯一 key
      const key = 'm_' + sp.matchId;
      data.m[key] = {
        matchId: sp.matchId,
        num: sp.num,
        homeName: sp.homeName,
        visitName: sp.visitName,
        leagueName: sp.leagueName || '',
        startTime: '',
        date: sp.date,
        matchStatus: 0,
        score: '',
        halfScore: '',
        duration: '',
        yellow: '',
        red: '',
        recommNum: 0,
        source: sp.source,
        _syncedAt: now,
      };
      numIndex[sp.num] = key;
      added++;
    }
  }

  // 原子写入
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, DATA_FILE);

  return { added, updated, skipped };
}

// ═══ 主入口: 检查今天赛程 ═══
async function checkTodaySchedule(dateStr) {
  if (!dateStr) {
    dateStr = fmtLocal(new Date());
  }

  // 先检查现有数据
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      let count = 0;
      Object.values(data.m || {}).forEach((m) => {
        if (m && m.date && m.date.slice(0, 10) === dateStr) count++;
      });
      if (count > 0) {
        return { success: true, source: 'already_exists', matches: count, added: 0 };
      }
    }
  } catch (e) {}

  // ═══ 策略1: 500.com 赔率 (最快, 队名+编号) ═══
  console.log(`[today_sch] 策略1: 从 500.com 赔率页提取赛程...`);
  try {
    const { fetchOdds } = require('./fetch_500odds');
    const odds = await fetchOdds(dateStr);
    const matchNums = Object.keys(odds);

    if (matchNums.length > 0) {
      console.log(`[today_sch] 500.com 发现 ${matchNums.length} 场比赛: ${matchNums.slice(0, 5).join(',')}...`);

      const matches = matchNums.map((num) => {
        const data = odds[num] || {};
        return {
          num,
          homeName: data.homeName || '',
          visitName: data.visitName || '',
          leagueName: data.leagueName || '',
          date: dateStr,
          source: '500_odds',
          matchId: 'f500_' + dateStr.replace(/-/g, '') + '_' + num.replace(/周[一二三四五六日]/, ''),
        };
      });

      const result = mergeScheduleToData(matches);
      console.log(`[today_sch] ✓ 500.com: 新增${result.added} 更新${result.updated}`);
      return { success: true, source: '500_odds', matches: matchNums.length, ...result };
    }
  } catch (e) {
    console.log(`[today_sch] 500.com 失败: ${e.message}`);
  }

  // ═══ 策略2: SP 官方 schedule 缓存（从文本解析） ═══
  console.log(`[today_sch] 策略2: 检查 SP schedule 缓存...`);
  try {
    const cached = getCachedSchedule();
    if (cached) {
      const todayGroup = cached.dates.find((d) => d.date === dateStr);
      if (todayGroup && todayGroup.count > 0) {
        // 直接从文本解析比赛（内联，不依赖 sync_gov_schedule 导出）
        const matches = parseSPScheduleText(cached.text, dateStr);
        if (matches.length > 0) {
          const result = mergeScheduleToData(matches);
          console.log(`[today_sch] ✓ SP缓存: ${matches.length}场, 新增${result.added}`);
          return { success: true, source: 'sp_cached', matches: matches.length, ...result };
        }
      }
    }
  } catch (e) {
    console.log(`[today_sch] SP缓存: ${e.message}`);
  }

  // ═══ 策略3: 触发 midou310 同步 ═══
  console.log(`[today_sch] 策略3: 触发 midou310 同步...`);
  try {
    const { syncMatchList } = require('./data_sync');
    await syncMatchList(dateStr);

    // 检查结果
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      let count = 0;
      Object.values(data.m || {}).forEach((m) => {
        if (m && m.date && m.date.slice(0, 10) === dateStr) count++;
      });
      if (count > 0) {
        console.log(`[today_sch] ✓ midou310: ${count}场`);
        return { success: true, source: 'midou310', matches: count, added: count };
      }
    }
    console.log(`[today_sch] midou310 未返回数据`);
  } catch (e) {
    console.log(`[today_sch] midou310 失败: ${e.message}`);
  }

  return { success: false, matches: 0, added: 0 };
}

// ═══ SP schedule 文本解析（内联版） ═══
function parseSPScheduleText(text, targetDate) {
  if (!targetDate) targetDate = fmtLocal(new Date());
  const matches = [];

  // 匹配: 周日201 联赛 主队VS客队 YYYY-MM-DD HH:MM
  const pat = /(周[一二三四五六日])(\d{3})\s+(\S+)\s+(\S+?)VS(\S+?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g;
  let m;
  while ((m = pat.exec(text)) !== null) {
    const matchNum = m[1] + m[2];
    const league = m[3];
    const homeName = m[4].trim();
    const visitName = m[5].trim();
    const date = m[6].slice(0, 10);

    if (date !== targetDate) continue;

    const matchId = 'sp_' + date.replace(/-/g, '') + '_' + matchNum.replace(/周[一二三四五六日]/, '');
    matches.push({
      matchId,
      num: matchNum,
      homeName,
      visitName,
      leagueName: league,
      date,
      source: 'sp_schedule',
    });
  }

  // 备选: 匹配 "竞彩周四201,主队,客队,yyyy-MM-DD,HH:mm" 格式
  if (matches.length === 0) {
    const altPat = /(周[一二三四五六日])(\d{3}),([^,]+),([^,]+),(\d{4}-\d{2}-\d{2}),(\d{2}:\d{2})/g;
    while ((m = altPat.exec(text)) !== null) {
      const date = m[5];
      if (date !== targetDate) continue;
      const matchId = 'sp_' + date.replace(/-/g, '') + '_' + m[2];
      matches.push({
        matchId,
        num: m[1] + m[2],
        homeName: m[3].trim(),
        visitName: m[4].trim(),
        leagueName: '',
        date,
        source: 'sp_schedule',
        startTime: `${m[5].slice(5)}/${m[6]}`,
      });
    }
  }

  return matches;
}

module.exports = { checkTodaySchedule, mergeScheduleToData, extractMatchNumsFrom500 };

if (require.main === module) {
  const date = process.argv[2] || fmtLocal(new Date());
  checkTodaySchedule(date).then((r) => {
    console.log(`\nResult: ${JSON.stringify(r)}`);
    if (!r.success) process.exit(1);
  });
}
