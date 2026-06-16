---
name: backtesting-frameworks
description: >
  足彩预测回测系统。触发词：回测/backtest/命中率/ROI/方案参数/调参/minExpertA/minOdds/minProduct/Walk-Forward/Monte Carlo/参数优化。
  ⚠️ 涉及方案参数调优时必须**同时加载** `experiment-tracking` Skill。
  代码示例见 references/patterns.md。
---

# 回测框架 · 速查卡

## 核心概念

| 偏差 | 描述 | 缓解 |
|------|------|------|
| 前视偏差 | 用未来信息预测过去 | 预测时间戳 < 比赛时间 |
| 幸存者偏差 | 只统计有结果比赛 | 统计所有已预测场次 |
| 过拟合 | 对历史数据调参过度 | 保留 OOS 测试集 |
| 选择偏差 | 只挑高命中场次 | 全量统计 |

## 数据集分割

```
训练集 60% → 验证集 20% → 测试集 20%
  ↑ Prompt 开发      ↑ 参数选择      ↑ 最终评估（不可窥探）
```

## 方案参数调优流程（★ 必须执行）

1. 获取当前参数值（minExpertA / minOdds / minProduct）
2. `WalkForwardAnalyzer` 在 60 天历史上 Walk-Forward（train=30d, test=7d）
3. 网格搜索 ±20% 范围找最优参数
4. OOS 测试集验证 → 不通过则拒绝上线
5. 记录到 `experiment-tracking` → 对比旧参数

## 性能指标

- 命中率 (Hit Rate)
- 总回报率 (Total Return) / 年化回报 / 夏普比率
- 最大回撤 (Max Drawdown)
- 胜率 / 盈亏比 (Profit Factor)
- Monte Carlo 95% 置信区间

## 代码参考

- `references/patterns.md` — PredictionBacktester / MonteCarloIncome / WalkForwardAnalyzer 完整实现
