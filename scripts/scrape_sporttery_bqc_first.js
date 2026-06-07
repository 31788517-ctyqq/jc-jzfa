/**
 * 从中国体彩官网抓取 BQC(半全场) 赔率 - 取最早一条历史记录
 * 因为胜胜(ss)赔率可能早期有值、后期被下架
 * 
 * 用法: node scripts/scrape_sporttery_bqc_first.js
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'server', 'ttyingqiu_data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'sporttery_bqc_first.json');
const DATE_START = '2026-03-19';
const DATE_END = '2026-04-27';  // 补全到 04-27（hh 缺失的区间）

// matchId 范围估算（03-19 ~ 04-27 的比赛）
const ID_START = 2036800;
const ID_END = 2039800;

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0',
          'Accept': 'application/json',
          'Referer': 'https://www.sporttery.cn/'
        }
      });
      if (resp.ok) return await resp.json();
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

async function fetchMatchOdds(matchId) {
  const url = `https://webapi.sporttery.cn/gateway/uniform/football/getFixedBonusV1.qry?clientCode=3001&matchId=${matchId}`;
  const data = await fetchWithRetry(url);
  if (!data || !data.success || !data.value) return null;
  
  const oh = data.value.oddsHistory || {};
  const hafuList = oh.hafuList || [];
  
  if (hafuList.length === 0) return null;
  
  // ★ 取最早一条（索引0），因为胜胜赔率可能早期有值
  const first = hafuList[0];
  const last = hafuList[hafuList.length - 1];
  
  return {
    matchId: matchId,
    date: first.updateDate || '',
    homeTeam: oh.homeTeamAllName || oh.homeTeamAbbName || '',
    awayTeam: oh.awayTeamAllName || oh.awayTeamAbbName || '',
    league: oh.leagueAbbName || '',
    bqc: {
      // 最早一条的赔率（可能包含胜胜）
      ss_first: first.h || null,  // 胜胜
      sp_first: first.d || null,  // 胜平  
      sf_first: first.a || null,  // 胜负
      ps_first: first.dh || null, // 平胜
      pp_first: first.dd || null, // 平平
      pf_first: first.da || null, // 平负
      fs_first: first.ah || null, // 负胜
      fp_first: first.ad || null, // 负平
      ff_first: first.aa || null, // 负负
      firstUpdateTime: `${first.updateDate || ''} ${first.updateTime || ''}`.trim(),
      
      // 最后一条的赔率（对比用）
      ss_last: last.h || null,
      ps_last: last.dh || null,
    },
    historyCount: hafuList.length
  };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  抓取体彩官网 BQC 赔率 - 取最早历史记录（补胜胜数据）      ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`范围: ${DATE_START} ~ ${DATE_END}`);
  console.log(`matchId: ${ID_START} ~ ${ID_END}\n`);
  
  const results = {};
  let found = 0, withSS = 0, inRange = 0;
  const batchSize = 50;
  
  for (let id = ID_START; id <= ID_END; id += batchSize) {
    const batch = [];
    for (let i = 0; i < batchSize && id + i <= ID_END; i++) {
      batch.push(id + i);
    }
    
    // 并发请求
    const promises = batch.map(mid => fetchMatchOdds(mid));
    const batchResults = await Promise.all(promises);
    
    for (let i = 0; i < batch.length; i++) {
      const mid = batch[i];
      const r = batchResults[i];
      if (!r) continue;
      
      // 检查日期范围
      if (r.date < DATE_START || r.date > DATE_END) continue;
      
      found++;
      results[mid] = r;
      
      if (r.bqc.ss_first && r.bqc.ss_first !== '') withSS++;
      inRange++;
      
      if (inRange <= 5 || (r.bqc.ss_first && withSS <= 5)) {
        const hasSS = r.bqc.ss_first ? '✅ ss=' + r.bqc.ss_first : '❌ ss=null';
        console.log(`  [${r.date}] mid=${mid}: ${r.homeTeam} vs ${r.awayTeam} ${hasSS} (历史${r.historyCount}条)`);
      }
    }
    
    const progress = Math.min((id - ID_START + batchSize) / (ID_END - ID_START) * 100, 100);
    if (Math.floor(progress) % 10 === 0) {
      process.stdout.write(`\r  进度: ${progress.toFixed(0)}% | 找到:${found} | 范围内:${inRange} | 有ss:${withSS} `);
    }
    
    // 限速
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log('\n');
  
  // 保存结果
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`完成: 找到 ${found} 场比赛, 范围内 ${inRange} 场`);
  console.log(`有胜胜(ss)赔率: ${withSS} 场`);
  console.log(`输出: ${OUTPUT_FILE}`);
  console.log('═══════════════════════════════════════════════════════════');
  
  // 按日期统计
  const dateStats = {};
  for (const r of Object.values(results)) {
    if (!dateStats[r.date]) dateStats[r.date] = { total: 0, withSS: 0 };
    dateStats[r.date].total++;
    if (r.bqc.ss_first && r.bqc.ss_first !== '') dateStats[r.date].withSS++;
  }
  
  console.log('\n各日期统计:');
  Object.keys(dateStats).sort().forEach(d => {
    const s = dateStats[d];
    const status = s.withSS > 0 ? '✅' : '❌';
    console.log(`  ${status} ${d}: ${s.withSS}/${s.total} 有胜胜赔率`);
  });
}

main().catch(e => {
  console.error('错误:', e);
  process.exit(1);
});
