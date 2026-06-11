/**
 * server/payments/referral-account.js
 * 返利账户管理 — 余额查询/提现申请/管理员审核
 *
 * API:
 *   referral-info     — 邀请码 + 分享链接
 *   referral-account  — 账户余额 + 明细
 *   referral-commissions — 返利明细列表
 *   referral-withdraw-submit — 提现申请
 *   referral-withdraw-history — 提现历史
 *   admin-referral-commissions — 管理员查看全部返利
 *   admin-referral-accounts — 管理员查看全部账户
 *   admin-referral-withdraw-list — 管理员提现列表
 *   admin-referral-withdraw-process — 管理员处理提现
 */

const database = require('../database');

const MIN_WITHDRAWAL_AMOUNT = 1000; // 最小提现金额 10元（分）

/**
 * referral-info — 获取邀请码和分享链接
 */
async function referralInfo(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    const user = adp.execOne(
      `SELECT referral_code FROM users WHERE id = ?`,
      [userId]
    );

    const code = user?.referral_code || null;
    const shareUrl = code ? `https://zj.100qiu.com/preview/#register?ref=${code}` : null;

    const inviteCount = adp.execOne(
      `SELECT COUNT(*) as cnt FROM users WHERE referred_by = ?`,
      [userId]
    );

    return res.json({
      code: 1,
      data: {
        referralCode: code,
        shareUrl,
        inviteCount: inviteCount?.cnt || 0,
      },
    });
  } catch (e) {
    console.error('[referral-account] 获取信息失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * referral-account — 获取返利账户
 */
async function referralAccount(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;

    const account = adp.execOne(
      `SELECT * FROM referral_accounts WHERE user_id = ?`,
      [userId]
    );

    const pendingCommissions = adp.execOne(
      `SELECT COALESCE(SUM(commission_amount), 0) as total FROM referral_commissions
       WHERE inviter_user_id = ? AND status = 'pending'`,
      [userId]
    );

    const recentCommissions = adp.execAll(
      `SELECT rc.*, u.username as invitee_name, spo.plan_name
       FROM referral_commissions rc
       JOIN users u ON u.id = rc.invitee_user_id
       LEFT JOIN user_subscriptions us ON us.id = rc.subscription_id
       LEFT JOIN subscription_plans spo ON spo.plan_code = us.plan_code
       WHERE rc.inviter_user_id = ?
       ORDER BY rc.id DESC LIMIT 10`,
      [userId]
    );

    // 获取邀请码
    const user = adp.execOne(`SELECT referral_code FROM users WHERE id = ?`, [userId]);

    return res.json({
      code: 1,
      data: {
        referralCode: user?.referral_code || null,
        shareUrl: user?.referral_code ? `https://zj.100qiu.com/preview/#register?ref=${user.referral_code}` : null,
        totalEarned: account?.total_earned || 0,
        totalWithdrawn: account?.total_withdrawn || 0,
        balance: (account?.total_earned || 0) - (account?.total_withdrawn || 0),
        totalInvitees: account?.total_invitees || 0,
        totalCommissions: account?.total_commissions || 0,
        pendingCommissions: pendingCommissions?.total || 0,
        recentCommissions: (recentCommissions || []).map(c => ({
          invitee: c.invitee_name || 'user_***',
          plan: c.plan_name || '未知',
          amount: c.payment_amount,
          rate: c.commission_rate,
          commission: c.commission_amount,
          paymentIndex: c.payment_index,
          status: c.status,
          createdAt: c.created_at,
        })),
      },
    });
  } catch (e) {
    console.error('[referral-account] 获取账户失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * referral-commissions — 返利明细列表（分页）
 */
async function referralCommissions(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    const { page = 1, pageSize = 20, status: filterStatus } = req.body || {};
    const offset = (page - 1) * pageSize;

    let where = 'WHERE rc.inviter_user_id = ?';
    const params = [userId];
    if (filterStatus) {
      where += ' AND rc.status = ?';
      params.push(filterStatus);
    }

    const total = adp.execOne(
      `SELECT COUNT(*) as cnt FROM referral_commissions rc ${where}`,
      params
    );

    const rows = adp.execAll(
      `SELECT rc.*, u.username as invitee_name
       FROM referral_commissions rc
       JOIN users u ON u.id = rc.invitee_user_id
       ${where}
       ORDER BY rc.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({
      code: 1,
      data: {
        total: total?.cnt || 0,
        page,
        pageSize,
        list: (rows || []).map(r => ({
          id: r.id,
          invitee: r.invitee_name || 'user_***',
          paymentAmount: r.payment_amount,
          rate: r.commission_rate,
          commission: r.commission_amount,
          paymentIndex: r.payment_index,
          status: r.status,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (e) {
    console.error('[referral-account] 获取明细失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * referral-withdraw-submit — 提交提现申请
 */
async function withdrawSubmit(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    const { amount, paymentMethod = 'bank_transfer', accountHolder, paymentAccount } = req.body;

    if (!amount || amount <= 0) return res.json({ code: 400, msg: 'INVALID_AMOUNT' });
    if (amount < MIN_WITHDRAWAL_AMOUNT) {
      return res.json({ code: 400, msg: 'MIN_WITHDRAWAL_NOT_MET', data: { minAmount: MIN_WITHDRAWAL_AMOUNT } });
    }
    if (!accountHolder || !paymentAccount) {
      return res.json({ code: 400, msg: 'MISSING_PAYMENT_INFO' });
    }

    // 检查余额
    const account = adp.execOne(
      `SELECT * FROM referral_accounts WHERE user_id = ?`,
      [userId]
    );
    const balance = (account?.total_earned || 0) - (account?.total_withdrawn || 0);
    if (amount > balance) {
      return res.json({ code: 400, msg: 'INSUFFICIENT_BALANCE', data: { balance } });
    }

    adp.execRun(
      `INSERT INTO referral_withdrawals (user_id, amount, status, payment_method, payment_account, account_holder)
       VALUES (?, ?, 'submitted', ?, ?, ?)`,
      [userId, amount, paymentMethod, paymentAccount, accountHolder]
    );

    const wid = adp.execOne(`SELECT last_insert_rowid() as id FROM referral_withdrawals LIMIT 1`);

    return res.json({
      code: 1,
      data: {
        withdrawalId: wid?.id,
        status: 'submitted',
        message: '提现申请已提交，预计 1-3 个工作日内到账',
      },
    });
  } catch (e) {
    console.error('[referral-account] 提现申请失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * referral-withdraw-history — 提现记录
 */
async function withdrawHistory(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const userId = req.authSession?.userId;
    const { page = 1, pageSize = 20 } = req.body || {};
    const offset = (page - 1) * pageSize;

    const total = adp.execOne(
      `SELECT COUNT(*) as cnt FROM referral_withdrawals WHERE user_id = ?`,
      [userId]
    );

    const rows = adp.execAll(
      `SELECT * FROM referral_withdrawals WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
      [userId, pageSize, offset]
    );

    return res.json({
      code: 1,
      data: { total: total?.cnt || 0, page, pageSize, list: rows || [] },
    });
  } catch (e) {
    console.error('[referral-account] 获取提现历史失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

// ========== 管理员接口 ==========

/**
 * admin-referral-commissions — 管理员查看全部返利记录
 */
async function adminReferralCommissions(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const { page = 1, pageSize = 20, status: filterStatus, inviter, invitee } = req.body || {};
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params = [];
    if (filterStatus) { where += ' AND rc.status = ?'; params.push(filterStatus); }
    if (inviter) { where += ' AND ui.username LIKE ?'; params.push(`%${inviter}%`); }
    if (invitee) { where += ' AND ue.username LIKE ?'; params.push(`%${invitee}%`); }

    const total = adp.execOne(
      `SELECT COUNT(*) as cnt FROM referral_commissions rc
       LEFT JOIN users ui ON ui.id = rc.inviter_user_id
       LEFT JOIN users ue ON ue.id = rc.invitee_user_id ${where}`,
      params
    );

    const rows = adp.execAll(
      `SELECT rc.*, ui.username as inviter_name, ue.username as invitee_name
       FROM referral_commissions rc
       LEFT JOIN users ui ON ui.id = rc.inviter_user_id
       LEFT JOIN users ue ON ue.id = rc.invitee_user_id
       ${where} ORDER BY rc.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({ code: 1, data: { total: total?.cnt || 0, page, pageSize, list: rows || [] } });
  } catch (e) {
    console.error('[referral-account] 管理员查询返利失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * admin-referral-accounts — 管理员查看全部返利账户
 */
async function adminReferralAccounts(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const { page = 1, pageSize = 20 } = req.body || {};
    const offset = (page - 1) * pageSize;

    const total = adp.execOne(`SELECT COUNT(*) as cnt FROM referral_accounts`);
    const rows = adp.execAll(
      `SELECT ra.*, u.username FROM referral_accounts ra
       JOIN users u ON u.id = ra.user_id
       ORDER BY ra.total_earned DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );

    return res.json({ code: 1, data: { total: total?.cnt || 0, page, pageSize, list: rows || [] } });
  } catch (e) {
    console.error('[referral-account] 管理员查询账户失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * admin-referral-withdraw-list — 管理员提现列表
 */
async function adminWithdrawList(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const { page = 1, pageSize = 20, status: filterStatus } = req.body || {};
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params = [];
    if (filterStatus) { where += ' AND rw.status = ?'; params.push(filterStatus); }

    const total = adp.execOne(
      `SELECT COUNT(*) as cnt FROM referral_withdrawals rw ${where}`,
      params
    );

    const rows = adp.execAll(
      `SELECT rw.*, u.username FROM referral_withdrawals rw
       JOIN users u ON u.id = rw.user_id
       ${where} ORDER BY rw.id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return res.json({ code: 1, data: { total: total?.cnt || 0, page, pageSize, list: rows || [] } });
  } catch (e) {
    console.error('[referral-account] 管理员查询提现失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

/**
 * admin-referral-withdraw-process — 管理员处理提现
 */
async function adminWithdrawProcess(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const adminId = req.authSession?.userId;
    const { withdrawalId, newStatus, remark } = req.body;

    if (!withdrawalId || !newStatus) return res.json({ code: 400, msg: 'MISSING_PARAMS' });
    if (!['processing', 'completed', 'rejected'].includes(newStatus)) {
      return res.json({ code: 400, msg: 'INVALID_STATUS' });
    }

    const withdrawal = adp.execOne(
      `SELECT * FROM referral_withdrawals WHERE id = ?`,
      [withdrawalId]
    );
    if (!withdrawal) return res.json({ code: 404, msg: 'WITHDRAWAL_NOT_FOUND' });
    if (withdrawal.status === 'completed') {
      return res.json({ code: 400, msg: 'ALREADY_COMPLETED' });
    }

    adp.execRun(
      `UPDATE referral_withdrawals SET status = ?, processed_by = ?, 
       processed_at = datetime('now','localtime'), remark = ?
       WHERE id = ?`,
      [newStatus, adminId, remark || null, withdrawalId]
    );

    // 如果是 completed，更新账户已提现额
    if (newStatus === 'completed') {
      adp.execRun(
        `UPDATE referral_accounts SET total_withdrawn = total_withdrawn + ?, 
         updated_at = datetime('now','localtime')
         WHERE user_id = ?`,
        [withdrawal.amount, withdrawal.user_id]
      );
    }

    return res.json({
      code: 1,
      data: {
        withdrawalId,
        status: newStatus,
        processedAt: new Date().toISOString(),
      },
    });
  } catch (e) {
    console.error('[referral-account] 处理提现失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

module.exports = {
  referralInfo,
  referralAccount,
  referralCommissions,
  withdrawSubmit,
  withdrawHistory,
  adminReferralCommissions,
  adminReferralAccounts,
  adminWithdrawList,
  adminWithdrawProcess,
};
