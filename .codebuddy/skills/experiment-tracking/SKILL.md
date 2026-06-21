# experiment-tracking v19

> 必须同时加载 backtesting-frameworks

## 检查清单
```
□ 1. 双 Skill 加载？      → experiment-tracking + backtesting-frameworks
□ 2. 对比数据记录？       → 模型/耗时/费用/命中率
□ 3. ai_timing.json？     → 更新基线配置
□ 4. 降级策略？           → 确认超时/fallback
```

## 当前基线
DeepSeek(avg33s)+豆包(avg31s) | 合并~10s | 总~46s(960采样) | 16:30后仅豆包+精简Prompt | 日费用从 `ai_timing.json` 计算 | 最后验证: 2026-06-22

## 变更记录格式
`{ model, temperature, prompt_version, avg_time, cost_per_call, date }` → `server/ai_timing.json`

## 实验决策
| 命中率变化 | 决策 |
|:---:|------|
| >+3% | 采纳 |
| +1%~3% | A/B扩大样本 |
| <±1% | 保留 |
| 下降 | 回滚 |

## Fallback
| 失败 | 降级 |
|------|------|
| ai_timing.json 格式错误 | JSON.parse 校验→修复 |
| 模型超时(>60s) | 检查 API key→降级备用模型 |
| 对比不一致 | 相同seed重新采样 |
