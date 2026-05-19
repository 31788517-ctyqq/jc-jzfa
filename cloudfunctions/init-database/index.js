/**
 * 云数据库初始化脚本
 * 运行方式: 右键云函数 → 本地调试 → 运行
 * 作用: 创建集合和索引
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async () => {
  const db = cloud.database();
  const results = [];

  const collections = [
    { name: 'matches', desc: '比赛列表缓存' },
    { name: 'recommends', desc: '推荐趋势数据' },
    { name: 'hit_rates', desc: '命中率统计' },
    { name: 'crawl_logs', desc: '抓取日志' }
  ];

  for (const col of collections) {
    try {
      await db.createCollection(col.name);
      results.push(`✅ 创建集合 ${col.name} (${col.desc}) 成功`);
    } catch (err) {
      if (err.errCode === -502001) {
        results.push(`ℹ️  集合 ${col.name} 已存在`);
      } else {
        results.push(`❌ 创建集合 ${col.name} 失败: ${err.message}`);
      }
    }
  }

  // 创建索引（需在云开发控制台手动创建或通过 API）
  results.push('');
  results.push('请在云开发控制台 → 数据库 → 对应集合 → 索引管理中创建以下索引:');
  results.push('');
  results.push('matches 集合:');
  results.push('  - date (普通索引, 升序)');
  results.push('  - matchStatus (普通索引, 升序)');
  results.push('  - date + matchStatus (复合索引)');
  results.push('');
  results.push('recommends 集合:');
  results.push('  - matchId (普通索引, 升序)');
  results.push('  - matchId + captureTimestamp (复合索引, 升序)');
  results.push('');
  results.push('hit_rates 集合:');
  results.push('  - statDate (普通索引, 降序)');

  return results.join('\n');
};
