---
name: experiment-tracking
description: >
  AI 预测实验追踪。触发词：实验/prompt/AI模型/DeepSeek/豆包/temperature/费用优化/命中率对比/A-B/test/模型切换/模型变更。
  ⚠️ 涉及 AI 模型或 prompt 变更时必须**同时加载** `backtesting-frameworks` Skill。
  代码实现见 references/tracker-code.md。
---

# 实验追踪 · 速查卡

## 追踪维度

| 类别 | 示例 |
|------|------|
| Prompt | 版本 / content hash / temperature / max_tokens |
| 模型 | deepseek-chat / 豆包 / 双模型并行 |
| 数据源 | gs_cache_version / pk_scorer_version |
| 指标 | SPF 命中率 / 比分命中率 / 大小球命中率 |
| 成本 | 日费用 / 单次调用费用 |

## AI 变更流程（★ 必须执行）

1. 记录当前配置为基线（命中率 + 日成本）
2. 创建新实验组 → `experiment_registry` 表
3. 新配置在 `prediction_logs` 打 `experiment_id` + `experiment_group`
4. 收集 ≥ 60 场数据后 → `compareExperiment()` → 生成报告

## 决策指南

| 命中率变化 | 决策 |
|-----------|------|
| > +3% | ✅ 立即采纳 |
| +1%~3% | A/B 测试扩大样本 |
| < ±1% | 保留现用配置 |
| 下降 | ❌ 回滚 |

## 记录字段

`prediction_logs` 表需包含: `ai_prompt_version`, `ai_model`, `experiment_id`, `experiment_group`
`experiment_registry` 表: experiment 元数据 + 结果 JSON

## 代码参考

- `references/tracker-code.md` — ExperimentTracker 类完整实现
