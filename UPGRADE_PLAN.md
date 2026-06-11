# JC-ZJFA 系统升级计划 (V9.1 → V10.0)

> 2026-06-11 | 基于项目评估报告 | 参考详细版：`sucai/系统改进计划_V9.1.md`

---

## 总体目标

- **server/index.js**：7146 行 → <2000 行（拆分为 9 个路由模块）
- **测试覆盖率**：25% → 50%（全局）、40% → 55%（core）
- **部署脚本**：10+ → 3 个核心脚本
- **临时文件**：清零（删除 tmp_*、清理 deploy/ 废物）
- **支付体系**：3 档套餐（全功能开放）+ 支付宝支付 + 订阅生命周期 🆕

---

## Phase 1：安全与卫生（本周）

### 1.1 敏感信息审计
- [ ] `git log --all --full-history -- "*.env"` 确认未泄漏
- [ ] 扫描代码中是否有硬编码 API Key

### 1.2 废弃代码清理

| 文件/目录 | 行数/文件数 | 操作 |
|-----------|------------|------|
| `tmp_check_match.js` | 1 | **删除** |
| `tmp_check_match2.js` | 1 | **删除** |
| `_backup_20260525/` | 8 | 移入 `archive/` |
| `cloudfunctions/` | 22 | 保留文档，加入 `.gitignore` |
| `deploy/` 临时文件 | ~60 | 清理 JSON/txt 调试数据 |

### 1.3 敏感文件检查
- [ ] `.env` / `.env.deploy` / `server/.env` 确认在 `.gitignore` 中且未被追踪

---

## Phase 2：质量基线（本月）

### 2.1 覆盖率提升路线

| 时间 | 全局 statements | core statements | gongshoudao |
|------|----------------|-----------------|-------------|
| 第 1 周 | 25%→30% | 40%→45% | 30%→40% |
| 第 2-3 周 | 30%→40% | 45%→50% | 40%→45% |
| 第 4 周 | 40%→50% | 50%→55% | 45%→50% |

### 2.2 部署统一

```
当前（混乱）:
  deploy.py  deploy_gs.bat  deploy.sh  deploy2.sh
  upload.bat  一键部署.bat  deploy_sftp.js  deploy_ssh.js
  do_deploy.py  run_deploy.py  _run_upgrade.py  deploy_gs.js

目标（清晰）:
  deploy.py          ← 主入口（含 --gs-only / --fast）
  deploy_sftp.js     ← SFTP 备选
  nginx.conf         ← 配置参考
  一键部署.bat        ← Windows 便捷入口
```

- [ ] 将 `deploy_gs.bat` 合并到 `deploy.py --gs-only`
- [ ] 删除重复变体：`do_deploy.py`, `run_deploy.py`, `_run_upgrade.py`
- [ ] 清理 `deploy/` 下 60+ 临时数据文件

### 2.3 预检增强
- [ ] 覆盖率门禁：警告 → 阻断
- [ ] 新增：检查 `tmp_*` 文件
- [ ] 新增：检查 `.env` 是否误 staged
- [ ] `npm audit` 失败：警告 → 阻断

---

## Phase 3：架构优化（下月）

### 3.1 server/index.js 拆分方案

```
server/index.js (7146 行)

    ├── server/routes/auth.js        auth-login/session/logout/change-password
    ├── server/routes/users.js       user-list/create/update-status
    ├── server/routes/plans.js       plan-list/generate/confirm  （最复杂）
    ├── server/routes/matches.js     match-list/odds/detail
    ├── server/routes/predictions.js predict/backtest/stats
    ├── server/routes/gongshoudao.js gs-cache/analysis/pk
    ├── server/routes/hot.js         hot-data/quant-hot/jczq-change
    ├── server/routes/ai.js          ai-batch-generate/cache/timing
    └── server/routes/system.js      health/cache-flush/sync-trigger
```

**执行顺序：auth → users → matches → hot → ai → system → predictions → gongshoudao → plans**

### 3.2 中间件抽取
- [ ] `server/middleware/auth.js`：统一认证校验
- [ ] `server/middleware/error-handler.js`：统一异常处理
- [ ] `server/config.js`：集中配置管理

### 3.3 风险控制
- 每次拆分后：`npm run test:critical` + `npm run test:e2e:critical`
- `POST /api` 接口不变，前端零感知
- 保留 `backup/monolithic-index` 分支作为回退

---

## Phase 4：支付体系与订阅收费 💰（本月启动，2 个月）

> **核心原则**：所有付费用户全功能开放，仅按付费周期区分价格。

### 4.1 套餐设计（月费锚点 ¥98）

| 套餐 | 价格 | 折合月费 | 折扣 | 推荐 |
|------|------|---------|------|:----:|
| **月度套餐** | ¥98 | ¥98/月 | 基准价 | |
| **季度套餐** | ¥258 | ¥86/月 | 省 ¥36（≈88折） | |
| **年度套餐** | ¥888 | ¥74/月 | 省 ¥288（≈76折） | ⭐ 最划算 |

### 4.2 功能说明

所有套餐**全功能开放**，无阉割。未付费用户仅可看功守道总览 + 今日方案前 3 个。

### 4.3 后端新增

```
server/payments/
├── index.js              # 支付模块入口
├── plans.js              # 套餐查询
├── orders.js             # 订单创建/查询/回调
├── subscriptions.js      # 订阅生命周期
├── subscription-guard.js # 订阅状态中间件（仅检查是否有效期内）
├── alipay.js             # 支付宝核心集成（wap.pay + page.pay + query + refund）
├── alipay-callback.js    # 支付宝回调处理（验签 + 幂等 + 绕过 token 认证）
├── renewal-scheduler.js  # 定时任务（node-cron + PM2 单实例，到期提醒 + 过期处理）
├── referral-compute.js   # 阶梯返利计算引擎 + 反欺诈
├── referral-account.js   # 返利账户查询 + 提现管理
├── referral-anti-fraud.js # 邀请反欺诈检测
└── schema.js             # 建表 DDL + 种子数据
```

**数据库表**（全部通过 `database.js` 适配器操作）：
- `subscription_plans` — 3 种套餐（月/季/年）+ trial
- `user_subscriptions` — 订阅记录（status: active/expiring_soon/expired/cancelled/refunded）
- `payment_orders` — 支付宝支付订单
- `coupons` — 优惠码（fixed/percent 折扣，使用次数上限）
- `referral_commissions` — 阶梯返利订单（1→50%, 2→55%, 3+→60%）
- `referral_accounts` — 邀请人返利钱包（累计收入/已提现/邀请人数）
- `referral_withdrawals` — 线下提现记录（管理员审核打款）
- `users` 扩展 — subscription_status / referral_code（8位邀请码）/ referred_by / device_fingerprint / registration_ip

### 4.4 前端新增

| 页面 | 优先级 |
|------|--------|
| `pricing.js` — 三栏套餐对比 + 年度高亮推荐 | P0 |
| `payment.js` — 订单确认 + 支付宝跳转支付 | P0 |
| `payment-result.js` — 支付结果 | P0 |
| `profile.js` — 增强：会员状态 + 到期倒计时 | P1 |
| `subscription.js` — 续费/自动续费开关 | P1 |
| `referral.js` — 返利中心（邀请码+分享+账户+提现入口） | P1 |
| 全局付费引导弹窗 | P1 |
| `admin-referrals.js` — 管理员返利后台（审核+报表） | P2 |

### 4.5 关键 API

| action | 说明 |
|--------|------|
| `plan-catalog` | 三种套餐列表与定价 |
| `subscription-status` | 当前用户订阅状态 |
| `payment-create-order` | 创建支付订单 → 返回支付宝跳转链接 |
| `payment-callback` | 支付宝异步回调 |
| `subscription-renew` | 手动续费 |
| `subscription-cancel-auto-renew` | 取消自动续费 |
| `referral-info` | 邀请码 + 分享链接 |
| `referral-account` | 返利账户余额 + 明细 |
| `referral-withdraw-submit` | 提交提现申请（线下打款） |
| `admin-referral-commissions` | 管理员查看全部返利 |
| `admin-referral-withdraw-process` | 管理员处理提现（通过/驳回） |

### 4.6 支付宝接入
- [ ] 支付宝开放平台注册 + 应用创建 + 签约「手机网站支付」「电脑网站支付」
- [ ] 生成 RSA2 密钥对 + 配置 notify_url/return_url
- [ ] 安装 `alipay-sdk`，实现 `alipay.trade.wap.pay`（手机）+ `alipay.trade.page.pay`（桌面）
- [ ] 支付回调签名校验 + seller_id/app_id 验证 + 激活订阅（**回调绕过 token 认证，仅用签名校验**）
- [ ] `alipay.trade.refund` 退款 + 争议处理接口
- [ ] **注意**：支付宝周期扣款需单独签约协议，暂不实现自动扣款；`auto_renew` 意为「到期前 3 天推送续费提醒」

### 4.7 运营策略
- 新用户免费试用 3 天（注册时自动插入 trial 订阅记录）
- 阶梯返利（50%→55%→60%，按付费次数递增，线下打款，详见 `sucai/系统改进计划_V9.1.md` 4.10）
- 优惠码系统（coupons 表，fixed/percent 折扣 + 使用次数上限）
- 老用户锁价 1 年保护

### 4.8 E2E 测试覆盖
18 个核心用例覆盖：选购→支付→激活→过期→续费→阶梯返利（50%/55%/60%）→提现→管理员审核，详见详细版 4.8-A。

---

## Phase 5：技术升级（季度评估）

### 5.1 TypeScript 渐进引入
- [ ] 第 1 步：`tsconfig.json`（`allowJs:true`，不强制检查）
- [ ] 第 2 步：`server/config.ts`（纯类型定义，收益最大）
- [ ] 第 3 步：新模块用 `.ts` 编写
- [ ] 第 4 步：核心模块选择性迁移

### 5.2 前端框架评估
- 当前 17 页面 Vanilla JS → 够用，不强行迁移
- 如需扩展 → **Alpine.js**（5KB，兼容现有代码）

---

## 关键指标看板

| 指标 | 当前 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|------|---------|---------|---------|---------|---------|
| index.js 行数 | 7146 | 7146 | 7146 | **<2000** | <2000 | <1500 |
| 全局覆盖率 | 25% | 25% | **40%** | 50% | 55% | 60% |
| core 覆盖率 | 40% | 40% | **50%** | 55% | 60% | 65% |
| 部署脚本 | 10+ | 8 | **4** | 3 | 3 | 3 |
| tmp_* 文件 | 4 | **0** | 0 | 0 | 0 | 0 |
| 废弃目录 | 2 | 1 | 0 | 0 | 0 | 0 |
| 付费套餐 | 0 | 0 | 0 | 0 | **3** | 3 |
| 支付渠道 | 0 | 0 | 0 | 0 | **1** | 1 |

---

## 时间线

```
6/11 ──┬── Week 1-2: 安全审计 + 删除 tmp 文件 + 覆盖率启动
       ├── Week 3-4: 部署统一 + 预检增强 + 覆盖率提升
7/09 ──┼── Week 5-6: API 路由拆分(auth/users) + 支付 DB + 后端模块
       ├── Week 7-8: API 拆分(plans) + 支付宝接入 + 支付 API 测试 + 返利后端
       ├── Week 9-10: 中间件抽取 + 支付前端(pricing/payment) + 返利前端(referral)
       ├── Week 11-12: 配置集中化 + 支付前端(subscription/admin) + 返利管理后台 + E2E
9/03 ──┼── Month 4-5: 支付灰度发布 + 线上验证
10月+ ──┴── TypeScript 试点 + 前端框架评估
```
