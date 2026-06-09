/**
 * 从本地 midou_data.db 的 odds_history_v2 表提取赔率
 * 合并到 server/odds_history/*.json 文件中
 * 目标: 补全 halfFull / totalGoals / scores
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'server', 'midou_data.db');
const ODDS_DIR = path.join(__dirname, '..', 'server', 'odds_history');
const DRY_RUN = process.argv.includes('--dry');

if (!fs.existsSync(DB_PATH)) {
  console.error('ERROR: DB not found: ' + DB_PATH);
  process.exit(1);
}

console.log((DRY_RUN ? '[DRY RUN] ' : '') + '从 DB odds_history_v2 补全 odds_history JSON\n');

// Read all DB data
const db = new Database(DB_PATH, { readonly: true });
const rows = db
  .prepare(
    `
  SELECT date, match_num, play_type, odds_json
  FROM odds_history_v2
  WHERE date >= '2026-03-19'
  ORDER BY date, match_num, play_type
`,
  )
  .all();
db.close();

console.log(`DB: ${rows.length} records`);

// Group by date → matchNum → { halfFull, totalGoals, scores }
const dbMap = {};
for (const r of rows) {
  try {
    const odds = JSON.parse(r.odds_json);
    if (!odds || Object.keys(odds).length === 0) continue;
    if (!dbMap[r.date]) dbMap[r.date] = {};
    if (!dbMap[r.date][r.match_num]) dbMap[r.date][r.match_num] = {};
    dbMap[r.date][r.match_num][r.play_type] = odds;
  } catch (e) {}
}

const dates = Object.keys(dbMap).sort();
console.log(`DB dates: ${dates.length} (${dates[0]} ~ ${dates[dates.length - 1]})\n`);

let totalNewFiles = 0,
  totalNewMatches = 0,
  totalUpdated = 0;
let missingCount = 0,
  hfCount = 0,
  tgCount = 0,
  scCount = 0;

for (const dt of dates) {
  const jsonPath = path.join(ODDS_DIR, dt + '.json');
  const dayData = dbMap[dt];
  const dbMatchNums = Object.keys(dayData);

  // Read existing
  let existing = null;
  if (fs.existsSync(jsonPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch (e) {}
  }

  const odds = existing ? existing.odds || existing : {};
  const existingNums = Object.keys(odds).filter((k) => k !== 'date' && odds[k] && typeof odds[k] === 'object');

  let dayNew = 0,
    dayUpd = 0,
    dayHF = 0,
    dayTG = 0,
    daySC = 0;

  for (const mn of dbMatchNums) {
    const dbEntry = dayData[mn];
    let target = odds[mn];

    // Case 1: Match doesn't exist in odds_history → create from DB
    if (!target || !existingNums.includes(mn)) {
      odds[mn] = {
        num: mn,
        homeName: '',
        visitName: '',
        leagueName: '',
        handicap: 0,
        spf: null,
        rqspf: null,
        halfFull: dbEntry.halfFull || null,
        totalGoals: dbEntry.totalGoals || null,
        scores: dbEntry.scores || null,
        isSingleGame: false,
      };
      if (!target) dayNew++;
      else dayUpd++;
      continue;
    }

    // Case 2: Existing entry missing play type data
    let changed = false;
    if (
      dbEntry.halfFull &&
      Object.keys(dbEntry.halfFull).length > 0 &&
      (!target.halfFull || Object.keys(target.halfFull || {}).length === 0)
    ) {
      target.halfFull = dbEntry.halfFull;
      changed = true;
      dayHF++;
    }
    if (
      dbEntry.totalGoals &&
      Object.keys(dbEntry.totalGoals).length > 0 &&
      (!target.totalGoals || Object.keys(target.totalGoals || {}).length === 0)
    ) {
      target.totalGoals = dbEntry.totalGoals;
      changed = true;
      dayTG++;
    }
    if (
      dbEntry.scores &&
      Object.keys(dbEntry.scores).length > 0 &&
      (!target.scores || Object.keys(target.scores || {}).length === 0)
    ) {
      target.scores = dbEntry.scores;
      changed = true;
      daySC++;
    }
    if (changed) dayUpd++;
    else missingCount++;
  }

  if (dayNew > 0 || dayUpd > 0) {
    const totalMatches = Object.keys(odds).filter((k) => k !== 'date').length;
    if (!DRY_RUN) {
      const toSave = existing && existing.date ? existing : { date: dt, odds };
      if (!toSave.date) toSave.date = dt;
      fs.writeFileSync(jsonPath, JSON.stringify(toSave, null, 2), 'utf8');
    }
    if (!existing && dayNew > 0) {
      console.log(`  [NEW] ${dt}: +${dayNew} 场次 (新文件)`);
      totalNewFiles++;
    } else {
      console.log(`  [UPD] ${dt}: +${dayNew}新 ${dayUpd}更新 (HF:${dayHF} TG:${dayTG} SC:${daySC})`);
    }
    totalNewMatches += dayNew;
    totalUpdated += dayUpd;
    hfCount += dayHF;
    tgCount += dayTG;
    scCount += daySC;
  }
}

console.log(`\n=== 结果 ===`);
console.log(`新文件: ${totalNewFiles}, 新场次: ${totalNewMatches}, 更新场次: ${totalUpdated}`);
console.log(`补全: halfFull=${hfCount} totalGoals=${tgCount} scores=${scCount}`);
if (DRY_RUN) console.log('>>> DRY RUN 模式，未写入文件');
