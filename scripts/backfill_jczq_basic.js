/**
 * JczqBasic 全字段历史数据回填脚本（V9.0）
 *
 * 用途: 将 m.100qiu.com/api/JczqBasic 的历史全字段数据回填到 midou_data.db 的 jczq_basic_cache 表
 *
 * ⚠️ 必须在服务器上运行（依赖 127.0.0.1:19880 本地代理访问 m.100qiu.com API）
 *
 * 用法:
 *   # 服务器上执行:
 *   node scripts/backfill_jczq_basic.js                          # 回填所有历史日期
 *   node scripts/backfill_jczq_basic.js --date 2026-05-26        # 回填单天
 *   node scripts/backfill_jczq_basic.js --from 2026-03-19 --to 2026-04-01  # 回填日期范围
 *   node scripts/backfill_jczq_basic.js --dry-run                # 仅检查缺口，不实际请求
 *
 *   部署后在服务器执行:
 *   scp scripts/backfill_jczq_basic.js root@119.23.51.159:/root/server/scripts/
 *   ssh root@119.23.51.159 "cd /root/server && node scripts/backfill_jczq_basic.js"
 */

const http = require('http');
const path = require('path');

// ── 配置 ──
const LOCAL_HOST = '127.0.0.1';
const LOCAL_PORT = 19880;
const BATCH_SIZE = 5;
const BATCH_DELAY = 300; // ms，比实时稍慢以减轻 API 压力
const REQUEST_TIMEOUT = 10000;

// ── 命令行参数解析 ──
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--date' && argv[i + 1]) { args.date = argv[++i]; continue; }
  if (argv[i] === '--from' && argv[i + 1]) { args.from = argv[++i]; continue; }
  if (argv[i] === '--to' && argv[i + 1]) { args.to = argv[++i]; continue; }
  if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
}

// ── HTTP 请求 ──
function fetchJSON(apiPath, timeoutMs) {
  timeoutMs = timeoutMs || REQUEST_TIMEOUT;
  return new Promise(function (resolve) {
    const opts = {
      hostname: LOCAL_HOST,
      port: LOCAL_PORT,
      path: apiPath,
      method: 'GET',
      headers: { Host: 'm.100qiu.com', Accept: 'application/json' },
    };
    http
      .get(opts, function (res) {
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
          } catch (e) {
            resolve(null);
          }
        });
      })
      .on('error', function () { resolve(null); })
      .setTimeout(timeoutMs, function () { resolve(null); });
  });
}

/**
 * 获取 JczqBasic 全字段数据
 */
async function fetchJczqBasicFull(dateStr, number) {
  const dt = dateStr.replace(/-/g, '');
  const apiPath = '/api/JczqBasic?dateTime=' + dt + '&number=' + number;
  const resp = await fetchJSON(apiPath);
  if (!resp || !resp.data) return null;
  const d = resp.data;

  // 提取所有字段（与 jczq_change.js 保持一致）
  return {
    lineId: d.lineId || null,
    matchTimeStr: d.matchTimeStr || null,
    homeTeam: d.homeTeam || null,
    guestTeam: d.guestTeam || null,
    gameShortName: d.gameShortName || null,
    rq: d.rq !== undefined ? d.rq : null,
    homePower: d.homePower != null ? Number(d.homePower) : null,
    guestPower: d.guestPower != null ? Number(d.guestPower) : null,
    homeJiFenHomeAll: d.homeJiFenHomeAll != null ? Number(d.homeJiFenHomeAll) : null,
    homeJiFenHome: d.homeJiFenHome != null ? Number(d.homeJiFenHome) : null,
    awayJiFenGuest: d.awayJiFenGuest != null ? Number(d.awayJiFenGuest) : null,
    homeFeature: d.homeFeature || null,
    guestFeature: d.guestFeature || null,
    homeEnterEfficiency: d.homeEnterEfficiency != null ? Number(d.homeEnterEfficiency) : null,
    guestEnterEfficiency: d.guestEnterEfficiency != null ? Number(d.guestEnterEfficiency) : null,
    homePreventEfficiency: d.homePreventEfficiency != null ? Number(d.homePreventEfficiency) : null,
    guestPreventEfficiency: d.guestPreventEfficiency != null ? Number(d.guestPreventEfficiency) : null,
    homeSpf: d.homeSpf || null,
    guestSpf: d.guestSpf || null,
    homeWinQiu_0: d.homeWinQiu_0 != null ? Number(d.homeWinQiu_0) : null,
    homeWinQiu_1: d.homeWinQiu_1 != null ? Number(d.homeWinQiu_1) : null,
    homeWinQiu_2: d.homeWinQiu_2 != null ? Number(d.homeWinQiu_2) : null,
    homeLoseQiu_0: d.homeLoseQiu_0 != null ? Number(d.homeLoseQiu_0) : null,
    homeLoseQiu_1: d.homeLoseQiu_1 != null ? Number(d.homeLoseQiu_1) : null,
    homeLoseQiu_2: d.homeLoseQiu_2 != null ? Number(d.homeLoseQiu_2) : null,
    homeWinGap_1: d.homeWinGap_1 != null ? Number(d.homeWinGap_1) : null,
    homeWinGap_2: d.homeWinGap_2 != null ? Number(d.homeWinGap_2) : null,
    homeLoseGap_1: d.homeLoseGap_1 != null ? Number(d.homeLoseGap_1) : null,
    homeLoseGap_2: d.homeLoseGap_2 != null ? Number(d.homeLoseGap_2) : null,
    homeWinPan: d.homeWinPan != null ? Number(d.homeWinPan) : null,
    guestWinPan: d.guestWinPan != null ? Number(d.guestWinPan) : null,
    jiaoFenDesc: d.jiaoFenDesc || null,
    jiaoFenMatch1: d.jiaoFenMatch1 || null,
    jiaoFenMatch2: d.jiaoFenMatch2 || null,
    initPan: d.initPan != null ? Number(d.initPan) : null,
    asiaInitAvgWinOdd: d.asiaInitAvgWinOdd != null ? Number(d.asiaInitAvgWinOdd) : null,
    asiaInitAvgLoseOdd: d.asiaInitAvgLoseOdd != null ? Number(d.asiaInitAvgLoseOdd) : null,
    lastPan: d.lastPan != null ? Number(d.lastPan) : null,
    asiaLastAvgWinOdd: d.asiaLastAvgWinOdd != null ? Number(d.asiaLastAvgWinOdd) : null,
    asiaLastAvgLoseOdd: d.asiaLastAvgLoseOdd != null ? Number(d.asiaLastAvgLoseOdd) : null,
    dxqInitPan: d.dxqInitPan != null ? Number(d.dxqInitPan) : null,
    dxqInitAvgWinOdd: d.dxqInitAvgWinOdd != null ? Number(d.dxqInitAvgWinOdd) : null,
    dxqInitAvgLoseOdd: d.dxqInitAvgLoseOdd != null ? Number(d.dxqInitAvgLoseOdd) : null,
    dxqLastPan: d.dxqLastPan != null ? Number(d.dxqLastPan) : null,
    dxqLastAvgWinOdd: d.dxqLastAvgWinOdd != null ? Number(d.dxqLastAvgWinOdd) : null,
    dxqLastAvgLoseOdd: d.dxqLastAvgLoseOdd != null ? Number(d.dxqLastAvgLoseOdd) : null,
    initRqWinOdd: d.initRqWinOdd != null ? Number(d.initRqWinOdd) : null,
    initRqDrawOdd: d.initRqDrawOdd != null ? Number(d.initRqDrawOdd) : null,
    initRqLoseOdd: d.initRqLoseOdd != null ? Number(d.initRqLoseOdd) : null,
    lastRqWinOdd: d.lastRqWinOdd != null ? Number(d.lastRqWinOdd) : null,
    lastRqDrawOdd: d.lastRqDrawOdd != null ? Number(d.lastRqDrawOdd) : null,
    lastRqLoseOdd: d.lastRqLoseOdd != null ? Number(d.lastRqLoseOdd) : null,
    winRate: d.winRate != null ? Number(d.winRate) : null,
    drawRate: d.drawRate != null ? Number(d.drawRate) : null,
    loseRate: d.loseRate != null ? Number(d.loseRate) : null,
    lastWinRate: d.lastWinRate != null ? Number(d.lastWinRate) : null,
    lastDrawRate: d.lastDrawRate != null ? Number(d.lastDrawRate) : null,
    lastLoseRate: d.lastLoseRate != null ? Number(d.lastLoseRate) : null,
    winDiscrete: d.winDiscrete != null ? Number(d.winDiscrete) : null,
    drawDiscrete: d.drawDiscrete != null ? Number(d.drawDiscrete) : null,
    loseDiscrete: d.loseDiscrete != null ? Number(d.loseDiscrete) : null,
    lastWinDiscrete: d.lastWinDiscrete != null ? Number(d.lastWinDiscrete) : null,
    lastDrawDiscrete: d.lastDrawDiscrete != null ? Number(d.lastDrawDiscrete) : null,
    lastLoseDiscrete: d.lastLoseDiscrete != null ? Number(d.lastLoseDiscrete) : null,
    initDiscreteDiff: d.initDiscreteDiff != null ? Number(d.initDiscreteDiff) : null,
    lastDiscreteDiff: d.lastDiscreteDiff != null ? Number(d.lastDiscreteDiff) : null,
    initEuroPay: d.initEuroPay != null ? Number(d.initEuroPay) : null,
    lastEuroPay: d.lastEuroPay != null ? Number(d.lastEuroPay) : null,
    initConfi: d.initConfi != null ? Number(d.initConfi) : null,
    lastConfi: d.lastConfi != null ? Number(d.lastConfi) : null,
    winPercent: d.winPercent != null ? Number(d.winPercent) : null,
    drawPercent: d.drawPercent != null ? Number(d.drawPercent) : null,
    losePercent: d.losePercent != null ? Number(d.losePercent) : null,
    rqWinPercent: d.rqWinPercent != null ? Number(d.rqWinPercent) : null,
    rqDrawPercent: d.rqDrawPercent != null ? Number(d.rqDrawPercent) : null,
    rqLosePercent: d.rqLosePercent != null ? Number(d.rqLosePercent) : null,
    hotWinRate: d.hotWinRate != null ? Number(d.hotWinRate) : null,
    hotLoseRate: d.hotLoseRate != null ? Number(d.hotLoseRate) : null,
    hotFocusNum: d.hotFocusNum != null ? Number(d.hotFocusNum) : null,
    homeWinAward: d.homeWinAward != null ? Number(d.homeWinAward) : null,
    drawAward: d.drawAward != null ? Number(d.drawAward) : null,
    guestWinAward: d.guestWinAward != null ? Number(d.guestWinAward) : null,
  };
}

// ── 辅助函数 ──
function extractMatchNum(numStr) {
  if (!numStr) return null;
  const m = ('' + numStr).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ═══════════════════════════════════════
// 主流程
// ═══════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  JczqBasic 历史数据回填脚本 (V9.0)  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');

  // 初始化数据库（兼容本地 scripts/../server/ 和服务器 scripts/../ = server/ 两种路径）
  let db;
  try { db = require('../server/database'); } catch (e) { db = require('../database'); }
  db.initDatabase();

  // sql.js 是异步初始化，轮询等待就绪（最多 10 秒）
  let waitAttempts = 0;
  while ((!db.isAvailable || !db.isAvailable()) && waitAttempts < 20) {
    await new Promise(function (r) { setTimeout(r, 500); });
    waitAttempts++;
  }

  if (!db.isAvailable || !db.isAvailable()) {
    console.error('[ERROR] 数据库超时未就绪，退出');
    process.exit(1);
  }

  const adp = db.getAdapter();
  if (!adp) {
    console.error('[ERROR] 数据库适配器不可用，退出');
    process.exit(1);
  }

  // 收集需要处理的比赛
  console.log('[1/3] 收集历史比赛数据...');
  let matches = [];

  if (args.date) {
    // 单日模式
    matches = adp.execAll(
      'SELECT matchId, num, date FROM matches WHERE date = ? ORDER BY CAST(num AS INTEGER)',
      args.date,
    );
    console.log('  指定日期: ' + args.date + ' → ' + matches.length + ' 场');
  } else if (args.from && args.to) {
    // 范围模式
    matches = adp.execAll(
      'SELECT matchId, num, date FROM matches WHERE date >= ? AND date <= ? ORDER BY date, CAST(num AS INTEGER)',
      args.from, args.to,
    );
    console.log('  日期范围: ' + args.from + ' ~ ' + args.to + ' → ' + matches.length + ' 场');
  } else {
    // 全量模式
    matches = adp.execAll(
      'SELECT matchId, num, date FROM matches ORDER BY date, CAST(num AS INTEGER)',
    );
    console.log('  全量回填 → ' + matches.length + ' 场');
  }

  if (matches.length === 0) {
    console.log('[DONE] 无需要处理的比赛，退出');
    process.exit(0);
  }

  // 检查已有数据，筛选缺口
  console.log('[2/3] 检查 DB 已有数据...');
  const existingSet = new Set();
  try {
    const existing = adp.execAll('SELECT date, match_num FROM jczq_basic_cache');
    existing.forEach(function (r) {
      existingSet.add(r.date + '|' + r.match_num);
    });
  } catch (e) {
    console.log('  表可能尚未创建，将全部视为缺失');
  }

  const toFetch = [];
  matches.forEach(function (m) {
    const matchNum = extractMatchNum(m.num);
    if (!matchNum) return;
    const key = m.date + '|' + matchNum;
    if (!existingSet.has(key)) {
      toFetch.push({ date: m.date, num: matchNum, matchId: m.matchId });
    }
  });

  const skippedCount = matches.length - toFetch.length;
  console.log('  已有数据: ' + skippedCount + ' 场');
  console.log('  待回填:   ' + toFetch.length + ' 场');

  if (toFetch.length === 0) {
    console.log('[DONE] 无缺口数据，退出');
    process.exit(0);
  }

  if (args.dryRun) {
    console.log('\n[Dry-Run] 以下 ' + toFetch.length + ' 场比赛需要回填 (未实际请求):');
    const sample = toFetch.slice(0, 20);
    sample.forEach(function (m) {
      console.log('  ' + m.date + '  #' + m.num + '  (' + m.matchId + ')');
    });
    if (toFetch.length > 20) console.log('  ... 还有 ' + (toFetch.length - 20) + ' 场');
    process.exit(0);
  }

  // 开始回填
  console.log('\n[3/3] 开始回填 (' + toFetch.length + ' 场)...');
  console.log('  BATCH_SIZE=' + BATCH_SIZE + '  BATCH_DELAY=' + BATCH_DELAY + 'ms');
  console.log('');

  let successCount = 0;
  let failCount = 0;
  let emptyCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);

    const promises = batch.map(function (m) {
      return (async function () {
        const data = await fetchJczqBasicFull(m.date, m.num);
        if (!data) {
          emptyCount++;
          return { status: 'empty', date: m.date, num: m.num };
        }
        try {
          db.upsertJczqBasic(m.date, String(m.num), data);
          successCount++;
          return { status: 'ok', date: m.date, num: m.num, team: data.homeTeam + ' vs ' + data.guestTeam };
        } catch (e) {
          failCount++;
          return { status: 'error', date: m.date, num: m.num, error: e.message };
        }
      })();
    });

    const results = await Promise.all(promises);
    results.forEach(function (r) {
      if (r.status === 'ok') {
        console.log('  ✓ ' + r.date + ' #' + r.num + '  ' + r.team);
      } else if (r.status === 'empty') {
        console.log('  ~ ' + r.date + ' #' + r.num + '  (API 无数据)');
      } else {
        console.log('  ✗ ' + r.date + ' #' + r.num + '  ERROR: ' + r.error);
      }
    });

    const done = Math.min(i + BATCH_SIZE, toFetch.length);
    const pct = Math.round(done / toFetch.length * 100);
    console.log('  ── 进度: ' + done + '/' + toFetch.length + ' (' + pct + '%)  成功:' + successCount + '  无数据:' + emptyCount + '  失败:' + failCount + ' ──\n');

    // 批次间延迟
    if (i + BATCH_SIZE < toFetch.length) {
      await sleep(BATCH_DELAY);
    }
  }

  // 报告
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  console.log('╔══════════════════════════════════════╗');
  console.log('║           回填完成                     ║');
  console.log('╠══════════════════════════════════════╣');
  console.log('║  总需处理: ' + String(toFetch.length).padStart(6) + ' 场                  ║');
  console.log('║  成功存入: ' + String(successCount).padStart(6) + ' 场                  ║');
  console.log('║  API 无数据: ' + String(emptyCount).padStart(6) + ' 场                  ║');
  console.log('║  写入失败: ' + String(failCount).padStart(6) + ' 场                  ║');
  console.log('║  耗时: ' + String(minutes).padStart(4) + '分' + String(seconds).padStart(2) + '秒                ║');
  console.log('╚══════════════════════════════════════╝');

  // 验证：输出最终统计
  try {
    const totalInDB = adp.execOne('SELECT COUNT(*) as cnt FROM jczq_basic_cache');
    const datesInDB = adp.execOne('SELECT COUNT(DISTINCT date) as cnt FROM jczq_basic_cache');
    console.log('\n[验证] jczq_basic_cache 表状态:');
    console.log('  总记录数: ' + (totalInDB ? totalInDB.cnt : 0));
    console.log('  覆盖天数: ' + (datesInDB ? datesInDB.cnt : 0));
  } catch (e) {
    console.log('\n[验证] 统计失败: ' + e.message);
  }

  if (failCount > 0) process.exitCode = 1;
}

main().catch(function (e) {
  console.error('[FATAL] ' + e.message + '\n' + e.stack);
  process.exit(1);
});
