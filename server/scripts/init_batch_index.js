/**
 * ★ 批次索引迁移脚本
 *
 * 从现有 stats_bank.json 中提取 _raw_ 批次数据，
 * 生成初始 batch_index.json。
 *
 * 用法: node server/scripts/init_batch_index.js
 */
const fs = require('fs');
const path = require('path');

const STATS_BANK_PATH = path.join(__dirname, '..', 'stats_bank.json');
const BATCH_INDEX_PATH = path.join(__dirname, '..', 'batch_index.json');
const TTL_BATCH = 30 * 24 * 3600 * 1000; // 30天

function main() {
  console.log('=== 批次索引初始化 ===');

  // 1. 读取现有数据
  if (!fs.existsSync(STATS_BANK_PATH)) {
    console.log('stats_bank.json 不存在，创建空索引');
    fs.writeFileSync(BATCH_INDEX_PATH, JSON.stringify({}, null, 2), 'utf8');
    return;
  }

  const bank = JSON.parse(fs.readFileSync(STATS_BANK_PATH, 'utf8'));
  const now = Date.now();

  // 2. 提取所有 _raw_ 批次
  const index = {};
  let count = 0;

  Object.keys(bank).forEach((key) => {
    if (!key.startsWith('_raw_')) return;

    const dt = key.replace('_raw_', '');
    const entry = bank[key];

    // 计算匹配数
    let matchCount = 0;
    if (Array.isArray(entry)) {
      matchCount = entry.length;
    } else if (entry && entry.data && Array.isArray(entry.data)) {
      matchCount = entry.data.length;
    }

    index[dt] = {
      valid: true,
      matchCount: matchCount,
      discoveredAt: now,
      expiresAt: now + TTL_BATCH,
    };
    count++;

    console.log('  [OK] ' + dt + ' → ' + matchCount + ' 场');
  });

  // 3. 同时记录 _last_batch
  if (bank._last_batch && !index[bank._last_batch]) {
    // 标记 last_batch 但缺少 raw 数据
    console.log('  [WARN] _last_batch=' + bank._last_batch + ' 但缺少 _raw_ 数据');
  }

  // 4. 写入索引
  fs.writeFileSync(BATCH_INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  console.log('\n索引已生成: ' + BATCH_INDEX_PATH);
  console.log('共 ' + count + ' 个批次');
}

main();
