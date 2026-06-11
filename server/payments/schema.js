/**
 * server/payments/schema.js
 * Phase 4 支付体系数据库 Schema — 7 张新表 + users 扩展
 *
 * 通过 database.getAdapter() 操作，遵守 AGENTS.md §7.6 规则
 */

const path = require('path');

/**
 * 初始化支付体系数据库表
 * @param {object} adp - database.getAdapter() 返回的适配器
 */
function initPaymentSchema(adp) {
  if (!adp) throw new Error('initPaymentSchema: adapter 不可用');

  // ========== 4.3.1 套餐定义表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS subscription_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_code TEXT NOT NULL UNIQUE,
    plan_name TEXT NOT NULL,
    period TEXT NOT NULL,
    duration_months INTEGER NOT NULL,
    price INTEGER NOT NULL,
    monthly_equivalent INTEGER,
    discount_label TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // ========== 4.3.2 用户订阅表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS user_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_code TEXT NOT NULL,
    period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    auto_renew INTEGER DEFAULT 0,
    source TEXT DEFAULT 'manual',
    transaction_id TEXT,
    amount INTEGER NOT NULL DEFAULT 0,
    original_amount INTEGER,
    coupon_code TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_user_sub_user ON user_subscriptions(user_id)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_user_sub_status ON user_subscriptions(status, end_date)`);

  // ========== 4.3.3 支付订单表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS payment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    plan_code TEXT NOT NULL,
    period TEXT NOT NULL,
    amount INTEGER NOT NULL,
    original_amount INTEGER DEFAULT 0,
    coupon_code TEXT,
    coupon_discount INTEGER DEFAULT 0,
    pay_channel TEXT NOT NULL DEFAULT 'alipay',
    pay_status TEXT NOT NULL DEFAULT 'pending',
    transaction_id TEXT,
    payment_url TEXT,
    paid_at TEXT,
    expired_at TEXT,
    remark TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_pay_order_user ON payment_orders(user_id)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_pay_order_status ON payment_orders(pay_status)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_pay_order_no ON payment_orders(order_no)`);

  // ========== 4.3.4 优惠码表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT NOT NULL DEFAULT 'fixed',
    discount_value INTEGER NOT NULL,
    min_amount INTEGER DEFAULT 0,
    applicable_plans TEXT DEFAULT '*',
    max_uses INTEGER DEFAULT 0,
    used_count INTEGER DEFAULT 0,
    valid_from TEXT NOT NULL,
    valid_until TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)`);

  // ========== 4.3.5 返利订单表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS referral_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    inviter_user_id INTEGER NOT NULL,
    invitee_user_id INTEGER NOT NULL,
    payment_order_id INTEGER NOT NULL,
    subscription_id INTEGER,
    payment_index INTEGER NOT NULL,
    commission_rate INTEGER NOT NULL,
    payment_amount INTEGER NOT NULL,
    commission_amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    settlement_method TEXT DEFAULT 'offline',
    settled_by INTEGER,
    settled_at TEXT,
    remark TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (inviter_user_id) REFERENCES users(id),
    FOREIGN KEY (invitee_user_id) REFERENCES users(id),
    FOREIGN KEY (payment_order_id) REFERENCES payment_orders(id)
  )`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_rc_inviter ON referral_commissions(inviter_user_id)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_rc_invitee ON referral_commissions(invitee_user_id)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_rc_status ON referral_commissions(status)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_rc_payment_order ON referral_commissions(payment_order_id)`);

  // ========== 4.3.6 返利账户表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS referral_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    total_earned INTEGER DEFAULT 0,
    total_withdrawn INTEGER DEFAULT 0,
    total_invitees INTEGER DEFAULT 0,
    total_commissions INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_ra_user ON referral_accounts(user_id)`);

  // ========== 4.3.7 返利提现表 ==========
  adp.execDDL(`CREATE TABLE IF NOT EXISTS referral_withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    payment_method TEXT DEFAULT 'bank_transfer',
    payment_account TEXT,
    account_holder TEXT,
    processed_by INTEGER,
    processed_at TEXT,
    remark TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_rw_user ON referral_withdrawals(user_id)`);
  adp.execDDL(`CREATE INDEX IF NOT EXISTS idx_rw_status ON referral_withdrawals(status)`);

  // ========== 4.3.8 users 表扩展 ==========
  const extendUsers = [
    `ALTER TABLE users ADD COLUMN subscription_status TEXT DEFAULT 'free'`,
    `ALTER TABLE users ADD COLUMN subscription_expires_at TEXT`,
    `ALTER TABLE users ADD COLUMN current_subscription_id INTEGER DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN referral_code TEXT UNIQUE`,
    `ALTER TABLE users ADD COLUMN referred_by INTEGER DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN device_fingerprint TEXT`,
    `ALTER TABLE users ADD COLUMN registration_ip TEXT`,
  ];
  extendUsers.forEach(sql => {
    try { adp.execDDL(sql); } catch (e) {
      // 字段已存在时忽略 (SQLite ALTER TABLE 不支持 IF NOT EXISTS)
      if (!e.message.includes('duplicate column')) {
        console.warn('[payments/schema] ALTER TABLE 警告:', e.message);
      }
    }
  });

  // ========== 种子数据：3 种套餐 ==========
  const existingPlans = adp.execOne(`SELECT COUNT(*) as cnt FROM subscription_plans`);
  if (!existingPlans || existingPlans.cnt === 0) {
    adp.execRun(`INSERT INTO subscription_plans (plan_code, plan_name, period, duration_months, price, monthly_equivalent, discount_label, sort_order)
      VALUES ('monthly', '月度套餐', 'month', 1, 9800, 9800, '基准价', 1)`);
    adp.execRun(`INSERT INTO subscription_plans (plan_code, plan_name, period, duration_months, price, monthly_equivalent, discount_label, sort_order)
      VALUES ('quarterly', '季度套餐', 'quarter', 3, 25800, 8600, '省36元', 2)`);
    adp.execRun(`INSERT INTO subscription_plans (plan_code, plan_name, period, duration_months, price, monthly_equivalent, discount_label, sort_order)
      VALUES ('yearly', '年度套餐', 'year', 12, 88800, 7400, '省288元', 3)`);
  }

  console.log('[payments/schema] 支付体系表初始化完成');
}

module.exports = { initPaymentSchema };
