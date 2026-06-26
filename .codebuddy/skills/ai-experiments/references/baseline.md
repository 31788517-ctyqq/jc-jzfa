# AI 实验基线参考

> 最后更新：2026-06-22 | 960 次采样

## 当前基线

| 指标 | 值 | 备注 |
|------|:---:|------|
| DeepSeek 平均响应 | 33s | model: deepseek-chat |
| 豆包平均响应 | 31s | 16:30 后仅用此模型 |
| 合并耗时 | ~10s | 两模型结果合并 |
| 总耗时 | ~46s | 含 pre/post 处理 |
| 采样数 | 960 | 训练+验证 |
| Temperature | 0.3 | 代码/逻辑任务 |
| 降级策略 | 16:30 → 仅豆包 + 精简 Prompt | 避免 DeepSeek 超时 |

## 历史变更记录

| 日期 | 变更 | 效果 |
|------|------|------|
| 2026-06-22 | 基线建立 | 双模型并行 |
| — | — | 见 `server/ai_timing.json` 完整记录 |

## 实验入门

```bash
# 标准回测（评估当前模型）
node scripts/backtest_v2.cjs

# Walk-Forward 验证（防止过拟合）
node scripts/backtest_v2.cjs --walk-forward

# 修改 prompt 后：必须录入 ai_timing.json
# 格式参考 ai-experiments SKILL.md「变更记录格式」节
```

## 重要决策

- 模型/ prompt 变更前必须运行 baseline 回测
- 变更后对比命中率/ROI/利润 3 项指标
- 命中率 > +3% → 采纳；下降 → 回滚
- 双模型结果取并集，同比赛随机选一个
