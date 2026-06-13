/**
 * server/payments/plans.js
 * 套餐查询 — plan-catalog
 */

const database = require('../database');

/**
 * plan-catalog — 获取三种套餐列表
 * 无需认证，公开接口
 */
async function planCatalog(req, res) {
  try {
    const adp = database.getAdapter();
    if (!adp) return res.json({ code: 500, msg: 'DB_UNAVAILABLE' });

    const plans = adp.execAll(
      `SELECT plan_code, plan_name, period, duration_months, price, 
              monthly_equivalent, discount_label, sort_order
       FROM subscription_plans
       WHERE is_active = 1
       ORDER BY sort_order ASC`,
    );

    return res.json({
      code: 1,
      data: { plans },
    });
  } catch (e) {
    console.error('[plans] 查询失败:', e.message);
    return res.json({ code: 500, msg: e.message });
  }
}

module.exports = { planCatalog };
