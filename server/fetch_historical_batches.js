/**
 * 历史批次全量抓取脚本
 *
 * 用途：在服务器上直连 127.0.0.1:19880 批量抓取 m.100qiu.com 的全部历史批次数据
 * 服务器上本地直连，不受限流影响。
 *
 * 用法：
 *   node server/fetch_historical_batches.js              # 抓取全部缺失批次（默认）
 *   node server/fetch_historical_batches.js --force      # 强制重新抓取全部批次（覆盖已有）
 *   node server/fetch_historical_batches.js --dry        # 试跑，不写入文件
 *
 * 批次范围：26011 (Jan batch 1) → 26070 (Jun batch 10)
 * 存储位置：server/stats_bank.json（API 原始数据）+ server/batch_index.json（索引）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================

const LOCAL_API = 'http://127.0.0.1:19880';
const SERVER_DIR = __dirname;
const STATS_BANK_PATH = path.join(SERVER_DIR, 'stats_bank.json');
const BATCH_INDEX_PATH = path.join(SERVER_DIR, 'batch_index.json');

// 批次范围：26011 (Jan 1st) → 26070 (Jun 10th batch)
// 格式: YY + 0 + M + batchNo
//   26011 = 26 + 0 + 1 + 1
//   260121 = 26 + 0 + 1 + 21
const START_YEAR = 2026, START_MONTH = 1, START_BATCH = 1;
const END_YEAR = 2026, END_MONTH = 6, END_BATCH = 10;

// 请求设置
const TIMEOUT_MS = 15000;
const GAP_MS = 200; // 本地请求间隔 200ms（本地不限流，但留点间隔）

const DRY_RUN = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

// ==================== 工具函数 ====================

function makeDateTime(year, month, batch) {
  const yy = String(year).slice(2);
  return yy + '0' + String(month) + String(batch);
}

/**
 * 生成全部目标批次列表
 */
function generateAllBatches() {
  const batches = [];
  for (let m = START_MONTH; m <= END_MONTH; m++) {
    const maxBatch = (m === END_MONTH) ? END_BATCH : 30; // 每月最多30期
    for (let b = START_BATCH; b <= maxBatch; b++) {
      // 月+批次号拼到两位数
      const dt = makeDateTime(START_YEAR, m, b);
      batches.push({ dt, month: m, batch: b });
    }
  }
  return batches;
}

function httpGetJSON(url, timeoutMs) {
  timeoutMs = timeoutMs || TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Host: 'm.100qiu.com',
      },
    };
    http.get(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
          resolve(data);
        } catch (e) {
          reject(new Error('JSON parse: ' + e.message));
        }
      });
    }).on('error', (err) => {
      reject(err);
    }).setTimeout(timeoutMs, () => {
      reject(new Error('timeout(' + timeoutMs + 'ms)'));
    });
  });
}

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn('读取失败:', filePath, e.message);
    return {};
  }
}

/**
 * 检查批次是否已经缓存
 */
function isAlreadyCached(dt) {
  if (FORCE) return false;
  const bank = readJSON(STATS_BANK_PATH);
  const entry = bank['_raw_' + dt];
  if (!entry) return false;

  // 新格式: { data: [...], ... }
  const data = entry.data || entry;
  if (Array.isArray(data) && data.length > 0) return true;
  return false;
}

/**
 * 保存原始 API 数据到 stats_bank.json
 */
function saveRawCache(dt, rawData) {
  if (DRY_RUN) return;

  let bank = readJSON(STATS_BANK_PATH);
  const now = Date.now();
  bank['_raw_' + dt] = {
    data: rawData,
    createdAt: now,
    expiresAt: now + 365 * 24 * 3600 * 1000, // 长期保留
  };
  fs.writeFileSync(STATS_BANK_PATH, JSON.stringify(bank, null, 2), 'utf8');
}

/**
 * 更新批次索引
 */
function updateBatchIndex(dt, rawData) {
  if (DRY_RUN) return;

  let index = readJSON(BATCH_INDEX_PATH);
  const now = Date.now();
  const matchCount = Array.isArray(rawData)
    ? rawData.length
    : (rawData && rawData.data ? rawData.data.length : 0);
  index[dt] = {
    valid: true,
    matchCount: matchCount,
    discoveredAt: index[dt] ? index[dt].discoveredAt : now,
    updatedAt: now,
    expiresAt: now + 365 * 24 * 3600 * 1000,
  };
  fs.writeFileSync(BATCH_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== 主流程 ====================

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log(' m.100qiu.com 历史批次全量抓取');
  console.log(' API: ' + LOCAL_API + ' (本地直连，不限流)');
  console.log(' 存储: ' + STATS_BANK_PATH);
  console.log(' 时间: ' + new Date().toISOString());
  if (DRY_RUN) console.log(' 模式: DRY-RUN (不写入文件)');
  if (FORCE) console.log(' 模式: FORCE (覆盖已有缓存)');
  console.log('══════════════════════════════════════════════\n');

  // 生成全部候选批次
  const allBatches = generateAllBatches();
  console.log('候选批次总数: ' + allBatches.length);
  console.log('范围: ' + allBatches[0].dt + ' → ' + allBatches[allBatches.length - 1].dt);

  // 过滤掉已缓存的
  let pending = allBatches;
  if (!FORCE) {
    const skipped = allBatches.filter((b) => isAlreadyCached(b.dt));
    pending = allBatches.filter((b) => !isAlreadyCached(b.dt));
    if (skipped.length > 0) {
      console.log('跳过已缓存: ' + skipped.length + ' 批次 (' + skipped.map((b) => b.dt).join(', ') + ')');
    }
  }

  console.log('待抓取: ' + pending.length + ' 批次\n');

  if (pending.length === 0) {
    console.log('✅ 没有需要抓取的批次，全部已缓存！');
    printSummary(allBatches);
    return;
  }

  // 批量抓取
  let success = 0, empty = 0, failed = 0;
  const results = { success: [], empty: [], failed: [] };

  for (let i = 0; i < pending.length; i++) {
    const { dt, month, batch } = pending[i];
    const url = LOCAL_API + '/api/dcListBasic?dateTime=' + dt;
    const progress = '[' + (i + 1) + '/' + pending.length + ']';

    try {
      const resp = await httpGetJSON(url, TIMEOUT_MS);

      // 判断响应是否有效
      let dataArr = null;
      if (Array.isArray(resp)) {
        dataArr = resp;
      } else if (resp && resp.data && Array.isArray(resp.data)) {
        dataArr = resp.data;
      } else if (resp && resp.code !== undefined) {
        // API 返回了错误码
        if (resp.code !== 0 && resp.code !== 200) {
          console.log(progress, dt, `(M${month}B${batch})`, '→ API错误:', resp.msg || resp.message || 'code=' + resp.code);
          failed++;
          results.failed.push({ dt, month, batch, error: 'API code=' + resp.code });
          await sleep(GAP_MS);
          continue;
        }
      }

      if (dataArr && dataArr.length > 0) {
        // 有效数据
        saveRawCache(dt, dataArr);
        updateBatchIndex(dt, dataArr);
        const dateRange = getDateRange(dataArr);
        console.log(progress, dt, `(M${month}B${batch})`, '✅ ' + dataArr.length + '场', dateRange);
        success++;
        results.success.push({ dt, month, batch, count: dataArr.length });
      } else {
        console.log(progress, dt, `(M${month}B${batch})`, '⚠️ 空批次（无比赛数据）');
        empty++;
        results.empty.push({ dt, month, batch });
        // 仍标记到索引（避免后续重复探测）
        if (!DRY_RUN) {
          saveRawCache(dt, []);
          updateBatchIndex(dt, []);
          // 标记为无效
          let index = readJSON(BATCH_INDEX_PATH);
          if (index[dt]) {
            index[dt].valid = false;
            index[dt].matchCount = 0;
            fs.writeFileSync(BATCH_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
          }
        }
      }
    } catch (err) {
      // "Unexpected end of JSON input" = 空响应 = 批次不存在，当作空批次处理
      if (err.message && err.message.includes('Unexpected end of JSON input')) {
        console.log(progress, dt, `(M${month}B${batch})`, '⚠️ 批次不存在（空响应）');
        empty++;
        results.empty.push({ dt, month, batch });
      } else {
        console.log(progress, dt, `(M${month}B${batch})`, '❌', err.message);
        failed++;
        results.failed.push({ dt, month, batch, error: err.message });
      }
    }

    // 速率控制
    if (i < pending.length - 1) {
      await sleep(GAP_MS);
    }
  }

  // 清理无效的过期标记（由 FORCE 模式造成的缓存可能需要单独修复）
  if (!DRY_RUN) {
    let index = readJSON(BATCH_INDEX_PATH);
    results.empty.forEach(({ dt }) => {
      if (index[dt]) {
        index[dt].valid = false;
      }
    });
    results.failed.forEach(({ dt }) => {
      if (!index[dt]) {
        index[dt] = { valid: false, matchCount: 0, discoveredAt: Date.now() };
      }
    });
    fs.writeFileSync(BATCH_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  }

  // ==================== 汇总 ====================
  console.log('\n══════════════════════════════════════════════');
  console.log(' 抓取完成汇总');
  console.log('══════════════════════════════════════════════');
  console.log('  ✅ 成功: ' + success + ' 批次');
  console.log('  ⚠️ 空批: ' + empty + ' 批次');
  console.log('  ❌ 失败: ' + failed + ' 批次');
  console.log('  跳过: ' + (allBatches.length - pending.length) + ' 批次（已缓存）');
  console.log('══════════════════════════════════════════════');

  if (results.failed.length > 0) {
    console.log('\n失败批次详情:');
    results.failed.forEach((f) => {
      console.log('    ' + f.dt + ' (' + f.month + '月' + f.batch + '期): ' + f.error);
    });
  }

  // 最终统计
  printSummary(allBatches);
}

function getDateRange(dataArr) {
  if (!dataArr || dataArr.length === 0) return '(none)';
  const dates = dataArr
    .map((d) => d.matchTimeStr || d.matchDate)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return '(no dates)';
  return dates[0] + ' ~ ' + dates[dates.length - 1];
}

function printSummary(allBatches) {
  if (DRY_RUN) return;
  const bank = readJSON(STATS_BANK_PATH);
  const index = readJSON(BATCH_INDEX_PATH);

  let totalRawEntries = 0;
  let totalMatchCount = 0;
  const byMonth = {};
  let lastMonth = 0;

  Object.keys(bank).forEach((k) => {
    if (!k.startsWith('_raw_')) return;
    const dt = k.replace('_raw_', '');
    const entry = bank[k];
    const dataList = entry && entry.data ? entry.data : (Array.isArray(entry) ? entry : []);
    const cnt = Array.isArray(dataList) ? dataList.length : 0;
    totalRawEntries++;
    totalMatchCount += cnt;

    const parsed = parseDT(dt);
    if (parsed) {
      if (!byMonth[parsed.month]) byMonth[parsed.month] = { batches: 0, matches: 0 };
      byMonth[parsed.month].batches++;
      byMonth[parsed.month].matches += cnt;
    }
  });

  console.log('\n📊 缓存统计:');
  Object.keys(byMonth).sort().forEach((m) => {
    const name = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][parseInt(m)] || m + '月';
    console.log('  ' + name + ': ' + byMonth[m].batches + ' 批次, ' + byMonth[m].matches + ' 条比赛数据');
  });
  console.log('  总计: ' + totalRawEntries + ' 批次, ' + totalMatchCount + ' 条比赛数据');
}

function parseDT(dt) {
  const s = String(dt);
  if (s.length < 5) return null;
  return {
    year: 2000 + parseInt(s.slice(0, 2)),
    month: parseInt(s[3]),
    batch: parseInt(s.slice(4)),
  };
}

// ==================== 启动 ====================

main().catch((err) => {
  console.error('❌ 抓取脚本异常:', err);
  process.exit(1);
});
