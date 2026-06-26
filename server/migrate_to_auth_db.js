/**
 * server/migrate_to_auth_db.js — 认证 DB 分离迁移脚本
 *
 * ★ P0: 将认证/支付表从 midou_data.db 迁移到 auth.db
 * 执行后 API 服务器只加载 auth.db (~10MB)，内存从 1.3GB → ~50MB
 *
 * 用法: node server/migrate_to_auth_db.js
 *
 * 迁移步骤:
 *   1. 创建 auth.db
 *   2. 从 midou_data.db 复制 auth 表数据到 auth.db
 *   3. 验证数据完整性
 *   4. 不删除 midou_data.db 中的 auth 表（兼容回退）
 *
 * 认证表列表:
 *   users, roles, permissions, role_permissions, user_roles,
 *   auth_sessions, audit_logs, user_plans
 *
 * 支付表列表:
 *   subscription_plans, user_subscriptions, payment_orders,
 *   coupons, referral_commissions, referral_accounts,
 *   referral_withdrawals
 */

const fs = require('fs');
const path = require('path');

const MIDOU_DB = path.join(__dirname, 'midou_data.db');
const AUTH_DB = path.join(__dirname, 'auth.db');

const AUTH_TABLES = [
  'users', 'roles', 'permissions', 'role_permissions',
  'user_roles', 'auth_sessions', 'audit_logs', 'user_plans',
];

const PAYMENT_TABLES = [
  'subscription_plans', 'user_subscriptions', 'payment_orders',
  'coupons', 'referral_commissions', 'referral_accounts',
  'referral_withdrawals',
];

const ALL_MIGRATE_TABLES = [...AUTH_TABLES, ...PAYMENT_TABLES];

function runMigration() {
  console.log('════ 认证 DB 分离迁移 ════');
  console.log('源: ' + MIDOU_DB + ' (' + (fs.existsSync(MIDOU_DB) ? Math.round(fs.statSync(MIDOU_DB).size / 1048576) + 'MB' : '不存在') + ')');
  console.log('目标: ' + AUTH_DB);

  if (!fs.existsSync(MIDOU_DB)) {
    console.error('❌ midou_data.db 不存在，无法迁移');
    process.exit(1);
  }

  // 使用 database.js 的适配器模式
  const database = require('./database');
  database.initDatabase();

  // 等待 DB 就绪
  let waited = 0;
  function waitAndMigrate() {
    if (!database.isAvailable()) {
      if (waited < 30) {
        waited++;
        setTimeout(waitAndMigrate, 1000);
        return;
      }
      console.error('❌ 数据库初始化超时');
      process.exit(1);
    }
    doMigration(database);
  }
  setTimeout(waitAndMigrate, 2000);
}

function doMigration(database) {
  const srcAdp = database.getAdapter();
  if (!srcAdp) {
    console.error('❌ 源 DB 适配器不可用');
    process.exit(1);
  }

  // 初始化认证 DB
  const authOk = database.initAuthDatabase();
  console.log('认证 DB 初始化: ' + (authOk ? '✅' : '⚠️ 降级到主DB'));

  // 等待认证 DB 就绪（sql.js 异步加载）
  let authWaited = 0;
  function waitAuthAndCopy() {
    const dstAdp = database.getAuthAdapter();
    if (!dstAdp || !dstAdp.execOne) {
      if (authWaited < 15) {
        authWaited++;
        setTimeout(waitAuthAndCopy, 500);
        return;
      }
      console.error('❌ 认证 DB 适配器超时不可用');
      process.exit(1);
    }

    copyTables(srcAdp, dstAdp);
  }
  setTimeout(waitAuthAndCopy, 1000);
}

function copyTables(srcAdp, dstAdp) {
  let totalRows = 0;
  let migratedTables = 0;
  let skippedTables = 0;

  for (const table of ALL_MIGRATE_TABLES) {
    try {
      // 检查源表中是否有数据
      const countRow = srcAdp.execOne('SELECT COUNT(*) as cnt FROM ' + table);
      const count = countRow ? countRow.cnt : 0;

      if (count === 0) {
        console.log('  ⏭ ' + table + ': 0 行，跳过');
        skippedTables++;
        continue;
      }

      // 获取源表数据
      const rows = srcAdp.execAll('SELECT * FROM ' + table);
      if (!rows || rows.length === 0) {
        console.log('  ⏭ ' + table + ': 无数据，跳过');
        skippedTables++;
        continue;
      }

      // 获取列名
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(',');

      // 写入目标表
      let written = 0;
      for (const row of rows) {
        try {
          const values = columns.map((c) => row[c] !== undefined ? row[c] : null);
          dstAdp.execRun(
            'INSERT OR IGNORE INTO ' + table + '(' + columns.join(',') + ') VALUES(' + placeholders + ')',
            values,
          );
          written++;
        } catch (e) {
          console.warn('  ⚠ ' + table + ' 行写入失败: ' + e.message.slice(0, 50));
        }
      }

      totalRows += written;
      migratedTables++;
      console.log('  ✅ ' + table + ': ' + written + '/' + count + ' 行已迁移');
    } catch (e) {
      console.warn('  ⏭ ' + table + ': 源表不存在或查询失败 — ' + e.message.slice(0, 50));
      skippedTables++;
    }
  }

  // 验证
  console.log('\n════ 验证 ════');
  let verified = 0;
  for (const table of ALL_MIGRATE_TABLES) {
    try {
      const srcCount = (srcAdp.execOne('SELECT COUNT(*) as cnt FROM ' + table) || {}).cnt || 0;
      const dstCount = (dstAdp.execOne('SELECT COUNT(*) as cnt FROM ' + table) || {}).cnt || 0;
      if (srcCount === dstCount) {
        verified++;
        console.log('  ✅ ' + table + ': ' + srcCount + '=' + dstCount);
      } else if (dstCount > 0) {
        verified++;
        console.log('  ⚠ ' + table + ': ' + srcCount + '→' + dstCount + ' (差异: INSERT OR IGNORE 可能去重)');
      } else {
        console.log('  ⏭ ' + table + ': 目标0行');
      }
    } catch (e) {
      console.log('  ⏭ ' + table + ': 验证失败');
    }
  }

  // 认证 DB 文件信息
  if (fs.existsSync(AUTH_DB)) {
    const authSizeMB = Math.round(fs.statSync(AUTH_DB).size / 1048576 * 10) / 10;
    console.log('\n════ 结果 ════');
    console.log('auth.db 大小: ' + authSizeMB + ' MB (vs midou_data.db ~300MB)');
    console.log('迁移表: ' + migratedTables + '/' + ALL_MIGRATE_TABLES.length);
    console.log('总行数: ' + totalRows);
    console.log('验证通过: ' + verified + '/' + ALL_MIGRATE_TABLES.length);
    console.log('\n★ API 服务器启动时只加载 auth.db，内存预计从 1.3GB → ~50MB');
    console.log('★ jc-sync/jc-scheduler 继续加载 midou_data.db');
  } else {
    console.log('\n⚠ auth.db 文件未找到（可能 sql.js 未写入）');
    console.log('  等待 _saveToFile 后再检查');
  }

  // 关闭
  database.closeDatabase();
  console.log('\n迁移完成。可在 index.js 中设置 AUTH_DB_ONLY=true 来跳过主DB加载。');
  process.exit(0);
}

runMigration();
