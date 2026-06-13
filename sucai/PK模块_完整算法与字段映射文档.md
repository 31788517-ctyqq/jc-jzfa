# PK 模块 — 完整算法与字段映射文档

> 生成时间：2026-06-09  
> 最后更新：2026-06-13（排除 AI/专家数据）  
> 源码版本：refactor/phase8-atomic-write  
> 覆盖范围：`server/pk_scorer.js`、`server/gongshoudao/`、`server/core/`、`preview/js/pages/match-pk.js`  
> **设计原则**：PK 模块为独立计算模块，不依赖任何 AI 预测（DeepSeek/豆包）或专家推荐/共识数据。所有评分、方向判定、融合投票均基于功守道自算 + 市场信号 + 数据融合。

---

## 目录

- [一、参与模型总览](#一参与模型总览)
- [二、字段映射](#二字段映射--数据来源与映射方法)
- [三、七维评分算法](#三七维评分算法--字段算法详解)
- [四、完整算法展开（20个子算法）](#四完整算法展开)
- [五、综合评分与权重设置](#五综合评分与权重设置)
- [六、预测方向判定逻辑](#六预测方向--完整判定逻辑)
- [七、联赛热度自适应](#七联赛热度自适应v20-p5)
- [八、七维评分子算法详解](#八七维评分子算法详解)
- [九、数据流转全链路](#九数据流转全链路)
- [十、关键常量速查](#十关键常量速查)
- [十一、核心文件索引](#十一核心文件索引)
- [十二、数据库 Schema](#十二数据库-schema--prediction_logs-表-pk-字段)
- [十三、前后端算法差异对比](#十三前后端算法差异对比)
- [十四、测试覆盖矩阵](#十四测试覆盖矩阵)
- [十五、回填管道](#十五回填管道data-pipeline)
- [十六、调度与运行机制](#十六调度与运行机制)
- [十七、前端渲染架构](#十七前端渲染架构match-pk-fusionjs-v50)
- [十八、回测中的 PK 使用方式](#十八回测中的-pk-使用方式)
- [十九、部署注意事项](#十九部署注意事项)
- [二十、调整 PK 模块时的修改清单](#二十调整-pk-模块时的修改清单)
- [二十一、版本与实验管理系统](#二十一版本与实验管理系统)
- [二十二、修改影响范围地图](#二十二修改影响范围地图)
- [二十三、常见陷阱与修改模式](#二十三常见陷阱与修改模式)
- [二十四、调试指南](#二十四调试指南)
- [附录A：版本变更日志](#附录a版本变更日志)

---

## 版本变更日志

| 版本 | 日期 | 变更内容 | 影响范围 |
|------|------|---------|---------|
| **pk_v2.0** | 2026-06-09 | pwScore 权重 0.3→0.35, bigBallRatio 0.3→0.35, 新增 consensus 奖励 +3; 新增版本追踪系统 | 综合分偏移 +2~5 分；所有写入记录自动标记版本 |
| **pk_v1.0** | 初始版 | 原始算法：gd:0.3/cv:0.2/pw:0.3/ad:0.2, bb:0.3/att:0.3/h2h:0.2/bk:0.2 | — |

> **提示**：修改算法后，将 `server/pk_scorer.js` 中的 `PK_SCORER_VERSION` 递增为新版本号，并在此表添加一行。
> **查看当前版本**：`node server/pk_scorer.js --version`

---

## 一、参与模型总览

PK 模块涉及 **两层模型体系**：

### 1.1 功守道三模型融合（进球数层面）

| 模型 | 名称 | 核心公式 | 代码位置 |
|------|------|----------|---------|
| **ModelA** | 射门还原法 | `E_h = (α×Eff_atk_h + β×Eff_def_a) × 10`，基于射门次数还原进球期望 | `fusion.js:28-65` |
| **ModelB** | 攻守权重法 | 复用 `goal.js` B2 的 `xgHome + xgAway` | `fusion.js:108` |
| **ModelC** | 交锋预测法 | `0.3 × 近6次场均总进球 + 0.7 × 近2次场均总进球` | `fusion.js:69-93` |

### 1.2 融合引擎 4 个模型适配器（预测方向层面）

> **注意**：PK 模块不涉及 AI（DeepSeek/豆包）和专家推荐/专家共识数据。以下仅列出独立计算的模型适配器。

| # | 适配器 | 版本 | 覆盖维度 | 方向来源 |
|---|--------|------|----------|---------|
| 1 | **GongshoudaoAdapter** | v9.1 | direction/goal/score | GS `crossSpfWin/Draw/Lose` 概率分布 |
| 2 | **PKScorerAdapter** | v2.0 | direction/goal | `prediction_logs.pk_direction` |
| 3 | **MarketSignalAdapter** | v2.0 | direction | JczqBasic 多维市场信号（SP隐含概率+亚指盘口+离散度） |
| 4 | **DataFusionAdapter** | v1.0 | direction/goal | `data-fusion.fullFusion()` 三源融合 |

> **已排除**：DeepseekAdapter / DoubaoAdapter（AI 预测）和 ExpertConsensusAdapter（专家推荐）不属于 PK 模块计算范畴。

---

## 二、字段映射 — 数据来源与映射方法

### 2.1 GS Cache → pk_scorer 内部字段（`loadGSFields`）

核心映射函数位于 `server/pk_scorer.js:489-559`：

| pk_scorer 内部字段 | GS Cache 原始 key | 计算方法 |
|-------------------|------------------|---------|
| `gdScore` | `gs.gdQ` | 直接取值（★ 注意：是 `gdQ` 不是 `gdScore`） |
| `crossValue` | 无直接字段 | `hWins + aLosses - hLosses - aWins`（从4个原始字段计算） |
| `pwScore` | `gs.totalStrength` | 直接取值（综合实力，主队视角正数=占优） |
| `adCombined` | `gs.adWeightedComposite` | 直接取值（攻守实力合成） |
| `bigBallRatio` | `gs.bigBallRatio` | 直接取值，缺失默认 50 |
| `attDefGoal` | `gs.attDefGoal` | 直接取值，前端兜底限制 ≤7.0 |
| `headToHeadGoal` | `gs.h2hGoalAvg` | 直接取值，缺失默认 2.5 |
| `breakArmor` | `gs.breakArmorSum` | 直接取值 |
| `heatIndex` | `gs.heatIndex` / `gs.heatScore` / `jczq_change_cache` | 优先从 GS 取，如为 `1.00` 则从 `jczq_change_cache.json` 交叉校验 |
| `fusionConsensus` | `gs.fusionConsensusType` / `gs.fusionConsensus` | 优先取英文代码（`strong`/`weak`/`meltdown`） |
| `dataAge` | `gs.computedAt` | `(Date.now() - computedAt) / 60000`（分钟数） |
| `stabilityOverall` | `gs.stabilityOverall` | 直接取值，默认 50 |
| `ladderLevel` | `gs.ladderLevel` | 直接取值 |
| `homeWinAward` | `gs.homeWinAward` | 即时主胜赔率 |
| `awayWinAward` | `gs.awayWinAward` | 即时客胜赔率 |
| `drawAward` | `gs.drawAward` | 即时平局赔率 |
| `homeWinPan` | `gs.homeWinPanRate` | 主队赢盘率 |
| `awayWinPan` | `gs.awayWinPanRate` | 客队赢盘率 |
| `strengthGoal` | `gs.strengthGoal` | 实力进球预期 |
| `leagueCalibration` | `gs.leagueCalibration` | 联赛校准系数 |
| `leagueAvgGoals` | `gs.leagueAvgGoals` | 联赛场均进球，默认 2.65 |
| `leagueOverBaseline` | `gs.leagueOverBaseline` | 联赛大球基准，默认 55 |
| `attackPattern` | `gs.attackPattern` | 攻防格局描述字符串 |
| `crossSpfWin/Lose` | `gs.crossSpfWin/Lose` | SPF 交叉分布概率 |
| `crossHcpWin/Lose` | `gs.crossHcpWin/Lose` | 让球交叉分布概率 |
| `fusionFinalHome/Away/Total` | `gs.fusionFinalHome/Away/Total` | 功守道融合最终值 |

### 2.2 前端 `buildGSFields` 补充映射（`match-pk.js:72-149`）

前端也有一层映射，将 GS 数据展平为评分所需的字段结构：

```js
return {
  totalAdvantage: gs.totalAdvantage || '-',
  totalAdvantageValue: gs.totalAdvantageValue || 0,
  attackPattern: gs.attackPattern || '',
  xgHome: gs.xgHome != null ? gs.xgHome : 0,
  xgAway: gs.xgAway != null ? gs.xgAway : 0,
  adWeightedComposite: gs.adWeightedComposite != null ? gs.adWeightedComposite : 0,
  // ... stability / league / winPan 等
};
```

---

## 三、七维评分算法 — 字段算法详解

### 3.1 评分维度汇总

`computeAllScores()` 计算 **7 个分项评分**（每项 0~100）：

1. 实力评分（`calcPowerScores`）
2. 进球评分（`calcGoalScores`）
3. 热度评分（`calcHeatScores`）
4. 健康评分（`calcHealthScores`）
5. 稳定性评分（`calcStabilityScores`）
6. 赢盘率评分（`calcWinPanScores`）— V9.0 新增
7. 验证评分（`calcVerificationScores`）

---

## 四、完整算法展开

### 算法 1：gdQ（净胜球量化）— `goal.js`

#### 1.1 数据预处理：时间衰减加权场均

近期趋势推断公式（`inferRecentTrendRatio`）：

```
W2 = 大胜场次, W1 = 小胜场次, D = 平局, L1 = 小负场次, L2 = 大败场次
weightedScore = W2×2 + W1×1 - L1×1 - L2×2
normalizedScore = weightedScore / (W2+W1+D+L1+L2)
trendRatio = 1.0 + normalizedScore × 0.3  // 范围 [0.7, 1.3]
```

**三段式时间衰减权重**（`applyTimeDecayToAvg`）：

```
trendDecayed = flatAvg × [0.6 × trendRatio + 0.25 × 1.0 + 0.15 × (1/trendRatio)]
```

#### 1.2 四维呼吸权重（β 值计算 + 稳定化）

```
atkH = gh / (eh + 0.001)          // 主队进攻次数（还原射门次数）
shotAgainstH = lh / (dh + 0.001)   // 主队被射门次数
atkA = ga / (ea + 0.001)           // 客队进攻次数
shotAgainstA = la / (da + 0.001)   // 客队被射门次数

β1_raw = atkH / (atkH + shotAgainstA)
β2_raw = atkA / (atkA + shotAgainstH)

// 缩尾 [0.15, 0.85]
// 贝叶斯收缩: β = n/(n+3) × β_raw + 3/(n+3) × 0.5
```

#### 1.3 效率方向微调 β

```
β_adj += homeAttackEffRaw > 0 ? 0.03 : -0.03
// clamp [0.1, 0.9]
```

#### 1.4 主客场地维度 β3、β4

```
β3 = (hfGoal - hfLose) / (hfGoal + hfLose + 1)
β4 = (afGoal - afLose) / (afGoal + afLose + 1)
```

#### 1.5 终极 xG 计算

```
xgHome = β1_adj × gh + β3 × hfGoal    // clamp [0.1, 4.5]
xgAway = β2_adj × ga + β4 × afGoal     // clamp [0.1, 4.5]
```

#### 1.6 净胜球量化 gdQ

```
E_h = β1 × 主场场均进球 + (1-β1) × 客场场均失球
E_a = β2 × 客场场均进球 + (1-β2) × 主场场均失球
gdQ = E_h - E_a
```

---

### 算法 2：综合实力 `totalStrength`（pwScore）— `diff.js`

#### 2.1 静态实力

```
Static = (homePower - awayPower) / (homePower + awayPower)  ∈ [-1, 1]
```

#### 2.2 动态状态（V6.4 动态计分规则）

```
Dyn_H = WG2×2 + WG1×1.75 + Draw×0.5 + LG1×0.25
Dyn = (Dyn_H - Dyn_A) / (Dyn_H + Dyn_A)  ∈ [-1, 1]
```

#### 2.3 综合实力合成

```
totalStrength = 0.7 × Static + 0.3 × Dyn
```

---

### 算法 3：攻守实力 `adCombined` — `attack.js`

#### 3.1 进攻优势度（Adv_进攻）= 3个子维度加权合成

**子维度一：赢球格局得分对冲**
```
对冲赢球格局 = ([2WG2_h + 1WG1_h + 0.5PG_h] - [2WG2_a + 1WG1_a + 0.5PG_a]) / 10
```

**子维度二：攻击力纯能效对冲**
```
冲攻击能效 = (G_h / (Eff_atk,h+0.001) - G_a / (Eff_atk,a+0.001)) / max(Atk_H, Atk_A, 0.01)
```

**子维度三：进球厚度分布对冲**
```
对冲进球厚度 = ([1×Q1_h + 2×Q2p_h] - [1×Q1_a + 2×Q2p_a]) / 10
```

**合成**：
```
Adv_进攻 = 0.4 × 赢球格局 + 0.35 × 攻击能效 + 0.25 × 进球厚度
```

#### 3.2 防守优势度（Adv_防守）= 对称的3个子维度合成

```
Adv_防守 = 0.4 × 输球格局对冲 + 0.35 × 防守能效对冲 + 0.25 × 失球厚度对冲
```

（注意方向：客队输球多 → 利好主队，方向取反）

#### 3.3 攻守格局与 sigmoid 权重

```
S = (Adv_进攻 + Adv_防守) / 2
w_进攻 = sigmoid(Adv_进攻),  w_防守 = 1 - w_进攻

格局判定：
  Adv_进攻 > 0.15 & Adv_防守 > -0.05 → 对攻为主
  Adv_防守 > 0.15 & Adv_进攻 > -0.05 → 防守为主
  其他 → 攻守平衡
```

#### 3.4 攻守实力 AD_Diff（进球/失球分布计分法 V6.4）

| 进球分布 | 进攻得分 | 失球分布 | 防守得分 |
|----------|---------|----------|---------|
| 0球 | ×0 | 0球 | ×2 |
| 1球 | ×1 | 1球 | ×1 |
| 2+球 | ×2 | 2+球 | ×0 |

```
AD_Diff = [(进攻_主 + 防守_主) - (进攻_客 + 防守_客)] / [(进攻_主 + 防守_主) + (进攻_客 + 防守_客)]
```

---

### 算法 4：四重一致性验证与熔断 — `fusion.js`

#### 4.1 ModelA：射门还原法

```
atkH = (gh×10)/eh,  atkA = (ga×10)/ea
defH = (lh×10)/dh,  defA = (la×10)/da

α = atkH/(atkH+atkA+0.001),  β = defH/(defH+defA+0.001)

E_h = (α × Eff_atk,h + β × Eff_def,a) × 10
E_a = ((1-α) × Eff_atk,a + (1-β) × Eff_def,h) × 10
```

#### 4.2 ModelC：交锋预测法

```
G_6 = 近6次交锋总进球 / 6
G_2 = 近N次交锋总进球 / N
E_C = 0.3 × G_6 + 0.7 × G_2
```

#### 4.3 一致性判定 + 动态加权融合

三模型两两比较（差值 ≤ 0.3 球算一致）：

| 一致对数 | 判定 | 处理方式 |
|---------|------|---------|
| **3** | `strong` | 三模型动态加权融合 |
| **2** | `weak` | 剔除分歧模型，保留的2个加权融合 |
| **≤1** | `meltdown` | 保留模型加权结果（不再跟随盘口） |

**连续共识置信度（V9.1）**：
```
consensusScore = max(0, min(1, 1 - max_diff/0.3))
```

---

### 算法 5：全量总进球 λ_total — `goal.js`

```
W_h = sigmoid(S),  W_a = 1 - W_h,  W_h ∈ [0.05, 0.95]
Intensity_h = G_主场进球 + G_主场失球
Intensity_a = G_客场进球 + G_客场失球
λ_total = W_h × Intensity_h + W_a × Intensity_a
```

---

### 算法 6：进球数弹性区间（三维收敛锁）— `goal.js`

```
λ_gene = 0.4 × H_大球率×5 + 0.4 × A_大球率×5 + 0.2 × H2H_大球率×5
λ_actual = 最近交锋场均进球
综合线 = 0.4λ_gene + 0.3λ_actual + 0.3λ_total

区间 = [⌊综合线⌋ - 1, ⌈综合线⌉ + 1], clamp 到 [0, 6]

下限锁：λ_gene < 1.8 且 λ_actual < 1.5 → 总进球 ≤ 2
上限锁：λ_gene > 2.5 → 总进球 ≥ 2
```

---

### 算法 7：进球分布稳定性评分 — `goal.js`

信息熵 → 稳定度映射：

```
H = -∑ p_i × ln(p_i),  p_i = count_i / Σcount
稳定性_i = (1 - H/ln(3)) × 100

stabilityOverall = (主进球稳定 + 客进球稳定 + 主失球稳定 + 客失球稳定) / 4
```

---

### 算法 8：胜平负交叉分布 — `attack.js`

#### 不让球 SPF 交叉

```
P_主胜 = (H_胜 + A_败) / 20
P_平   = (H_平 + A_平) / 20
P_客胜 = (H_败 + A_胜) / 20
```

#### 让球 HCP 交叉（按 rq 偏移）

合并主客队共20场净胜球分布为5档 `[+2, +1, 0, -1, -2]`，按让球数 `rq` 判断每档偏移后是否穿盘：

```
对每个净胜球档 d ∈ [-2,-1,0,1,2]:
  adjusted = d - rq
  if adjusted > 0 → hcpWin += dist[d]
  if adjusted = 0 → hcpDraw += dist[d]
  if adjusted < 0 → hcpLose += dist[d]

最终除以20归一化
```

---

### 算法 9：实力阶梯映射（7档）— `attack.js`

```
S ≥ 0.3  → 👑 主队绝对大优势 (level=3)
S ≥ 0.15 → ⚔️ 主队中等优势 (level=2)
S ≥ 0.05 → 🔍 主队微弱优势 (level=1)
S > -0.05→ ⚖️ 双方实力接近 (level=0)
S ≥ -0.15→ 🔍 客队微弱优势 (level=-1)
S > -0.3 → ⚔️ 客队中等优势 (level=-2)
S < -0.3 → 👑 客队绝对大优势 (level=-3)
```

---

### 算法 10：盘口位移分析 — `odds-movement.js`

```
P_h = (1/O_h) / (1/O_h + 1/O_d + 1/O_a)   // 隐含概率（去市场抽水偏差）
ProbShift = P_h_live - P_h_open

| probShift | pwScore 条件 | 扣分 |
|-----------|-------------|------|
| > 0.05（主胜降水） | pwScore < -0.1（模型看客） | -15 |
| > 0.02（微降水） | pwScore < -0.08 | -8 |
| < -0.05（主胜升水） | pwScore > 0.1（模型看主） | -15 |
| < -0.02（微升水） | pwScore > 0.08 | -8 |
| abs < 0.02 | — | 0 |
```

**方向一致 bonus（V9.1）**：盘口位移方向与 pw 一致且无惩罚 → +5

---

### 算法 11：欧亚一致性检测 — `odds-movement.js`

```
euroFavorsHome = 欧赔主胜 < 欧赔客胜 → 看好主队
asianFavorsHome = 亚盘让球 > 0 → 看好主队

if 欧亚方向矛盾 → penalty = -12
else if 欧亚一致但模型与市场方向相反 → penalty = -10
```

---

### 算法 12：SP 隐含概率（市场定价）— `data-fusion.js`

```
P_h_SP = (1/SP_h) / (1/SP_h + 1/SP_d + 1/SP_a)
支付率 = 1 / (1/SP_h + 1/SP_d + 1/SP_a)
```

---

### 算法 13：离散度预警 — `data-fusion.js`

```
Δ_离散 = 临盘离散度 - 初盘离散度

Δ > 0.1 → warning → pk_scorer扣分：-10
Δ > 0.05 → caution → pk_scorer扣分：-5
Δ ≤ 0.05 → 稳定 → 无扣分
```

---

### 算法 14：亚指水位变化 — `data-fusion.js`

```
盘口升降 = 临盘盘口 - 初盘盘口
主水位变化 = 临盘主胜均赔 - 初盘主胜均赔
客水位变化 = 临盘客胜均赔 - 初盘客胜均赔

主队降水(<-0.05) → 看好主队信号
主队升水(>0.05)  → 看衰主队信号
```

---

### 算法 15：Beta-Binomial 概率化阈值判定 — `diff.js`

```
P_穿盘 = (2 + successes) / (4 + total)     // Beta(2,2) 先验

样本置信度：
  total ≥ 20 → 极高
  total ≥ 14 → 高
  total ≥ 8  → 中等
  total < 8  → 低（小样本）

P ≥ 0.75 → 🔥极高概率
P ≥ 0.6  → 📊高概率
P < 0.5  → 未通过
```

---

### 算法 16：四维共振裁决 — `diff.js`

四维共振条件：

1. `diffXG > 0`（xG 方向看好主队）
2. `totalStrength ≥ 0.2`（实力方向强）
3. `dim1.passed`（Beta-Binomial ≥ 0.55）
4. `panShift > 0 && SP_主胜隐含 > 0.45`（市场共振）

```
三者共振（无市场）：🔥 三者共振：主队穿盘概率极高
四维共振（有市场）：🔥 四维共振：主队穿盘+市场验证
市场背离：主队盘路偏强，但市场背离⚠️
```

---

### 算法 17：EV 期望值 — `pk_scorer.js`

```
p_Win = 0.33 + (sigmoid(pw×3.5) - 0.5) × 0.94    // [0.33, ~0.80]
p_Draw = 0.25 - |pw| × 0.25                        // clamp [0.18, 0.32]
p_Lose = 1 - p_Win - p_Draw

EV_Home = p_Win × 主胜赔率 - 1
EV_Draw = p_Draw × 平局赔率 - 1
EV_Away = p_Lose × 客胜赔率 - 1
```

价值标签：

| ev 区间 | 标签 | valueScore |
|---------|------|-----------|
| > 0.15 | 💰超值 | +30 |
| > 0.05 | ✅正期望 | +15 |
| > -0.05 | 📊合理 | +5 |
| ≤ -0.05 | ⚠️负期望 | -10 |

---

### 算法 18：动态模型权重（Softmax）— `model-weights.js`

命中定义：`|predictedTotalGoals - actualHomeGoals - actualAwayGoals| ≤ 0.5`

```
acc_i = min(0.7, max(0.3, Hits_i / Total_i))     // 缩尾 [0.3, 0.7]
s_i = exp(acc_i / 0.5)                              // 温度 T=0.5
w_i = s_i / Σs_j
```

---

### 算法 19：双重降级逻辑（V2.0）

熔断和过热的降级处理（不阻断，但降星）：

| 条件 | 方向 | 星级 | 描述 |
|------|------|------|------|
| meltdown + pw≥0.08 | 主胜（参考） | ⭐⭐ | 模型分歧较大 |
| meltdown + pw≤-0.08 | 客胜（参考） | ⭐⭐ | 模型分歧较大 |
| meltdown + -0.08<pw<0.08 | 观望/避开 | ☆ | 无明确方向 |

### 算法 20：综合得分数据时效兜底

```
ageWeight(热度)   = 0.5^(minutes/30)
ageWeight(稳定性) = 0.5^(minutes/360)

dataAge > 240分钟 → 综合分 -5
dataAge > 120分钟 → 综合分 -3
```

---

## 五、综合评分与权重设置

### 5.1 按玩法切换权重 Profile

```js
const SCORE_PROFILES = {
  spf:       { power:0.35, goal:0.1,  heat:0.1,  health:0.1,  stability:0.1,  verify:0.15, winPan:0.1 },
  overUnder: { power:0.1,  goal:0.3,  heat:0.05, health:0.2,  stability:0.15, verify:0.1,  winPan:0.1 },
  handicap:  { power:0.35, goal:0.05, heat:0.05, health:0.1,  stability:0.1,  verify:0.25, winPan:0.1 },
  default:   { power:0.25, goal:0.15, heat:0.1,  health:0.15, stability:0.1,  verify:0.15, winPan:0.1 },
};
```

**设计理念**：

| 玩法 | 主要依赖维度 | 原因 |
|------|------------|------|
| **SPF（胜平负）** | 实力35% + 验证15% | 以实力判断为主，验证防止方向错误 |
| **大小球（overUnder）** | 进球30% + 健康20% | 进球指标权重最大，模型一致性辅助判断 |
| **让球盘（handicap）** | 实力35% + 验证25% | 实力判断+深度验证防止盘口陷阱 |
| **默认** | 均分 | 通用均衡配置 |

### 5.2 综合信心分公式

```
compositeScore = p.power×pwr + p.goal×goal + p.heat×heat + p.health×health
               + p.stability×stab + p.verify×verif + p.winPan×winPan
```

---

## 六、预测方向 — 完整判定逻辑

### 6.1 SPF 方向推荐函数（`getDirectionAdvice`）

基于 `pwScore`（综合实力方向）和 `heatIndex`（热度指数）的二维判定矩阵：

| pwScore 区间 | HI 条件 | 推荐方向 | 星级 | 描述 |
|-------------|---------|---------|------|------|
| **≥ 0.25** | `!isOverheat` | 主胜 | ⭐⭐⭐⭐⭐ | 绝对优势 |
| **≥ 0.25** | `isOverheat` | 主胜（防冷） | ⭐⭐⭐ | 过热预警 |
| **≥ 0.08** | `!isOverheat` | 主胜 | ⭐⭐⭐⭐ | 明显优势 |
| **≥ 0.08** | `isOverheat` | 主胜（防冷） | ⭐⭐⭐ | 过热预警 |
| **≥ 0.08** | `isCold` | 主胜 | ⭐⭐⭐⭐ | 冷门高赔 |
| **(-0.08, 0.08)** | — | 胜/平双选 | ⭐⭐ | 实力均衡/弱一致 |
| **≤ -0.08** | — | 客胜 | ⭐⭐⭐~⭐⭐⭐⭐ | 同上反向 |
| **≤ -0.25** | `!isOverheat` | 客胜 | ⭐⭐⭐⭐⭐ | 绝对优势 |

### 6.1.1 方向判定决策树（可视化）

```
                     ┌───────────────────────────┐
                     │   比赛进入方向判定           │
                     │   fusionConsensus=?         │
                     └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
         meltdown              weak              strong/normal
              │                   │                   │
    ┌─────────┼─────────┐        │                   │
    ▼         ▼         ▼        ▼                   ▼
 pw≥0.08  pw≤-0.08  其他    同正常流程          正常流程
主胜(参考) 客胜(参考) 观望    但双向选优         完整走下面的
   ⭐⭐      ⭐⭐      ⭐      降一档处理           判定矩阵
    │         │         │
    └────┬────┘         │
         │              │
         ▼              ▼
    ┌───────────────────────────────────────────────┐
    │              pwScore 值判定                     │
    │    |pw| 越大 → 方向越明确，星级越高              │
    └───────────────────────────────────────────────┘
              │
    ┌─────────┼─────────────────────┐
    ▼         ▼                     ▼
 pw≥0.25   pw≥0.08              |pw|<0.08
    │         │                     │
    ▼         ▼                     ▼
 heatZ?   heatZ?               meltdown→观望
    │         │                  weak→胜/平双选
 ┌──┴──┐   ┌──┴──┐              正常→胜/平双选
 ▼     ▼   ▼     ▼               ⭐⭐
过热 正常 过热 正常/冷
  │    │   │    │
⭐⭐⭐ ⭐⭐⭐⭐⭐ ⭐⭐⭐ ⭐⭐⭐⭐
主胜防冷 绝对优势 主胜防冷 主胜
```

### 6.2 HCP（让球）方向

```js
if (crossHcpWin > crossHcpLose + 0.05) → '主队让球胜'
else if (crossHcpLose > crossHcpWin + 0.05) → '客队让球胜'
```

### 6.3 大小球方向

```js
totalGoals > 3.0 → '大球' ⭐⭐⭐⭐
totalGoals ≥ 2.5 → '倾向大球' ⭐⭐⭐
totalGoals < 2.5 → '小球' ⭐⭐⭐
```

### 6.4 融合引擎 4 模型方向投票

V9.1 加权版一致性判定（仅含独立计算模型，不含 AI/专家数据）：

```js
effectiveRatio = Σ(w × confidence) / Σw

effectiveRatio ≥ 0.8 → strong
effectiveRatio ≥ 0.6 → weak
effectiveRatio ≤ 0.4 → meltdown
```

> **注意**：PK 模块的方向投票仅使用 4 个模型适配器（Gongshoudao / PKScorer / MarketSignal / DataFusion），不引入 DeepSeek/豆包（AI）和 ExpertConsensus（专家推荐）的预测数据。

---

## 七、联赛热度自适应（V2.0 P5）

`league-heat-profile.js` 为 30+ 联赛设置不同的热度基准：

```js
const LEAGUE_HEAT_BASELINE = {
  英超: { mean: 1.25, std: 0.18, overheatZ: 1.5 },  // 过热阈值 = 1.52
  日乙: { mean: 1.05, std: 0.13, overheatZ: 1.5 },  // 过热阈值 = 1.25
  挪超: { mean: 0.92, std: 0.12, overheatZ: 1.5 },  // 过热阈值 = 1.10
  // ...
};
```

Z-Score 计算：`zScore = (HI - mean) / std`，取代旧版固定 1.4 全局阈值。

---

## 八、七维评分子算法详解

### 8.1 实力评分（`calcPowerScores`）- 4因子归一化加权

```
因子: gdScore(0.25) + crossValue(0.15) + pwScore(0.35) + adCombined(0.25)
方法: min-max归一化后按权重合成

pk_v2.0 优化: pwScore 权重 0.3→0.35（最直接预测信号）
                crossValue 权重 0.2→0.15（间接合成信号，噪音较多）
                gdScore 权重 0.3→0.25（净胜球量化较波动）
                adCombined 权重 0.2→0.25（攻守合成有价值）
```

### 8.2 进球评分（`calcGoalScores`）- 4因子归一化加权

```
因子: bigBallRatio(0.35) + attDefGoal(0.25) + headToHeadGoal(0.2) + breakArmor(0.2)
方法: min-max归一化后按权重合成

pk_v2.0 优化: bigBallRatio 权重 0.3→0.35（更稳定的大球率指标）
                attDefGoal 权重 0.3→0.25（较波动，降低权重）
```

### 8.3 热度评分（`calcHeatScores`）- 非对称惩罚函数

```
score = 100 - 100 × |1.0 - HI|^1.5
HI = 1.0 → 100分（完美均衡）
偏离越大扣分越多，指数1.5使过热（HI>1.4）惩罚重于过冷
```

### 8.4 健康评分（`calcHealthScores`）- 共识直接映射

```
strong → 100
weak → 70
meltdown → 20（V2.0: 不再给0，保留最低基础分）
其他 → 50
```

### 8.5 稳定性评分（`calcStabilityScores`）

```
直接取 stabilityOverall 值, clamp [0, 100], 缺失默认50
```

### 8.6 赢盘率评分（`calcWinPanScores`）- V9.0 新增

```
score = (homeWinPan / 2) × 100
0=全输, 50=均衡, 100=全赢
```

### 8.7 验证评分（`calcVerificationScores`）- 5层交叉验证扣分制

初始100分，触发以下扣分：

| 触发条件 | 扣分 |
|----------|------|
| ladderLevel≥2 & pw<0（实力阶梯与方向矛盾） | -15 |
| strengthGoal>1.5 & attDefGoal<2.0（实力进球与攻防进球背离） | -10 |
| 赔率方向矛盾 | -12 |
| 赢盘率方向矛盾 | -8 |
| bigBallRatio>70 & leagueOverBaseline<50（大球率与联赛基准背离） | -10 |
| 离散度预警(warning) | -10 |
| 离散度预警(caution) | -5 |
| 盘口位移与模型方向矛盾(significant) | -15 |
| 盘口位移与模型方向矛盾(moderate) | -8 |
| 欧亚不一致 | -12 |
| 盘口位移与pw方向一致 | **+5** bonus |

---

## 九、数据流转全链路

```
┌───────────────────────────────────────────────────┐
│                   数据源（3层）                      │
├────────────┬──────────────┬───────────────────────┤
│ 功守道自算  │ JczqBasic   │ JczqChange            │
│ GS cache   │ (SQLite)    │ 热度缓存               │
│            │ 基本面/亚指 │ 冷热指数               │
└─────┬──────┴──────┬───────┴───────┬───────────────┘
      │             │               │
      ▼             ▼               ▼
┌──────────────────────────────────────────────────┐
│              data-fusion.js 三源融合层             │
│  fundamentalFusion() / heatFusion() / fullFusion()│
│  输出: spProb, discrete, asiaWater, xgValidation  │
└──────────────────────────┬───────────────────────┘
                           │
      ┌────────────────────┼────────────────────┐
      ▼                    ▼                    ▼
┌──────────────┐  ┌────────────────┐  ┌──────────────────────┐
│ fusion.js    │  │  pk_scorer.js  │  │ prediction-fusion.js │
│ 三模型融合    │  │  7维评分+方向   │  │  4模型适配器融合       │
│ A/B/C 进球   │  │  loadGSFields  │  │  (不含AI/专家)         │
│ strong/weak  │  │  computeAll    │  │  方向投票+共识判定     │
│ /meltdown    │  │  getDirection  │  │  unified_predictions  │
└──────┬───────┘  └───────┬────────┘  └───────────┬───────────┘
       │                  │                       │
       ▼                  ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  prediction_logs (SQLite)                     │
│  pk_direction / pk_composite_score / pk_* 字段                │
│  gs_top_score / gs_modelA_total / gs_modelB_total / ...     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│             前端 match-pk.js / match-pk-fusion.js             │
│  三维度PK弹窗: 实力/进球/热度 横向对比                          │
│  综合评分卡: 6维度雷达 + 星级 + 风险指数                        │
└─────────────────────────────────────────────────────────────┘
```

> **说明**：PK 模块数据源仅 3 层（功守道自算 + JczqBasic 基本面 + JczqChange 热度缓存），不包含 AI 预测（DeepSeek/豆包）和专家推荐数据。prediction-fusion.js 中仅使用 4 个独立模型适配器进行方向投票。

---

## 十、关键常量速查

| 常量 | 值 | 位置 |
|------|-----|------|
| 归一化默认值 | 50 | `normalize()` 等最小-最大区间 |
| 大球比例默认值 | 50% | `bigBallRatio` 缺失时 |
| 交锋进球默认值 | 2.5 | `headToHeadGoal` 缺失时 |
| 稳定性默认值 | 50 | `stabilityOverall` 缺失时 |
| 实力评分权重 (v1.0) | 0.3/0.2/0.3/0.2 | gd/cv/pw/ad |
| 实力评分权重 (v2.0) | 0.25/0.15/0.35/0.25 | gd/cv/pw/ad — pwScore 权重提升 |
| 进球评分权重 (v1.0) | 0.3/0.3/0.2/0.2 | bb/at/h2/bk |
| 进球评分权重 (v2.0) | 0.35/0.25/0.2/0.2 | bb/at/h2/bk — bigBallRatio 权重提升 |
| 赢盘率缩放 | /2 × 100 | 0~2 → 0~100 |
| 热度指数最优值 | 1.0 | 偏离越大扣分越多 |
| 综合分 → 星级 | /20 取整 | 0~100 → 0~5星 |
| 时效衰减半衰期 | 15/30/60/360 分钟 | odds/heat/ai/stats |
| Softmax 温度 | 0.5 | 模型权重计算 |
| 命中率缩尾 | [0.3, 0.7] | 避免极端权重 |
| 一致性阈值 | 0.3 球 | 三模型两两差值 |
| 共识强/弱/熔断 | ≥0.8 / ≥0.6 / ≤0.4 | 融合引擎加权比例 |
| xG 上限 | 4.5 | clamp 防止极端值 |
| 贝叶斯收缩强度 | 3 | shrinkBeta: n/(n+3) |
| 动态实力权重 | 0.25~2.0 | 大胜×2, 小胜×1.75, 平×0.5, 小负×0.25 |
| sigmoid 陡峭度 | 3.5 | EV 计算中的 pw→概率映射 |

---

## 十一、核心文件索引

| 文件 | 职责 |
|------|------|
| `server/pk_scorer.js` | PK 评分核心：7维评分 + 方向推荐 + EV + 风险指数 |
| `server/gongshoudao/goal.js` | xG 计算：gdQ、λ_total、进球弹性区间、稳定性 |
| `server/gongshoudao/attack.js` | 攻守分析：Adv_进攻/防守、adCombined、SPF交叉、实力阶梯 |
| `server/gongshoudao/diff.js` | 实力差：totalStrength、Beta-Binomial、四维共振 |
| `server/gongshoudao/fusion.js` | 三模型融合：ModelA/B/C、一致性判定、熔断 |
| `server/gongshoudao/model-weights.js` | 动态权重：Softmax 基于真实命中率 |
| `server/core/data-fusion.js` | 三源融合：SP隐含概率、离散度预警、亚指水位 |
| `server/core/odds-movement.js` | 盘口位移：概率偏移分析、欧亚一致性检测 |
| `server/core/league-heat-profile.js` | 联赛热度基准：Z-Score 替代固定阈值 |
| `preview/js/pages/match-pk.js` | 前端PK弹窗（旧版）：三维度横向对比 + 评分卡渲染 |
| `preview/js/pages/match-pk-fusion.js` | 前端PK弹窗（V5.0 融合版）：完整评分+方向推荐+渲染，含前端独立算法副本 |

> **排除范围说明**：`server/core/prediction-fusion.js` 和 `server/core/prediction-adapter.js` 虽在项目中存在，但其 7 模型适配器中的 DeepSeek / 豆包 / 专家共识适配器的数据**不参与 PK 模块计算**。PK 模块仅使用其中 4 个独立模型适配器（Gongshoudao / PKScorer / MarketSignal / DataFusion），不依赖 AI 或专家推荐数据。

---

## 十二、数据库 Schema — `prediction_logs` 表 PK 字段

> 位置：`server/backfill_phase1_matches.js:226-254`

### 12.1 PK 核心字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `pk_composite_score` | REAL | 综合信心分 (0~100)，主输出 |
| `pk_power_score` | REAL | 实力评分 (0~100) |
| `pk_goal_score` | REAL | 进球评分 (0~100) |
| `pk_heat_score` | REAL | 热度评分 (0~100) |
| `pk_stability_score` | REAL | 稳定性评分 (0~100) |
| `pk_health_score` | REAL | 健康评分/共识评分 (0~100) |
| `pk_direction` | TEXT | SPF 方向：'主胜'/'客胜'/'平'/'胜平双选'/... |
| `pk_direction_stars` | INTEGER | 方向星级 0~5 |
| `pk_direction_desc` | TEXT | 方向描述文本 |
| `pk_hcp_direction` | TEXT | 让球方向：'主队让球胜'/'客队让球胜' |
| `pk_goal_direction` | TEXT | 大小球方向：'大球'/'倾向大球'/'小球' |
| `pk_goal_stars` | INTEGER | 大小球星级 |
| `pk_fusion_consensus` | TEXT | 功守道共识：'strong'/'weak'/'meltdown' |
| `pk_batch_date` | TEXT | 批次日期 |

### 12.2 EV 与价值字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `pk_ev_home` | REAL | 主胜期望值 EV |
| `pk_ev_draw` | REAL | 平局期望值 EV |
| `pk_ev_away` | REAL | 客胜期望值 EV |
| `pk_value_tag` | TEXT | 价值标签：💰超值 / ✅正期望 / 📊合理 / ⚠️负期望 |
| `pk_value_score` | REAL | 价值得分 |

### 12.3 热度扩展字段

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `pk_heat_zscore` | REAL | 热度 Z-Score（联赛归一化后） |
| `pk_heat_z_overheat` | INTEGER | 是否过热标记：1=过热, 0=正常 |

### 12.4 GS 关联字段（同一表）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `gs_scores_json` | TEXT | GS 全量 JSON（功守道原始输出） |
| `gs_top_score` | TEXT | GS 最佳比分预测（如 '2:1'） |
| `gs_top_percent` | REAL | GS 最佳置信百分比 |
| `gs_ladder_label` | TEXT | 实力阶梯标签文字 |
| `gs_ladder_level` | INTEGER | 实力阶梯等级 -3~3 |
| `gs_modelA_total` | REAL | ModelA 预测总进球 |
| `gs_modelB_total` | REAL | ModelB 预测总进球 |
| `gs_modelC_total` | REAL | ModelC 预测总进球 |

### 12.5 版本追踪字段（V8.2 新增）

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `pk_scorer_version` | TEXT | PK Scorer 版本号：'pk_v1.0' / 'pk_v2.0' |
| `experiment_id` | TEXT | 实验 ID，用于 A/B 对比实验 |
| `experiment_group` | TEXT | 实验分组：'control' 对照组 / 'treatment' 实验组 |

---

## 十三、前后端算法差异对比

> **重要发现：前端 `match-pk-fusion.js` 拥有与后端 `pk_scorer.js` 几乎相同的评分算法副本！**

### 13.1 差异汇总表

| 维度 | 后端 `pk_scorer.js` | 前端 `match-pk-fusion.js` |
|------|---------------------|--------------------------|
| **综合权重 Profile** | 按 spf/handicap/overUnder 切换（4种） | **固定单一权重**：0.3/0.15/0.1/0.15/0.15/0.15 |
| **赢盘率维度** | 有（`calcWinPanScores`） | **无**（前端只有6维，无 winPan） |
| **盘口位移分析** | 调用 `odds-movement.js`（含欧亚一致性） | 仅做基础 open→live 概率偏移 |
| **离散度预警** | 调用 `data-fusion.discreteWarning()` | **无** |
| **sigmoid 陡峭度** | 3.5（EV 计算） | **6.0**（更陡峭） |
| **pDraw 公式** | `0.25 - \|pw\| × 0.25`, clamp [0.18, 0.32] | `0.25 - \|pw\| × 0.3`, clamp [0.18, 0.32] |
| **方向推荐增强** | 基础矩阵判定 | **额外增加**: 排名补偿 + SPF交叉检查 + xG一致性 + 市场一致性 |
| **进球方向** | 纯 attDefGoal 分档 | **多因子联动**: bigBallRatio×attDefGoal 矛盾检测 + 格局优先 + 实力碾压加成 |
| **min-max 归一化范围** | 当前批次内动态归一化 | 同左（行为一致） |

### 13.2 前端固定权重（`calcCompositeScore`）

```js
// match-pk-fusion.js:331-333
composite = 0.3*power + 0.15*goal + 0.1*heat(衰减) + 0.15*health + 0.15*stability(衰减) + 0.15*verify
```

对比后端的按玩法切换：

```js
// pk_scorer.js:267-272
spf:       { power:0.35, goal:0.1,  heat:0.1,  health:0.1,  stability:0.1,  verify:0.15, winPan:0.1 }
overUnder: { power:0.1,  goal:0.3,  heat:0.05, health:0.2, stability:0.15, verify:0.1,  winPan:0.1 }
handicap:  { power:0.35, goal:0.05, heat:0.05, health:0.1,  stability:0.1,  verify:0.25, winPan:0.1 }
```

### 13.3 前端独有增强功能

#### A. 相对排名补偿（P2-⑥）

```js
// match-pk-fusion.js:469-482
// 集合内 |pwScore| Top 25% 且 |pw| ≥ 0.03 → 星级 +1
absPwList.sort((a,b) => b-a);  // 降序排列
top25Idx = Math.ceil(ranked.length * 0.25) - 1;
if (Math.abs(pw) >= max(0.03, top25Pw) && stars < 5) stars += 1;
```

#### B. SPF 交叉验证（P2-⑧）

```js
// match-pk-fusion.js:485-512
// 推荐"主胜"但 crossSpfLose > crossSpfWin + 30% → 标记交叉矛盾
// 同时检查 HCP 交叉是否一致
result.crossOk = false;
result.crossDetail = 'SPF交叉矛盾（客胜XX% vs 主胜XX%）';
```

#### C. xG 一致性检查（P1-④）

```js
// match-pk-fusion.js:516-531
xgDiff = xgHome - xgAway;
if (推荐主胜 && xgDiff < -0.1) → xgOk=false, 'xg矛盾（客 > 主）'
else → xgDetail = 'xg一致 主X.X:客X.X'
```

#### D. 市场一致性校准

```js
// match-pk-fusion.js:533-553
pMarketHome = (1/homeAward) / Σ(1/sp)
if (推荐主胜 && pMarketAway > pMarketHome + 0.1) → marketConsistent=false
else → marketDetail = '市场一致(赔率:X.X/X.X/X.X)'
```

#### E. 进球方向多因子联动（`getGoalDirection`）

```
优先级链：
① 矛盾检测：bigBallRatio≥65 但 totalGoals<2.0 → 降级为"倾向小球"
② 双高确认：bbr≥70 & totalGoals≥3.0 → "大球" ⭐⭐⭐⭐
③ 双低确认：bbr≤35 & totalGoals<2.0 → "小球" ⭐⭐⭐⭐
④ 格局优先："对攻为主"+"高预期" → 大球；"防守为主"+低预期 → 小球
⑤ 单边强信号：bbr≥70 或 ≤35
⑥ 兜底：totalGoals > 3.0 → 略偏大球

特殊规则 applyDirLink：
  |pw| > 0.25 + 推荐"大球" → 星级 +1（实力碾压利好大球）
```

#### F. totalSum 进球维度综合指标（前端独有）

```js
// match-pk-fusion.js:88-94
totalSum = bigBallRatio + attDefGoal×10 + headToHeadGoal×8 + breakArmorSum×3
// 用于前端的进球维度排序和展示
```

---

## 十四、测试覆盖矩阵

> 位置：`server/tests/pk_scorer.test.js`（~280 行，~25 个用例）

### 14.1 computeAllScores 测试组

| # | 用例 | 验证点 |
|---|------|--------|
| 1 | 返回相同数组长度 | 输入N个元素 → 输出N个 |
| 2 | 每个元素包含所有7维评分属性 | powerScore, goalScore, heatScore, healthScore, stabilityScore, verificationScore, compositeScore, stars |
| 3 | 所有评分在 0~100 范围内 | min-max clamp 正确性 |
| 4 | strong 共识 → healthScore=100 | 共识直接映射正确 |
| 5 | weak 共识 → healthScore=70 | 弱一致降级正确 |
| 6 | meltdown → healthScore=20 | V2.0 降级保留最低基础分 |
| 7 | stars = round(compositeScore / 20) | 星级转换公式正确 |
| 8 | 多项目 → 不同 compositeScore | 归一化区分度 |
| 9 | 强队 → 高 powerScore | 权重方向正确性 |
| 10 | dataAge>120 → compositeScore 扣减 | 时效惩罚生效 |
| 11 | verificationDetails 数组非空 | 验证详情可追溯 |
| 12 | V9.1: discreteWarning 不影响评分 (mock none) | mock隔离正确 |
| 13 | V9.1: 盘口位移触发验证扣分 | openOdds→liveOdds 分析路径 |

### 14.2 getDirectionAdvice 测试组

| # | 用例 | 验证点 |
|---|------|--------|
| 1 | meltdown 无明确方向 → 观望/避开, 0星 | V2.0 降级阻断 |
| 2 | meltdown 有明确方向 → 2星参考 | V2.0 不完全放弃 |
| 3 | 绝对主胜优势 pw≥0.25, hi<1.4 → 5星 | 矩阵边界 |
| 4 | 绝对客胜优势 pw≤-0.25, hi<1.4 → 5星 | 对称性 |
| 5 | 过热预警 pw≥0.08, hi≥1.4 → 3星防冷 | 过热降级 |
| 6 | 实力均衡 |pw|<0.08 → 双选 | 中间态处理 |
| 7 | 返回 goalDir 和 goalStars | 多玩法输出完整性 |
| 8 | hcpDir 基于 crossHcpWin/crossHcpLose | 让球方向计算 |
| 9 | V2.0 EV: 有赔率时输出 ev 字段 | EV 计算条件分支 |
| 10 | V2.0 EV: 无赔率时 ev 为 null | 缺失数据处理 |
| 11 | V2.0 EV: 负期望值价值标签 | 价值标签分类 |

### 14.3 Mock 配置

```js
jest.mock('../core/data-fusion', () => ({
  loadBasic: jest.fn().mockReturnValue(null),
  discreteWarning: jest.fn().mockReturnValue({ flagLevel: 'none', flag: '稳定' }),
  asiaWaterChange: jest.fn().mockReturnValue({ signal: '无数据' }),
}));
```

---

## 十五、回填管道（Data Pipeline）

### 15.1 PK 数据生成流程

```
scheduler_v2.js (定时任务)
  └── case 'pk_scorer_compute':
        ├── const pk = require('./pk_scorer')
        ├── pk.computeAndSave(date)    // ★ 主入口
        │     ├── 加载当天比赛列表 (prediction_logs)
        │     ├── 加载 GS cache (gongshoudao/_global)
        │     ├── loadGSFields() 映射 28 个字段
        │     ├── computeAllScores() 7维评分
        │     ├── getDirectionAdvice() 方向推荐
        │     ├── EV 计算与价值标签
        │     └── UPDATE prediction_logs SET pk_*=?
        └── logger.info('[task] PK评分计算完成')
```

### 15.2 三阶段回填脚本

| 脚本 | 触发场景 | 功能 |
|------|---------|------|
| `backfill_pk_from_gs.js` | **历史补填**：有GS方向但无PK方向的记录 | 从 `gs_top_score` 解析方向 → 写入 `pk_direction` + `pk_composite_score` |
| `backfill_phase2_predict.js` | 批量预测阶段 | 调用 `pk_scorer` 为新比赛生成评分（PK 评分本身不使用 AI 数据） |
| `backfill_full_models.js` | 全模型批量回填 | 包含 PK 评分的完整回填流程 |
| `backfill_unified_predictions.js` | unified 表同步 | 将 `pk_direction` / `pk_composite_score` / 各子维度同步到 `unified_predictions` 表 |

### 15.3 backfill_pk_from_gs.js 详细逻辑

```js
// 位置：server/backfill_pk_from_gs.js

function scoreToDirection(score) {
  // 解析 gs_top_score 格式 "2:1"
  // h>a → '主胜', h<a → '客胜', h===a → '平'
}

// 查询条件：
//   actual_score IS NOT NULL (已完赛)
//   gs_top_score IS NOT NULL (有GS预测)
//   pk_direction IS NULL OR '' (待回填)

// 回填写入：
UPDATE prediction_logs SET
  pk_direction = ?,       // 从 gs_top_score 解析的方向
  pk_composite_score = ?  // 使用 gs_top_percent 作为替代分数
WHERE id = ?
```

### 15.4 unified_predictions 同步字段

```js
// backfill_unified_predictions.js:185-236
{
  modelName: 'pk_scorer',
  direction: row.pk_direction,
  confidence: row.pk_composite_score || 50,
  overUnder: mapOverUnder(row.pk_goal_direction),
  scores: {
    composite:  row.pk_composite_score,
    power:      row.pk_power_score,
    goal:       row.pk_goal_score,
    heat:       row.pk_heat_score,
    stability:  row.pk_stability_score,
    value:      row.pk_value_score,
  },
  ev: {
    home: row.pk_ev_home,
    draw: row.pk_ev_draw,
    away: row.pk_ev_away,
  },
  consensus: row.pk_fusion_consensus,
}
```

---

## 十六、调度与运行机制

### 16.1 定时任务配置

> 位置：`server/scheduler_v2.js:339-357`, `:542-543`

| 任务 ID | 名称 | 触发方式 | 依赖 |
|---------|------|---------|------|
| `gongshoudao_refresh` | 功守道缓存刷新 | 定时调度 | 无（先于 PK 运行） |
| `pk_scorer_compute` | PK 评分计算 | 定时调度 | **依赖 GS cache 就绪** |

### 16.2 运行日志格式（历史记录）

日志文件：`server/ai_backfill_log.txt`

```
[pk_scorer] 2026-06-04: 5/5 matches saved      ← 正常
[pk_scorer] 2026-06-03: 4/4 matches saved
[pk_scorer] 2026-05-17: 34/34 matches saved      ← 高峰日（周末）
[pk_scorer] 2026-04-01: 2/2 matches saved        ← 低谷日
```

### 16.3 前端调用时机

```
用户操作: 在比赛列表中勾选 ≥2 场比赛 → 点击"PK对比"按钮
  ↓
openPKMulti(pickedList)                    ← match-pk-fusion.js:30
  ├─ 为每场比赛补全 GS 数据（api('gongshoudao', {matchId})）
  │   ├─ 已有 hasGS && pwScore → 直接使用
  │   └─ 无 GS 数据 → 异步请求（5秒超时保护）
  ├─ 总超时保护 8 秒
  └─ renderFusionPK(modal, fullList)       ← 渲染融合PK弹窗
        ├─ computeAllScores(list)          ← ★ 前端独立评分
        ├─ 按 compositeScore 降序排列
        ├─ getDirectionAdvice(scored, ranked)  ← ★ 前端方向推荐（含增强）
        └─ HTML 渲染: 三维度表格 + 评分卡 + 方向标签
```

---

## 十七、前端渲染架构（match-pk-fusion.js V5.0）

### 17.1 文件结构概览

| 行号区间 | 函数 | 职责 |
|---------|------|------|
| 1-10 | esc(), shortTeam() | 工具函数 |
| 17-23 | normalizeConsensus() | 中文共识→英文代码 |
| 30-79 | openPKMulti() | 入口：打开多场PK弹窗 |
| 81-158 | buildGSFields() | GS数据展平为评分字段（57个字段的完整映射） |
| 164-168 | normalize() | Min-max归一化 [0,100] |
| 171-202 | calcPowerScores() | 实力评分（4因子加权） |
| 205-236 | calcGoalScores() | 进球评分（4因子加权） |
| 239-247 | calcHeatScores() | 热度评分（指数惩罚） |
| 250-259 | calcHealthScores() | 健康评分（共识映射） |
| 262-267 | calcStabilityScores() | 稳定性评分 |
| 270-320 | calcVerificationScores() | 交叉验证扣分制 |
| 323-328 | calcAgeWeight() | 时效衰减权重 |
| 331-384 | computeAllScores() | **主评分函数**：组装全部维度 |
| 391-593 | getDirectionAdvice() | **主方向推荐**：含排名补偿/交叉/xG/市场/EV |
| 596-689 | getGoalDirection() | 大小球方向（多因子联动） |
| 692-694 | starStr() | 星级字符串生成 |
| 696+ | renderFusionPK() | **主渲染函数**：HTML生成 |

### 17.2 渲染输出结构

```
┌────────────────────────────────────────────────────┐
│  ⚔️ 三维度融合分析 — N场比赛                        │
├────────────────────────────────────────────────────┤
│  [表头行] 排名 | 比赛 | 实力 | 进球 | 热度 | 综合   │
│  [第1行]  🥇 | 主vs客 | 85 | 78 | 72 | ⭐⭐⭐⭐ 82分│
│  [第2行]  🥈 | A vs B  | 70 | 65 | 80 | ⭐⭐⭐  71分│
│  ...                                               │
├────────────────────────────────────────────────────┤
│  [焦点比赛展开]                                     │
│  ┌──────────┬──────────┬──────────┬──────────┐     │
│  │ 6维雷达图 │ 方向推荐卡 │ 进球方向卡 │ EV/价值  │     │
│  │          │ 主胜 ⭐⭐⭐⭐│ 大球 ⭐⭐⭐ │ ✅正期望 │     │
│  │          │ 防冷预警  │ 对攻格局  │ EV:+0.08 │     │
│  └──────────┴──────────┴──────────┴──────────┘     │
│  交叉验证: ✅xG一致 ✅SPF一致 ✅市场一致            │
│  风险提示: (verificationDetails 展开)              │
└────────────────────────────────────────────────────┘
```

### 17.3 方向推荐返回的完整对象结构

```js
{
  dir: '主胜',              // 方向文字
  stars: 4,                 // 星级 0~5
  cls: 'dir-home',          // CSS 类名
  desc: '明显优势；相对排名补偿',  // 描述（可多条拼接）
  weak: false,              // 是否弱一致
  xgOk: true,               // xG 一致性
  xgDetail: 'xg一致 主1.5:客0.8',
  crossOk: true,            // SPF/HCP 交叉一致性
  crossDetail: '',           // 交叉详情
  marketConsistent: true,   // 市场一致性
  marketDetail: '市场一致(赔率:1.80/3.50/4.20)',
  ev: {                     // EV 对象（有赔率时）
    evHome: 0.082,
    evDraw: -0.120,
    evAway: -0.364,
    pWin: 0.5834,
    pDraw: 0.2200,
    pAway: 0.1966,
  },
  valueTag: '✅正期望',     // 价值标签
}
```

---

## 十八、回测中的 PK 使用方式

> 位置：`backtesting-frameworks` Skill + `preview/js/pages/backtest.js`

### 18.1 回测命中判定

```js
// backtest.js:954-960
if (row.pk_direction) {
  var isPK = source === 'pk';
  if (isPK && row.pk_direction_stars) extra = ' ' + '★'.repeat(row.pk_direction_stars);
  if (isPK && row.pk_composite_score) extra += ' ' + Math.round(row.pk_composite_score) + '分';
  // 命中判断:
  (row.pk_hit ? 'pred-hit ✓' : 'pred-miss ✕') + row.pk_direction
}
```

### 18.2 回测统计口径

| 统计量 | 来源字段 |
|--------|---------|
| 命中数 | `pk_direction === actual_spf` |
| 置信度排序 | `pk_composite_score DESC` |
| 分层命中率 | 按 `pk_direction_stars` (1~5星) 分桶 |
| EV 校验 | `pk_ev_home/ev_draw/ev_away` vs 实际回报 |

---

## 十九、部署注意事项

### 19.1 必须同步上传的文件

| 文件 | 目标路径 | 更新频率 |
|------|---------|---------|
| `server/pk_scorer.js` | `/root/server/pk_scorer.js` | 算法变更时 |
| `preview/js/pages/match-pk-fusion.js` | `/var/www/zj.100qiu.com/preview/js/pages/match-pk-fusion.js` | UI 变更时 |
| `preview/js/pages/match-pk.js` | `/var/www/zj.100qiu.com/preview/js/pages/match-pk.js` | UI 变更时 |
| `preview/css/modals.css` | `/var/www/zj.100qiu.com/preview/css/modals.css` | 样式变更时 |

### 19.2 依赖链

```
pk_scorer.js 依赖:
  ├── gongshoudao/ (goal.js, attack.js, diff.js, fusion.js, model-weights.js)
  ├── core/data-fusion.js (离散度、亚指水位)
  ├── core/odds-movement.js (盘口位移、欧亚一致性)
  └── database.js (读写 prediction_logs)

match-pk-fusion.js 前端依赖:
  ├── api('gongshoudao', {matchId}) ← server/index.js gongshoudao API
  └── 无外部 JS 依赖（纯自包含算法）
```

---

## 二十、调整 PK 模块时的修改清单

当你需要调整 PK 模块的某项指标时，以下是需要同时修改的位置：

### 20.1 只改评分权重

| 修改位置 | 文件 |
|---------|------|
| 后端权重 Profile | `server/pk_scorer.js` :267-272 (`SCORE_PROFILES`) |
| 后端综合公式 | `server/pk_scorer.js` :274-287 (`calcCompositeScore`) |
| 前端权重（固定） | `preview/js/pages/match-pk-fusion.js` :331-333 (`calcCompositeScore`) |
| **注意**：前端是独立副本，必须同步修改！否则前后端分数不一致 |

### 20.2 只改方向判定阈值

| 修改位置 | 文件 |
|---------|------|
| 后端矩阵 | `server/pk_scorer.js` :335-483 (`getDirectionAdvice`) |
| 前端矩阵 | `preview/js/pages/match-pk-fusion.js` :391-593 (`getDirectionAdvice`) |
| **注意**：前端有额外增强逻辑（排名补偿、交叉验证），需评估影响 |

### 20.3 改 GDQ / xG 底层算法

| 修改位置 | 文件 | 影响范围 |
|---------|------|---------|
| xG 计算 | `server/gongshoudao/goal.js` | gdQ、attDefGoal、fusionFinalHome/Away → 全链路 |
| 攻守实力 | `server/gongshoudao/attack.js` | adCombined、crossSpf/Hcp、ladderLevel |
| 综合实力 | `server/gongshoudao/diff.js` | pwScore、totalStrength |
| 一致性判定 | `server/gongshoudao/fusion.js` | fusionConsensus → healthScore |

### 20.4 新增评分维度

需要修改 **至少 6 处**：

1. `server/pk_scorer.js`: 新增 `calcXXXScores()` 函数
2. `server/pk_scorer.js`: `computeAllScores()` 中调用新函数
3. `server/pk_scorer.js`: `SCORE_PROFILES` 新增权重
4. `server/pk_scorer.js`: `loadGSFields()` 新增字段映射
5. `preview/js/pages/match-pk-fusion.js`: 同步上述 1-4（前端副本）
6. `server/backfill_phase1_matches.js`: `prediction_logs` 表新增列（如需持久化）
7. `server/tests/pk_scorer.test.js`: 新增测试用例

---

## 二十一、版本与实验管理系统

> 新增于 V8.2（2026-06-09）

### 21.1 版本管理常量

在 `server/pk_scorer.js` 顶部定义：

```js
const PK_SCORER_VERSION = 'pk_v2.0';   // 版本号，修改算法时手动递增
const PK_SCORER_HASH = '';             // 可选：Git commit hash（CI 自动计算）
const EXPERIMENT_ID = '';              // 实验 ID（空 = 非实验模式）
const EXPERIMENT_GROUP = '';           // 'control' 或 'treatment'
```

### 21.2 写入流程

每次 `computeAndSave()` 调用时，版本号随每条记录写入 `prediction_logs` 表：

```
computeAndSave(date)
  └─ predictionLog.upsertPK(matchId, {
       ...,                          // 所有评分字段
       pkScorerVersion: PK_SCORER_VERSION,  // ★ 版本标记
       experimentId: EXPERIMENT_ID,
       experimentGroup: EXPERIMENT_GROUP,
     })
```

### 21.3 版本对比 API

```http
POST /api
Content-Type: application/json

{ "action": "pk-version-compare", "versions": ["pk_v1.0", "pk_v2.0"] }
```

**返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `currentVersion` | TEXT | 当前代码的 PK_SCORER_VERSION |
| `versions` | TEXT[] | 查询的版本列表 |
| `stats[version]` | Object | 每个版本的统计：total, hits, hitRate, goalHitRate, byLeague, byStars |
| `comparison[]` | Object[] | 版本对比列表，按版本分组 |
| `diff` | Object | 版本间差异分析：hitRateDiff, goalHitRateDiff, direction |

**示例响应：**

```json
{
  "code": 1,
  "data": {
    "versions": ["pk_v1.0", "pk_v2.0"],
    "stats": {
      "pk_v1.0": { "total": 200, "hits": 110, "hitRate": 0.55, "byLeague": [...] },
      "pk_v2.0": { "total": 85, "hits": 52, "hitRate": 0.6118, "byLeague": [...] }
    },
    "comparison": [
      { "version": "pk_v1.0", "stats": { ... } },
      { "version": "pk_v2.0", "stats": { ... } }
    ],
    "diff": {
      "pk_v2.0_vs_pk_v1.0": {
        "hitRateDiff": "+6.18%",
        "goalHitRateDiff": "+2.3%",
        "direction": "✅ 优化有效"
      }
    }
  },
  "currentVersion": "pk_v2.0"
}
```

### 21.4 实验工作流

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 冻结 v1.0    │────>│ 全量回填标记  │────>│ 修改算法     │
│ VERSION=     │     │ --phase=3   │     │ VERSION=     │
│ pk_v1.0      │     │              │     │ pk_v2.0      │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ 全量切换     │<────│ 命中率提升?   │<────│ API 对比查询  │
│ 清除EXP标记 │     │              │     │ version-     │
└──────────────┘     └──────┬───────┘     │ compare      │
                            │              └──────────────┘
                            ▼
                     ┌──────────────┐
                     │ 回滚到 v1.0  │
                     └──────────────┘
```

---

## 二十二、修改影响范围地图

当你修改 PK 模块的某处代码时，可用此表快速评估影响范围：

### 22.1 参数修改影响矩阵

| 修改位置 | 影响输出 | 影响程度 | 需要同步的前端文件 |
|---------|---------|:-------:|------------------|
| `SCORE_PROFILES` 权重 | compositeScore / stars / 排名 | ★★★ | `match-pk-fusion.js` calcCompositeScore 固定权重 |
| `calcPowerScores` 公式 | powerScore / compositeScore | ★★★★ | `match-pk-fusion.js` calcPowerScores |
| `calcGoalScores` 公式 | goalScore / compositeScore | ★★★ | `match-pk-fusion.js` calcGoalScores |
| `getDirectionAdvice` 阈值 | direction / stars / desc | ★★★★★ | `match-pk-fusion.js` getDirectionAdvice（含增强逻辑） |
| `calcVerificationScores` 扣分 | verificationScore / compositeScore / 风险提示 | ★★ | `match-pk-fusion.js` calcVerificationScores |
| `calcHeatScores` 指数 | heatScore / compositeScore | ★ | `match-pk-fusion.js` calcHeatScores |
| `calcHealthScores` 映射 | healthScore / compositeScore | ★ | `match-pk-fusion.js` calcHealthScores |
| `_loadGSFields` 字段映射 | 所有 7 维评分 | ★★★★★ | `match-pk-fusion.js` buildGSFields |
| `computeAndSave` 写入逻辑 | prediction_logs 存储 | ★ | 无（纯后端） |
| EV 公式 (sigmoid / pDraw) | ev 值 / valueTag / valueScore | ★★ | `match-pk-fusion.js` EV 计算（有差异） |
| 新增玩法 profile | 该玩法下的综合分 | ★★★ | 前端不支持按玩法切换权重 |

### 22.2 新增评分维度检查清单

1. `server/pk_scorer.js`: 新增 `calcXXXScores()` 函数
2. `server/pk_scorer.js`: `computeAllScores()` 中调用新函数
3. `server/pk_scorer.js`: `SCORE_PROFILES` 新增权重
4. `server/pk_scorer.js`: `loadGSFields()` 新增字段映射
5. `server/prediction_log.js`: `initTable()` 新增 ALTER TABLE 列
6. `server/prediction_log.js`: `upsertPK()` 新增字段传递
7. `preview/js/pages/match-pk-fusion.js`: 同步上述 1-4（前端副本）
8. `server/tests/pk_scorer.test.js`: 新增测试用例

### 22.3 参数敏感性参考

| 参数 | 调整幅度 | 综合分变化 | 命中率预估影响 | 建议 |
|------|:-------:|:---------:|:------------:|:----:|
| pwScore 权重 ±0.05 | 中等 | ±1.5~3 分 | 显著 | **优先调参对象** |
| crossValue 权重 ±0.05 | 中等 | ±1~2 分 | 中等 | 次要调参 |
| bigBallRatio 权重 ±0.05 | 中等 | ±1~2 分 | 中等（大小球） | 大小球场景优先 |
| verification 扣分值 ±5 | 小 | ±0~5 分/少数比赛 | 弱 | 仅极端比赛有感 |
| heatScore 指数 1.5→2.0 | 大 | - | 弱 | 谨慎调整 |
| consensus 奖励 +3 | 小 | +3 分/strong 比赛 | 弱 | 仅约 30% 比赛 |
| 时效衰减半衰期 ×2 | 大 | - | 弱（仅老数据） | 很少需要改 |

---

## 二十三、常见陷阱与修改模式

> 从开发历史中提炼的真实踩坑经验，每次踩新坑后请在此追加记录。

### 陷阱 1：修改后端权重不修改前端 → 前后端分数不一致

**症状**：`match-pk-fusion.js` 的 `calcCompositeScore` 使用**固定权重** `(0.3/0.15/0.1/0.15/0.15/0.15)`，后端按玩法切换权重。修改 `SCORE_PROFILES` 后，前端弹窗评分仍然用旧值。

**解决**：同步修改前端 `match-pk-fusion.js:331-333` 的 `calcCompositeScore()`。  
**检查方式**：用同一批 mock 数据分别跑后端 `pk_scorer.computeAllScores()` 和前端 `calcCompositeScore`，对比输出。

### 陷阱 2：新增字段映射但 GS Cache key 名不对 → 静默降级

**症状**：在 `loadGSFields()` 中新增字段映射 `gs.newField`，但服务器上的 GS Cache 实际 key 是 `gs.newField2` 或该字段缺失 → 评分降到默认值（0 或 50），无任何错误提示。

**解决**：部署后执行批量验证脚本，检查 default 值比例：
```sql
SELECT pk_scorer_version, COUNT(*) AS total,
  SUM(CASE WHEN pk_power_score = 50 THEN 1 ELSE 0 END) AS defaults
FROM prediction_logs
GROUP BY pk_scorer_version;
```

### 陷阱 3：前端有增强逻辑 → 后端改了方向但前端不匹配

**症状**：后端 `getDirectionAdvice` 改了阈值，但前端额外有：
- 相对排名补偿（Top 25% → 星级 +1）
- SPF 交叉验证（影响方向描述）
- xG 一致性检查（影响描述）
- 市场一致性校准（影响描述）

这些增强逻辑在后端不存在，导致前后端方向描述不一样。

**解决**：
1. 先确定是"只改后端评分"还是"前后端一致"
2. 如果改方向判定阈值，必须同时改前端 `match-pk-fusion.js:391-593`
3. 如果在后端新增方向判定逻辑，也要评估前端是否需要同步

### 陷阱 4：`crossValue` 不是直接字段，是 4 个字段合成

**症状**：`crossValue` 不是从 GS Cache 直接读取，而是通过 `hWins + aLosses - hLosses - aWins` 计算。如果 GS 缓存的这四个字段任何一个是 `undefined`，crossValue 就为 0。

**解决**：始终检查 `loadGSFields()` 中的合成字段计算逻辑，每个子字段用 `|| 0` 兜底。

### 陷阱 5：`num` 字段可能是空字符串

**症状**：某些比赛的 `num` 字段为空字符串。在排序或匹配时可能导致问题。

**解决**：始终用 `String(m.num || '')` 包裹，不要依赖数字类型。

### 陷阱 6：`computeAndSave` 依赖 `data.json` 必须是最新

**症状**：`computeAndSave()` 不在任何处加锁，如果刚好在 `data.json` 被重写时调用，可能读到半写状态。

**解决**：`data.json` 写入时使用原子写入（`atomicWrite`），`computeAndSave` 读取时不会读到残缺文件。

### 陷阱 7：数据库列不存在则写入静默失败

**症状**：`upsertPK()` 使用 `UPDATE ... SET pk_xxx = ?`，如果 `pk_xxx` 列不存在，SQLite 抛出错误被 `try/catch` 吃掉。

**解决**：
1. 建表/加列在 `initTable()` 中用 ALTER TABLE 统一处理
2. 修改 `upsertPK()` 新增字段时，必须先确保 `initTable()` 中有对应的 `_addColumnIfMissing` 调用
3. 新增字段后运行 `node server/backfill_full_models.js --phase=3` 对所有历史记录补填

---

## 二十四、调试指南

### 24.1 CLI 快速验证

```bash
# 查看当前版本
node server/pk_scorer.js --version

# 指定日期执行 PK 评分（不依赖 scheduler）
node -e "
  const pk = require('./server/pk_scorer');
  pk.computeAndSave('2026-06-09').then(r => console.log(r));
"

# 单场比赛评分（mock 数据）
node -e "
  const pk = require('./server/pk_scorer');
  const mockList = [{
    gdScore: 0.85, crossValue: 0.32, pwScore: 0.56, adCombined: 0.41,
    bigBallRatio: 68, attDefGoal: 3.2, headToHeadGoal: 2.8, breakArmor: 1.5,
    heatIndex: 1.12, fusionConsensus: 'strong', dataAge: 45,
    stabilityOverall: 72, homeWinPan: 1.2, awayWinPan: 0.8,
    ladderLevel: 2, strengthGoal: 1.8, homeWinAward: 1.85, awayWinAward: 3.80,
    drawAward: 3.40, openHomeAward: 1.90, openDrawAward: 3.30, openAwayAward: 3.60,
    leagueName: '英超', handicap: 0.5, rq: 0.5,
    leagueOverBaseline: 58,
  }];
  const scored = pk.computeAllScores(mockList);
  const adv = pk.getDirectionAdvice(scored[0], scored);
  console.log('score:', scored[0]);
  console.log('direction:', adv);
"
```

### 24.2 API 版本对比

```bash
# 对比 v1.0 vs v2.0
curl -X POST http://localhost:3000/api ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"pk-version-compare\",\"versions\":[\"pk_v1.0\",\"pk_v2.0\"]}"

# 自动发现版本
curl -X POST http://localhost:3000/api ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"pk-version-compare\"}"

# 按时间范围过滤
curl -X POST http://localhost:3000/api ^
  -H "Content-Type: application/json" ^
  -d "{\"action\":\"pk-version-compare\",\"versions\":[\"pk_v1.0\"],\"dateRange\":\"30d\"}"
```

### 24.3 回填历史数据并标记版本

```bash
# Dry-run 查看计划
node server/backfill_full_models.js --dry --phase=3

# 正式回填（自动写入 pk_scorer_version=pk_v2.0）
node server/backfill_full_models.js --phase=3
```

### 24.4 SQL 直接查询

```sql
-- 各版本命中率概览
SELECT pk_scorer_version,
  COUNT(*) AS total,
  SUM(CASE WHEN pk_direction = actual_spf THEN 1 ELSE 0 END) AS hits,
  ROUND(100.0 * SUM(CASE WHEN pk_direction = actual_spf THEN 1 ELSE 0 END) / COUNT(*), 2) AS hit_rate
FROM prediction_logs
WHERE actual_spf IS NOT NULL AND pk_scorer_version IS NOT NULL
GROUP BY pk_scorer_version;

-- 按版本+联赛细分
SELECT pk_scorer_version, leagueName,
  COUNT(*) AS total,
  ROUND(100.0 * SUM(CASE WHEN pk_direction = actual_spf THEN 1 ELSE 0 END) / COUNT(*), 2) AS hit_rate
FROM prediction_logs
WHERE actual_spf IS NOT NULL AND pk_scorer_version IS NOT NULL
GROUP BY pk_scorer_version, leagueName
ORDER BY total DESC;

-- 检查版本标记覆盖情况
SELECT pk_scorer_version, COUNT(*) AS cnt
FROM prediction_logs
GROUP BY pk_scorer_version;

-- 检查未标记版本（旧数据）
SELECT COUNT(*) AS unmared
FROM prediction_logs
WHERE pk_scorer_version IS NULL OR pk_scorer_version = '';
```

### 24.5 修改后验证清单

修改算法后，依次执行以下验证（从 L1 到 L5）：

```
□ L1: node server/pk_scorer.js --version
     → 确认版本号符合预期

□ L2: node server/backfill_full_models.js --dry --phase=3
     → 模拟回填无报错

□ L3: API 对比查询
     → 新版本数据已正确标记

□ L4: 查看回测页面
     → 新版本命中率数据可正常显示

□ L5: 前端 PK 弹窗
     → 打开比赛列表→勾选≥2场→PK对比→评分显示正常
```

---

## 附录A：版本变更日志

| 版本 | 日期 | 详细变更 | 代码变更文件 |
|------|------|---------|------------|
| **pk_v2.0** | 2026-06-09 | **实力评分权重优化**：pwScore 0.3→0.35, gdScore 0.3→0.25, crossValue 0.2→0.15, adCombined 0.2→0.25 | `pk_scorer.js` calcPowerScores |
| | | **进球评分权重优化**：bigBallRatio 0.3→0.35, attDefGoal 0.3→0.25 | `pk_scorer.js` calcGoalScores |
| | | **共识奖励**：strong 共识 + 验证分 ≥85 → compositeScore +3 | `pk_scorer.js` computeAllScores |
| | | **版本追踪系统**：新增 `pk_scorer_version` / `experiment_id` / `experiment_group` 字段 | `pk_scorer.js`, `prediction_log.js`, `index.js`, `backfill_full_models.js` |
| | | **版本对比 API**：`POST /api { action: 'pk-version-compare' }` | `index.js`, `prediction_log.js` queryPKVersionCompare |
| **pk_v1.0** | 初始版 | 原始 7 维评分算法、4 因子加权归一化、方向判定矩阵 | 基线 |
