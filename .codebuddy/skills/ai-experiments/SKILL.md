# ai-experiments

> 回测 / ROI / 调参 / AI 模型 / DeepSeek / 豆包

> 原 backtesting-frameworks + experiment-tracking 合并。永远一起加载。

## ⚠️ MUST 检查清单

1. 基线对比 → 变更前后命中率 / ROI / 利润
2. Walk-Forward → 前向验证防过拟合
3. 实验记录 → 参数写入 `ai_timing.json`
4. 降级策略 → 确认超时 / fallback 模型

## 当前基线（2026-06-22 验证）

- 双模型：DeepSeek(avg 33s) + 豆包(avg 31s)，合并 ~10s，总 ~46s（960 采样）
- 降级：16:30 后仅豆包 + 精简 Prompt
- 模型变更必须记录到 `server/ai_timing.json`

## 实验决策标准

| 命中率变化 | 决策 |
|:----------:|:----:|
| > +3% | 采纳 |
| +1~3% | A/B 测试 |
| < ±1% | 保留 |
| 下降 | 回滚 |

## 回测命令

```bash
node scripts/backtest_v2.cjs                          # 标准回测
node scripts/backtest_v2.cjs --walk-forward            # Walk-Forward
node scripts/backtest_v2.cjs --monte-carlo             # Monte Carlo
```

## 关键参数

`minExpertA`=A | `minOdds`=1.50 | `minProduct`=2.0

## 变更记录格式

```json
{ "model": "xxx", "temperature": 0.3, "prompt_version": "v3",
  "avg_time": 33, "cost_per_call": 0.015, "date": "2026-06-22" }
```

保存到 `server/ai_timing.json`

## 参考文档（`references/`）

- `baseline.md` — 当前 AI 基线详情 + 历史对比

## Fallback

| 失败 | 降级 |
|------|------|
| 回测报错 | 检查 `data.json` 日期范围 |
| 命中率异常 | 确认 odds 完整性 |
| 过拟合 | 缩短训练窗口 → 增加测试期数 |
| `ai_timing` 格式错 | JSON.parse 校验 → 修复 |
| 模型超时(>60s) | 检查 API key → 降级备用模型 |
| 防假跑验证不通过 | 按 AGENTS.md 4 段格式强制交付 |
