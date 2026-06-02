The user wants me to revert the changes I just made and instead just provide the information as a text response, not modify any code.
撤销改动：
Good, the file has been reverted. Now let me provide the comprehensive rule explanations as text.

Let me also check if the same file has the same issue in `match-pk.js`:
已撤销。以下是基于代码分析的 5 项规则完整说明：

---

## ① 参与计算的模型 & 模型打架（熔断）判定规则

### 四重一致性验证系统 (`server/gongshoudao/fusion.js`)

参与计算的三模型 + 一盘口基准：

| 模型 | 名称 | 核心公式 |
|------|------|----------|
| **ModelA** | 射门还原法 | E_A = 主队进攻×进攻效率 + 客队防守×客队失球效率 → Σ缩放至每队进球期望，两两加权取总进球 |
| **ModelB** | 攻守权重法 | 复用 `goal.js` 的 B2 模型（xgHome + xgAway） |
| **ModelC** | 交锋预测法 | 0.3×近6次场均总进球 + 0.7×近2次场均总进球 |
| **P_asia** | 亚指盘口基准 | `dxqLastPan`（亚指大小球盘口），缺失则 fallback 到 λ_total |

### 一致性判定算法

三个模型各自计算出总进球数 `[mA.total, mB.total, mC.total]`，两两比较差值 ≤ 0.3 球：

| 条件 | 判定 | 处理 |
|------|------|------|
| 3对差值均 ≤ 0.3 | **强一致** | 三模型平均值作为最终值 `E_final = (A+B+C)/3` |
| 恰好2对 ≤ 0.3 | **弱一致** | 剔除分歧模型，保留的2个取平均 |
| ≤1对一致 | **熔断（模型打架）** | 放弃模型，直接跟随盘口 `E_final = P_asia` |

```javascript
// 判定代码（fusion.js:99-167）
const pairs = [
  { diff: |mA.total - mB.total| },
  { diff: |mA.total - mC.total| },
  { diff: |mB.total - mC.total| },
];
const consistent = pairs.filter(p => p.diff <= 0.3);
if (consistent.length >= 3) → '强一致(三模型融合)'
if (consistent.length === 2) → '弱一致(剔除分歧模型)'
else → '熔断(模型打架，跟随盘口)'
```

---

## ② 熔断的所有规则和判定机制

熔断发生在 **两个层面**：

### 层面一：融合层熔断（fusion.js）
- **触发条件**：三模型两两差值 ≤ 0.3 的对数 ≤ 1
- **处理方式**：放弃模型计算，跟随 P_asia 亚指盘口
- **前端标记**：`fusionConsensus = 'meltdown'` → 显示 🔴熔断
- **连锁影响**：
  - 方案生成器中 `meltdown` 比赛**不允许生成方案**（`plan-generator.js`）
  - 方向推荐返回 「观望/避开」0星

### 层面二：评分卡熔断效果（match-pk-fusion.js）
- **健康评分**：`healthScore = meltdown ? 0 : strong?100 : weak?70 : 50`
- **综合信心分**：健康权重占 15%
- **风险指数**：熔断 = severity 5（最高）
- **标签**：显示 ⚠️模型打架

### 层面三：熔断 + 过热双杀
```
if 熔断 && 热度指数 ≥ 1.4 → 💀 熔断+过热双杀 → 强烈建议放弃
```

---

## ③ 市场分歧的数据来源和判定规则

### 数据来源
赔率数据来自 `homeWinAward`、`awayWinAward`、`drawAward`（从 `gsCache` 加载）。

### 判定公式（`getDirectionAdvice`）

```
隐含概率计算：
  invSum = 1/主胜赔率 + 1/平局赔率 + 1/客胜赔率
  P_主胜 = 1/主胜赔率 / invSum
  P_客胜 = 1/客胜赔率 / invSum
```

### 分歧判定

| 条件 | 判定 |
|------|------|
| 方向推荐主胜 & 市场隐含概率客胜 > 主胜+10% | ⚠️ 市场不看好主胜 |
| 方向推荐客胜 & 市场隐含概率主胜 > 客胜+10% | ⚠️ 市场不看好客胜 |
| 其他 | ✅ 市场一致 |

### 其他验证层面的分歧检测

| 验证项 | 规则 |
|--------|------|
| **SPF交叉验证** | 方向主胜 但 crossSpfLose > crossSpfWin+30% → 矛盾 |
| **让球盘交叉验证** | 方向主胜 但 crossHcpLose > crossHcpWin+40% → 矛盾 |
| **xg一致性** | 方向主胜 但 xgDiff < -0.1 → 矛盾 |
| **赔率方向矛盾** | ladderLevel≥2 但 hAward > aAward×1.3 → 扣15分 |
| **赢盘率矛盾** | pw > 0.1 但 awayWinPan > winPan+15 → 扣10分 |
| **strengthGoal vs attDefGoal** | 差异 > 1球 → 扣15分 |
| **大球率 vs 联赛** | bigBallRatio > 70 但 lob < 50 → 扣10分 |

---

## ④ 风险指数计算规则

### 触发规则

```
风险评分 = 
  熔断场数 × 5 
  + 过热场数(HI≥1.4) × 3 
  + 弱一致场数 × 2 
  + 冷门场数(HI∈(0,0.85]) × 2

风险指数(%) = (风险评分 / (总场数×5)) × 100
```

### 风险等级

| 风险指数 | 标签 |
|----------|------|
| ≥ 50% | 🔴 高风险，建议谨慎投注 |
| 25%~49% | 🟡 中风险，注意控制仓位 |
| < 25% | 🟢 低风险 |

### 整体健康度

```
healthPct = (1 - (meltdown场数 + weak场数×0.5) / 总场数) × 100
```

---

## ⑤ 场次综合评分卡计算规则

### 6维度分项评分（各 0~100 分）

| 维度 | 计算方式 | 公式 |
|------|----------|------|
| **实力评分** (30%) | 四维 min-max 归一化后加权 | `gdScore_norm×0.3 + crossValue_norm×0.2 + pwScore_norm×0.3 + adCombined_norm×0.2` |
| **进球评分** (15%) | 4维进球归一化加权 | `bigBallRatio_norm×0.3 + attDefGoal_norm×0.3 + headToHeadGoal_norm×0.2 + breakArmor_norm×0.2` |
| **热度评分** (10%) | 距离 1.0 的非对称惩罚 | `100 - 100 × |1.0 - HI|^1.5`，clamp 0~100 |
| **健康评分** (15%) | 融合共识映射 | `strong→100, weak→70, meltdown→0, 默认→50` |
| **稳定性评分** (15%) | 直读 | `stabilityOverall`（出自进球分布方差），clamp 0~100 |
| **验证评分** (15%) | 初始100分，4项交叉验证扣分 | 赔率矛盾扣15/赢盘率矛盾扣10/进球背离扣15/联赛大球率扣10 |

### 时效衰减

```javascript
ageWeight = 0.5^(dataAge / halfLife)
// halfLife: odds=15min, heat=30min, ai=60min, stats=360min
// 热度评分 × ageW_heat; 稳定性评分 × ageW_stats
```

### 综合信心分

```
综合信心分 = 0.30×实力 + 0.15×进球 + 0.10×热度(衰减) + 0.15×健康 + 0.15×稳定性(衰减) + 0.15×验证

额外兜底: dataAge > 240min → -5分; dataAge > 120min → -3分
```

### 星级映射

| 综合分 | 星级 |
|--------|------|
| 0~19 | ⭐ |
| 20~39 | ⭐⭐ |
| 40~59 | ⭐⭐⭐ |
| 60~79 | ⭐⭐⭐⭐ |
| 80~100 | ⭐⭐⭐⭐⭐ |

### 方向推荐映射

| pwScore | HI | 推荐方向 | 星级 |
|---------|-----|----------|------|
| ≥ 0.25 | < 1.4 | 主胜（绝对优势） | 5 |
| ≥ 0.08 | ≥ 1.4 | 主胜（防冷） | 3 |
| ≥ 0.08 | < 1.4 | 主胜（明显优势） | 4 |
| ∈(-0.08,0.08) | — | 胜/平双选 | 2 |
| ≤ -0.08 | — | 客胜 | 3~4 |
| meltdown | — | 观望/避开 | 0 |

弱一致额外 -1 星；相对排名 Top 25% 额外 +1 星。