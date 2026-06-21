# backtesting-frameworks v19

> 必须同时加载 experiment-tracking

## 检查清单
```
□ 1. 双 Skill 加载？     → backtesting + experiment-tracking
□ 2. 基线对比？          → 变更前后命中率/ROI/利润
□ 3. 实验记录？          → 参数写入 experiment-tracking
□ 4. Walk-Forward？      → 前向验证防过拟合
```

## 命令
```
node scripts/backtest_v2.cjs                   # 标准回测
node scripts/backtest_v2.cjs --walk-forward    # Walk-Forward
node scripts/backtest_v2.cjs --monte-carlo     # Monte Carlo
```

## 关键参数
`minExpertA`=A | `minOdds`=1.50 | `minProduct`=2.0

## 指标
命中率=命中/总场次 | ROI=净利润/总投入 | 利润曲线=累计利润

## Fallback
| 失败 | 降级 |
|------|------|
| 回测报错 | 检查 data.json 日期范围 |
| 命中率异常 | 确认数据源无脏数据→odds完整性 |
| 过拟合 | 缩短训练窗口→增加测试期数 |
