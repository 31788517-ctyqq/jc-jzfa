/**
 * 批量抓取500.com历史赔率数据
 * 从2026-04-25开始补抓所有日期
 */
const fs = require('fs');
const path = require('path');
const { fetchOdds } = require('./fetch_500odds');

// 数据存储目录
const DATA_DIR = path.join(__dirname, 'odds_history');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 生成日期范围
function generateDates(startDate, endDate) {
  const dates = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

// 抓取单个日期
async function fetchOneDay(dateStr) {
  const filePath = path.join(DATA_DIR, `${dateStr}.json`);
  
  // 检查是否已存在且有效
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.size > 100) {
      console.log(`[SKIP] ${dateStr} - already exists`);
      return { date: dateStr, status: 'skipped', count: 0 };
    }
  }
  
  console.log(`[FETCH] ${dateStr} - fetching...`);
  
  try {
    const odds = await fetchOdds(dateStr);
    const matches = Object.keys(odds);
    
    if (matches.length === 0) {
      console.log(`[EMPTY] ${dateStr} - no matches`);
      fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, matches: [], empty: true }));
      return { date: dateStr, status: 'empty', count: 0 };
    }
    
    // 保存完整数据
    fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, odds }, null, 2));
    console.log(`[SUCCESS] ${dateStr} - ${matches.length} matches saved`);
    return { date: dateStr, status: 'success', count: matches.length };
    
  } catch (e) {
    console.error(`[ERROR] ${dateStr} - ${e.message}`);
    return { date: dateStr, status: 'error', error: e.message };
  }
}

// 批量抓取
async function batchFetch() {
  const startDate = '2026-04-25';
  const endDate = new Date().toISOString().slice(0, 10);
  
  console.log(`Starting batch fetch from ${startDate} to ${endDate}`);
  console.log('========================================');
  
  const dates = generateDates(startDate, endDate);
  const results = [];
  
  // 串行抓取，避免被封
  for (const dateStr of dates) {
    const result = await fetchOneDay(dateStr);
    results.push(result);
    
    // 延迟1秒，避免请求过快
    await new Promise(r => setTimeout(r, 1000));
  }
  
  console.log('========================================');
  console.log('Batch fetch completed');
  
  // 统计
  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const empty = results.filter(r => r.status === 'empty').length;
  const error = results.filter(r => r.status === 'error').length;
  
  console.log(`Summary: ${success} success, ${skipped} skipped, ${empty} empty, ${error} error`);
  
  // 保存统计报告
  const reportPath = path.join(DATA_DIR, 'batch_report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ 
    startDate, 
    endDate, 
    fetchedAt: new Date().toISOString(),
    summary: { success, skipped, empty, error },
    results 
  }, null, 2));
  
  return results;
}

// 如果直接运行此脚本
if (require.main === module) {
  batchFetch().then(() => {
    console.log('Done');
    process.exit(0);
  }).catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

module.exports = { batchFetch, fetchOneDay };
