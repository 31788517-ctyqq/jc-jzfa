/**
 * 从体彩官网补全 03-19 ~ 04-24 期间缺失的 halfFull 赔率
 *
 * ★ 关键修正: API key 是 hh/hd/ha/dh/dd/da/ah/ad/aa（不是 h/d/a）
 * ★ 之前的 scrape_sporttery_odds.py 用错了 key 导致 ss/sp/sf 全为空
 *
 * 用法: node scripts/backfill_sporttery_hh.js --dry  (探测模式)
 *       node scripts/backfill_sporttery_hh.js          (抓取+写入)
 */

const fs = require('fs');
const path = require('path');

const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const CACHE_FILE = path.join(__dirname, '..', 'server', 'ttyingqiu_data', 'sporttery_hh_cache.json');
const DATE_START = '2026-03-19';
const DATE_END = '2026-04-27';
const DRY_RUN = process.argv.includes('--dry');
const BATCH_SIZE = 40;
const DELAY_MS = 150;

// matchId 范围 (根据数据估算)
const ID_START = 2036800;
const ID_END = 2040000;

// ── API 调用 ──
let reqCount = 0;
async function fetchMatch(matchId) {
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  try {
    reqCount++;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
        Referer: 'https://www.sporttery.cn/',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.success || !data.value) return null;

    const oh = data.value.oddsHistory || {};
    const hafu = oh.hafuList || [];
    if (hafu.length === 0) return null;

    // ★ 用正确的 key: hh/hd/ha/dh/dd/da/ah/ad/aa
    const first = hafu[0];
    return {
      matchId: String(matchId),
      date: first.updateDate || '',
      home: oh.homeTeamAllName || oh.homeTeamAbbName || '',
      away: oh.awayTeamAllName || oh.awayTeamAbbName || '',
      league: oh.leagueAbbName || '',
      halfFull: {
        hh: first.hh || null,
        hd: first.hd || null,
        ha: first.ha || null,
        dh: first.dh || null,
        dd: first.dd || null,
        da: first.da || null,
        ah: first.ah || null,
        ad: first.ad || null,
        aa: first.aa || null,
      },
      updateTime: `${first.updateDate || ''} ${first.updateTime || ''}`.trim(),
    };
  } catch (e) {
    return null;
  }
}

// ── 主流程 ──
async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  从体彩官网补全 halfFull 赔率 (03-19 ~ 04-27)');
  console.log('  使用正确 API key: hh/hd/ha/dh/dd/da/ah/ad/aa');
  console.log(DRY_RUN ? '  >>> DRY RUN (不写入文件)' : '  >>> 写入模式');
  console.log('══════════════════════════════════════════════════════\n');

  // 加载现有 odds_history 确定需要补全的 matchNum
  console.log('[1/4] 分析需要补全的比赛...');

  const needsBackfill = {}; // date -> [{ matchNum, homeName, visitName, matchId }]
  let totalNeed = 0;

  for (let d = new Date(DATE_START); d <= new Date(DATE_END); d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const file = path.join(ODDS_DIR, ds + '.json');
    if (!fs.existsSync(file)) continue;

    const od = JSON.parse(fs.readFileSync(file, 'utf8'));
    const odds = od.odds || {};

    for (const [matchNum, entry] of Object.entries(odds)) {
      if (!entry || typeof entry !== 'object') continue;
      if (matchNum === 'date') continue;

      // 检查是否缺 hh
      const hf = entry.halfFull || {};
      if (hf.hh !== null && hf.hh !== undefined) continue; // 已有 hh，跳过

      if (!needsBackfill[ds]) needsBackfill[ds] = [];
      needsBackfill[ds].push({
        matchNum,
        homeName: entry.homeName || '',
        visitName: entry.visitName || '',
        matchId: entry.matchId || '',
      });
      totalNeed++;
    }
  }

  const datesNeed = Object.keys(needsBackfill).sort();
  console.log(`  需要补全: ${totalNeed} 场比赛, ${datesNeed.length} 个日期\n`);

  if (totalNeed === 0) {
    console.log('  无需补全，所有比赛已有 hh 数据。');
    return;
  }

  // 检查缓存
  let cache = {};
  if (fs.existsSync(CACHE_FILE)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`[CACHE] 已有 ${Object.keys(cache).length} 条缓存`);
    } catch (e) {}
  }

  // [2/4] 抓取
  console.log('[2/4] 抓取中...\n');

  const results = {}; // matchId -> halfFull data
  let newFetch = 0,
    cachedUse = 0;

  // 收集所有需要抓取的 matchId
  const allMatchIds = new Set();
  for (const ds of datesNeed) {
    for (const m of needsBackfill[ds]) {
      if (m.matchId) allMatchIds.add(m.matchId);
    }
  }

  const idList = [...allMatchIds].map(Number).sort((a, b) => a - b);
  console.log(`  去重后需查询: ${idList.length} 个 matchId\n`);

  for (let i = 0; i < idList.length; i += BATCH_SIZE) {
    const batch = idList.slice(i, i + BATCH_SIZE);

    const promises = batch.map((mid) => {
      if (cache[String(mid)]) {
        cachedUse++;
        results[String(mid)] = cache[String(mid)];
        return null;
      }
      return fetchMatch(mid);
    });

    const fetched = await Promise.all(promises);

    for (const r of fetched) {
      if (!r) continue;
      newFetch++;
      results[String(r.matchId)] = r;
      cache[String(r.matchId)] = r; // 写入缓存
    }

    if ((i / BATCH_SIZE) % 5 === 0 || i + BATCH_SIZE >= idList.length) {
      process.stdout.write(
        `\r  进度: ${Math.min(i + BATCH_SIZE, idList.length)}/${idList.length} | 新抓:${newFetch} 缓存:${cachedUse}   `,
      );
    }

    if (i + BATCH_SIZE < idList.length) await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // 保存缓存
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
  console.log(`\n\n  [CACHE] 保存: ${Object.keys(cache).length} 条`);
  console.log(`  新抓: ${newFetch} | 缓存: ${cachedUse} | 有效结果: ${Object.keys(results).length}\n`);

  // [3/4] 匹配并写入
  console.log('[3/4] 写入 odds_history...');

  let updatedMatches = 0,
    updatedFiles = 0;

  for (const ds of datesNeed) {
    const file = path.join(ODDS_DIR, ds + '.json');
    const od = JSON.parse(fs.readFileSync(file, 'utf8'));
    const odds = od.odds || {};

    let dayUpdated = 0;
    for (const need of needsBackfill[ds]) {
      const mid = need.matchId;
      if (!mid) continue;

      const result = results[String(mid)];
      if (!result || !result.halfFull || !result.halfFull.hh) continue;

      const entry = odds[need.matchNum];
      if (!entry) continue;

      // 合并 halfFull（保留已有字段，只补充缺失的）
      if (!entry.halfFull) entry.halfFull = {};
      for (const [key, val] of Object.entries(result.halfFull)) {
        if (val !== null && val !== undefined && (entry.halfFull[key] === null || entry.halfFull[key] === undefined)) {
          entry.halfFull[key] = val;
        }
      }

      dayUpdated++;
    }

    if (dayUpdated > 0) {
      if (!DRY_RUN) {
        const toSave = od.date ? od : { date: ds, odds: Object.assign(odds, od.odds ? {} : null) || odds };
        toSave.odds = odds;
        fs.writeFileSync(file, JSON.stringify(toSave, null, 2), 'utf8');
      }
      console.log(`  ${ds}: 补全 ${dayUpdated} 场`);
      updatedMatches += dayUpdated;
      updatedFiles++;
    }
  }

  if (DRY_RUN) {
    console.log(`\n  [DRY] 将补全 ${updatedMatches} 场比赛 (${updatedFiles} 个文件)`);
  } else {
    console.log(`\n  写入完成: ${updatedMatches} 场比赛, ${updatedFiles} 个文件`);
  }

  // [4/4] 统计
  console.log('\n[4/4] 验证...');

  let nowHH = 0;
  for (let d = new Date(DATE_START); d <= new Date(DATE_END); d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const file = path.join(ODDS_DIR, ds + '.json');
    if (!fs.existsSync(file)) continue;
    const od = JSON.parse(fs.readFileSync(file, 'utf8'));
    const odds = od.odds || {};
    let dayHH = 0,
      dayTotal = 0;
    for (const [k, e] of Object.entries(odds)) {
      if (!e || typeof e !== 'object' || k === 'date') continue;
      dayTotal++;
      if (e.halfFull && e.halfFull.hh != null) dayHH++;
    }
    const status = dayHH === dayTotal ? '✅' : dayHH > 0 ? '⚠️' : '❌';
    nowHH += dayHH;
    if (ds >= DATE_START && ds <= DATE_END) {
      console.log(`  ${status} ${ds}: ${dayHH}/${dayTotal} 有 hh`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`  完成! API请求: ${reqCount} | 补全比赛: ${updatedMatches}`);
  console.log('══════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('错误:', e);
  process.exit(1);
});
