/**
 * server/core/shadow-account.js
 * 影子账户/虚拟资金管理系统 — 从 shadow_account_service 移植
 *
 * 功能：
 *   - 虚拟账户创建与管理
 *   - 方案投注冻结/释放/结算
 *   - 资金流水记账 (journal + ledger)
 *   - 对账与差异检测 (reconcile)
 *   - 风控限额同步
 *   - 收入回测 (ROI, 回撤, 资金曲线)
 */

const crypto = require('crypto');

// ═══ 常量 ═══

const DEFAULT_INITIAL_BALANCE_CENT = 1000_0000; // 10万元(分)
const DEFAULT_VIRTUAL_ACCOUNT_CODE = 'system-shadow-main';
const DEFAULT_DAILY_CAPACITY_RATIO = 0.2; // 每日上限 20%
const DEFAULT_SINGLE_TICKET_RATIO = 0.05; // 单票上限 5%

const BALANCE_BUCKETS = {
  book_balance: 'bookBalanceCent',
  available_balance: 'availableBalanceCent',
  frozen_balance: 'frozenBalanceCent',
  reserved_balance: 'reservedBalanceCent',
  pending_pnl: 'pendingPnlCent',
  realized_pnl: 'realizedPnlCent',
};

// ═══ 工具函数 ═══

function centsFromAmount(value) {
  if (value == null || value === '' || value === false) return 0;
  const n = parseFloat(String(value));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function amountFromCents(value) {
  return parseFloat((parseInt(value || 0) / 100).toFixed(2));
}

function nowISO() {
  return new Date().toISOString().replace('+00:00', 'Z').replace('T', ' ').slice(0, 19);
}

function generateId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

// ═══ 表结构初始化 ═══

function ensureTables(db) {
  if (!db) return;

  const tables = [
    `CREATE TABLE IF NOT EXISTS shadow_virtual_accounts (
      account_id TEXT PRIMARY KEY,
      account_code TEXT UNIQUE NOT NULL,
      account_name TEXT,
      book_balance_cent INTEGER DEFAULT 0,
      available_balance_cent INTEGER DEFAULT 0,
      frozen_balance_cent INTEGER DEFAULT 0,
      reserved_balance_cent INTEGER DEFAULT 0,
      pending_pnl_cent INTEGER DEFAULT 0,
      realized_pnl_cent INTEGER DEFAULT 0,
      risk_limit_json TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS shadow_ledger_journals (
      journal_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      journal_type TEXT NOT NULL,
      biz_ref_type TEXT,
      biz_ref_id TEXT,
      amount_cent INTEGER DEFAULT 0,
      summary_json TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS shadow_ledger_entries (
      entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      balance_bucket TEXT NOT NULL,
      amount_cent INTEGER DEFAULT 0,
      direction TEXT,
      biz_ref_type TEXT,
      biz_ref_id TEXT,
      memo TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
    `CREATE TABLE IF NOT EXISTS shadow_account_holds (
      hold_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      hold_type TEXT,
      hold_status TEXT DEFAULT 'active',
      biz_ref_type TEXT,
      biz_ref_id TEXT,
      amount_cent INTEGER DEFAULT 0,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      released_at TEXT,
      settled_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS shadow_income_records (
      record_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      scheme_id TEXT,
      date TEXT,
      ticket_count INTEGER DEFAULT 0,
      stake_amount_cent INTEGER DEFAULT 0,
      payout_amount_cent INTEGER DEFAULT 0,
      pnl_cent INTEGER DEFAULT 0,
      roi REAL,
      running_balance_cent INTEGER,
      running_max_cent INTEGER,
      drawdown REAL,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`,
  ];

  tables.forEach(function (sql) {
    try {
      db.run(sql);
    } catch (e) {
      console.error('[shadow_account] ensureTables error:', e.message);
    }
  });
}

// ═══ 虚拟账户 ═══

/**
 * 创建或获取虚拟账户
 */
function ensureVirtualAccount(db, opts) {
  opts = opts || {};
  let account = null;

  // 按 account_id 查找
  if (opts.accountId) {
    account = getAccount(db, opts.accountId);
    if (account) return account;
  }

  // 按 account_code 查找
  const code = opts.accountCode || DEFAULT_VIRTUAL_ACCOUNT_CODE;
  account = getAccountByCode(db, code);
  if (account) return account;

  // 创建新账户
  const accountId = opts.accountId || generateId('va');
  const initialBalance = opts.initialBalanceCent || DEFAULT_INITIAL_BALANCE_CENT;
  const now = nowISO();

  db.run(
    `INSERT INTO shadow_virtual_accounts
     (account_id, account_code, account_name, book_balance_cent, available_balance_cent, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [accountId, code, opts.accountName || code, initialBalance, initialBalance, now, now],
  );

  return getAccount(db, accountId);
}

function getAccount(db, accountId) {
  try {
    const stmt = db.prepare('SELECT * FROM shadow_virtual_accounts WHERE account_id = ?');
    stmt.bind([accountId]);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return obj;
    }
    stmt.free();
  } catch (e) {}
  return null;
}

function getAccountByCode(db, code) {
  try {
    const stmt = db.prepare('SELECT * FROM shadow_virtual_accounts WHERE account_code = ?');
    stmt.bind([code]);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return obj;
    }
    stmt.free();
  } catch (e) {}
  return null;
}

function updateBalances(db, accountId, balances) {
  const sets = [];
  const vals = [];
  Object.keys(balances).forEach(function (key) {
    if (balances[key] != null) {
      sets.push(key + ' = ?');
      vals.push(balances[key]);
    }
  });
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(nowISO());
  vals.push(accountId);

  const sql = 'UPDATE shadow_virtual_accounts SET ' + sets.join(', ') + ' WHERE account_id = ?';
  db.run(sql, vals);
}

// ═══ 资金流水 ═══

/**
 * 记账过账
 * @param {Object} opts
 * @param {string} opts.accountId - 账户 ID
 * @param {string} opts.journalType - 流水类型 (stake_freeze/stake_release/ticket_settle/manual_credit)
 * @param {Array} opts.entries - 分录 [{balanceBucket, amountCent, memo}]
 * @param {string} opts.bizRefType - 业务参考类型
 * @param {string} opts.bizRefId - 业务参考 ID
 */
function postJournal(db, opts) {
  const account = getAccount(db, opts.accountId);
  if (!account) throw new Error('Virtual account not found: ' + opts.accountId);

  // 计算新余额
  const balances = {};
  BALANCE_BUCKETS &&
    Object.keys(BALANCE_BUCKETS).forEach(function (bucket) {
      const field = BALANCE_BUCKETS[bucket];
      balances[field] = parseInt(account[field] || 0);
    });

  opts.entries.forEach(function (entry) {
    const bucket = entry.balanceBucket || entry.balance_bucket;
    const field = BALANCE_BUCKETS[bucket];
    if (!field) throw new Error('Unknown balance bucket: ' + bucket);
    balances[field] += parseInt(entry.amountCent || entry.amount_cent || 0);
  });

  // 检查余额不为负
  if (balances.availableBalanceCent < 0 && !account.allow_negative_balance) {
    throw new Error('Insufficient available balance');
  }

  // 创建 journal
  const journalId = generateId('jnl');
  const totalAmount = opts.entries.reduce(function (sum, e) {
    return sum + Math.abs(parseInt(e.amountCent || e.amount_cent || 0));
  }, 0);
  const now = nowISO();

  db.run(
    `INSERT INTO shadow_ledger_journals (journal_id, account_id, journal_type, biz_ref_type, biz_ref_id, amount_cent, summary_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      journalId,
      opts.accountId,
      opts.journalType,
      opts.bizRefType || null,
      opts.bizRefId || null,
      totalAmount,
      JSON.stringify(opts.summary || {}),
      now,
    ],
  );

  // 创建分录
  opts.entries.forEach(function (entry, idx) {
    const amountCent = parseInt(entry.amountCent || entry.amount_cent || 0);
    db.run(
      `INSERT INTO shadow_ledger_entries (journal_id, account_id, balance_bucket, amount_cent, direction, biz_ref_type, biz_ref_id, memo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        journalId,
        opts.accountId,
        entry.balanceBucket || entry.balance_bucket,
        amountCent,
        amountCent >= 0 ? 'credit' : 'debit',
        opts.bizRefType || null,
        opts.bizRefId || null,
        entry.memo || null,
      ],
    );
  });

  // 更新余额
  updateBalances(db, opts.accountId, balances);

  return {
    journalId: journalId,
    account: getAccount(db, opts.accountId),
  };
}

// ═══ 投注资金操作 ═══

/**
 * 资金冻结 (提交投注前)
 */
function freezeStake(db, accountId, schemeId, amount, reason) {
  const amountCent = centsFromAmount(amount);
  if (amountCent <= 0) throw new Error('amount must be positive');

  // 创建 hold
  const holdId = generateId('hold');
  const now = nowISO();
  db.run(
    `INSERT INTO shadow_account_holds (hold_id, account_id, hold_type, hold_status, biz_ref_type, biz_ref_id, amount_cent, reason, created_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [holdId, accountId, 'ticket_stake', 'scheme', schemeId, amountCent, reason || '方案投注', now],
  );

  // 记账
  return postJournal(db, {
    accountId: accountId,
    journalType: 'stake_freeze',
    entries: [
      { balanceBucket: 'available_balance', amountCent: -amountCent, memo: '冻结投注金' },
      { balanceBucket: 'frozen_balance', amountCent: amountCent, memo: '转入冻结余额' },
    ],
    bizRefType: 'scheme',
    bizRefId: schemeId,
    summary: { amountCent: amountCent, holdId: holdId },
  });
}

/**
 * 释放冻结 (投注取消/拒绝)
 */
function releaseStake(db, accountId, schemeId, holdId, reason) {
  const hold = getHold(db, holdId);
  if (!hold) throw new Error('Hold not found: ' + holdId);

  const amountCent = parseInt(hold.amount_cent || 0);
  if (amountCent <= 0) throw new Error('hold amount must be positive');

  const result = postJournal(db, {
    accountId: accountId,
    journalType: 'stake_release',
    entries: [
      { balanceBucket: 'available_balance', amountCent: amountCent, memo: '释放冻结金' },
      { balanceBucket: 'frozen_balance', amountCent: -amountCent, memo: '扣减冻结余额' },
    ],
    bizRefType: 'scheme',
    bizRefId: schemeId,
    summary: { amountCent: amountCent, reason: reason || 'release' },
  });

  // 更新 hold 状态
  db.run("UPDATE shadow_account_holds SET hold_status = 'released', released_at = ? WHERE hold_id = ?", [
    nowISO(),
    holdId,
  ]);

  return result;
}

/**
 * 结算 (投注结果)
 */
function settleTicket(db, accountId, schemeId, holdId, result, payoutAmount, feeAmount) {
  const hold = getHold(db, holdId);
  if (!hold) throw new Error('Hold not found: ' + holdId);

  const stakeCent = parseInt(hold.amount_cent || 0);
  const payoutCent = centsFromAmount(payoutAmount || 0);
  const feeCent = centsFromAmount(feeAmount || 0);
  const settlementCent = payoutCent - feeCent;
  const pnlCent = settlementCent - stakeCent;

  const journalResult = postJournal(db, {
    accountId: accountId,
    journalType: 'ticket_settle',
    entries: [
      { balanceBucket: 'frozen_balance', amountCent: -stakeCent, memo: '释放冻结本金' },
      { balanceBucket: 'available_balance', amountCent: settlementCent, memo: '结算入账' },
      { balanceBucket: 'book_balance', amountCent: pnlCent, memo: '计入盈亏' },
      { balanceBucket: 'realized_pnl', amountCent: pnlCent, memo: '已实现盈亏' },
    ],
    bizRefType: 'scheme',
    bizRefId: schemeId,
    summary: {
      stakeCent: stakeCent,
      payoutCent: payoutCent,
      feeCent: feeCent,
      pnlCent: pnlCent,
      result: result || 'unknown',
    },
  });

  // 更新 hold
  db.run("UPDATE shadow_account_holds SET hold_status = 'settled', settled_at = ? WHERE hold_id = ?", [
    nowISO(),
    holdId,
  ]);

  // 记录收入
  recordIncome(db, {
    accountId: accountId,
    schemeId: schemeId,
    stakeCent: stakeCent,
    payoutCent: settlementCent,
    pnlCent: pnlCent,
  });

  return Object.assign({}, journalResult, { pnlCent: pnlCent });
}

function getHold(db, holdId) {
  try {
    const stmt = db.prepare('SELECT * FROM shadow_account_holds WHERE hold_id = ?');
    stmt.bind([holdId]);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return obj;
    }
    stmt.free();
  } catch (e) {}
  return null;
}

// ═══ 收入追踪 ═══

function recordIncome(db, opts) {
  const account = getAccount(db, opts.accountId);
  if (!account) return;

  const balanceCent = parseInt(account.available_balance_cent || 0) + parseInt(account.frozen_balance_cent || 0);
  const roi = opts.stakeCent > 0 ? opts.pnlCent / opts.stakeCent : 0;

  // 计算最大资金和回撤
  const prevMax = getRunningMax(db, opts.accountId);
  const runningMax = Math.max(prevMax, balanceCent);
  const drawdown = runningMax > 0 ? (balanceCent - runningMax) / runningMax : 0;

  const recordId = generateId('inc');
  const now = nowISO();

  db.run(
    `INSERT INTO shadow_income_records
     (record_id, account_id, scheme_id, date, ticket_count, stake_amount_cent, payout_amount_cent, pnl_cent, roi, running_balance_cent, running_max_cent, drawdown, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recordId,
      opts.accountId,
      opts.schemeId || null,
      new Date().toISOString().slice(0, 10),
      1,
      opts.stakeCent,
      opts.payoutCent,
      opts.pnlCent,
      +roi.toFixed(4),
      balanceCent,
      runningMax,
      +drawdown.toFixed(4),
      now,
    ],
  );
}

function getRunningMax(db, accountId) {
  try {
    const stmt = db.prepare(
      'SELECT MAX(running_balance_cent) as max_bal FROM shadow_income_records WHERE account_id = ?',
    );
    stmt.bind([accountId]);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return parseInt(obj.max_bal || 0);
    }
    stmt.free();
  } catch (e) {}
  return DEFAULT_INITIAL_BALANCE_CENT;
}

// ═══ 统计查询 ═══

/**
 * 获取账户收入摘要
 */
function getIncomeSummary(db, accountId) {
  const records = [];

  try {
    const stmt = db.prepare('SELECT * FROM shadow_income_records WHERE account_id = ? ORDER BY created_at ASC');
    stmt.bind([accountId]);
    while (stmt.step()) records.push(stmt.getAsObject());
    stmt.free();
  } catch (e) {
    return null;
  }

  if (records.length === 0)
    return {
      totalSchemes: 0,
      totalStake: 0,
      totalPayout: 0,
      totalPnl: 0,
      roi: 0,
      maxDrawdown: 0,
      winRate: 0,
      profitFactor: 0,
    };

  const totalStake = records.reduce(function (s, r) {
    return s + parseInt(r.stake_amount_cent || 0);
  }, 0);
  const totalPayout = records.reduce(function (s, r) {
    return s + parseInt(r.payout_amount_cent || 0);
  }, 0);
  const totalPnl = records.reduce(function (s, r) {
    return s + parseInt(r.pnl_cent || 0);
  }, 0);
  const roi = totalStake > 0 ? totalPnl / totalStake : 0;

  const wins = records.filter(function (r) {
    return parseInt(r.pnl_cent || 0) > 0;
  });
  const losses = records.filter(function (r) {
    return parseInt(r.pnl_cent || 0) < 0;
  });
  const winRate = records.length > 0 ? wins.length / records.length : 0;
  const profitFactor =
    losses.length > 0
      ? wins.reduce(function (s, r) {
          return s + parseInt(r.pnl_cent || 0);
        }, 0) /
        Math.abs(
          losses.reduce(function (s, r) {
            return s + parseInt(r.pnl_cent || 0);
          }, 0),
        )
      : wins.length > 0
        ? Infinity
        : 0;

  // 最大回撤
  const maxDD = records.reduce(function (min, r) {
    return Math.min(min, parseFloat(r.drawdown || 0));
  }, 0);

  return {
    totalSchemes: records.length,
    totalStake: amountFromCents(totalStake),
    totalPayout: amountFromCents(totalPayout),
    totalPnl: amountFromCents(totalPnl),
    roi: +roi.toFixed(4),
    maxDrawdown: +maxDD.toFixed(4),
    winRate: +winRate.toFixed(4),
    profitFactor: isFinite(profitFactor) ? +profitFactor.toFixed(2) : 'Inf',
  };
}

/**
 * 获取资金曲线数据 (用于图表)
 */
function getEquityCurve(db, accountId, days) {
  days = days || 90;
  const records = [];

  try {
    const stmt = db.prepare(
      'SELECT date, SUM(CASE WHEN pnl_cent > 0 THEN 1 ELSE 0 END) as wins, ' +
        'COUNT(*) as total, SUM(pnl_cent) as daily_pnl_cent, ' +
        'MAX(running_balance_cent) as balance_cent, MAX(drawdown) as dd ' +
        'FROM shadow_income_records WHERE account_id = ? ' +
        'GROUP BY date ORDER BY date DESC LIMIT ?',
    );
    stmt.bind([accountId, days]);
    while (stmt.step()) records.push(stmt.getAsObject());
    stmt.free();
  } catch (e) {
    return [];
  }

  return records.reverse().map(function (r) {
    return {
      date: r.date,
      wins: parseInt(r.wins || 0),
      total: parseInt(r.total || 0),
      dailyPnl: amountFromCents(r.daily_pnl_cent || 0),
      balance: amountFromCents(r.balance_cent || 0),
      drawdown: parseFloat(r.dd || 0),
    };
  });
}

// ═══ 风控限额 ═══

/**
 * 获取动态风控限额
 * @returns {{singleTicketMax: number, dailyCapacity: number, availableBalance: number}}
 */
function getRiskLimits(db, accountId) {
  const account = getAccount(db, accountId);
  if (!account) return null;

  const availableCent = parseInt(account.available_balance_cent || 0);
  const riskLimit = parseRiskLimit(account.risk_limit_json);

  const configuredSingleMax = parseInt(riskLimit.single_ticket_max_cent || 0);
  const singleTicketMax =
    configuredSingleMax > 0
      ? Math.min(configuredSingleMax, Math.floor(availableCent * DEFAULT_SINGLE_TICKET_RATIO))
      : Math.floor(availableCent * DEFAULT_SINGLE_TICKET_RATIO);

  return {
    availableBalance: amountFromCents(availableCent),
    frozenBalance: amountFromCents(parseInt(account.frozen_balance_cent || 0)),
    singleTicketMax: amountFromCents(Math.max(0, singleTicketMax)),
    dailyCapacity: amountFromCents(Math.max(0, Math.floor(availableCent * DEFAULT_DAILY_CAPACITY_RATIO))),
  };
}

function parseRiskLimit(jsonStr) {
  if (!jsonStr) return {};
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    return {};
  }
}

// ═══ 导出 ═══
module.exports = {
  DEFAULT_INITIAL_BALANCE_CENT,
  DEFAULT_VIRTUAL_ACCOUNT_CODE,
  DEFAULT_DAILY_CAPACITY_RATIO,
  DEFAULT_SINGLE_TICKET_RATIO,
  BALANCE_BUCKETS,

  centsFromAmount,
  amountFromCents,

  ensureTables,
  ensureVirtualAccount,
  getAccount,
  getAccountByCode,
  updateBalances,

  postJournal,
  freezeStake,
  releaseStake,
  settleTicket,
  getHold,

  recordIncome,
  getRunningMax,
  getIncomeSummary,
  getEquityCurve,
  getRiskLimits,
};
