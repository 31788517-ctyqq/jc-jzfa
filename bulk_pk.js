const database = require('./database');
database.initDatabase();

function wait(n) {
  if (database.isAvailable()) return run(database.getAdapter());
  if (n > 50) { console.log('timeout'); process.exit(1); }
  setTimeout(() => wait(n + 1), 300);
}

function run(adp) {
  var sql = "UPDATE prediction_logs SET " +
    "pk_direction = CASE " +
    "  WHEN CAST(substr(gs_top_score,1,instr(gs_top_score,':')-1) AS INTEGER) > CAST(substr(gs_top_score,instr(gs_top_score,':')+1) AS INTEGER) THEN '主胜' " +
    "  WHEN CAST(substr(gs_top_score,1,instr(gs_top_score,':')-1) AS INTEGER) < CAST(substr(gs_top_score,instr(gs_top_score,':')+1) AS INTEGER) THEN '客胜' " +
    "  ELSE '平' " +
    "END, " +
    "pk_composite_score = gs_top_percent " +
    "WHERE actual_score IS NOT NULL AND actual_score != '' " +
    "AND gs_top_score IS NOT NULL AND gs_top_score != '' " +
    "AND (pk_direction IS NULL OR pk_direction = '')";

  var r = adp.execRun(sql);
  console.log('Updated:', JSON.stringify(r));

  var v = adp.execOne("SELECT COUNT(*) as c FROM prediction_logs WHERE pk_direction IS NOT NULL AND pk_direction != '' AND actual_score IS NOT NULL AND actual_score != ''");
  console.log('PK total:', v ? v.c : 0);
  process.exit(0);
}
wait(0);
