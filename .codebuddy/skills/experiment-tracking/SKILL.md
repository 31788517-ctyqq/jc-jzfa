# experiment-tracking · 实验追踪

> ⚠️ 涉及 AI 模型/prompt 变更时必须**同时加载 backtesting-frameworks** Skill

---

## 🔴 强制检查清单

```
□ 1. 双 Skill 加载？     → experiment-tracking + backtesting-frameworks 必须同时加载
□ 2. 记录对比数据？      → 变更前后：模型/耗时/费用/命中率
□ 3. ai_timing.json？    → 更新当前基线配置
□ 4. 降级策略？          → 确认超时/fallback 策略
```

---

## 📊 当前 AI 基线

| 项目 | 值 |
|------|-----|
| 模型 | DeepSeek（avg 33s）+ 豆包（avg 31s） |
| 合并耗时 | ~10s |
| 总耗时 | ~46s（960 次采样） |
| 降级 | 16:30 后仅豆包，deepseek-chat + 精简 Prompt |

---

## 📝 变更记录格式

每次模型/prompt 变更在 `server/ai_timing.json` 记录：

```
{ model, temperature, prompt_version, avg_time, cost_per_call, date }
```

---

## 🆘 Fallback（检查清单某项不通过时）

| 失败项 | 降级路径 |
|--------|---------|
| ai_timing.json 格式错误 | `JSON.parse` 校验 → 修复 → 重新写入 |
| 模型调用超时（>60s） | 检查 API key + 网络 → 自动降级到备用模型 |
| 对比数据不一致 | 重新采样（相同 seed） → 排除网络抖动 |
| 双 Skill 漏加载 | 始终 backtesting-frameworks + experiment-tracking 配对 |

> 所有 fallback 均失败 → 中止模型变更，向用户报告瓶颈。

---
深度文档：`.codebuddy/skills/experiment-tracking/references/tracker-code.md`
