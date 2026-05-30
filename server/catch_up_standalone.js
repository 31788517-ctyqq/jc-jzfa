/**
 * catch_up_standalone.js — 兼容 Node.js 10 的补抓脚本
 * 不依赖 winston，直接用 console.log/error
 */
const fs = require('fs');
const path = require('path');
const { fetchOdds, fetchShujuMap } = require('./fetch_500odds');
const { execSync } = require('child_process');

const ODDS_DIR = path.join(__dirname, 'odds_history');
const SHUJU_DIR = path.join(__dirname, 'shuju_data');

function TS() { return new Date().toISOString().replace('T',' ').slice(0,19); }

function generateDates(start, end) {
  const dates = [];
  const sParts = start.split('-').map(Number);
  const eParts = end.split('-').map(Number);
  const cur = new Date(sParts[0], sParts[1] - 1, sParts[2], 12, 0, 0); // noon to avoid DST
  const last = new Date(eParts[0], eParts[1] - 1, eParts[2], 12, 0, 0);
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(y + '-' + m + '-' + d);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(ms) { return Math.floor(ms * (0.5 + Math.random() * 1.5)); }

// ===== 赔率补抓 =====
async function catchUpOdds(dates) {
  console.log(TS() + ' [P0-Odds] 开始: ' + dates.length + ' 天');
  let done = 0, skipped = 0, failed = 0;

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const fp = path.join(ODDS_DIR, d + '.json');

    if (fs.existsSync(fp) && fs.statSync(fp).size > 100) {
      try {
        const e = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const c = Object.keys(e.odds || {}).length;
        if (e.empty || c > 0) { skipped++; continue; }
      } catch (_) {}
    }

    try {
      console.log('  [' + (i + 1) + '/' + dates.length + '] ' + d + ' odds...');
      const odds = await fetchOdds(d);
      const n = Object.keys(odds).length;
      const out = { date: d, odds: n > 0 ? odds : {} };
      if (n === 0) out.empty = true;
      fs.writeFileSync(fp, JSON.stringify(out));
      if (n > 0) { console.log('    OK: ' + n + ' 场'); done++; }
      else { console.log('    empty'); skipped++; }
    } catch (e) {
      console.error('    FAIL: ' + e.message);
      failed++;
    }
    await sleep(jitter(1500));
  }
  console.log(TS() + ' [P0-Odds] done=' + done + ' skip=' + skipped + ' fail=' + failed);
  return { done, skipped, failed };
}

// ===== 攻防数据补抓 =====
async function catchUpShuju(dates) {
  console.log(TS() + ' [P0-Shuju] 开始: ' + dates.length + ' 天');
  let done = 0, skipped = 0, failed = 0, noOdds = 0;

  const py3 = 'python3';
  const fenxiPy = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi.py');
  const selPy = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi_selenium.py');

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const mf = path.join(SHUJU_DIR, 'shuju_merged_' + d + '.json');

    if (fs.existsSync(mf) && fs.statSync(mf).size > 500) {
      skipped++; continue;
    }

    const of = path.join(ODDS_DIR, d + '.json');
    if (!fs.existsSync(of) || fs.statSync(of).size < 100) {
      noOdds++; continue;
    }

    try {
      console.log('  [' + (i + 1) + '/' + dates.length + '] ' + d + ' shuju...');

      // 1) shuju map
      const mapf = path.join(__dirname, 'shuju_map_' + d + '.json');
      if (!fs.existsSync(mapf)) {
        const m = await fetchShujuMap(d);
        if (!m || Object.keys(m).length === 0) {
          console.log('    no links');
          fs.writeFileSync(mapf, JSON.stringify({ date: d, empty: true }));
          noOdds++; continue;
        }
        fs.writeFileSync(mapf, JSON.stringify(m, null, 2));
        console.log('    map: ' + Object.keys(m).length);
      }

      // 2) 静态抓取
      console.log('    static fetch...');
      try {
        execSync(py3 + ' "' + fenxiPy + '" ' + d, {
          cwd: path.join(__dirname, '..'), timeout: 300000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024
        });
        console.log('    static done');
      } catch (e) {
        console.log('    static fail: ' + (e.message || '').slice(0, 80));
      }

      // 3) Selenium (只对最近30天)
      const daysAgo = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
      if (daysAgo <= 30) {
        console.log('    selenium...');
        try {
          execSync(py3 + ' "' + selPy + '" ' + d, {
            cwd: path.join(__dirname, '..'), timeout: 600000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024
          });
          console.log('    selenium done');
        } catch (e) {
          console.log('    selenium fail: ' + (e.message || '').slice(0, 80));
        }
      } else {
        console.log('    (>30d skip selenium)');
      }

      // 4) 合并
      try {
        const { mergeShuju } = require('./merge_shuju');
        const merged = mergeShuju(d);
        if (merged && Object.keys(merged).length > 0) {
          console.log('    merged: ' + Object.keys(merged).length + ' 场');
          done++;
        }
      } catch (e) {
        console.log('    merge fail: ' + e.message);
      }
    } catch (e) {
      console.error('    FAIL: ' + e.message);
      failed++;
    }
    await sleep(jitter(2000));
  }
  console.log(TS() + ' [P0-Shuju] done=' + done + ' skip=' + skipped + ' noOdds=' + noOdds + ' fail=' + failed);
  return { done, skipped, noOdds, failed };
}

async function main() {
  const mode = process.argv[2] || '--all';
  const start = process.argv[3] || '2026-03-19';
  const end = process.argv[4] || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  console.log('='.repeat(60));
  console.log(TS() + ' CatchUp ' + start + ' ~ ' + end + ' mode=' + mode);
  console.log('Node:', process.version);
  console.log('='.repeat(60));

  if (!fs.existsSync(ODDS_DIR)) fs.mkdirSync(ODDS_DIR, { recursive: true });
  if (!fs.existsSync(SHUJU_DIR)) fs.mkdirSync(SHUJU_DIR, { recursive: true });

  const dates = generateDates(start, end);
  let r1 = {}, r2 = {};

  if (mode === '--all' || mode === '--odds-only') {
    r1 = await catchUpOdds(dates);
  }

  if (mode === '--all' || mode === '--shuju-only') {
    r2 = await catchUpShuju(dates);
  }

  console.log('\n' + '='.repeat(60));
  console.log(TS() + ' DONE: odds=' + JSON.stringify(r1) + ' shuju=' + JSON.stringify(r2));

  // 完整性检查
  let missOdds = 0, missShuju = 0;
  const allD = generateDates(start, end);
  for (const d of allD) {
    const of = path.join(ODDS_DIR, d + '.json');
    const mf = path.join(SHUJU_DIR, 'shuju_merged_' + d + '.json');
    if (!fs.existsSync(of) || fs.statSync(of).size < 100) missOdds++;
    if (!fs.existsSync(mf) || fs.statSync(mf).size < 500) missShuju++;
  }
  console.log('Gaps: odds=' + missOdds + ' shuju=' + missShuju);
  console.log('='.repeat(60));
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
