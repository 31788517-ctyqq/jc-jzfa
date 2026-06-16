/**
 * 从 GS 预测回填 PK 方向数据
 * PK 融合分析 = GS 方向 + AI 置信度等，历史数据中 PK 字段为空时用 GS 方向填充
 */
const path = require('path');
const database = require('./database');

function scoreToDirection(score) {
  if (!score) return null;
  const parts = String(score).split(/[-:：]/);
  if (parts.length < 2) return null;
  const h = parseInt(parts[0]),
    a = parseInt(parts[1]);
  if (isNaN(h) || isNaN(a)) return null;
  if (h > a) return '主胜';
  if (h < a) return '客胜';
  return '平';
}

function waitForDb() {
  return new Promise(function (resolve) {
    database.initDatabase();
    if (database.isAvailable()) {
      resolve(database.getAdapter());
      return;
    }
    const start = Date.now();
    function check() {
      if (database.isAvailable()) {
        resolve(database.getAdapter());
        return;
      }
      if (Date.now() - start > 30000) {
        console.error('数据库初始化超时');
        process.exit(1);
      }
      setTimeout(check, 500).unref();
    }
    check();
  });
}

(async function () {
  const adp = await waitForDb();
  if (!adp) {
    console.error('数据库不可用');
    process.exit(1);
  }

  // 查找: 有 GS 方向 但 没有 PK 方向的记录
  const rows = adp.execAll(
    'SELECT id, matchId, gs_top_score, gs_top_percent, actual_score, actual_spf ' +
      'FROM prediction_logs ' +
      "WHERE actual_score IS NOT NULL AND actual_score <> '' " +
      "AND gs_top_score IS NOT NULL AND gs_top_score <> '' " +
      "AND (pk_direction IS NULL OR pk_direction = '')",
  );

  console.log('需要回填 PK 方向: ' + rows.length + ' 条');

  let count = 0;
  rows.forEach(function (row) {
    const dir = scoreToDirection(row.gs_top_score);
    if (!dir) return;

    adp.execRun('UPDATE prediction_logs SET pk_direction = ?, pk_composite_score = ? WHERE id = ?', [
      dir,
      row.gs_top_percent || 50,
      row.id,
    ]);
    count++;
  });

  console.log('已回填 PK 方向: ' + count + ' 条');

  // 验证
  const verify = adp.execOne(
    'SELECT COUNT(*) as cnt FROM prediction_logs ' +
      "WHERE pk_direction IS NOT NULL AND pk_direction <> '' AND actual_score IS NOT NULL AND actual_score <> ''",
  );
  console.log('PK 有效记录: ' + (verify ? verify.cnt : 0) + ' 条');
  console.log('完成');
})();
