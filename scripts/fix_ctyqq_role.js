/**
 * Check and fix ctyqq admin role in auth.db
 */
const database = require('../server/database');
const adp = database.getAuthAdapter ? database.getAuthAdapter() : null;
if (!adp) { console.log('FAIL: no auth adapter'); process.exit(1); }

try {
  // 1. Check user exists
  const user = adp.execOne('SELECT id, username, role FROM users WHERE username = ?', 'ctyqq');
  if (!user) { console.log('ctyqq not found in auth.db'); process.exit(1); }
  console.log('User:', JSON.stringify(user));

  // 2. Check user_roles
  let roles = adp.execAll('SELECT * FROM user_roles WHERE user_id = ?', user.id);
  console.log('user_roles:', JSON.stringify(roles));

  // 3. Check roles table
  const allRoles = adp.execAll('SELECT * FROM roles');
  console.log('Available roles:', JSON.stringify(allRoles));

  const now = new Date().toISOString();

  if (!roles || roles.length === 0) {
    // Find super_admin role_id
    const saRole = allRoles.find(function(r) { return r.code === 'super_admin'; });
    if (saRole) {
      adp.execRun('INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)', user.id, saRole.id, now);
      console.log('Inserted super_admin: user_id=' + user.id + ', role_id=' + saRole.id);
    } else {
      console.log('super_admin role not found in roles table');
    }
  }

  // Also grant ops_admin
  const opsRole = allRoles.find(function(r) { return r.code === 'ops_admin'; });
  if (opsRole) {
    const hasOps = (roles || []).some(function(r) { return r.role_id === opsRole.id; });
    if (!hasOps) {
      adp.execRun('INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)', user.id, opsRole.id, now);
      console.log('Granted ops_admin as well');
    }
  }

  // Verify
  const updated = adp.execAll('SELECT r.code FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = ?', user.id);
  console.log('Final roles for ctyqq:', updated.map(function(r) { return r.code; }).join(', '));
} catch(e) {
  console.log('Error:', e.message);
}
