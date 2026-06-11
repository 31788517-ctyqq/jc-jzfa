/**
 * server/payments/renewal-scheduler.js
 * 定时任务 — 到期提醒 + 过期处理
 *
 * 每天凌晨 2:00 执行
 * 1. 到期前 3 天 → 发送提醒
 * 2. 到期当天 → 状态改为 expiring_soon（3天宽限期）
 * 3. 宽限期过后 → 状态改为 expired
 *
 * 通过 PM2 单实例保证不重复执行
 */

const database = require('../database');

/**
 * 运行续费检查
 */
async function runRenewalCheck() {
  try {
    const adp = database.getAdapter();
    if (!adp) return console.warn('[renewal-scheduler] 数据库不可用');

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const threeDaysLater = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    console.log(`[renewal-scheduler] 开始检查 (today=${today}, horizon=${threeDaysLater})`);

    // 1. 到期前 3 天 → 发送站内提醒
    const expiringSoon = adp.execAll(
      `SELECT us.*, u.username FROM user_subscriptions us
       JOIN users u ON u.id = us.user_id
       WHERE us.status = 'active' AND us.end_date = ?`,
      [today]
    );

    for (const sub of expiringSoon) {
      // 更新状态为 expiring_soon（进入宽限期）
      adp.execRun(
        `UPDATE user_subscriptions SET status = 'expiring_soon', updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [sub.id]
      );
      adp.execRun(
        `UPDATE users SET subscription_status = 'expiring_soon' WHERE id = ?`,
        [sub.user_id]
      );

      // TODO: 发送站内通知
      // await sendNotification(sub.user_id, 'subscription_expiring', { end_date: sub.end_date });
      console.log(`[renewal-scheduler] 用户 ${sub.user_id} 订阅今日到期，进入宽限期`);
    }

    // 2. 到期前 3 天提醒（对 auto_renew=1 的用户）
    const needRemind = adp.execAll(
      `SELECT us.*, u.username FROM user_subscriptions us
       JOIN users u ON u.id = us.user_id
       WHERE us.status = 'active' AND us.end_date = ? AND us.auto_renew = 1`,
      [threeDaysLater]
    );

    for (const sub of needRemind) {
      // TODO: 发送续费提醒通知
      console.log(`[renewal-scheduler] 提醒用户 ${sub.user_id} 续费，到期日 ${sub.end_date}`);
    }

    // 3. 宽限期（expiring_soon）超过 3 天 → 标记为 expired
    const expired = adp.execAll(
      `SELECT us.* FROM user_subscriptions us
       WHERE us.status = 'expiring_soon' AND date(us.end_date, '+3 days') < date('now')`
    );

    for (const sub of expired) {
      adp.execRun(
        `UPDATE user_subscriptions SET status = 'expired', updated_at = datetime('now','localtime')
         WHERE id = ?`,
        [sub.id]
      );
      adp.execRun(
        `UPDATE users SET subscription_status = 'expired' WHERE id = ?`,
        [sub.user_id]
      );
      console.log(`[renewal-scheduler] 用户 ${sub.user_id} 订阅已过期`);
    }

    console.log(`[renewal-scheduler] 检查完成: expiring=${expiringSoon.length}, remind=${needRemind.length}, expired=${expired.length}`);
  } catch (e) {
    console.error('[renewal-scheduler] 检查失败:', e.message);
  }
}

// 如果直接运行此脚本，执行一次检查
if (require.main === module) {
  // 等待数据库初始化
  setTimeout(() => {
    runRenewalCheck().then(() => {
      console.log('[renewal-scheduler] 单次检查完成');
      process.exit(0);
    });
  }, 2000);
}

module.exports = { runRenewalCheck };
