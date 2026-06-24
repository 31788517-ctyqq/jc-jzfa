# ai-experiments

> 原 backtesting-frameworks + experiment-tracking 合并。永远一起加载。

## ⚠️ MUST 检查清单
1. 基线对比 → 变更前后命中率/ROI/利润
2. Walk-Forward → 前向验证防过拟合
3. 实验记录 → 参数写入 `ai_timing.json`
4. 降级策略 → 确认超时/fallback

## 回测命令
```
node scripts/backtest_v2.cjs                # 标准回测
node scripts/backtest_v2.cjs --walk-forward # Walk-Forward
node scripts/backtest_v2.cjs --monte-carlo  # Monte Carlo
```

## 关键参数
`minExpertA`=A | `minOdds`=1.50 | `minProduct`=2.0

## 当前基线
DeepSeek(avg33s)+豆包(avg31s) | 合并~10s | 总~46s(960采样) | 16:30后仅豆包+精简Prompt | 最后验证: 2026-06-22

## 变更记录格式
`{ model, temperature, prompt_version, avg_time, cost_per_call, date }` → `server/ai_timing.json`

## 实验决策
命中率 >+3%→采纳 | +1~3%→A/B | <±1%→保留 | 下降→回滚

## Fallback
| 失败 | 降级 |
|------|------|
| 回测报错 | 检查data.json日期范围 |
| 命中率异常 | 确认odds完整性 |
| 过拟合 | 缩短训练窗口→增加测试期数 |
| ai_timing格式错 | JSON.parse校验→修复 |
| 模型超时(>60s) | 检查API key→降级备用 |
