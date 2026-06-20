/**
 * ═══ 比分污染全量审计 + 清理 + 回填 ═══
 * P0 门禁扩展: 自动检测并清空半场比分污染，再尝试回填正确比分
 *
 * 用法:
 *   node scripts/audit_score_pollution.js                      # 全量审计
 *   node scripts/audit_score_pollution.js --clean              # 审计+清空污染
 *   node scripts/audit_score_pollution.js --clean --backfill   # 审计+清空+回填
 *   node scripts/audit_score_pollution.js --date 2026-06-17    # 只审计指定日期
 */

const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, '..', 'server', 'data.json');
const BACKUP_FILE = DATA_FILE + '.bak.polution_cleanup';

// ── 工具函数 ──
function normScore(s) {
  if (!s) return null;
  var m = s.match(/(\d+)\s*[:-]\s*(\d+)/);
  return m ? [parseInt(m[1]), parseInt(m[2])] : null;
}
function eqScore(a, b) {
  var na = normScore(a), nb = normScore(b);
  return na && nb && na[0] === nb[0] && na[1] === nb[1];
}

// ── 主流程 ──
const args = process.argv.slice(2);
const doClean = args.includes('--clean');
const doBackfill = args.includes('--backfill');
const targetDate = (function() {
  var di = args.indexOf('--date');
  return di >= 0 ? args[di + 1] : null;
})();

console.log('=== 比分污染全量审计' + (doClean ? ' + 清理' : '') + ' ===');
console.log('Data file:', DATA_FILE);
console.log('');

// 读取 data.json
let data;
try {
  data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) {
  console.error('Failed to read data.json:', e.message);
  process.exit(1);
}

var mMap = data.m || {};
var rMap = data.r || {};

// 统计
var total = 0, scored = 0, checked = 0, mismatches = 0, halfEqMismatches = 0;
var allMismatches = [];
var byDate = {};

Object.keys(mMap).forEach(function (k) {
  var m = mMap[k];
  if (!m || !m.date) return;
  total++;

  var dt = m.date.slice(0, 10);
  if (targetDate && dt !== targetDate) return;
  if (!m.score || !m.matchStatus || m.matchStatus < 2) return;

  scored++;
  var recs = rMap['m_' + m.matchId] || rMap[m.matchId] || [];
  if (recs.length === 0) return;

  var spfWin = recs.filter(function (r) {
    return (r.t || r.type) === '\u80dc' && r.result !== null && r.result !== 2;
  })[0];
  if (!spfWin) return;

  checked++;
  var ns = normScore(m.score);
  if (!ns) return;

  var scoreDir = ns[0] > ns[1] ? 'H' : ns[0] < ns[1] ? 'A' : 'D';
  var resultDir = spfWin.result === 1 ? 'H' : spfWin.result === 0 ? 'A' : 'D';

  if (scoreDir === resultDir) return; // 一致

  // 矛盾发现
  mismatches++;
  var halfEq = eqScore(m.score, m.halfScore);
  if (halfEq) halfEqMismatches++;

  if (!byDate[dt]) byDate[dt] = [];
  var mm = {
    date: dt,
    num: m.num || '',
    matchId: m.matchId,
    homeName: m.homeName || m.hometeam || '',
    visitName: m.visitName || m.awayteam || '',
    score: m.score,
    halfScore: m.halfScore || '',
    duration: m.duration || '',
    halfEq: halfEq,
    scoreDir: scoreDir,
    resultDir: resultDir,
    spfResult: spfWin.result,
    spfExpertCount: spfWin.n || spfWin.num || 0,
    key: k,
  };
  byDate[dt].push(mm);
  allMismatches.push(mm);

  // 清理: 清空半场污染比分
  if (doClean && halfEq) {
    m.score = '';
    m.homeScore = -1;
    m.visitScore = -1;
    mm.cleaned = true;
  }
});

// 输出结果
console.log('Total matches:', total);
console.log('Scored & finished:', scored);
console.log('Cross-validated:', checked);
console.log('MISMATCHES:', mismatches);
console.log('  halfEq (半场污染):', halfEqMismatches);
console.log('  halfDiff (其他矛盾):', mismatches - halfEqMismatches);
console.log('');

var sortedDates = Object.keys(byDate).sort();
console.log('By date:');
sortedDates.forEach(function (dt) {
  var arr = byDate[dt];
  var he = arr.filter(function (x) { return x.halfEq; }).length;
  console.log('  ' + dt + ': ' + arr.length + ' contradictions (' + he + ' halfEq, ' + (arr.length - he) + ' other)');
});

if (allMismatches.length <= 30) {
  console.log('');
  console.log('Details:');
  allMismatches.forEach(function (mm) {
    console.log('  ' + mm.date + ' ' + mm.num + ' ' + mm.homeName + ' vs ' + mm.visitName +
      ' | score=' + mm.score + ' half=' + mm.halfScore +
      ' | halfEq=' + mm.halfEq +
      ' | scoreDir=' + mm.scoreDir + ' resultDir=' + mm.resultDir +
      ' | spfN=' + mm.spfExpertCount);
  });
}

// 保存清理后的 data.json
if (doClean && halfEqMismatches > 0) {
  // 备份
  fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  console.log('');
  console.log('Backup saved: ' + BACKUP_FILE);

  // 写入
  fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  console.log('data.json updated: cleared ' + halfEqMismatches + ' contaminated scores');

  // 通知 PM2 重载
  try {
    require('child_process').execSync('pm2 sendSignal SIGUSR2 jc-zjfa', { timeout: 3000 });
    console.log('PM2 reload signal sent');
  } catch (e) {}

  // 触发缓存刷新
  try {
    var http = require('http');
    var req = http.request({ hostname: 'localhost', port: 3000, path: '/api', method: 'POST',
      headers: { 'Content-Type': 'application/json' } });
    req.write(JSON.stringify({ action: 'health' }));
    req.end();
  } catch (e) {}
}

console.log('');
console.log('Done.');

// ── P0-B: 回填正确比分（如果指定 --backfill） ──
if (doBackfill && doClean) {
  console.log('');
  console.log('=== Phase 2: Backfill correct scores ===');
  // TODO: 从 midou310 API 拉取正确比分
  // 当前状态: 需要确认 midou310 API 对于这些 matchId 是否仍返回正确分数
  console.log('Backfill requires midou310 API verification. Skipping for now.');

  // 列出需要回填的 matchId
  var midsToBackfill = allMismatches.filter(function (x) { return x.halfEq; }).map(function (x) { return x.matchId; });
  console.log('MatchIds to backfill (' + midsToBackfill.length + '):', midsToBackfill.slice(0, 20).join(', '));
}
