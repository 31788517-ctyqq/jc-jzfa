# backtesting-frameworks · 回测系统

> ⚠️ 涉及方案参数调优时必须**同时加载 experiment-tracking** Skill

---

## 🔴 强制检查清单

```
□ 1. 双 Skill 加载？     → backtesting-frameworks + experiment-tracking 必须同时加载
□ 2. 基线对比？          → 变更前后命中率/ROI/利润对比
□ 3. 实验记录？          → 参数变更写入 experiment-tracking
□ 4. Walk-Forward 验证？ → 参数优化后做前向验证防过拟合
```

---

## ⚡ 回测命令

```powershell
node scripts/backtest_v2.cjs                    # 标准回测
node scripts/backtest_v2.cjs --walk-forward     # Walk-Forward 验证
node scripts/backtest_v2.cjs --monte-carlo      # Monte Carlo 模拟
```

---

## 🔑 关键参数

| 参数 | 含义 | 默认值 |
|------|------|--------|
| `minExpertA` | 专家最低评级 | A |
| `minOdds` | 最低赔率阈值 | 1.50 |
| `minProduct` | 最低乘积 | 2.0 |

---

## 📊 输出指标

- **命中率**：方案命中场次 / 总场次
- **ROI**：净利润 / 总投入
- **利润曲线**：累计利润随时间变化

---

深度文档：`.codebuddy/skills/backtesting-frameworks/references/patterns.md`
