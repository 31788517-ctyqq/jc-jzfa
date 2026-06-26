/**
 * 临时脚本: 将 ctyqq 提升为 super_admin
 * 运行: node scripts/grant_ctyqq_admin.js
 */
const database = require('../server/database');
const authDb = database.getAuthAdapter ? database.getAuthAdapter() : null;

if (!authDb) {
  console.log('FAIL: getAuthAdapter returned null');
  process.exit(1);
}

try {
  const row = authDb.execOne('SELECT id, username, roles FROM users WHERE username = ?', 'ctyqq');
  if (row) {
    console.log('当前 ctyqq roles:', row.roles);
    authDb.execRun(
      'UPDATE users SET roles = ? WHERE username = ?',
      JSON.stringify(['super_admin', 'ops_admin', 'analyst', 'viewer']),
      'ctyqq'
    );
    console.log('✅ ctyqq 已升级为 super_admin');
  } else {
    console.log('ctyqq 不在 auth.db 中，尝试同步主 DB...');
    // 检查主 DB
    const db = database.getAdapter();
    if (!db) { console.log('主 DB 不可用'); process.exit(1); }
    const mainRow = db.execOne('SELECT id, username, roles FROM users WHERE username = ?', 'ctyqq');
    if (mainRow) {
      console.log('主 DB ctyqq:', JSON.stringify(mainRow));
      // 复制到 auth.db
      authDb.execRun(
        'INSERT OR REPLACE INTO users (id, username, password_hash, salt, roles, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        mainRow.id || 1, 'ctyqq', '', '', JSON.stringify(['super_admin']), 'active', new Date().toISOString(), new Date().toISOString()
      );
      console.log('✅ ctyqq 已从主 DB 同步到 auth.db');
    } else {
      console.log('ctyqq 在两个 DB 中都不存在，请先注册');
    }
  }
} catch (e) {
  console.log('Error:', e.message);
}
