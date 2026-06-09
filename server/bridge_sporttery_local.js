/**
 * bridge_sporttery_local.js
 * 将本地已有的 SP 官方数据（sporttery_odds/*.json）桥接到 data.json 和 odds_history
 * 
 * 数据覆盖: 6189 场, 2025-02-22 ~ 2026-06-07 (426天)
 * 用途: 填补 data.json 赛程缺口 + odds_history 赔率缺口 + allplays 全玩法缺口
 * 
 * 用法: node server/bridge_sporttery_local.js [--dry] [--date 2026-06-06]
 */

const fs = require('fs');
const path = require('path');

const ODDS_DIR = path.join(__dirname, 'sporttery_odds');
const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_HISTORY_DIR = path.join(__dirname, 'odds_history');
const ALLPLAYS_FILE = path.join(__dirname, 'ttyingqiu_data', 'odds_500_allplays.json');
const DRY_RUN = process.argv.includes('--dry');
const TARGET_DATE = process.argv.includes('--date') ? process.argv[process.argv.indexOf('--date') + 1] : null;

if (!fs.existsSync(ODDS_DIR)) {
  console.error('sporttery_odds 目录不存在');
  process.exit(1);
}

// ═══ 工具 ═══
function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, filePath);
}

function extractDate(raw) {
  if (!raw) return '';
  // "2026 Friendlies 1 2026-06-05 03:00" or "2023/2024 常规赛 第19轮 2024-01-03 00:00"
  const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function extractMatchNum(raw) {
  if (!raw) return '';
  // "周六213 国际赛>"
  const m = String(raw).match(/(周[一二三四五六日]\d{3})/);
  return m ? m[1] : '';
}

function extractLeague(raw) {
  if (!raw) return '';
  const m = String(raw).match(/周[一二三四五六日]\d{3}\s+(.+?)[>\s]*$/);
  if (m) return m[1].trim().replace(/>/g, '');
  const parts = String(raw).replace(/>/g, '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function extractHandicap(row) {
  if (!row || !Array.isArray(row)) return null;
  const txt = row.map(c => String(c || '')).join(' ');
  // "让球\n\n-2\n\n彩果:" → -2
  const m = txt.match(/让球[\s\S]*?([+-]?\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

// ═══ 解析赔率表格 → SPF 赔率 ═══
function extractSPFOdds(tables) {
  // tables = [ [header], [data], [data], ... ]
  // 第一个 table (index 0) 是开奖结果
  // 第二个 table (index 1) 是 SPF 赔率演变
  // 第三个 table (index 3) 是 RQSPF
  // 第四个 table (index 4) 是比分?
  
  const result = { spf: {}, rqspf: {}, handicap: null, jqs: {}, bqc: {}, bf: {} };
  
  if (!tables || !Array.isArray(tables)) return result;
  
  // ── SPF 赔率（通常 index 1 或 2） ──
  for (let i = 1; i < Math.min(tables.length, 5); i++) {
    const table = tables[i];
    if (!Array.isArray(table) || table.length < 2) continue;
    
    const headerRow = table[0] || [];
    const headerText = headerRow.map(c => String(c || '')).join(' ');
    
    // SPF: 包含"胜" "平" "负" 且不包含"让球"
    if (headerText.includes('胜') && headerText.includes('平') && headerText.includes('负') && !headerText.includes('让球')) {
      // 找最后一行的赔率（最新）
      for (let r = table.length - 1; r >= 1; r--) {
        const row = table[r];
        if (!Array.isArray(row)) continue;
        // 找赔率数字
        const odds = [];
        for (const cell of row) {
          const val = parseFloat(String(cell).replace(/[↑↓]/g, '').trim());
          if (!isNaN(val) && val > 1) odds.push(val);
        }
        if (odds.length >= 3) {
          result.spf = { home: odds[odds.length - 3], draw: odds[odds.length - 2], away: odds[odds.length - 1] };
          break;
        }
      }
    }
    
    // RQSPF: 包含"让球"或"让"
    if (headerText.includes('让球') || (headerText.includes('让') && headerText.includes('胜') && headerText.includes('负'))) {
      // 提取让球数
      const hcp = extractHandicap(headerRow);
      if (hcp !== null) result.handicap = hcp;
      
      // 找最后一行
      for (let r = table.length - 1; r >= 1; r--) {
        const row = table[r];
        if (!Array.isArray(row)) continue;
        const odds = [];
        for (const cell of row) {
          const val = parseFloat(String(cell).replace(/[↑↓]/g, '').trim());
          if (!isNaN(val) && val > 1) odds.push(val);
        }
        if (odds.length >= 3) {
          result.rqspf = { home: odds[odds.length - 3], draw: odds[odds.length - 2], away: odds[odds.length - 1] };
          break;
        }
      }
    }
    
    // 总进球 JQS
    if (headerText.includes('0') && headerText.includes('1') && headerText.includes('2') && headerText.includes('3') && !headerText.includes('胜') && !headerText.includes('负')) {
      for (let r = table.length - 1; r >= 1; r--) {
        const row = table[r];
        if (!Array.isArray(row)) continue;
        const odds = {};
        const keys = ['0', '1', '2', '3', '4', '5', '6', '7+'];
        let ki = 0;
        for (const cell of row) {
          const val = parseFloat(String(cell).replace(/[↑↓]/g, '').trim());
          if (!isNaN(val) && val > 1 && ki < keys.length) {
            odds[keys[ki]] = val;
            ki++;
          }
        }
        if (Object.keys(odds).length >= 6) {
          result.jqs = odds;
          break;
        }
      }
    }
    
    // 半全场 BQC
    if (headerText.includes('胜胜') || headerText.includes('胜平') || headerText.includes('平胜')) {
      for (let r = table.length - 1; r >= 1; r--) {
        const row = table[r];
        if (!Array.isArray(row)) continue;
        const bqcKeys = ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'];
        const odds = {};
        let ki = 0;
        for (const cell of row) {
          const val = parseFloat(String(cell).replace(/[↑↓]/g, '').trim());
          if (!isNaN(val) && val > 1 && ki < bqcKeys.length) {
            odds[bqcKeys[ki]] = val;
            ki++;
          }
        }
        if (Object.keys(odds).length >= 8) {
          result.bqc = odds;
          break;
        }
      }
    }
  }
  
  return result;
}

// ═══ 解析开奖结果 → SPF 方向 + 比分 ═══
function parseLotteryResult(lotteryResult) {
  const out = {};
  if (!lotteryResult) return out;
  
  // 胜平负结果
  if (lotteryResult['胜平负']) {
    const v = lotteryResult['胜平负'].outcome || '';
    if (v === '胜') out.spf = '主胜';
    else if (v === '平') out.spf = '平';
    else if (v === '负') out.spf = '客胜';
  }
  
  // 比分
  if (lotteryResult['比分']) {
    out.score = lotteryResult['比分'].outcome || '';
  }
  
  // 总进球
  if (lotteryResult['总进球']) {
    const tg = parseInt(lotteryResult['总进球'].outcome);
    if (!isNaN(tg)) {
      if (tg > 2) out.overunder = '大球';
      else if (tg < 2) out.overunder = '小球';
      else out.overunder = '走';
    }
  }
  
  return out;
}

// ═══ 主流程 ═══
async function main() {
  const files = fs.readdirSync(ODDS_DIR)
    .filter(f => f.endsWith('.json') && /^2[01]\d{5}\.json$/.test(f)) // 只处理 202xxxx/203xxxx/204xxxx
    .sort();
  
  console.log(`═══════════════════════════════════`);
  console.log(`  SP本地数据桥接 (${files.length} 场)`);
  if (DRY_RUN) console.log(`  >>> DRY RUN`);
  if (TARGET_DATE) console.log(`  过滤日期: ${TARGET_DATE}`);
  console.log(`═══════════════════════════════════\n`);
  
  // ═══ 加载现有数据 ═══
  let dataJson = {};
  try { dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
  if (!dataJson.m) dataJson.m = {};
  if (!dataJson.r) dataJson.r = {};
  
  // allplays
  let allplays = {};
  try {
    if (fs.existsSync(ALLPLAYS_FILE)) {
      allplays = JSON.parse(fs.readFileSync(ALLPLAYS_FILE, 'utf8'));
    }
  } catch(e) {}
  
  const stats = {
    total: files.length,
    processed: 0,
    matchAdded: 0,
    matchUpdated: 0,
    matchSkipped: 0,
    oddsAdded: 0,
    oddsSkipped: 0,
    allplaysAdded: 0,
    scoreFixed: 0,
  };
  
  // 构建 num→matchId 索引（用于匹配已有数据）
  const numIndex = {};
  Object.entries(dataJson.m).forEach(([k, m]) => {
    if (m && m.num) numIndex[m.num] = k;
  });
  
  for (let fi = 0; fi < files.length; fi++) {
    const fname = files[fi];
    const matchId = fname.replace('.json', '');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, fname), 'utf8'));
    } catch(e) { continue; }
    
    const matchNum = extractMatchNum(data.matchNum);
    const date = extractDate(data.matchInfo);
    const league = extractLeague(data.matchNum);
    const home = data.home || '';
    const away = data.away || '';
    const score = data.score || '';
    
    // 日期过滤
    if (TARGET_DATE && date !== TARGET_DATE) continue;
    
    // 跳过非2026数据
    if (!date || date < '2026-03-01') continue;
    
    stats.processed++;
    
    // ═══ Part A: 同步到 data.json ═══
    const newMatch = {
      matchId,
      num: matchNum,
      homeName: home,
      visitName: away,
      leagueName: league,
      startTime: '', // SP 数据没有开赛时间格式
      date,
      score: score.replace(':', '-'),
      matchStatus: 2, // 已结束（历史数据）
      source: 'sporttery_local',
    };
    
    // 用 num 或 matchId 匹配已有记录
    let existingKey = dataJson.m[`m_${matchId}`];
    if (!existingKey && matchNum && numIndex[matchNum]) {
      existingKey = dataJson.m[numIndex[matchNum]];
    }
    
    if (existingKey) {
      // 已有记录，补充缺失信息
      const old = existingKey === dataJson.m[`m_${matchId}`] ? dataJson.m[`m_${matchId}`] : dataJson.m[numIndex[matchNum]];
      const key = existingKey === dataJson.m[`m_${matchId}`] ? `m_${matchId}` : numIndex[matchNum];
      
      let changed = false;
      if (!old.score || old.score === '-:-' || old.score === '') {
        if (score && score !== ':' && score !== '-:-') {
          old.score = score.replace(':', '-');
          changed = true;
          stats.scoreFixed++;
        }
      }
      if (!old.homeName || old.homeName === '') { old.homeName = home; changed = true; }
      if (!old.visitName || old.visitName === '') { old.visitName = away; changed = true; }
      if (old.matchStatus < 2) { old.matchStatus = 2; changed = true; }
      if (changed) stats.matchUpdated++;
      else stats.matchSkipped++;
    } else if (!TARGET_DATE) {
      // 新记录
      dataJson.m[`m_${matchId}`] = newMatch;
      numIndex[matchNum] = `m_${matchId}`;
      stats.matchAdded++;
    }
    
    // ═══ Part B: 同步到 odds_history/{date}.json ═══
    const oddsData = extractSPFOdds(data.tables);
    if (oddsData.spf && Object.keys(oddsData.spf).length > 0) {
      const oddsFile = path.join(ODDS_HISTORY_DIR, date + '.json');
      let existingOdds = {};
      
      try {
        if (fs.existsSync(oddsFile)) {
          existingOdds = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
        }
      } catch(e) {}
      
      if (!existingOdds.odds) existingOdds.odds = {};
      
      // 写入（不覆盖已有数据）
      if (!existingOdds.odds[matchNum]) {
        existingOdds.odds[matchNum] = {
          homeName: home,
          visitName: away,
          spf: oddsData.spf,
          rqspf: oddsData.rqspf,
          handicap: oddsData.handicap,
        };
        stats.oddsAdded++;
        
        if (!DRY_RUN) {
          fs.writeFileSync(oddsFile, JSON.stringify({ date, odds: existingOdds.odds }));
        }
      } else {
        stats.oddsSkipped++;
      }
    }
    
    // ═══ Part C: allplays 全玩法 ═══
    if (oddsData.spf || oddsData.rqspf || oddsData.jqs || oddsData.bqc) {
      if (!allplays[date]) allplays[date] = {};
      
      // 不覆盖已有数据
      if (!allplays[date][matchNum]) {
        allplays[date][matchNum] = {
          homeName: home,
          visitName: away,
          handicap: oddsData.handicap || 0,
          spf: oddsData.spf || {},
          rqspf: oddsData.rqspf || {},
          totalGoals: oddsData.jqs || {},
          halfFull: oddsData.bqc || {},
          scores: {}, // BF 暂不解析
          source: 'sporttery_local',
        };
        stats.allplaysAdded++;
      }
    }
    
    // 进度
    if ((fi + 1) % 500 === 0 || fi === files.length - 1) {
      console.log(`  [${fi+1}/${files.length}] 处理:${stats.processed} 新增赛程:${stats.matchAdded} 更新:${stats.matchUpdated} 赔率:${stats.oddsAdded} allplays:${stats.allplaysAdded} 赛果:${stats.scoreFixed}`);
    }
  }
  
  // ═══ 写入 ═══
  if (!DRY_RUN) {
    console.log(`\n写入 data.json...`);
    atomicWrite(DATA_FILE, dataJson);
    
    console.log(`写入 allplays...`);
    const allplaysDir = path.dirname(ALLPLAYS_FILE);
    if (!fs.existsSync(allplaysDir)) fs.mkdirSync(allplaysDir, { recursive: true });
    atomicWrite(ALLPLAYS_FILE, allplays);
  }
  
  // ═══ 汇总 ═══
  console.log(`\n══════════════════════════`);
  console.log(`  桥接完成!`);
  console.log(`  处理:    ${stats.processed}`);
  console.log(`  新增赛程: ${stats.matchAdded}`);
  console.log(`  更新赛程: ${stats.matchUpdated}`);
  console.log(`  跳过赛程: ${stats.matchSkipped}`);
  console.log(`  新增赔率: ${stats.oddsAdded}`);
  console.log(`  跳过赔率: ${stats.oddsSkipped}`);
  console.log(`  新增全玩法: ${stats.allplaysAdded}`);
  console.log(`  修正赛果: ${stats.scoreFixed}`);
  if (DRY_RUN) console.log(`  >>> DRY RUN — 未实际写入`);
  console.log(`══════════════════════════`);
  
  return stats;
}

module.exports = { main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
