/**
 * bridge_sp_gap_dates.js — 针对已知缺口日期强制从 SP 数据补入 data.json
 * 
 * 用法: node server/bridge_sp_gap_dates.js [date1,date2,...]
 * 默认: 2026-03-19,2026-03-23,2026-03-24,2026-03-25,2026-03-26
 */

const fs = require('fs');
const path = require('path');

const ODDS_DIR = path.join(__dirname, 'sporttery_odds');
const DATA_FILE = path.join(__dirname, 'data.json');

const DRY_RUN = process.argv.includes('--dry');

// Parse target dates
const targetArg = process.argv.find(a => a.startsWith('2026-'));
const TARGET_DATES = targetArg 
  ? targetArg.split(',')
  : ['2026-03-19','2026-03-23','2026-03-24','2026-03-25','2026-03-26'];

console.log('Target dates:', TARGET_DATES.join(', '));
console.log(DRY_RUN ? 'DRY RUN' : 'WRITE MODE');

// Scan all SP files
const files = fs.readdirSync(ODDS_DIR).filter(f => f.endsWith('.json'));
const matchesByDate = {};

for (const fname of files) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, fname), 'utf8'));
    const matchInfo = data.matchInfo || '';
    const dateMatch = matchInfo.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const date = dateMatch[1];
    
    if (!TARGET_DATES.includes(date)) continue;
    
    const matchNum = (data.matchNum || '').match(/(周[一二三四五六日]\d{3})/);
    const matchId = fname.replace('.json', '');
    
    if (!matchesByDate[date]) matchesByDate[date] = [];
    matchesByDate[date].push({
      matchId,
      num: matchNum ? matchNum[1] : '',
      homeName: data.home || '',
      visitName: data.away || '',
      leagueName: (data.matchNum || '').replace(/周[一二三四五六日]\d{3}\s*/, '').replace(/>/g, '').trim(),
      date,
      score: (data.score || '').replace(':', '-'),
      matchStatus: 2,
      source: 'sporttery_gap_fix',
    });
  } catch(e) {}
}

// Load data.json
let dataJson = {};
try { dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) {}
if (!dataJson.m) dataJson.m = {};

const stats = { added: 0, updated: 0, skipped: 0, scoreFixed: 0 };

for (const date of TARGET_DATES) {
  const matches = matchesByDate[date] || [];
  console.log(`\n${date}: ${matches.length} matches from SP`);
  
  for (const sp of matches) {
    const key = `m_${sp.matchId}`;
    const existing = dataJson.m[key];
    
    if (existing) {
      // Update existing
      let changed = false;
      if (!existing.score || existing.score === '-:-' || existing.score === '') {
        if (sp.score && sp.score !== ':' && sp.score !== '-:-') {
          existing.score = sp.score;
          changed = true;
          stats.scoreFixed++;
        }
      }
      if (!existing.homeName || existing.homeName === '') { existing.homeName = sp.homeName; changed = true; }
      if (!existing.visitName || existing.visitName === '') { existing.visitName = sp.visitName; changed = true; }
      if (existing.matchStatus < 2) { existing.matchStatus = 2; changed = true; }
      if (!existing.num) { existing.num = sp.num; changed = true; }
      if (changed) stats.updated++;
      else stats.skipped++;
      console.log(`  ${key}: ${sp.num} ${sp.homeName}vs${sp.visitName} [${sp.score}] ${changed ? 'UPDATE' : 'SKIP'}`);
    } else {
      // New entry
      dataJson.m[key] = sp;
      stats.added++;
      console.log(`  ${key}: ${sp.num} ${sp.homeName}vs${sp.visitName} [${sp.score}] NEW`);
    }
  }
}

// Also scan data.json for existing matches with wrong dates on these target dates
// (某些比赛可能有正确的 matchId 但日期字段为空或错误)
for (const date of TARGET_DATES) {
  // Check if any existing match has this date
  let count = 0;
  for (const [k, m] of Object.entries(dataJson.m)) {
    if (m && m.date && m.date.slice(0, 10) === date) count++;
  }
  console.log(`\n${date}: ${count} total matches in data.json after bridge`);
}

// Write
if (!DRY_RUN) {
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(dataJson));
  fs.renameSync(tmpFile, DATA_FILE);
  console.log(`\nWrote data.json (${JSON.stringify(dataJson).length} bytes)`);
}

console.log(`\nStats:`);
console.log(`  Added: ${stats.added}`);
console.log(`  Updated: ${stats.updated}`);
console.log(`  Skipped: ${stats.skipped}`);
console.log(`  Score fixed: ${stats.scoreFixed}`);
if (DRY_RUN) console.log('  >>> DRY RUN');
