/**
 * server/backfill_consensus.js — 一次性回填 prediction_logs.pk_fusion_consensus
 *
 * 数据源: gongshoudao/cache.json._global[matchId].fusionConsensusType
 * 用法: node server/backfill_consensus.js [--dry]
 */

const fs = require('fs');
const path = require('path');

const dryRun = process.argv.includes('--dry');
const DB_PATH = path.join(__dirname, 'midou_data.db');
const GS_CACHE_PATH = path.join(__dirname, 'gongshoudao', 'cache.json');

console.log(dryRun ? 'DRY RUN — 不写入' : '正式执行\n');

// 1) 加载 GS 缓存
if (!fs.existsSync(GS_CACHE_PATH)) {
  console.error('cache.json 不存在');
  process.exit(1);
}
const gsCache = JSON.parse(fs.readFileSync(GS_CACHE_PATH, 'utf8'));
const gsGlobal = gsCache._global || {};
const gsKeys = Object.keys(gsGlobal).filter((k) => !k.startsWith('_'));
console.log(`GS 缓存 keys: ${gsKeys.length} 条\n`);

// 2) 初始化 DB (sql.js)
const initSqlJs = require('sql.js');
initSqlJs().then((SQL) => {
  const buf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  let updated = 0,
    skipped = 0,
    noGS = 0;

  // 3) 遍历 prediction_logs 每条记录
  const rows = db.exec(`
    SELECT id, matchId, date, pk_fusion_consensus
    FROM prediction_logs
    WHERE pk_fusion_consensus IS NULL OR pk_fusion_consensus = ''
  `);

  const all = rows.length > 0 ? rows[0].values : [];
  console.log(`prediction_logs 待回填: ${all.length} 条\n`);

  for (const row of all) {
    const [id, matchId, date, current] = row;
    if (current && current !== '') {
      skipped++;
      continue;
    }

    // 用 matchId 查 GS 缓存 (兼容 m_ 前缀)
    const mid = String(matchId || '').replace(/^m_/, '');
    const gs = gsGlobal[mid] || gsGlobal['m_' + mid] || gsGlobal[matchId];
    if (!gs) {
      noGS++;
      continue;
    }

    const consensus = gs.fusionConsensusType || gs.fusionConsensus || null;
    if (!consensus) {
      noGS++;
      continue;
    }

    if (!dryRun) {
      db.run('UPDATE prediction_logs SET pk_fusion_consensus = ? WHERE id = ?', [consensus, id]);
    }
    updated++;
  }

  // 4) 写入 + 统计
  if (!dryRun && updated > 0) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }

  console.log(`\n===== 结果 =====`);
  console.log(`  已回填: ${updated}`);
  console.log(`  无共识: ${noGS}`);
  console.log(`  已跳过: ${skipped}`);
  if (dryRun) console.log(`  (DRY RUN, 未实际写入)`);

  // 验证
  const verify = db.exec(
    "SELECT COUNT(*) as c FROM prediction_logs WHERE pk_fusion_consensus IS NOT NULL AND pk_fusion_consensus != ''",
  );
  const count = verify.length > 0 ? verify[0].values[0][0] : 0;
  console.log(`  最终有共识: ${count} / ${all.length + skipped}`);

  db.close();
  console.log('\n完成');
});
