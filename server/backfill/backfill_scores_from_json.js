/**
 * 从 sporttery_odds/*.json 回填历史比赛比分
 * 使用 database.js 适配器（避免 better-sqlite3 兼容问题）
 * 用法: node server/backfill_scores_from_json.js [--dry]
 */
const fs = require('fs');
const path = require('path');
const database = require('./database');

const ODDS_DIR = path.join(__dirname, 'sporttery_odds');
const dryRun = process.argv.includes('--dry');

console.log('=== JSON 比分回填 ===');
console.log(dryRun ? 'DRY RUN' : '正式执行');

const files = fs.readdirSync(ODDS_DIR).filter(function (f) {
  return f.endsWith('.json');
});
console.log('文件数: ' + files.length);

function parseScore(s) {
  if (!s) return null;
  const parts = String(s).split(/[-:：]/);
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]),
    a = parseInt(parts[1]);
  if (isNaN(h) || isNaN(a)) return null;
  return { home: h, away: a };
}

function spfText(o) {
  if (o === '胜') return '主胜';
  if (o === '平') return '平';
  if (o === '负') return '客胜';
  return null;
}

// Init DB
database.initDatabase();
const adp = database.getAdapter();
if (!adp) {
  console.error('数据库不可用');
  process.exit(1);
}

// Step 1: 从 JSON 提取比分
console.log('Step 1: 解析 JSON...');
const scoreMap = {};
let noResult = 0,
  errors = 0;

files.forEach(function (f, i) {
  const mid = f.replace('.json', '');
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf8'));
    const lr = d.lotteryResult;
    if (!lr || Object.keys(lr).length === 0) {
      noResult++;
      return;
    }
    const score = d.score || '';
    if (!score || score === ':') {
      noResult++;
      return;
    }
    const g = parseScore(score);
    if (!g) {
      noResult++;
      return;
    }
    scoreMap[mid] = {
      score: score,
      hg: g.home,
      ag: g.away,
      spf: spfText((lr['胜平负'] || {}).outcome),
    };
  } catch (e) {
    errors++;
  }
  if (i % 2000 === 0) process.stdout.write('\r  ' + i);
});
console.log('\r  解析完成: ' + files.length + ' 文件, ' + Object.keys(scoreMap).length + ' 有比分');

if (dryRun) {
  console.log('无结果: ' + noResult + ', 错误: ' + errors);
  console.log('DRY RUN 完成');
  process.exit(0);
}

// Step 2: 更新 prediction_logs
console.log('\nStep 2: 更新 prediction_logs...');
const mids = Object.keys(scoreMap);
let plDone = 0,
  plSkip = 0;

mids.forEach(function (mid) {
  const s = scoreMap[mid];
  try {
    // Check if already has score
    const existing = adp.execOne('SELECT actual_score FROM prediction_logs WHERE matchId=?', mid);
    if (existing && existing.actual_score && existing.actual_score.trim()) {
      plSkip++;
      return;
    }
    adp.execRun(
      "UPDATE prediction_logs SET actual_score=?, actual_home_goals=?, actual_away_goals=?, actual_spf=?, actual_corrected_at=datetime('now','localtime') WHERE matchId=?",
      s.score,
      s.hg,
      s.ag,
      s.spf,
      mid,
    );
    plDone++;
  } catch (e) {
    errors++;
  }
  if (plDone % 2000 === 0) console.log('  ' + plDone + ' 条...');
});
console.log('  prediction_logs: ' + plDone + ' 更新, ' + plSkip + ' 已有');

// Step 3: 更新 matches
console.log('\nStep 3: 更新 matches...');
let mDone = 0,
  mSkip = 0;

mids.forEach(function (mid) {
  const s = scoreMap[mid];
  try {
    const cur = adp.execOne('SELECT score FROM matches WHERE matchId=?', mid);
    if (cur && cur.score && cur.score.trim() && cur.score !== '-') {
      mSkip++;
      return;
    }
    adp.execRun(
      "UPDATE matches SET score=?, matchStatus=2, updatedAt=datetime('now','localtime') WHERE matchId=?",
      s.score,
      mid,
    );
    mDone++;
  } catch (e) {}
});
console.log('  matches: ' + mDone + ' 更新, ' + mSkip + ' 已有');

// Step 4: 更新 data.json
console.log('\nStep 4: 更新 data.json...');
try {
  const dataFile = path.join(__dirname, 'data.json');
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const mMap = data.m || {};
  let dUpdated = 0;
  mids.forEach(function (mid) {
    const s = scoreMap[mid];
    const key = 'm_' + mid;
    if (mMap[key]) {
      mMap[key].score = s.score;
      mMap[key].matchStatus = 2;
      dUpdated++;
    }
  });
  const tmp = dataFile + '.tmp_scores2';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, dataFile);
  console.log('  data.json: ' + dUpdated + ' 场比分更新');
} catch (e) {
  console.log('  data.json 跳过: ' + e.message);
}

// Verify
let r = adp.execOne(
  "SELECT COUNT(*) as c FROM prediction_logs WHERE date>='2024-01-01' AND date<='2026-03-18' AND actual_score IS NOT NULL AND actual_score!=''",
);
console.log('\n=== 验证 ===');
console.log('2024-2026.3 prediction_logs 有比分: ' + r.c + ' 条');

r = adp.execOne("SELECT COUNT(*) as c FROM prediction_logs WHERE actual_score IS NOT NULL AND actual_score!=''");
console.log('全部 prediction_logs 有比分: ' + r.c + ' 条');

r = adp.execOne(
  "SELECT COUNT(*) as c FROM matches WHERE date>='2024-01-01' AND score IS NOT NULL AND score!='' AND score!='-'",
);
console.log('2024+ matches 有比分: ' + r.c + ' 场');

if (errors) console.log('错误: ' + errors);
console.log('=== 完成 ===');
