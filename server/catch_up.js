/**
 * catch_up.js — 03-19之后全量数据补抓程序
 *
 * 用法: node server/catch_up.js [startDate] [endDate] [--odds-only|--shuju-only|--all]
 * 默认: 2026-03-19 ~ 昨天, --all
 *
 * 补抓顺序:
 *   1. 赔率数据 (500.com trade)          ← 最快，每天约2秒
 *   2. 攻防shuju (500.com fenxi)         ← Python脚本，每天约30秒
 *   3. 赛程+推荐 (midou310)              ← 需要token，给出命令
 *   4. 命中回填 (midou310)               ← 只对已结束比赛
 *
 * 特性:
 *   - 断点续传: 已有有效数据自动跳过
 *   - 反封策略: 随机UA + 间隔抖动 1~3秒
 *   - 进度保存: 每5天写入checkpoint
 *   - 错误恢复: 单日失败不中断，记录失败列表
 *   - 日志记录: 每次补抓写入 logs/catch_up.log
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { fetchOdds, fetchShujuMap } = require('./fetch_500odds');
const logger = require('./logger').child('catch_up');

const ODDS_DIR = path.join(__dirname, 'odds_history');
const SHUJU_DIR = path.join(__dirname, 'shuju_data');
const CHECKPOINT_FILE = path.join(__dirname, 'catch_up_checkpoint.json');
const REPORT_FILE = path.join(__dirname, 'catch_up_report.json');

// ═══ 日期生成 ═══
function generateDates(start, end) {
  const dates = [];
  const cur = new Date(start + 'T00:00:00+08:00');
  const last = new Date(end + 'T00:00:00+08:00');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(baseMs) { return Math.floor(baseMs * (0.5 + Math.random() * 1.5)); }

// ═══ 检查点 ═══
function loadCheckpoint() {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
    }
  } catch (e) {}
  return { lastDate: null, results: {} };
}

function saveCheckpoint(cp) {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
  } catch (e) {}
}

function saveReport(report) {
  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  } catch (e) {}
}

// ═══ Step 1: 赔率补抓 ═══
async function catchUpOdds(dates, cp) {
  logger.info('═══ Step 1: 500.com 赔率补抓 (' + dates.length + ' 天) ═══');
  let done = 0, skipped = 0, failed = 0;

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const filePath = path.join(ODDS_DIR, d + '.json');

    // 跳过已有数据
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 100) {
      try {
        const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (existing.empty) { skipped++; continue; }
        const oddsCount = Object.keys(existing.odds || {}).length;
        if (oddsCount > 0) { skipped++; continue; }
      } catch (e) {}
    }

    try {
      logger.info('  [' + (i + 1) + '/' + dates.length + '] ' + d + ' - 抓取赔率...');
      const odds = await fetchOdds(d);
      const matchNums = Object.keys(odds);

      if (matchNums.length === 0) {
        fs.writeFileSync(filePath, JSON.stringify({ date: d, odds: {}, empty: true }));
        logger.info('    → 空 (无比赛或未开盘)');
      } else {
        fs.writeFileSync(filePath, JSON.stringify({ date: d, odds }));
        logger.info('    → ' + matchNums.length + ' 场');
        done++;
      }
    } catch (e) {
      logger.error('    → 失败: ' + e.message);
      failed++;
      cp.results[d] = Object.assign(cp.results[d] || {}, { odds: 'failed', oddsError: e.message });
    }

    cp.lastDate = d;
    if ((i + 1) % 5 === 0) saveCheckpoint(cp);
    await sleep(jitter(1500));
  }

  logger.info('赔率补抓完成: 新增' + done + '天, 跳过' + skipped + '天, 失败' + failed + '天');
  return { done, skipped, failed };
}

// ═══ Step 2: shuju攻防数据补抓 ═══
async function catchUpShuju(dates, cp) {
  logger.info('═══ Step 2: 500.com 攻防数据补抓 (' + dates.length + ' 天) ═══');
  let done = 0, skipped = 0, failed = 0, noData = 0;

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  const fenxiScript = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi.py');
  const selScript = path.join(__dirname, '..', 'scripts', 'fetch_500_fenxi_selenium.py');

  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const shujuFile = path.join(SHUJU_DIR, 'shuju_merged_' + d + '.json');

    // 跳过已有合并数据
    if (fs.existsSync(shujuFile) && fs.statSync(shujuFile).size > 500) {
      skipped++;
      continue;
    }

    // 检查是否有赔率数据（没有赔率则不抓shuju）
    const oddsFile = path.join(ODDS_DIR, d + '.json');
    if (!fs.existsSync(oddsFile) || fs.statSync(oddsFile).size < 100) {
      noData++;
      continue;
    }

    try {
      logger.info('  [' + (i + 1) + '/' + dates.length + '] ' + d + ' - 获取shuju映射...');

      // 1. 获取shuju映射
      const mapFile = path.join(__dirname, 'shuju_map_' + d + '.json');
      if (!fs.existsSync(mapFile)) {
        const shujuMap = await fetchShujuMap(d);
        if (!shujuMap || Object.keys(shujuMap).length === 0) {
          logger.info('    → 无分析链接');
          fs.writeFileSync(mapFile, JSON.stringify({ date: d, empty: true }));
          noData++;
          continue;
        }
        fs.writeFileSync(mapFile, JSON.stringify(shujuMap, null, 2));
        logger.info('    → ' + Object.keys(shujuMap).length + ' 个场次');
      }

      // 2. 静态抓取
      logger.info('    → 静态抓取攻防数据...');
      try {
        execSync(pythonCmd + ' "' + fenxiScript + '" ' + d, {
          cwd: path.join(__dirname, '..'),
          timeout: 300000,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024
        });
      } catch (e) {
        logger.info('    → 静态抓取失败: ' + (e.message || '').slice(0, 100));
      }

      // 3. Selenium补充（跳过太旧的数据，加速流程）
      const daysAgo = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
      if (daysAgo <= 30) {
        logger.info('    → Selenium抓取近6场...');
        try {
          execSync(pythonCmd + ' "' + selScript + '" ' + d, {
            cwd: path.join(__dirname, '..'),
            timeout: 600000,
            encoding: 'utf8',
            maxBuffer: 1024 * 1024
          });
        } catch (e) {
          logger.info('    → Selenium失败: ' + (e.message || '').slice(0, 100));
        }
      } else {
        logger.info('    → (' + d + ' 超过30天，跳过Selenium)');
      }

      // 4. 合并
      const { mergeShuju } = require('./merge_shuju');
      try {
        const merged = mergeShuju(d);
        if (merged && Object.keys(merged).length > 0) {
          logger.info('    → 合并完成: ' + Object.keys(merged).length + ' 场');
          done++;
        }
      } catch (e) {
        logger.info('    → 合并失败: ' + e.message);
      }

    } catch (e) {
      logger.error('    → 失败: ' + e.message);
      failed++;
      cp.results[d] = Object.assign(cp.results[d] || {}, { shuju: 'failed', shujuError: e.message });
    }

    cp.lastDate = d;
    if ((i + 1) % 3 === 0) saveCheckpoint(cp);
    await sleep(jitter(2000));
  }

  logger.info('攻防数据补抓完成: 新增' + done + '天, 跳过' + skipped + '天, 无数据' + noData + '天, 失败' + failed + '天');
  return { done, skipped, noData, failed };
}

// ═══ Step 3: 赛程+推荐补同步（给出命令，需在生产环境手动执行） ═══
function printCatchUpCommands(dates) {
  logger.info('═══ Step 3: 赛程+推荐补同步 ═══');
  logger.info('注意: 此步骤需要 midou310 token，建议在生产服务器执行');
  logger.info('');

  if (dates.length <= 10) {
    logger.info('逐条命令 (共 ' + dates.length + ' 条):');
    for (const d of dates) {
      console.log('curl -X POST https://zj.100qiu.com/api -H "Content-Type: application/json" -d \'{"action":"sync-match-date","date":"' + d + '"}\'');
    }
  } else {
    logger.info('命令过多 (' + dates.length + ' 条)，建议使用生产服务器批量脚本:');
    console.log(`
# 在生产服务器上运行:
for d in $(cat dates_to_sync.txt); do
  curl -X POST http://localhost:3000/api \\
    -H "Content-Type: application/json" \\
    -d "{\\"action\\":\\"sync-match-date\\",\\"date\\":\\"$d\\"}"
  sleep 5
done`);
  }
}

// ═══ 主函数 ═══
async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2);
  let startDate = '2026-03-19';
  let endDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let mode = 'all';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--odds-only') mode = 'odds';
    else if (args[i] === '--shuju-only') mode = 'shuju';
    else if (args[i] === '--matches-only') mode = 'matches';
    else if (args[i] === '--all') mode = 'all';
    else if (!args[i].startsWith('--')) {
      if (!startDate || startDate === '2026-03-19') startDate = args[i];
      else endDate = args[i];
    }
  }

  console.log('════════════════════════════════════════');
  console.log('  数据补抓程序 v1');
  console.log('  范围: ' + startDate + ' ~ ' + endDate);
  console.log('  模式: ' + mode);
  console.log('════════════════════════════════════════');

  const dates = generateDates(startDate, endDate);
  console.log('共 ' + dates.length + ' 天\n');

  let cp = loadCheckpoint();
  if (cp.lastDate) {
    const resumeIdx = dates.indexOf(cp.lastDate);
    if (resumeIdx >= 0) {
      console.log('从检查点恢复: ' + cp.lastDate);
      dates.splice(0, resumeIdx + 1);
      console.log('剩余 ' + dates.length + ' 天\n');
    }
  }

  const report = {
    startDate, endDate, mode,
    startedAt: new Date().toISOString(),
    totalDays: dates.length,
    results: {}
  };

  // 确保目录存在
  if (!fs.existsSync(ODDS_DIR)) fs.mkdirSync(ODDS_DIR, { recursive: true });
  if (!fs.existsSync(SHUJU_DIR)) fs.mkdirSync(SHUJU_DIR, { recursive: true });

  // Step 1: 赔率
  if (mode === 'all' || mode === 'odds') {
    report.results.odds = await catchUpOdds(dates, cp);
    saveCheckpoint(cp);
  }

  // Step 2: 攻防数据
  if (mode === 'all' || mode === 'shuju') {
    report.results.shuju = await catchUpShuju(dates, cp);
    saveCheckpoint(cp);
  }

  // Step 3: 赛程+推荐（需要midou token，给出命令）
  if (mode === 'all' || mode === 'matches') {
    printCatchUpCommands(dates);
  }

  // 最终汇总
  report.completedAt = new Date().toISOString();
  console.log('\n════════════════════════════════════════');
  console.log('  补抓完成!');
  console.log('════════════════════════════════════════');

  // 完整性检查
  console.log('\n── 完整性检查 ──');
  const allDates = generateDates(startDate, endDate);
  let oddsMissing = 0, shujuMissing = 0;
  const missingDates = [];
  for (const d of allDates) {
    const oFile = path.join(ODDS_DIR, d + '.json');
    const sFile = path.join(SHUJU_DIR, 'shuju_merged_' + d + '.json');
    if (!fs.existsSync(oFile) || fs.statSync(oFile).size < 100) oddsMissing++;
    if (!fs.existsSync(sFile) || fs.statSync(sFile).size < 500) {
      shujuMissing++;
      missingDates.push(d);
    }
  }
  console.log('赔率缺失: ' + oddsMissing + ' 天');
  console.log('攻防数据缺失: ' + shujuMissing + ' 天');

  report.gaps = { oddsMissing, shujuMissing, missingDates };

  if (shujuMissing > 0) {
    console.log('缺失日期列表:');
    missingDates.forEach(d => console.log('  ' + d));

    // 写入缺失日期文件供后续批量同步
    const missingFile = path.join(__dirname, 'dates_to_sync.txt');
    fs.writeFileSync(missingFile, missingDates.join('\n'));
    console.log('\n缺失日期已写入: server/dates_to_sync.txt');
  }

  saveReport(report);
  saveCheckpoint(cp);
}

// 运行
if (require.main === module) {
  main().catch(e => {
    console.error('FATAL:', e.message);
    logger.error('FATAL: ' + e.message);
    console.error(e.stack);
    process.exit(1);
  });
}

module.exports = { main, catchUpOdds, catchUpShuju, generateDates };
