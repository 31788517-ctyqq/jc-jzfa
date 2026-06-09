/**
 * sync_gov_schedule.js — 官方赛程轻量抓取器（纯 HTTP，无需 Playwright）
 * 
 * 数据源: 官方赛程页（服务端渲染，table 标签包含全部数据）
 * 用法: node server/sync_gov_schedule.js
 * 
 * 输出: 将解析的赛程数据合并到 data.json，作为赛程主数据源
 */

const https = require('https');
const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, 'data.json');
const SCHEDULE_URL = 'https://www.lottery.gov.cn/jc/zqszsc/';

// ═══ HTTP GET（UTF-8） ═══
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      timeout: 15000,
      rejectUnauthorized: false,
    }, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject);
  });
}

// ═══ 解析赛程 ═══
function parseSchedule(html) {
  const matches = [];

  // 策略1: 从 HTML table 提取
  const tableRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>(.*?)<\/t[dh]>/gi;

  let matchLines = [];

  // 先尝试解析 table 行
  const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = [];
    let cellMatch;
    const cellRe = /<t[dh][^>]*>(.*?)<\/t[dh]>/gi;
    while ((cellMatch = cellRe.exec(row)) !== null) {
      // Strip HTML tags from cell content
      const text = cellMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      cells.push(text);
    }
    if (cells.length >= 4) {
      // Check if first cell looks like a match number (e.g., "周四201")
      if (/^周[一二三四五六日]\d{3}$/.test(cells[0])) {
        matchLines.push(cells);
      }
    }
  }

  // 策略2: 如果 table 解析为空，尝试从纯文本提取
  if (matchLines.length === 0) {
    const text = html.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ');
    const textLines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of textLines) {
      const parts = line.split(/\t/);
      if (parts.length >= 4 && /^周[一二三四五六日]\d{3}$/.test(parts[0].trim())) {
        matchLines.push(parts.map(p => p.trim()));
      }
    }
  }

  // 策略3: 使用更灵活的文本模式匹配
  if (matchLines.length === 0) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ');
    const pat = /(周[一二三四五六日])(\d{3})\s+(\S+)\s+(\S+?)VS(\S+?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g;
    let m;
    while ((m = pat.exec(text)) !== null) {
      matchLines.push([m[1] + m[2], m[3], m[4] + 'VS' + m[5], m[6]]);
    }
  }

  // 转换为统一 match 对象
  const weekMap = { '周日': 0, '周一': 1, '周二': 2, '周三': 3, '周四': 4, '周五': 5, '周六': 6 };

  for (const cells of matchLines) {
    const matchNum = cells[0] || '';
    const league = cells[1] || '';
    const teamsRaw = cells[2] || '';
    const dateTimeRaw = cells[3] || '';

    // 解析 主队VS客队
    const vsMatch = teamsRaw.match(/^(.+?)[Vv][Ss](.+)$/);
    if (!vsMatch) continue;
    const homeName = vsMatch[1].trim();
    const visitName = vsMatch[2].trim();

    // 解析日期时间
    const dtMatch = dateTimeRaw.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
    const date = dtMatch ? dtMatch[1] : '';
    const time = dtMatch ? dtMatch[2] : '';
    const startTime = date && time ? `${date.slice(5).replace('-', '/')} ${time}` : '';

    if (!date || !matchNum) continue;

    // 生成稳定的 matchId（基于日期+编号）
    const matchId = `gov_${date.replace(/-/g, '')}_${matchNum.replace(/周[一二三四五六日]/, '')}`;

    matches.push({
      matchId,
      num: matchNum,
      homeName,
      visitName,
      leagueName: league,
      startTime,
      date,
      source: 'gov_schedule',
    });
  }

  // 按日期分组统计
  const byDate = {};
  matches.forEach(m => {
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push(m);
  });

  return { matches, byDate };
}

// ═══ 合并到 data.json ═══
function mergeToDataJson(matches) {
  let data = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}

  if (!data.m) data.m = {};
  if (!data.r) data.r = {};

  let added = 0, updated = 0, skipped = 0;
  const now = new Date().toISOString();

  for (const m of matches) {
    const mid = m.matchId;
    const mkey = `m_${mid}`;

    // 检查是否已存在（先按 matchId 找，再按 num+date 找）
    let existingKey = null;
    if (data.m[mkey]) {
      existingKey = mkey;
    } else {
      // 按竞彩编号+日期匹配已有记录
      for (const [k, v] of Object.entries(data.m)) {
        if (v && v.num === m.num && v.date && v.date.slice(0, 10) === m.date) {
          existingKey = k;
          break;
        }
      }
    }

    if (existingKey) {
      const old = data.m[existingKey];
      // 仅更新可能在变化的信息
      if (old.leagueName !== m.leagueName || old.homeName !== m.homeName || old.visitName !== m.visitName) {
        old.leagueName = old.leagueName || m.leagueName;
        old.homeName = m.homeName;  // 官方队名更准
        old.visitName = m.visitName;
        old.source = 'gov_schedule';
        updated++;
      } else {
        skipped++;
      }
    } else {
      // 新增
      data.m[mkey] = {
        matchId: mid,
        num: m.num,
        homeName: m.homeName,
        visitName: m.visitName,
        leagueName: m.leagueName,
        startTime: m.startTime,
        date: m.date,
        matchStatus: 0,
        score: '',
        halfScore: '',
        duration: '',
        yellow: '',
        red: '',
        recommNum: 0,
        source: 'gov_schedule',
        _syncedAt: now,
      };
      added++;
    }
  }

  // 原子写入
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, DATA_FILE);

  return { added, updated, skipped, total: Object.keys(data.m).length };
}

// ═══ 主函数 ═══
async function main() {
  console.log('═══════════════════════════════');
  console.log('  官方赛程抓取');
  console.log('═══════════════════════════════');

  // 策略1: 尝试纯 HTTP 抓取（快速、轻量）
  console.log(`[HTTP] 尝试纯 HTTP 抓取: ${SCHEDULE_URL}`);
  let html = '';
  let useHTTP = true;

  try {
    html = await httpGet(SCHEDULE_URL);
    console.log(`[HTTP] 响应: ${html.length} 字节`);
  } catch (e) {
    console.log(`[HTTP] 请求失败: ${e.message}`);
    html = '';
  }

  // 检测是否为 JS 渲染页面（无 table 标签 + 内容过短）
  const hasTable = /<table/i.test(html) || />周[一二三四五六日]\d{3}</.test(html);
  
  if (!hasTable || html.length < 2000) {
    console.log('[HTTP] 页面需 JS 渲染，尝试 Playwright 方案...');
    useHTTP = false;

    // 策略2: 检查是否已有 Playwright 抓取的 schedule 文件
    const scheduleDir = path.join(__dirname, 'sporttery_schedule');
    if (fs.existsSync(scheduleDir)) {
      const files = fs.readdirSync(scheduleDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse();
      
      if (files.length > 0) {
        const latestFile = path.join(scheduleDir, files[0]);
        console.log(`[Schedule] 使用已有赛程文件: ${files[0]}`);
        try {
          const scheduleData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
          const text = scheduleData.text || '';
          
          // 从保存的文本中解析
          const { byDate } = parseScheduleText(text);
          if (Object.keys(byDate).length > 0) {
            console.log(`[Schedule] 从文本解析: ${Object.values(byDate).flat().length} 场比赛`);
            const matches = Object.values(byDate).flat();
            const result = mergeToDataJson(matches);
            console.log(`合并结果: 新增${result.added} 更新${result.updated} 跳过${result.skipped}`);
            console.log(`[OK] 同步完成 (from cached schedule)`);
            return { success: true, ...result, method: 'cached_schedule' };
          }
        } catch (e) {
          console.log(`[Schedule] 文件解析失败: ${e.message}`);
        }
      }
    }

    // 策略3: 尝试用 Playwright 获取（需要 Python 环境）
    console.log('[Schedule] 尝试 python scripts/scrape_sporttery.py --schedule ...');
    try {
      const { execSync } = require('child_process');
      const pyCmd = process.platform === 'win32' ? 'python' : 'python3';
      const scriptPath = path.join(__dirname, '..', 'scripts', 'scrape_sporttery.py');
      execSync(`${pyCmd} "${scriptPath}" --schedule`, {
        cwd: path.join(__dirname, '..'),
        timeout: 120000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });
      console.log('[Schedule] Playwright 抓取完成');

      // 重新读取最新 schedule 文件
      const newFiles = fs.readdirSync(scheduleDir).filter(f => f.endsWith('.json')).sort().reverse();
      if (newFiles.length > 0) {
        const data = JSON.parse(fs.readFileSync(path.join(scheduleDir, newFiles[0]), 'utf8'));
        const { byDate } = parseScheduleText(data.text || '');
        if (Object.keys(byDate).length > 0) {
          const matches = Object.values(byDate).flat();
          const result = mergeToDataJson(matches);
          console.log(`合并结果: 新增${result.added} 更新${result.updated} 跳过${result.skipped}`);
          return { success: true, ...result, method: 'playwright' };
        }
      }
    } catch (e) {
      console.log(`[Schedule] Playwright 失败: ${e.message}`);
    }

    console.log('[WARN] 所有方案均失败，请手动执行: python scripts/scrape_sporttery.py --schedule');
    return { success: false, reason: 'all_methods_failed', matches: 0 };
  }

  // HTTP 解析成功
  console.log(`[HTTP] 响应有效，解析赛程...`);
  const { matches, byDate } = parseSchedule(html);
  console.log(`解析: ${matches.length} 场比赛`);

  for (const [date, ms] of Object.entries(byDate).sort()) {
    console.log(`  ${date}: ${ms.length} 场`);
  }

  if (matches.length === 0) {
    console.log('[WARN] 未解析到比赛');
    return { success: false, reason: 'parse_empty', matches: 0 };
  }

  const result = mergeToDataJson(matches);
  console.log(`\n合并结果:`);
  console.log(`  新增: ${result.added} 场`);
  console.log(`  更新: ${result.updated} 场`);
  console.log(`  跳过: ${result.skipped} 场`);
  console.log(`  总计: ${result.total} 条记录`);
  console.log(`\n[OK] 同步完成`);

  return { success: true, ...result, method: 'http' };
}

// ═══ 从纯文本解析赛程（用于 Playwright 抓取的 text 字段） ═══
function parseScheduleText(text) {
  const matches = [];
  const byDate = {};

  // 使用灵活的文本模式匹配
  const pat = /(周[一二三四五六日])(\d{3})\s+(\S+)\s+(\S+?)VS(\S+?)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/g;
  let m;
  while ((m = pat.exec(text)) !== null) {
    const matchNum = m[1] + m[2];
    const league = m[3];
    const homeName = m[4].trim();
    const visitName = m[5].trim();
    const date = m[6].slice(0, 10);
    const time = m[6].slice(11);
    const startTime = `${date.slice(5).replace('-', '/')} ${time}`;
    const matchId = `sp_${date.replace(/-/g, '')}_${matchNum.replace(/周[一二三四五六日]/, '')}`;

    const match = {
      matchId, num: matchNum, homeName, visitName,
      leagueName: league, startTime, date, source: 'sp_schedule',
    };
    matches.push(match);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(match);
  }

  return { matches, byDate };
}

module.exports = { main, parseSchedule, mergeToDataJson, httpGet };

if (require.main === module) {
  main().then(r => {
    if (!r.success) process.exit(1);
  });
}
