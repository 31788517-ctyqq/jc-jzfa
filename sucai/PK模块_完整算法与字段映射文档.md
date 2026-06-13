# PK 模块 — 完整算法与字段映射文档

> 生成时间：2026-06-09  
> 最后更新：2026-06-13（V2.3 开发落地蓝本整理 + V2.2 对比融合方案 + 回测分析/模型仪表盘/首页最小增强 + V2.1 算法优化草案）  
> 源码版本：refactor/phase8-atomic-write  
> 覆盖范围：`server/pk_scorer.js`、`server/gongshoudao/`、`server/core/`、`server/data_sync.js`、`preview/js/pages/home.js`、`preview/js/pages/match-pk.js`、`preview/js/pages/match-pk-fusion.js`、`preview/js/pages/quant-rank-fusion.js`、`preview/js/pages/backtest.js`、`preview/js/pages/model-dashboard.js`  
> **设计原则**：PK 核心评分与方向判定保持独立计算能力，不把 AI 预测（DeepSeek/豆包）或专家推荐/共识数据作为必需依赖。基础评分仍基于功守道自算 + 市场信号 + 数据融合；V2.2 对比融合仅在裁判展示、风控降级与赛后复盘层引用外部信号。本文档阶段只定义算法、量化维度、数据口径、权重、验证门禁与页面展示方案，不写代码。开发落地时优先阅读“二十九、开发落地蓝本与任务拆分”。

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
- [二十五、PK v2.1 准确率提升优化方案](#二十五pk-v21-准确率提升优化方案)
- [二十六、量化排行榜与 PK 弹窗页面优化方案](#二十六量化排行榜与-pk-弹窗页面优化方案仅文档规划暂不写代码)
- [二十七、与专家共识、功守道、AI预测分析的对比融合方案](#二十七与专家共识功守道ai预测分析的对比融合方案)
- [二十八、回测分析页、模型表现仪表盘与首页核心文案规划](#二十八回测分析页模型表现仪表盘与首页核心文案规划)
- [二十九、开发落地蓝本与任务拆分](#二十九开发落地蓝本与任务拆分)
- [附录A：版本变更日志](#附录a版本变更日志)

---

## 版本变更日志

| 版本 | 日期 | 变更内容 | 影响范围 |
|------|------|---------|---------|
| **pk_v2.3-dev-blueprint-doc** | 2026-06-13 | 整理开发落地蓝本：补充实施边界、模块任务拆分、数据契约、页面验收、测试门禁、风险回滚与开发顺序 | 文档方案；暂不改代码，作为后续开发排期与验收蓝本 |
| **pk_v2.2-page-copy-doc** | 2026-06-13 | 新增回测分析页、模型表现仪表盘与首页最小增强的产品文案规划：明确页面定位、首页轻量摘要、保留“最多推荐/最热场次”、筛选项、图表口径、明细复盘口径与落地优先级 | 文档方案；暂不改代码，作为后续页面改造与验收依据 |
| **pk_v2.2-fusion-doc** | 2026-06-13 | 新增与专家共识、功守道、AI预测分析的对比融合方案：明确 PK 作为量化决策中枢/裁判层，定义模块定位、融合合同、分歧裁判、EV价值判断、页面呈现与回测闭环 | 文档方案；暂不改代码，作为后续融合展示与回测追踪依据 |
| **pk_v2.1-page-doc** | 2026-06-13 | 新增量化排行榜与 PK 弹窗页面优化方案：页面定位、展示字段、数据合同、页签重构、风控解释与实施优先级 | 文档方案；暂不改代码，作为前端页面改造依据 |
| **pk_v2.1-doc** | 2026-06-13 | 新增准确率提升优化方案：维度重构、权重建议、数据质量门禁、概率校准、Walk-Forward 验证与灰度策略 | 文档方案；暂不改代码，作为下一轮实现与回测依据 |
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

## 二十五、PK v2.1 准确率提升优化方案

> 本章是基于当前文档、`server/pk_scorer.js`、`preview/js/pages/match-pk-fusion.js`、`server/core/data-fusion.js`、`server/core/odds-movement.js`、`server/core/league-heat-profile.js`、`server/gongshoudao/model-weights.js` 与本地 `midou_data.db` 审计结果形成的下一版算法优化方案。目标是先把算法设计、数据口径、权重、验证门禁写清楚，后续再按本章拆分实现。

### 25.1 当前实际情况与主要准确率风险

#### 25.1.1 本地历史数据审计结论

对 `server/midou_data.db` 的只读审计显示：

| 指标 | 当前结果 | 解释 |
|------|---------:|------|
| `prediction_logs` 总记录 | 8157 | 本地历史预测记录规模 |
| 有 `actual_spf` 且有 `pk_direction` 样本 | 8131 | 可用于粗略统计 PK SPF 命中 |
| 粗略复合方向命中 | 2641 / 8131 = **32.48%** | 含历史旧口径、回填数据、无版本区分，不能代表 `pk_v2.0` 真实性能 |
| `pk_scorer_version` 为空记录 | 8151 | 版本追踪基本未覆盖历史样本 |
| 有星级样本 | 21 | 星级校准样本严重不足 |
| `pk_fusion_consensus` 有效样本 | 近似 0 | 共识分层无法从当前本地库验证 |

**结论**：当前本地库不能直接用于证明 `pk_v2.0` 优化有效或无效。下一步优化前必须先完成“版本化重算 + 特征快照 + OOS 回测”，否则容易把旧回填数据、GS 方向替代数据、真实 PK 评分数据混在一起，导致调参方向错误。

#### 25.1.2 代码与文档口径差异

| 风险点 | 项目实际情况 | 对准确率/可信度的影响 | V2.1 处理方向 |
|--------|--------------|----------------------|----------------|
| 后端权重 Profile 未显式传入玩法 | `computeAllScores()` 调用 `calcCompositeScore(..., playType)`，但 `computeAndSave()` 当前未传 `playType`，实际落到 `default` 权重 | `spf`、`handicap`、`overUnder` 的设计权重可能未在持久化 PK 中生效 | 明确：SPF 持久化必须使用 `spf` Profile；大小球、让球分别走独立 Profile |
| 前端仍是旧权重副本 | `match-pk-fusion.js` 使用 `0.3/0.15/0.1/0.15/0.15/0.15`，无 `winPan` 维度 | 前端弹窗评分与后端入库评分可能不一致，用户看到的排序与回测口径不同 | 前后端只保留一个权重真源，前端优先消费后端评分；如保留本地计算，必须同步 Profile |
| 前端热度阈值仍有固定 `1.4/0.85` 逻辑 | 后端使用 `league-heat-profile.js` 联赛 Z-Score，前端方向仍大量使用固定阈值 | 同一场比赛可能后端“不热”、前端“过热防冷” | 热度统一改为 `heatZ`，固定 HI 阈值只作为兜底 |
| EV 概率映射前后端不同 | 后端 sigmoid 陡峭度 `3.5` 且重映射到 `[0.33, ~0.80]`；前端仍使用 `6.0` | 前端 EV 更激进，可能误导“超值/正期望” | EV 只使用经回测校准后的概率，前后端公式必须一致 |
| `winPan` 尺度不统一 | 注释假设 `0~2`，测试中出现 `65` 这类百分制值，GS/JczqBasic 来源也可能不同 | `calcWinPanScores()` 可能大量 clamp 到 100，降低区分度 | 增加尺度归一化：自动识别 `0~2`、`0~100`、`0~1` 三类输入 |
| `crossSpfWin/Lose` 尺度不统一 | 后端 HCP 用 `+0.05` 阈值，前端 SPF 检查用 `>30` | 同一字段可能被当成比例或百分比 | 统一存储为 `0~1`，展示时乘 100；输入侧做兼容转换 |
| 历史回填混入替代口径 | `backfill_pk_from_gs.js` 可从 `gs_top_score` 解析 `pk_direction` | 这不是 PK 评分模型真实输出，会污染版本回测 | 回测训练集必须排除 `source=gs_backfill` 或补充 `pk_source` 字段标识 |
| 市场信号混在验证扣分中 | 离散度、盘口位移、欧亚一致性都在 `verificationScore` 内体现 | 市场维度权重不可单独校准，难以知道是模型问题还是市场修正问题 | V2.1 拆出 `marketScore`，验证分只做一致性/风控 |

### 25.2 V2.1 优化目标

1. **从“相对排名分”升级为“可校准概率”**：当前 min-max 归一化依赖同批次比赛，适合排序但不稳定。V2.1 要将 SPF、让球、大小球分别输出可回测校准的概率。
2. **从“一个综合分包打天下”升级为“玩法独立目标函数”**：SPF 看方向，HCP 看穿盘，OU 看总进球，三者不可共用同一套主权重。
3. **从“字段可用即参与”升级为“字段可靠才参与”**：每个字段必须有覆盖率、时效、尺度、来源标识，低质量字段自动降权。
4. **从“经验阈值”升级为“回测约束下的保守阈值”**：所有阈值必须通过 Walk-Forward、分联赛、分星级校准验证。
5. **继续保持 PK 独立性**：不引入 AI 预测、专家推荐、专家共识；但可使用市场赔率、盘口、冷热、JczqBasic、GS 自算数据。

### 25.3 维度重构：从 7 维扩展为 8 维目标架构

#### 25.3.1 V2.1 目标维度

| 维度 | 字段/来源 | 目标 | 主要用途 |
|------|----------|------|----------|
| `powerScore` | `gdQ`、`totalStrength`、`adWeightedComposite`、`crossSpfEdge` | 真实实力差 | SPF / HCP 主方向 |
| `goalScore` | `attDefGoal`、`fusionFinalTotal`、`bigBallRatio`、`h2hGoalAvg`、`leagueAvgGoals` | 总进球环境 | OU 主方向，SPF 辅助 |
| `marketScore` | SP 隐含概率、盘口位移、欧亚一致、亚指水位、离散度 | 市场验证 | 修正方向与风险 |
| `heatScore` | `heatIndex` + 联赛 Z-Score | 热度风险 | 防过热、防冷门 |
| `healthScore` | `fusionConsensus` + 连续共识分 `consensusScore` | 模型一致性 | 降级/熔断 |
| `stabilityScore` | 进球/失球熵、模型波动、历史方差 | 数据稳定性 | 置信度校准 |
| `winPanScore` | 主客赢盘率差、外源赢盘率融合 | 盘口适配 | HCP 辅助 |
| `dataQualityScore` | 覆盖率、时效、来源、尺度有效性 | 数据可信度 | 所有玩法的总门禁 |

#### 25.3.2 旧维度迁移关系

| 旧维度 | V2.1 去向 | 说明 |
|--------|-----------|------|
| 实力评分 | 保留并增强 | 加入 `crossSpfEdge = crossSpfWin - crossSpfLose`，减少单纯 min-max 放大 |
| 进球评分 | 保留并增强 | `attDefGoal` 异常时优先切 `fusionFinalTotal`，并引入大小球盘口偏差 |
| 热度评分 | 保留但改为联赛 Z-Score | 不再用 `abs(1-HI)` 作为唯一评分 |
| 健康评分 | 保留但从离散档改连续分 | `strong/weak/meltdown` 仍保留，新增 `consensusScore` 连续校准 |
| 稳定性评分 | 保留 | 从展示分升级为概率校准折扣项 |
| 赢盘率评分 | 保留但先做尺度归一 | 使用 `homeWinPan - awayWinPan`，而不是只看主队值 |
| 验证评分 | 拆分 | 市场类信号进入 `marketScore`，一致性冲突保留在 `verificationScore` 或并入 `dataQualityScore` |

### 25.4 推荐权重设置

#### 25.4.1 短期 V2.1（不新增数据库列时）的 7 维权重

在不改表结构的前提下，先用现有 7 维完成权重修正。核心思想：SPF 降低进球权重、提升验证权重；OU 提升进球与健康权重；HCP 提升验证和赢盘权重。

| Profile | power | goal | heat | health | stability | verify | winPan | 合计 |
|---------|------:|-----:|-----:|-------:|----------:|-------:|-------:|-----:|
| `spf_v2_1` | 0.38 | 0.05 | 0.08 | 0.10 | 0.09 | 0.20 | 0.10 | 1.00 |
| `handicap_v2_1` | 0.30 | 0.05 | 0.05 | 0.10 | 0.10 | 0.28 | 0.12 | 1.00 |
| `overUnder_v2_1` | 0.05 | 0.38 | 0.05 | 0.18 | 0.14 | 0.10 | 0.10 | 1.00 |
| `default_v2_1` | 0.25 | 0.15 | 0.08 | 0.14 | 0.10 | 0.18 | 0.10 | 1.00 |

**说明**：

- `spf_v2_1`：方向判断主要依赖实力和验证，不应让大小球特征过多影响胜平负。
- `handicap_v2_1`：让球盘更容易被盘口陷阱影响，因此 `verify + winPan` 合计提高到 40%。
- `overUnder_v2_1`：大小球应以 `goalScore + health + stability` 为核心，`power` 仅在强弱悬殊时作为大球辅助。
- `default_v2_1`：仅用于未知玩法兜底，正式入库不可依赖 default。

#### 25.4.2 中期 V2.1（新增 `marketScore/dataQualityScore` 后）的 8 维权重

| Profile | power | goal | market | heat | health | stability | winPan | dataQuality | 合计 |
|---------|------:|-----:|-------:|-----:|-------:|----------:|-------:|------------:|-----:|
| SPF | 0.30 | 0.03 | 0.20 | 0.07 | 0.10 | 0.08 | 0.07 | 0.15 | 1.00 |
| HCP | 0.28 | 0.03 | 0.18 | 0.04 | 0.08 | 0.08 | 0.14 | 0.17 | 1.00 |
| OU | 0.05 | 0.36 | 0.14 | 0.05 | 0.16 | 0.12 | 0.02 | 0.10 | 1.00 |

**关键原则**：

1. `marketScore` 不能只做扣分，应输出方向性：市场支持主、市场支持客、市场分歧、市场诱热。
2. `dataQualityScore` 不直接代表强弱，而是决定最终置信度上限。例如数据质量 60 分时，五星上限应降为三星。
3. `goalScore` 对 SPF 只保留 3% 权重，避免“大球强”误推“主胜强”。

### 25.5 子算法优化细则

#### 25.5.1 归一化：从批次 min-max 改为稳健归一

当前 `normalize(val, min, max)` 依赖当前勾选批次或当天批次，存在两个问题：

1. 只选 2 场时容易把一个字段强行拉成 0/100；
2. 不同日期的综合分不可比，影响回测校准。

V2.1 建议采用三层归一：

| 层级 | 方法 | 适用场景 |
|------|------|----------|
| 字段固定边界 | 如 `pwScore ∈ [-0.6, 0.6]`、`gdQ ∈ [-2.5, 2.5]` | 强边界字段 |
| 联赛稳健 Z-Score | `z = (x - median_league) / IQR_league`，再 sigmoid 到 0~100 | 联赛差异大字段 |
| 批次 min-max | 仅用于 UI 横向排名展示 | 不参与入库与回测主分 |

推荐映射：

```text
score = 100 / (1 + exp(-k × z))
其中 k 默认 1.2，z clamp 到 [-3, 3]
```

#### 25.5.2 实力评分优化

旧公式：

```text
powerScore = gdQ×0.25 + crossValue×0.15 + pwScore×0.35 + adCombined×0.25
```

V2.1 建议：

```text
powerRaw = 0.34×PW_norm
         + 0.24×GDQ_norm
         + 0.22×AD_norm
         + 0.14×CrossSPFEdge_norm
         + 0.06×Ladder_norm
```

其中：

- `CrossSPFEdge = crossSpfWin - crossSpfLose`，比 `hWins+aLosses-hLosses-aWins` 更接近方向概率；
- `Ladder_norm` 来自 `ladderLevel ∈ [-3, 3]`，只做小权重辅助；
- 若 `PW_norm` 与 `GDQ_norm` 方向相反且差异较大，`powerScore` 上限降为 75。

#### 25.5.3 市场评分新增

市场评分拆成 4 个子项：

| 子项 | 权重 | 计算口径 |
|------|-----:|----------|
| SP 隐含概率边际 | 0.35 | `marketEdge = P_home - P_away`，去除抽水 |
| 盘口位移方向 | 0.25 | 初盘→临盘隐含概率变化，与模型方向一致加分，反向扣分 |
| 欧亚一致性 | 0.20 | 欧赔低赔方向与亚盘让球方向是否一致 |
| 离散度变化 | 0.20 | 离散度扩大降分，收窄或稳定加分 |

市场评分不直接替代模型方向，只作为“模型方向是否可下注”的二次确认。

#### 25.5.4 热度评分优化

旧逻辑：`HI=1` 得满分，偏离扣分。V2.1 改成联赛标准化：

```text
heatZ = (HI - leagueMean) / leagueStd
heatRisk = sigmoid(|heatZ| - 1.2)
```

判定：

| heatZ | 含义 | 处理 |
|-------|------|------|
| `>= 1.5` | 过热 | 推荐方向降星，强队也要防冷 |
| `0.5 ~ 1.5` | 微热 | 不扣方向，只降低 EV 置信 |
| `-1.5 ~ 0.5` | 正常/偏冷 | 不惩罚 |
| `< -1.5` 且市场概率不支持 | 异常冷 | 只标记“冷藏”，不自动加星 |

#### 25.5.5 健康评分优化

旧映射 `strong=100 / weak=70 / meltdown=20` 过于离散。V2.1 建议：

```text
healthScore = 100 × consensusScore × freshnessWeight
```

兜底映射：

| 共识 | consensusScore 缺失时默认 | 最高星级上限 |
|------|--------------------------:|-------------:|
| `strong` | 0.90 | 5 |
| `weak` | 0.62 | 3 |
| `meltdown` 且 `|pw|>=0.18` | 0.35 | 2 |
| `meltdown` 且 `|pw|<0.18` | 0.20 | 0 |

#### 25.5.6 赢盘率评分优化

先统一尺度：

| 输入范围 | 识别方式 | 转换为比例 |
|----------|----------|------------|
| `0~1` | `value <= 1` | 原值 |
| `0~2` | `1 < value <= 2` | `value / 2` |
| `0~100` | `value > 2` | `value / 100` |

再计算方向边际：

```text
winPanEdge = normalize(homeWinPanRate - awayWinPanRate, [-0.5, 0.5])
```

禁止只使用主队赢盘率，否则客队强盘场景会系统性偏主。

#### 25.5.7 EV 与价值标签优化

EV 必须基于校准概率，不再直接使用经验 sigmoid：

```text
p_home_calibrated = Calibrate(p_home_raw, league, oddsBucket, starBucket)
EV_home = p_home_calibrated × homeOdds - 1
```

价值标签建议：

| 标签 | 条件 | 额外门禁 |
|------|------|----------|
| 超值 | `EV >= 0.12` | 样本校准桶命中率稳定，数据质量 ≥80 |
| 正期望 | `EV >= 0.04` | 数据质量 ≥70，市场无强反向 |
| 合理 | `-0.04 < EV < 0.04` | 可作为串关备选 |
| 负期望 | `EV <= -0.04` | 不建议作为主推 |

### 25.6 方向判定从阈值矩阵升级为概率门禁

#### 25.6.1 SPF 概率框架

V2.1 推荐输出三项概率：

```text
pHome = sigmoid(β0 + β1×pw + β2×gdQ + β3×ad + β4×crossSpfEdge + β5×marketEdge - β6×heatRisk + β7×stability)
pDraw = drawPrior(league, |pw|, marketDrawProb, stability)
pAway = 1 - pHome - pDraw
```

不要求第一版就训练复杂模型，可以先用经验权重初始化，再通过 Walk-Forward 做网格搜索或贝叶斯优化。

#### 25.6.2 星级与推荐门禁

| 星级 | 条件 | 推荐含义 |
|------|------|----------|
| 5星 | `maxP ≥ 0.62` 且 `edge ≥ 0.08` 且无红色风险 | 单关主推候选 |
| 4星 | `maxP ≥ 0.56` 且 `edge ≥ 0.05` | 可做主推/串关核心 |
| 3星 | `maxP ≥ 0.51` 或市场/模型有轻微分歧 | 谨慎选择 |
| 2星 | 弱一致、边际不足、但方向存在 | 仅作参考 |
| 0~1星 | 熔断、数据缺失、强反向市场 | 观望/避开 |

#### 25.6.3 硬性降级规则

任一条件触发时，不允许 4 星以上：

1. `dataQualityScore < 70`；
2. `fusionConsensus = meltdown`；
3. `discreteWarning = warning` 且市场方向与模型方向相反；
4. `dataAge > 240` 且无新盘口/热度；
5. `winPanEdge` 与 `powerRaw` 强反向；
6. 前端/后端字段尺度无法识别。

### 25.7 大小球与让球独立优化

#### 25.7.1 大小球 OU

推荐融合：

```text
ouRaw = 0.30×attDefGoal_norm
      + 0.22×fusionFinalTotal_norm
      + 0.16×bigBallRatio_norm
      + 0.12×dxqPanDeviation_norm
      + 0.10×leagueGoalEnv_norm
      + 0.10×attackPattern_norm
```

门禁：

- `bigBallRatio ≥ 70` 但 `attDefGoal < 2.0`：降级为“倾向小/观望”；
- `dxqLastPan ≥ 2.75` 且 `fusionFinalTotal ≥ 3.0`：大球信号增强；
- `leagueAvgGoals < 2.3` 时，大球阈值整体上调；
- `meltdown` 不直接否定 OU，但必须降低星级。

#### 25.7.2 让球 HCP

推荐融合：

```text
hcpRaw = 0.28×powerRaw
       + 0.22×crossHcpEdge
       + 0.18×winPanEdge
       + 0.17×marketHandicapSignal
       + 0.15×verification
```

门禁：

- `crossHcpWin - crossHcpLose < 0.05`：不强推让胜；
- 主队强但亚指不升或反向降盘：降级；
- 低赔深盘且热度过高：优先标记“让负风险”。

### 25.8 数据质量与特征快照要求

V2.1 实现前必须补齐以下数据治理规则：

| 项目 | 要求 |
|------|------|
| 版本覆盖 | 每次 `computeAndSave()` 必须写入 `pk_scorer_version`，历史实验需重算，不允许空版本参与版本对比 |
| 来源标识 | 区分 `pk_real_compute`、`gs_backfill`、`manual_fix`，回测默认只用真实计算样本 |
| 特征快照 | 入库保存 `pk_feature_snapshot`，至少包含权重、核心输入字段、归一化后分、数据质量 |
| 数据尺度 | `winPan`、`crossSpf`、赔率、热度统一标准化后再评分 |
| 数据覆盖率 | GS ≥95%、JczqBasic ≥90%、JczqChange ≥80% 才允许作为正式回测样本 |
| 时效 | 盘口/热度半衰期短，统计/战绩半衰期长，不允许同一 `dataAge` 一刀切 |
| 数据库写入 | 继续遵守 `database.getAdapter()` 持久化规则，禁止绕过适配器直接写 raw 实例 |

### 25.9 回测与调参门禁

#### 25.9.1 数据切分

| 集合 | 比例/窗口 | 用途 |
|------|-----------|------|
| Train | 最早 60% 或滚动 60 天 | 初始权重/阈值搜索 |
| Validation | 中间 20% 或滚动 14 天 | 选择参数，不得反复窥探测试集 |
| Test/OOS | 最近 20% 或滚动 14 天 | 最终验收 |
| Walk-Forward | `30d train + 7d test`、`60d train + 14d test` | 稳定性验证 |

#### 25.9.2 必须统计的指标

| 指标 | 目标 |
|------|------|
| SPF 命中率 | 总体、分联赛、分星级、分热度桶 |
| Brier Score / LogLoss | 验证概率是否校准，而不只是命中率 |
| 星级单调性 | 5星命中率 ≥ 4星 ≥ 3星，至少不出现明显倒挂 |
| Coverage | 4/5星覆盖率不能过低，否则无业务价值 |
| ROI/EV 回测 | 仅对正 EV 样本统计，不与方向命中混算 |
| 最大回撤 | 防止少数高赔率样本造成虚高 |
| 数据缺失敏感性 | 去掉低质量样本后表现是否提升 |

#### 25.9.3 上线阈值

V2.1 不应只看单一命中率，需同时满足：

1. OOS SPF 命中率相对基线提升 ≥ 5%，或绝对提升 ≥ 3 个百分点；
2. 4星以上样本命中率高于整体样本至少 8 个百分点；
3. 主要联赛（样本 ≥30）无超过 10 个百分点的明显退化；
4. 正 EV 样本 ROI 置信区间下界不显著为负；
5. 数据质量门禁通过率 ≥85%。

### 25.10 分阶段落地路线（仅文档规划，暂不写代码）

| 阶段 | 目标 | 涉及文件 | 验收 |
|------|------|----------|------|
| P0 | 口径统一：前后端权重、热度 Z、EV、字段尺度、玩法 Profile | `pk_scorer.js`、`match-pk-fusion.js` | 同一批输入前后端评分差异 ≤1 分 |
| P1 | 版本化重算：清理旧回填污染，补 `pk_source` 与特征快照 | `prediction_log.js`、回填脚本 | `pk_scorer_version` 覆盖率 100% |
| P2 | 7维权重 V2.1 灰度：先不加表结构，只改权重与门禁 | `pk_scorer.js` | Walk-Forward 优于 `pk_v2.0` |
| P3 | 新增 `marketScore/dataQualityScore`，形成 8 维正式版 | `pk_scorer.js`、schema、测试 | 分玩法概率校准曲线可用 |
| P4 | 联赛/时间窗口自适应权重 | `model-weights.js`、回测模块 | 分联赛稳定性提升 |

### 25.11 后续修改清单

下一轮真正写代码时，按以下顺序修改，避免再次出现“文档正确但前后端不一致”：

1. 先统一 `winPan`、`crossSpf`、`heatZ`、EV 的字段尺度与前后端公式；
2. 再让 `computeAndSave()` 明确传入 `spf` Profile，禁止正式入库走 `default`；
3. 再重算历史真实 PK 样本并写入版本；
4. 再执行 Walk-Forward 对比 `pk_v2.0` 与 `pk_v2.1`；
5. 回测通过后再考虑新增 `marketScore`、`dataQualityScore` 和特征快照字段。

---

## 二十六、量化排行榜与 PK 弹窗页面优化方案（仅文档规划，暂不写代码）

> 本章用于承接 V2.1 算法优化在前端页面层的落地设计。当前阶段只整理页面定位、展示字段、数据合同与实施优先级，不修改 `preview/` 或 `server/` 代码。

### 26.1 页面优化总原则

量化排行榜与 PK 弹窗必须从“原始量化字段展示”升级为“统一口径的决策展示”：

1. **同一后端真源**：排行榜与 PK 弹窗都优先消费后端统一计算后的 PK/量化结果，避免前端继续维护权重、热度、EV、方向判断副本。
2. **先给结论，再给证据**：页面主视觉展示“可做方向、星级、价值、风险灯”，底层原始指标降为证据层。
3. **按玩法独立展示**：SPF、让球、大小球的目标函数不同，页面不能再用一个综合分解释所有玩法。
4. **展示风控原因**：凡是降星、观望、熔断、弱一致、数据陈旧、市场反向，都必须明确给出原因。
5. **图表只表达相对位置**：前端图表中的百分比柱只代表当页相对位置，不代表真实概率、命中率或下注强度。

### 26.2 两个页面的职责边界

| 页面 | 新定位 | 主要回答的问题 | 不应承担的职责 |
|------|--------|----------------|----------------|
| 量化数据排行榜 | 可下注机会发现页 / 筛选页 | 今天哪些比赛值得点开、哪些可做主推、哪些风险较高 | 不在前端重新计算方向、EV、星级 |
| PK 弹窗 | 统一模型决策解释页 | 为什么这场排名靠前、为什么推荐该方向、风险来自哪里 | 不维护独立算法副本，不覆盖后端结论 |

推荐页面流：

```text
后端统一 PK/量化评分
  → 量化排行榜摘要筛选
  → 用户选择比赛
  → PK 弹窗详细解释
  → 进入方案生成/确认链路
```

### 26.3 量化数据排行榜页面优化

#### 26.3.1 排名底座调整

排行榜不应继续以专家热度或推荐数作为量化榜底座。V2.1 后应新增或改造为独立量化榜数据源，直接返回 PK/量化统一结果。

必需字段：

| 字段 | 用途 |
|------|------|
| `pk_composite_score` | 当前玩法综合分，作为主排序候选 |
| `pk_direction` / `pk_direction_stars` | SPF 推荐方向与星级 |
| `pk_hcp_direction` | 让球推荐方向 |
| `pk_goal_direction` | 大小球/进球方向 |
| `pk_value_tag` | 超值、正期望、合理、负期望 |
| `pk_heat_zscore` | 热度 Z-Score，替代固定 HI 阈值主判断 |
| `marketScore` | 市场验证分/市场方向信号 |
| `dataQualityScore` | 数据质量分，决定置信度上限 |
| `pk_source` | `pk_real_compute` / `gs_backfill` / `manual_fix` 等来源标识 |
| `pk_scorer_version` | 评分版本，用于解释和回测一致性 |
| `dataAge` | 核心数据时效 |
| `hardDegradeReasons` | 降级、熔断、观望原因列表 |

#### 26.3.2 页签重构

当前按原始因子划分的页签应调整为结果导向：

| 新页签 | 默认排序 | 展示目标 |
|--------|----------|----------|
| SPF 决策榜 | `spfComposite` / `maxP` / `edge` | 找胜平负方向机会 |
| 让球价值榜 | `hcpComposite` / `winPanEdge` / `marketHandicapSignal` | 找让球穿盘或让负风险 |
| 大小球榜 | `ouComposite` / `totalGoalsProb` / `leagueGoalEnv` | 找大/小球机会 |
| 风险观察 | `riskScore DESC` | 找过热、熔断、市场反向、数据陈旧场次 |
| 原始因子 | 用户手动排序 | 给高阶用户查看底层指标 |

#### 26.3.3 行卡片展示结构

每场比赛建议拆成三层展示：

1. **摘要层**
   - 排名、对阵、联赛、开赛时间；
   - 主推荐方向、星级、综合分；
   - `pk_value_tag`；
   - 可做等级：`主推` / `可做` / `谨慎` / `观望`。

2. **证据层**
   - `powerScore`、`goalScore`、`marketScore`；
   - `pk_heat_zscore`、`healthScore`、`stabilityScore`；
   - `dataQualityScore`、`pk_scorer_version`。

3. **风控层**
   - 熔断/弱一致；
   - 数据陈旧；
   - 市场反向；
   - 赢盘率与实力反向；
   - 样本不足或来源为回填。

#### 26.3.4 热度展示口径

热度主展示应从固定 `HI >= 1.4` / `HI <= 0.85` 改为 `heatZ`：

| `heatZ` | 页面标签 | 说明 |
|---------|----------|------|
| `>= 1.5` | 过热 | 推荐方向降星，提示防冷 |
| `0.5 ~ 1.5` | 微热 | 不直接否定方向，只降低 EV 置信 |
| `-1.5 ~ 0.5` | 正常/偏冷 | 不自动加星 |
| `< -1.5` 且市场不支持 | 异常冷 | 标记“冷藏待确认”，不作为利好 |

原始 `heatIndex` 可作为次级字段展示，但不再作为主标签依据。

#### 26.3.5 图表视图说明

图表页必须增加认知提示：

```text
图表百分比仅表示当前列表内的相对位置，不等于命中率、概率或下注强度。
```

Tooltip 至少展示：原始值、归一化值、当前玩法权重、该字段对推荐方向的贡献/扣分原因。

### 26.4 PK 弹窗页面优化

#### 26.4.1 核心调整

PK 弹窗应从“前端临时评分弹窗”升级为“后端统一决策解释弹窗”：

| 当前问题 | 优化方向 |
|----------|----------|
| 前端自行计算综合分 | 优先展示后端 `pk_composite_score` 与分玩法分数 |
| 前端自行判定方向 | 优先展示后端 `pk_direction`、`pk_hcp_direction`、`pk_goal_direction` |
| 前端自行计算 EV | 使用后端经回测校准后的概率与 EV |
| 热度固定阈值 | 使用 `pk_heat_zscore` 与联赛热度 Profile |
| 标签经验化 | 改为结论标签 + 证据标签 + 风险标签 |

#### 26.4.2 弹窗四层结构

1. **顶部总览层**
   - 综合等级：A / B / C / 观望；
   - 主推荐：主胜 / 平 / 客胜 / 双选 / 观望；
   - 星级、`maxP`、`edge`、`pk_value_tag`；
   - 风险灯：绿 / 黄 / 红。

2. **三玩法决策层**

| 模块 | 展示字段 |
|------|----------|
| SPF 推荐 | 方向、星级、`pHome/pDraw/pAway`、`edge`、EV、触发原因、降级原因 |
| 让球推荐 | `pk_hcp_direction`、`hcpComposite`、`winPanEdge`、市场盘口信号、降级原因 |
| 大小球推荐 | `pk_goal_direction`、`ouComposite`、总进球概率、盘口偏差、联赛进球环境 |

3. **证据对比层**
   - 排名、对阵、SPF 综合、让球综合、大小球综合；
   - `marketScore`、`pk_heat_zscore`、`healthScore`、`stabilityScore`、`dataQualityScore`；
   - `pk_value_tag`、`dataAge`、`pk_scorer_version`。

4. **风控解释层**
   - `fusionConsensus = meltdown`；
   - `dataQualityScore` 不足；
   - 市场与模型方向反向；
   - 热度过热；
   - 数据时效过旧；
   - 赢盘率与实力方向反向；
   - `pk_source` 非真实计算样本。

#### 26.4.3 标签体系

标签分三类，避免把风险标签误读为推荐理由：

| 类型 | 标签示例 | 用途 |
|------|----------|------|
| 结论标签 | 主推、可做、谨慎、观望 | 告诉用户能不能用 |
| 证据标签 | 市场支持、强一致、数据新鲜、正期望 | 解释为什么能用 |
| 风险标签 | 热度过热、弱一致、熔断、数据陈旧、质量不足、负期望 | 解释为什么降级或避开 |

#### 26.4.4 PK 弹窗必需新增字段

| 字段 | 说明 |
|------|------|
| `pHome` / `pDraw` / `pAway` | SPF 校准概率 |
| `edge` | 推荐方向相对第二方向或市场概率的边际 |
| `marketScore` | 市场验证结果 |
| `dataQualityScore` | 数据可信度与星级上限 |
| `pk_heat_zscore` | 联赛标准化热度 |
| `consensusScore` | 连续一致性分 |
| `pk_scorer_version` | 评分版本 |
| `pk_source` | 数据来源 |
| `dataAge` | 数据时效 |
| `hardDegradeReasons` | 强制降级原因 |

建议字段：`winPanEdge`、`crossSpfEdge`、`marketEdge`、`ouRaw`、`hcpRaw`、`spfRaw`、`leagueCalibration`、`oddsBucket`、`starBucket`。

### 26.5 前后端统一数据合同草案

排行榜与 PK 弹窗应使用同一批核心字段，只是展示粒度不同：

| 字段组 | 排行榜 | PK 弹窗 | 说明 |
|--------|--------|---------|------|
| 基础信息 | 必需 | 必需 | `matchId`、`num`、`leagueName`、`homeName`、`visitName`、`matchTime` |
| 主结论 | 必需 | 必需 | `playType`、`direction`、`stars`、`decisionLevel`、`valueTag` |
| 分玩法结论 | 摘要 | 详细 | SPF / HCP / OU 三套方向、分数、概率、EV |
| 证据分 | 摘要 | 详细 | `powerScore`、`goalScore`、`marketScore`、`heatScore`、`healthScore`、`stabilityScore`、`winPanScore`、`dataQualityScore` |
| 风险原因 | 标签 | 列表 | `riskTags`、`hardDegradeReasons`、`softWarnings` |
| 数据治理 | 标记 | 详细 | `pk_source`、`pk_scorer_version`、`dataAge`、`featureSnapshotId` |

### 26.6 实施优先级

| 优先级 | 任务 | 验收口径 |
|--------|------|----------|
| P0 | 排行榜脱离专家热度底座，改用 PK/量化统一结果 | 默认榜单排序不再依赖 `expertCount` |
| P0 | PK 弹窗以后端结果为主，前端算法只允许兜底 | 同一场比赛前后端方向、星级、EV 口径一致 |
| P0 | 热度统一为 `heatZ` | 页面主标签不再直接使用固定 HI 阈值 |
| P0 | 新增 `dataQualityScore`、`dataAge`、`pk_scorer_version` 展示 | 用户能看到数据可信度与版本 |
| P1 | 排行榜页签改为 SPF / 让球 / 大小球 / 风险观察 / 原始因子 | 每个页签有独立排序逻辑 |
| P1 | PK 弹窗三玩法分栏 | SPF、HCP、OU 结论不混用一个综合分 |
| P1 | 展示硬性降级原因 | 降星或观望必须有原因 |
| P2 | 增加特征快照、校准桶、联赛解释 | 支持后续回测与用户解释 |

### 26.7 与 V2.1 算法章节的对应关系

| 页面优化点 | 对应算法章节 |
|------------|--------------|
| 后端统一真源 | 25.1.2、25.11 |
| 玩法独立页签 | 25.2、25.4、25.7 |
| `heatZ` 展示 | 25.5.4 |
| EV 与价值标签 | 25.5.7 |
| 星级与硬性降级 | 25.6.2、25.6.3 |
| 数据质量与时效 | 25.8 |
| 排行榜作为筛选页、PK 弹窗作为解释页 | 26.2 |

### 26.8 页面方案结论

- 量化数据排行榜应从“原始指标表”升级为“可下注机会发现页”。
- PK 弹窗应从“前端临时评分弹窗”升级为“统一模型决策解释弹窗”。
- 两个页面必须共用后端统一 PK/量化结果，只在展示深度上区分；任何前端本地算法都只能作为异常兜底，不得成为主路径。

---

## 二十七、与专家共识、功守道、AI预测分析的对比融合方案

> 本章定义 PK 模块与专家共识、功守道、AI预测分析之间的对比融合方式。核心原则：**PK 不升级为“第四个预测源”，而是作为量化决策中枢 / PK 裁判层 / 价值发现层**。本章仅为产品与算法方案文档，不修改 `server/` 或 `preview/` 代码。
>
> **边界声明**：PK 核心评分仍保持独立计算能力，不把专家共识或 AI 预测作为必需依赖。专家共识、AI 预测、市场赔率等外部信号可作为“对比、解释、降级、复盘”的旁路特征写入融合快照；当外部信号缺失时，PK 主路径不得阻断，只降低展示完整度或置信上限。

### 27.1 四大模块定位差异

| 模块 | 核心回答 | 主要价值 | 主要短板 | 在融合中的角色 |
|------|----------|----------|----------|----------------|
| 专家共识 | 大家怎么看 | 人群智慧、热度、主流观点、分歧度 | 容易从众，可能过热，缺少 EV 校验 | 作为共识/热度输入，不直接作为最终结论 |
| 功守道 | 基础攻防怎么看 | xG、攻防效率、稳定性、融合共识、熔断 | 参数相对固定，解释偏数值 | 作为基础模型底座和熔断来源 |
| AI预测分析 | 比赛故事和风险怎么看 | 战意、伤病、赛程、战术、语义解释 | 结构化不稳定，口径可能漂移，难直接回测 | 作为语义风险补充和解释层 |
| PK量化 | 值不值得做 | 概率校准、EV、风险降级、玩法决策、回测闭环 | 需要高质量特征和长期校准 | 作为最终裁判层与价值发现层 |

一句话定位：

```text
专家共识看人，功守道看球，AI 看故事，PK 量化看值不值得下注。
```

PK 模块的新增特色不是“再算一个分”，而是把多个信号的同向、冲突、价值与风险统一解释出来：

1. **信号融合**：把专家、功守道、AI、市场、PK 量化转成统一方向与置信口径；
2. **分歧裁判**：识别“专家热但市场反向”“功守道强但 AI 风险大”等场景；
3. **价值发现**：判断模型概率是否高于市场隐含概率，避免只追求命中率；
4. **硬性降级**：对熔断、数据质量不足、负 EV、过热等情况直接限制星级；
5. **赛后复盘**：记录每个信号赛前观点与赛后结果，形成可回测闭环。

### 27.2 融合架构：PK 作为裁判层

推荐架构：

```text
比赛基础数据
  ├─ 功守道攻防模型：xG、稳定性、fusionConsensus、meltdown
  ├─ 专家共识：方向、共识强度、热度、分歧度
  ├─ AI预测分析：方向、信心、风险标签、关键解释
  ├─ 市场赔率：隐含概率、变盘方向、盘口支持、返还异常
  └─ PK量化核心：校准概率、EV、玩法分数、风险降级
        ↓
PK 裁判层
  ├─ 一致性判断
  ├─ 分歧类型识别
  ├─ EV 价值判断
  ├─ 硬性降级
  └─ 最终输出：主推 / 可做 / 谨慎 / 观望
```

关键原则：

- **不做简单平均**：禁止用“专家 25% + 功守道 25% + AI 25% + PK 25%”替代裁判逻辑；
- **先统一口径再融合**：所有来源都要转成方向、置信、风险、证据、时间戳；
- **先判断能不能做，再判断做什么**：熔断、数据质量、负 EV 等规则优先于加权分；
- **缺失不阻断**：某个旁路模块无数据时，记录 `missingSources`，但不让页面空白；
- **复盘可追溯**：融合时使用的所有关键特征必须能落到快照或日志。

### 27.3 标准化数据合同

#### 27.3.1 输入信号标准结构

所有模块进入裁判层前建议统一成以下结构：

| 字段 | 类型 | 说明 |
|------|------|------|
| `source` | string | `expert` / `gongshoudao` / `ai` / `market` / `pk` |
| `playType` | string | `spf` / `hcp` / `ou` |
| `direction` | string | 标准化方向，如 `home` / `draw` / `away` / `over` / `under` / `watch` |
| `confidence` | number | 0~100 置信度 |
| `probability` | number | 如有，使用校准概率 |
| `evidenceTags` | array | 支持该方向的证据标签 |
| `riskTags` | array | 风险标签 |
| `summary` | string | 一句话解释 |
| `dataAge` | number | 数据时效，单位分钟 |
| `sourceVersion` | string | 来源版本或模型版本 |

#### 27.3.2 各来源映射字段

| 来源 | 推荐字段 | 说明 |
|------|----------|------|
| 专家共识 | `expertDirection`、`expertConsensusStrength`、`expertHeatIndex`、`expertDisagreement` | 表示主流观点强度与过热风险 |
| 功守道 | `gsDirection`、`gsConfidence`、`xgHome`、`xgAway`、`stabilityOverall`、`fusionConsensus` | 其中 `meltdown` 属于硬性风险 |
| AI预测 | `aiDirection`、`aiConfidence`、`aiRiskTags`、`aiKeyReasons`、`aiContentVersion` | 重点结构化伤病、战意、赛程、轮换等风险 |
| 市场赔率 | `marketDirection`、`marketImpliedProbability`、`oddsMoveSignal`、`marketEdge`、`returnRate` | 用于 EV 与市场支持判断 |
| PK量化 | `pkFinalDirection`、`calibratedProbability`、`valueEdge`、`expectedValue`、`decisionLevel` | 最终裁判输出，不等同于单一预测源 |

#### 27.3.3 裁判层输出字段

| 字段 | 说明 |
|------|------|
| `finalDecision` | `main_pick` / `playable` / `cautious` / `watch` |
| `finalDirection` | 最终方向，允许为 `watch` |
| `playType` | 当前玩法 |
| `stars` | 星级，受硬性降级约束 |
| `agreementScore` | 多来源方向一致度 |
| `conflictIndex` | 分歧强度 |
| `conflictType` | 分歧类型，见 27.4 |
| `valueEdge` | 模型概率 - 市场隐含概率 |
| `expectedValue` | 期望收益指标 |
| `riskLevel` | `green` / `yellow` / `red` |
| `degradeReasons` | 降级原因列表 |
| `decisionNarrative` | 面向用户的一句话裁判解释 |
| `featureSnapshotId` | 对应赛前特征快照，供复盘使用 |

### 27.4 分歧裁判机制

PK 裁判层的特色是显性化冲突，而不是隐藏冲突。

| 分歧类型 | 典型场景 | 页面解释 | 决策动作 |
|----------|----------|----------|----------|
| `all_aligned` | 专家、功守道、AI、市场、PK 同向 | 多源同向，信号一致 | 可提高置信，但仍检查 EV |
| `expert_hot_market_reverse` | 专家共识很热，但赔率/盘口反向 | 可能过热或诱导 | 降星，进入风险观察 |
| `gs_strong_ai_risk` | 功守道强，但 AI 提示伤病/战意/轮换 | 基础面占优但变量较大 | 降一级或转谨慎 |
| `ai_only_support` | AI 看好，但功守道/市场/PK 不支持 | 文本逻辑有吸引力但量化证据不足 | 不升星，仅做参考 |
| `market_support_pk_weak` | 市场支持但 PK 概率不足 | 市场信号存在但模型未确认 | 保持谨慎 |
| `pk_value_against_consensus` | 专家不热，但 PK/市场有正 EV | 可能存在价值冷门 | 进入价值冷门榜，小注/组合 |
| `gs_meltdown` | 功守道 `fusionConsensus = meltdown` | 模型结构性冲突 | 禁止主推，最多观望 |
| `data_quality_low` | 数据质量不足或过旧 | 当前判断可信度不足 | 星级上限 2 星 |

页面文案示例：

```text
本场专家、功守道、市场均支持主胜，但专家热度偏高且主胜赔率价值不足，因此 PK 裁判不升为主推，仅建议可做。
```

```text
专家共识偏主胜，但市场赔率持续反向，功守道稳定性不足，AI 也提示主队伤病隐患，因此降级为观望。
```

### 27.5 价值判断：从命中率升级到 EV

专家共识、功守道、AI 多数回答“哪个结果更可能发生”，PK 裁判层必须回答“这个方向是否值得做”。

核心字段：

| 概念 | 字段 | 说明 |
|------|------|------|
| 校准概率 | `calibratedProbability` | 基于回测校准后的真实概率估计 |
| 市场隐含概率 | `marketImpliedProbability` | 赔率反推并去水后的市场概率 |
| 价值边际 | `valueEdge` | `calibratedProbability - marketImpliedProbability` |
| 期望收益 | `expectedValue` | 结合赔率后的收益期望 |
| 价值标签 | `valueTag` | `high_prob_low_value` / `medium_prob_high_value` / `high_prob_high_value` / `low_prob_low_value` |

页面解释口径：

| 标签 | 含义 | 建议动作 |
|------|------|----------|
| 高概率低价值 | 方向可能命中，但赔率太低或过热 | 不做主推，可做串关辅助 |
| 中概率高价值 | 命中概率中等，但赔率补偿充足 | 可进价值榜，小注或组合 |
| 高概率高价值 | 概率与赔率同时有优势 | 主推候选 |
| 低概率低价值 | 既不稳也无赔率补偿 | 规避 |

硬规则：**EV 为负时，即使方向命中率高，也不能升为主推。**

### 27.6 三玩法独立融合

SPF、让球、大小球目标函数不同，融合时必须分玩法输出，避免一个综合分解释所有玩法。

| 玩法 | 更应依赖的信号 | 裁判输出 |
|------|----------------|----------|
| SPF | 实力差、主客场、状态、市场概率、专家热度 | `spfDecision` |
| 让球 | 盘口深度、赢盘率、实力差与盘口匹配度、市场变盘 | `handicapDecision` |
| 大小球 | xG、攻防效率、联赛节奏、大小球盘口、天气/赛程风险 | `overUnderDecision` |

每个玩法建议输出：

| 字段 | 说明 |
|------|------|
| `direction` | 推荐方向或观望 |
| `probability` | 校准概率 |
| `marketProbability` | 市场隐含概率 |
| `edge` | 价值边际 |
| `expectedValue` | 期望收益 |
| `stars` | 星级 |
| `decisionLevel` | 主推/可做/谨慎/观望 |
| `agreementScore` | 与专家/功守道/AI/市场的一致性 |
| `riskTags` | 该玩法独有风险 |
| `reasonText` | 一句话解释 |

初始权重建议仅作为冷启动，不作为长期固定公式：

| 场景/玩法 | PK量化 | 市场赔率 | 功守道 | 专家共识 | AI分析 |
|----------|-------:|---------:|-------:|---------:|-------:|
| SPF | 35% | 25% | 20% | 10% | 10% |
| 让球 | 30% | 35% | 20% | 10% | 5% |
| 大小球 | 25% | 25% | 35% | 5% | 10% |
| 风险观察 | 30% | 30% | 15% | 15% | 10% |

后续应通过 Walk-Forward 按联赛、玩法、赔率区间、数据质量动态更新权重。

### 27.7 硬性降级规则

以下场景不应被加权平均抵消，必须直接限制最终等级：

| 触发条件 | 处理 |
|----------|------|
| `fusionConsensus = meltdown` | 禁止主推，最多观望 |
| `dataQualityScore < 60` | 星级上限 2 星 |
| `dataAge` 超阈值 | 降一级，并展示数据陈旧 |
| AI 强风险 + 市场反向 | 降一级，必要时观望 |
| 专家过热 + EV 不足 | 降一级或进入风险观察 |
| 赔率异常波动但无数据支撑 | 标记“市场异动待确认”，不升星 |
| `expectedValue < 0` | 禁止主推 |
| 三个以上核心来源方向冲突 | 降为谨慎或观望 |
| `pk_source` 非真实计算样本 | 星级上限 2 星，并展示来源风险 |

### 27.8 页面展示方案

#### 27.8.1 PK 弹窗新增“模型对比表”

| 来源 | 方向 | 信心 | 关键证据 | 风险 |
|------|------|-----:|----------|------|
| 专家共识 | 主胜 | 78 | 专家集中支持 | 热度偏高 |
| 功守道 | 主胜 | 82 | xG 1.9 : 0.8，稳定性良好 | 无明显熔断 |
| AI分析 | 主胜/谨慎 | 70 | 主队战术占优 | 伤病不确定 |
| 市场赔率 | 主胜 | 65 | 主胜降赔 | 赔付偏低 |
| PK裁判 | 主胜可做 | 76 | 方向一致但 EV 一般 | 降为 3 星 |

#### 27.8.2 分歧解释区

弹窗应展示 `decisionNarrative`，要求一句话说明：

1. 哪些来源同向；
2. 哪些来源冲突；
3. 为什么升星或降级；
4. 最终动作是什么。

示例：

```text
功守道与市场均支持主胜，但专家热度偏高、EV 仅小幅为正，PK 裁判给出“可做”而非“主推”。
```

#### 27.8.3 价值雷达 / 决策雷达

建议展示维度：

- 实力优势；
- 进球优势；
- 市场支持；
- 热度风险；
- 数据质量；
- EV 价值；
- 一致性；
- 稳定性。

雷达图只表达决策维度的相对强弱，不等于命中率。

#### 27.8.4 赛后复盘入口

每场完赛后建议展示：

| 项目 | 说明 |
|------|------|
| PK 推荐方向 | 赛前最终方向 |
| 专家共识方向 | 赛前专家主流方向 |
| 功守道方向 | 赛前模型方向 |
| AI 方向 | 赛前 AI 方向与风险 |
| 市场方向 | 赛前市场支持方向 |
| 实际结果 | 完赛结果 |
| 命中状态 | 各来源是否命中 |
| ROI 表现 | 按赔率计算收益表现 |
| 归因标签 | 如过热、伤病、市场反向、数据失真 |
| 后续调整 | 对类似场景的降权或升权建议 |

### 27.9 量化排行榜升级为机会发现页

排行榜不只按综合分排序，应扩展为多种机会榜：

| 榜单 | 目标 |
|------|------|
| 综合机会榜 | 多模型一致且 EV 不差 |
| 价值冷门榜 | 专家不热但 PK/市场有价值 |
| 稳健主推榜 | 一致性高、风险低、数据质量高 |
| 风险预警榜 | 专家过热、市场反向、功守道熔断、数据陈旧 |
| AI 风险榜 | AI 提醒伤病、战意、赛程、轮换风险 |
| 大小球机会榜 | 功守道 xG 与大小球盘口形成价值差 |
| 让球价值榜 | 盘口与实力不匹配的机会 |

页面定位：

```text
排行榜负责发现机会；PK 弹窗负责解释裁判结果；方案页负责落地组合与预算风控。
```

### 27.10 回测闭环与归因字段

为了让融合机制持续变聪明，必须把赛前融合快照写入可回测结构。

建议新增或派生字段：

| 字段 | 用途 |
|------|------|
| `expertDirection` | 专家共识方向 |
| `expertConsensusStrength` | 专家共识强度 |
| `gsDirection` | 功守道方向 |
| `gsConfidence` | 功守道置信 |
| `aiDirection` | AI 预测方向 |
| `aiRiskTags` | AI 风险标签 |
| `marketDirection` | 市场方向 |
| `pkFinalDirection` | PK 最终方向 |
| `conflictType` | 分歧类型 |
| `valueEdge` | 价值边际 |
| `expectedValue` | 期望收益 |
| `decisionLevel` | 主推/可做/谨慎/观望 |
| `actualResult` | 实际赛果 |
| `hitStatus` | 是否命中 |
| `roiResult` | 收益表现 |
| `attributionTags` | 赛后归因标签 |

可回测问题：

- 专家共识强时，命中率和 ROI 分别多少？
- 功守道与专家反向时，谁更可靠？
- AI 提醒伤病/轮换时，爆冷率是否上升？
- 市场反向但 PK 坚持时，ROI 是否更高？
- 哪些联赛适合相信功守道，哪些联赛更应相信市场？
- 负 EV 的高概率方向是否长期拉低收益？

### 27.11 实施优先级

| 优先级 | 任务 | 验收口径 |
|--------|------|----------|
| P0 | 在 PK 弹窗增加模型对比表与分歧解释区 | 用户能看到专家/功守道/AI/市场/PK 的方向差异 |
| P0 | 定义 `conflictType`、`agreementScore`、`degradeReasons` | 每次降级或观望都有明确原因 |
| P0 | 保持 PK 主路径独立，外部信号缺失不阻断 | 无专家/AI 数据时仍能展示 PK 基础结论 |
| P1 | 接入 EV、市场隐含概率、价值标签 | 页面能区分“高概率低价值”和“中概率高价值” |
| P1 | 三玩法独立输出融合结论 | SPF、让球、大小球各有方向、EV、风险 |
| P1 | 排行榜扩展为机会榜/风险榜/价值冷门榜 | 用户能按决策目的筛选比赛 |
| P2 | 写入赛前融合快照与赛后归因 | 可按 `conflictType`、玩法、联赛、赔率区间回测 |
| P2 | 用 Walk-Forward 更新动态权重 | 权重不再长期固定，能按场景自适应 |

### 27.12 章节结论

PK 模块要做出特色，方向不是增加一个重复预测结论，而是升级为：

```text
量化决策榜 + PK 裁判弹窗 + 赛后复盘闭环
```

最终产品差异：

- 专家共识告诉用户：大家怎么看；
- 功守道告诉用户：基础攻防模型怎么看；
- AI预测告诉用户：比赛故事、战术和风险怎么看；
- PK量化告诉用户：这些观点融合后，到底值不值得做、做哪个玩法、为什么升降级、风险来自哪里。

---

## 二十八、回测分析页、模型表现仪表盘与首页核心文案规划

> 本章节只整理产品文案、页面定位、指标口径和验收目标，作为下一步页面改造依据；本阶段不写代码、不调整接口、不改数据库结构。

### 28.1 三个页面的产品分工

| 页面 | 新定位 | 用户核心问题 | 页面表达原则 |
|------|--------|--------------|--------------|
| 首页 | 轻量今日摘要 + 原有功能入口 | 今天有多少比赛和机会？原有最多推荐/最热场次是什么？ | 原结构不重排，只新增顶部轻量摘要，不展示复杂归因 |
| 回测分析页 | PK 裁判结果验证 + 场景归因 | PK 裁判历史上准不准？哪些规则有效？哪些场景应降级？ | 用样本、命中、ROI、归因证明规则是否有效 |
| 模型表现仪表盘 | 模型可靠性与权重驾驶舱 | 哪个模型现在更值得信？它擅长哪些玩法和场景？ | 不做单纯命中率榜，改为可靠性、校准、稳定性 |

整体产品链路：

| 模块 | 一句话定位 |
|------|------------|
| 首页 | 今天有多少场、多少机会 |
| 量化排行榜 | 机会在哪里 |
| PK 弹窗 | 为什么是这个判断 |
| 回测分析页 | 这个判断历史上是否有效 |
| 模型表现仪表盘 | 哪个模型现在更值得信 |

### 28.2 首页核心文案规划

首页不做结构重排，保持现有首页入口风格和用户操作路径不变。本次只做“最小增强”：去掉顶部“老鹰智选”字样，在顶部增加一条轻量今日摘要；“最多推荐”和“最热场次”两个模块完全保留原有结构、标题、数据和点击逻辑。

#### 28.2.1 首页最小增强原则

| 项目 | 处理方式 | 说明 |
|------|----------|------|
| 顶部标题 | 去掉“老鹰智选”字样 | 减少首屏占用，避免新增品牌标题区域 |
| 顶部摘要 | 新增一行轻量数据 | 只显示“今日 N 场｜机会 N”，有明显风险时追加“风险 N” |
| 最多推荐 | 完全不动 | 保留原标题、原布局、原数据、原点击逻辑 |
| 最热场次 | 完全不动 | 保留原标题、原布局、原数据、原点击逻辑 |
| 做个方案 | 保持不动 | 不新增复杂副文案，避免干扰主入口 |
| 功能入口/收益图 | 保持现有结构 | 不因首页摘要改动而重排 |

本阶段不新增三张大统计卡，不新增模型状态卡，不新增风险解释区，不改变“最多推荐/最热场次”的展示方式。

#### 28.2.2 顶部摘要文案（方案 B）

默认只展示今日比赛数与机会数：

```text
今日 N 场｜机会 N
```

当当天存在需要提醒的明显风险时，再追加风险场次数：

```text
今日 N 场｜机会 N｜风险 N
```

无明显风险时，不强行展示风险字段：

```text
今日 N 场｜机会 N
```

字段口径：

| 字段 | 口径 |
|------|------|
| 今日 N 场 | 当日赛事总数 |
| 机会 N | PK/量化裁判后“主推 + 可做”的比赛数量 |
| 风险 N | 明显风险场次数；仅当 `N > 0` 且需要提醒时展示 |

#### 28.2.3 “最多推荐”和“最热场次”处理方式

这两个模块本阶段完全保留，不升级、不改名、不追加复杂解释。

| 模块 | 处理方式 |
|------|----------|
| 最多推荐 | 保留原标题、原卡片、原推荐次数、原比赛展示、原跳转逻辑 |
| 最热场次 | 保留原标题、原卡片、原热度指标、原比赛展示、原跳转逻辑 |

明确不新增以下内容：

- 不在“最多推荐”里追加 `PK：可做`；
- 不在“最热场次”里追加 `风险：中`；
- 不新增“热度不等于稳胆”提示条；
- 不把“最多推荐”改成“今日机会”；
- 不把“最热场次”改成“最热风险”。

#### 28.2.4 首页结构草图

```text
┌────────────────────────────────────┐
│ 今日 N 场｜机会 N                  │
│ 有明显风险时：今日 N 场｜机会 N｜风险 N │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 最多推荐                            │
│ 原有内容保持不变                    │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 最热场次                            │
│ 原有内容保持不变                    │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 做个方案                            │
│ 原有内容保持不变                    │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 原有功能入口保持不变                │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│ 原有收益图 / 专家方案盈利保持不变    │
└────────────────────────────────────┘
```

#### 28.2.5 首页收益图标题

| 当前口径 | 阶段性建议 | 完整接入后建议 |
|----------|------------|----------------|
| 专家方案盈利 | 若仍只统计专家方案，暂时保留 | 完整接入后再考虑改为“近7日方案收益”或“方案收益表现” |

收益图只展示轻量数字，不展开回撤、EV、模型来源：

| 指标 | 文案 |
|------|------|
| 近7日收益 | 近7日 +N 元 |
| 胜率 | 胜率 N / 7 |
| 状态 | 收益稳定 / 波动较大 / 样本不足 |

首页不展示：完整模型排行、分联赛热力图、分歧类型大表、EV 明细、Walk-Forward、Monte Carlo、单场来源对比，也不新增复杂模型解释、回测说明和风险归因。


### 28.3 回测分析页文案规划

回测页从“单模型命中率展示”升级为“PK 裁判闭环验证”。核心不是问“哪个方向命中率高”，而是问“主推、可做、谨慎、观望这些裁判动作是否真的有效”。

#### 28.3.1 页面标题与说明

| 位置 | 推荐文案 |
|------|----------|
| 页面标题 | 回测分析 |
| PK 页签标题 | PK 裁判验证 |
| 页面副标题 | 验证主推、可做、谨慎、观望在历史比赛中的命中率、ROI 与风险规避效果 |
| 样本不足提示 | 样本不足 30 场，仅供观察，暂不参与权重调整 |
| 数据同步提示 | 完赛结果回填中，部分比赛暂未纳入统计 |

#### 28.3.2 页签结构

建议先保留现有页签框架，强化 PK 页签，减少一次性重构风险。

| 页签 | 新定位 | 展示重点 |
|------|--------|----------|
| 功守道量化 | 基础模型验证 | 方向命中、比分命中、大小球、强弱共识、熔断效果 |
| AI 深度分析 | 文本模型验证 | SPF、大小球、风险标签、伤病/战意/赛程提示命中情况 |
| PK 裁判验证 | 核心页签 | 决策等级、EV、星级、分歧类型、降级规则、ROI |
| 实验对比 | 版本与权重实验 | V2.1 vs V2.2、Prompt、权重、Walk-Forward |

#### 28.3.3 顶部统计卡

| 卡片 | 推荐标题 | 展示口径 |
|------|----------|----------|
| 有效样本 | 有效样本 | 已完赛且有赛前快照的比赛数 |
| 主推表现 | 主推命中 / ROI | 主推样本的方向命中率和单注 ROI |
| 正 EV 表现 | 正 EV 命中 / ROI | `expectedValue > 0` 样本表现 |
| 风险规避 | 观望避坑 | 观望/熔断样本中实际未命中的场次或负收益规避数 |

顶部说明文案：

| 场景 | 推荐文案 |
|------|----------|
| 表现良好 | 主推表现优于可做与谨慎，裁判分层有效 |
| 表现一般 | 主推未明显优于可做，需继续观察权重与降级规则 |
| 风险有效 | 熔断/观望样本错误率较高，风险规避有效 |
| 样本不足 | 样本不足，仅展示趋势，不作为调参依据 |

#### 28.3.4 筛选项

| 筛选项 | 选项 |
|--------|------|
| 时间 | 近7日 / 近30日 / 近90日 / 自定义 |
| 联赛 | 全部 / 单联赛 |
| 玩法 | SPF / 让球 / 大小球 |
| 决策等级 | 主推 / 可做 / 谨慎 / 观望 |
| 分歧类型 | 多源同向 / 专家热市场反向 / 功守道强但 AI 风险 / PK 逆共识价值 / 熔断 / 数据质量低 |
| 价值标签 | 高概率高价值 / 高概率低价值 / 中概率高价值 / 低概率低价值 |
| 星级 | 5星 / 4星 / 3星 / 2星及以下 |
| 风险等级 | 低风险 / 中风险 / 高风险 |
| EV 区间 | 负 EV / 0~3% / 3~8% / 8%以上 |
| 数据质量 | 高 / 中 / 低 |

#### 28.3.5 图表与表格模块

| 模块 | 标题文案 | 需要回答的问题 |
|------|----------|----------------|
| 决策等级漏斗 | 决策等级表现 | 主推是否优于可做，可做是否优于谨慎 |
| 分歧类型表现 | 分歧场景回测 | 哪类冲突应该升权，哪类冲突应该降级 |
| EV 校验 | EV 区间收益 | 正 EV 是否真的带来更高 ROI |
| 星级校准 | 星级表现校准 | 星级越高，表现是否单调更好 |
| 降级规则验证 | 降级是否有效 | 专家过热、熔断、数据低质量是否确实应降级 |
| Walk-Forward 稳定性 | 滚动验证 | 策略是否过拟合，测试集是否稳定 |
| Monte Carlo 风险 | 收益波动评估 | 预期 ROI、最大回撤、亏损概率是否可接受 |

#### 28.3.6 明细列表与复盘文案

明细列表从“预测记录”升级为“赛前裁判快照 + 赛后验证”。

| 字段 | 展示文案 |
|------|----------|
| 比赛 | 编号、主客队、联赛、开赛时间 |
| 最终裁判 | 主推 / 可做 / 谨慎 / 观望 |
| 推荐玩法 | SPF / 让球 / 大小球 |
| 推荐方向 | 主胜 / 平 / 客胜 / 大 / 小 |
| 星级 | 1~5 星 |
| EV | 正 EV / 负 EV / 价值不足 |
| 分歧类型 | 专家热市场反向、功守道强但 AI 风险等 |
| 降级原因 | 专家过热、EV 不足、数据陈旧、熔断等 |
| 实际结果 | 完场比分与赛果 |
| 命中状态 | 命中 / 未命中 / 走水 / 未结算 |
| ROI | 单注收益表现 |
| 归因 | 过热、伤病、市场反向、数据失真、熔断有效 |

复盘详情页文案结构：

| 区块 | 文案方向 |
|------|----------|
| 赛前判断 | 专家、功守道、AI、市场、PK 裁判各自怎么看 |
| 裁判动作 | 为什么主推、可做、谨慎或观望 |
| 赛后结果 | 实际比分、方向是否命中、收益表现 |
| 归因结论 | 是模型判断失误、风险提示有效，还是市场反向有效 |
| 后续建议 | 类似场景升权、降权或继续观察 |

### 28.4 模型表现仪表盘文案规划

模型仪表盘从“命中率榜单”升级为“模型可靠性驾驶舱”。它不回答“谁最近猜中更多”，而回答“谁在什么场景下更值得信”。

#### 28.4.1 页面标题与说明

| 位置 | 推荐文案 |
|------|----------|
| 页面标题 | 模型表现 |
| 页面副标题 | 综合样本、命中率、ROI、校准能力和稳定性，判断当前模型可靠程度 |
| 排行标题 | 模型可靠性排行 |
| 权重标题 | 动态权重建议 |
| 样本提示 | 低于最小样本的模型不参与可靠性排名 |

#### 28.4.2 顶部统计卡

| 卡片 | 推荐标题 | 展示口径 |
|------|----------|----------|
| 活跃模型 | 活跃模型 | 近周期有有效预测的模型数 |
| 有效样本 | 有效样本 | 已完赛并可验证的预测样本 |
| 最佳稳定模型 | 最佳稳定模型 | 综合评分最高且样本达标的模型 |
| 模型健康 | 模型健康 | 稳定 / 波动 / 样本不足 / 数据延迟 |

模型健康文案：

| 状态 | 推荐文案 |
|------|----------|
| 稳定 | 近周期表现稳定，可参与权重建议 |
| 波动 | 近期波动较大，建议降低自动采信 |
| 样本不足 | 有效样本不足，仅供观察 |
| 数据延迟 | 完赛回填未完成，统计可能滞后 |

#### 28.4.3 可靠性排行

排行不按单一命中率排序，改为综合可靠性评分。

| 列 | 说明 |
|----|------|
| 排名 | 综合可靠性排序 |
| 模型 | PK 裁判、功守道、市场赔率、专家共识、AI 分析等 |
| 综合评分 | 命中率、ROI、校准、稳定性、样本覆盖综合得分 |
| 命中率 | 方向命中表现 |
| ROI | 单注收益表现 |
| 校准状态 | 准确 / 偏自信 / 偏保守 |
| 稳定性 | 高 / 中 / 低 |
| 样本 | 有效样本量 |

综合评分说明文案：

| 说明项 | 推荐文案 |
|--------|----------|
| 评分含义 | 综合评分不是命中率，而是模型可靠性评价 |
| 样本惩罚 | 样本过少时，即使命中率高也不会排在前列 |
| ROI 权重 | ROI 能识别高概率低价值与中概率高价值的差异 |
| 稳定性 | 近期波动越大，评分越保守 |

#### 28.4.4 校准能力

| 模块 | 文案 |
|------|------|
| 校准标题 | 信心校准 |
| 中文解释 | 模型说 80% 把握时，历史实际是否接近 80% |
| 偏自信 | 模型信心高于实际命中，需要降权 |
| 偏保守 | 模型实际命中高于信心，可适度升权 |
| 较准确 | 信心与实际结果接近，可保持权重 |

校准模块建议展示：高信心命中率、低信心规避率、校准误差、Brier Score / ECE 的中文解释。专业指标可以展示，但必须配中文口径，避免用户只看到术语。

#### 28.4.5 玩法表现矩阵

| 模型 | SPF | 让球 | 大小球 | 比分 |
|------|-----|------|--------|------|
| PK 裁判 | 展示命中率 / ROI | 展示命中率 / ROI | 展示命中率 / ROI | 如样本不足显示“-” |
| 功守道 | 展示命中率 / ROI | 展示命中率 / ROI | 展示命中率 / ROI | 展示比分命中 |
| AI 分析 | 展示命中率 / ROI | 如无结构化样本显示“-” | 展示命中率 / ROI | 展示比分命中 |
| 专家共识 | 展示命中率 / ROI | 展示命中率 / ROI | 如无样本显示“-” | “-” |
| 市场赔率 | 展示命中率 / ROI | 展示命中率 / ROI | 展示命中率 / ROI | “-” |

玩法解释文案：

| 场景 | 推荐文案 |
|------|----------|
| SPF | SPF 更依赖综合实力、市场概率与专家热度修正 |
| 让球 | 让球更依赖盘口深度、赢盘能力和市场变盘 |
| 大小球 | 大小球更依赖 xG、攻防效率、节奏和大小球盘口 |
| 比分 | 比分样本稀疏，主要用于辅助解释，不作为主排行依据 |

#### 28.4.6 模型擅长场景

| 维度 | 展示目的 |
|------|----------|
| 联赛 | 哪些联赛模型更可靠 |
| 赔率区间 | 低赔 / 中赔 / 高赔谁更有效 |
| 让球深度 | 平手、半球、一球等盘口下谁更稳定 |
| 大小球盘口 | 2 / 2.5 / 3 球区间谁更有效 |
| 冷热指数 | 专家热度高低对模型表现的影响 |
| 分歧类型 | 冲突场景下谁更值得信 |
| 数据质量 | 数据完整度对模型可靠性的影响 |

#### 28.4.7 动态权重建议

动态权重先作为“建议权重”，不直接自动覆盖生产规则。

| 场景 | 展示内容 |
|------|----------|
| SPF | PK、市场、功守道、专家、AI 的建议权重 |
| 让球 | PK、市场、功守道、专家、AI 的建议权重 |
| 大小球 | PK、市场、功守道、专家、AI 的建议权重 |
| 专家过热 | 降低专家共识权重，提高市场/PK/AI 风险权重 |
| AI 强风险 | 提高 AI 风险解释权重，限制主推 |

权重说明文案：

| 项目 | 文案 |
|------|------|
| 权重来源 | 基于近周期 Walk-Forward 验证形成建议 |
| 使用状态 | 可用 / 样本不足 / 暂不调整 |
| 风险提示 | 建议权重需通过回测验证后再进入生产 |
| 更新时间 | 最近更新时间 + 有效样本数 |

### 28.5 回测页与模型仪表盘边界

| 功能 | 回测分析页 | 模型表现仪表盘 |
|------|------------|----------------|
| 单场明细 | 强 | 弱 |
| 赛后归因 | 强 | 中 |
| 分歧类型验证 | 强 | 中 |
| 模型总体排行 | 中 | 强 |
| 动态权重建议 | 弱 | 强 |
| 联赛/玩法能力 | 中 | 强 |
| Walk-Forward | 强 | 强 |
| Monte Carlo | 强 | 中 |
| 今日机会 | 弱 | 不展示，交给首页和排行榜 |

文案边界：

| 页面 | 不应承载 |
|------|----------|
| 首页 | 不重排原首页结构，不放复杂模型解释，不放大表格，不放专业回测图 |
| 回测分析页 | 不做今日机会入口主路径，不把模型榜单作为核心 |
| 模型仪表盘 | 不做单场复盘主路径，不替代回测页做规则归因 |

### 28.6 落地优先级

| 优先级 | 首页 | 回测分析页 | 模型表现仪表盘 |
|--------|------|------------|----------------|
| P0 | 去掉顶部“老鹰智选”，新增一行 `今日 N 场｜机会 N`，并保留“最多推荐/最热场次”不动 | PK 页签改为“PK 裁判验证”，增加决策等级、EV、星级、分歧类型统计 | 排行改为可靠性排行，增加样本、ROI、稳定性、玩法指标 |
| P1 | 有明显风险时摘要追加 `风险 N`；无风险时不展示风险字段 | 接入 `conflictType`、`decisionLevel`、`valueEdge`、`expectedValue`、`degradeReasons` 回测 | 增加玩法矩阵、真实联赛热力图、校准误差、动态权重建议 |
| P2 | 如后续确有必要，再评估模型健康提示；当前阶段不新增模型状态卡 | 增加 Walk-Forward、Monte Carlo、赛后归因详情 | 增加动态权重版本管理和模型漂移预警 |

### 28.7 验收口径

| 页面 | 验收标准 |
|------|----------|
| 首页 | 用户 5 秒内能看到顶部轻量摘要 `今日 N 场｜机会 N`；有明显风险时能看到 `风险 N`；“最多推荐”和“最热场次”保持原结构可用 |
| 回测分析页 | 用户能判断 PK 主推是否优于可做、正 EV 是否有效、降级规则是否避坑 |
| 模型表现仪表盘 | 用户能判断哪个模型可靠、擅长哪个玩法/联赛/场景，以及是否适合调整权重 |

最终表达：

| 一句话 | 产品解释 |
|--------|----------|
| 首页看简报 | 原结构不动，只在顶部看今日场次与机会；有明显风险时补充风险数 |
| 回测看证据 | 历史验证规则是否有效 |
| 仪表盘看能力 | 模型在什么场景下可靠 |
| 排行榜看机会 | 具体哪场值得关注 |
| PK 弹窗看解释 | 为什么升星、降级或观望 |

---

## 二十九、开发落地蓝本与任务拆分

> 本章节用于把前文算法、字段、页面文案整理成可直接排期、开发、验收的蓝本。本阶段只整理文档，不写代码、不调整接口、不改数据库结构。

### 29.1 落地总原则

| 原则 | 要求 |
|------|------|
| 主链路优先 | 先保证首页、量化排行榜、PK 弹窗、回测页、模型仪表盘的入口和核心信息可用 |
| 最小改动 | 首页只做顶部轻量摘要，不重排原有结构，不动“最多推荐”和“最热场次” |
| PK 独立 | PK 核心评分与方向判定保持独立；专家、AI、市场等外部信号缺失时不阻断基础结论 |
| 字段可追踪 | 新增展示字段必须能追溯来源、口径、缺失兜底和回测用途 |
| 先展示后闭环 | P0 先完成页面表达和字段透出，P1/P2 再逐步补 EV、赛前快照、回测归因和动态权重 |
| 不硬编码主路径 | 页面主路径不得用纯前端硬编码业务数据；无真实外部系统时使用后端可追踪模拟或已有缓存数据 |
| 数据库写入合规 | 若后续新增持久化，必须走 `database.getAdapter()` 的 `execRun/execAll/execOne/execDDL`，禁止绕过适配器直接操作 raw 实例 |

### 29.2 本轮开发范围冻结

| 模块 | 本轮做 | 本轮不做 |
|------|--------|----------|
| 首页 | 去掉“老鹰智选”；新增 `今日 N 场｜机会 N`；有明显风险时追加 `风险 N` | 不新增三张大卡；不改“最多推荐/最热场次”；不新增模型状态卡 |
| 量化排行榜 | 梳理为机会发现页，优先展示主推/可做/谨慎/观望、星级、风险标签 | 不一次性重做所有榜单和复杂图表 |
| PK 弹窗 | 增加模型对比、分歧解释、降级原因的承载结构 | 不让 AI/专家成为 PK 基础计算硬依赖 |
| 回测分析页 | 强化 PK 裁判验证页签，展示决策等级、命中、ROI、风险规避 | 不把模型排行榜做成回测页核心 |
| 模型仪表盘 | 从命中率榜升级为可靠性看板，明确样本、ROI、稳定性、校准 | 不替代回测页做单场归因 |
| 数据闭环 | 先定义字段和快照口径 | 不在本轮直接引入自动动态权重覆盖生产规则 |

### 29.3 建议开发顺序

| 阶段 | 目标 | 主要产物 | 验收重点 |
|------|------|----------|----------|
| M0 文档冻结 | 以本文档作为开发基线 | 需求边界、字段口径、验收标准确认 | 开发前没有“首页是否重排”等方向性分歧 |
| M1 首页最小增强 | 最低风险上线首页摘要 | `home.js` 顶部摘要展示与字段兜底 | 原首页模块不位移，“最多推荐/最热场次”可用 |
| M2 数据契约整理 | 统一页面需要的输出字段 | 字段映射、缺失兜底、API 响应说明 | 缺字段不白屏，字段含义一致 |
| M3 PK 弹窗与量化榜 | 让用户看懂机会与降级原因 | PK 对比表、分歧解释、机会榜字段 | 用户能知道为什么主推/可做/谨慎/观望 |
| M4 回测分析页 | 验证 PK 裁判是否有效 | PK 裁判验证页签、统计卡、明细复盘 | 能按决策等级、EV、风险标签看历史表现 |
| M5 模型仪表盘 | 判断模型可靠性 | 可靠性排行、玩法矩阵、校准说明 | 不再只看命中率，能看到样本和稳定性 |
| M6 回测闭环增强 | 支持持续优化 | 赛前快照、赛后归因、Walk-Forward/Monte Carlo | 可追踪哪些规则有效，哪些需要降权 |

### 29.4 页面到文件的落地索引

| 页面/能力 | 主要前端文件 | 主要后端/数据文件 | 备注 |
|-----------|--------------|------------------|------|
| 首页摘要 | `preview/js/pages/home.js` | `server/index.js`、`server/data_sync.js`、功守道缓存/比赛列表数据 | 只补顶部摘要，不重排首页 |
| 量化排行榜 | `preview/js/pages/quant-rank-fusion.js`、`preview/js/pages/quant-rank.js` | `server/index.js`、`server/pk_scorer.js`、`server/gongshoudao/` | 优先复用现有量化数据与 PK 输出 |
| PK 弹窗 | `preview/js/pages/match-pk.js`、`preview/js/pages/match-pk-fusion.js` | `server/pk_scorer.js`、`server/gongshoudao/`、`server/core/` | 承载模型对比、分歧、降级原因 |
| 回测分析 | `preview/js/pages/backtest.js` | `server/backfill_full_models.js`、`prediction_logs`/`unified_predictions` 相关查询 | 优先强化 PK 裁判验证页签 |
| 模型仪表盘 | `preview/js/pages/model-dashboard.js` | `server/gongshoudao/model-weights.js`、回测统计数据 | 以可靠性、样本、ROI、稳定性为核心 |
| 数据同步 | 无固定页面 | `server/data_sync.js`、回填脚本、结果回填逻辑 | 保障完赛结果、回测样本和模型统计自愈 |

### 29.5 统一数据契约

#### 29.5.1 首页摘要字段

| 字段 | 类型 | 来源建议 | 缺失兜底 | 展示规则 |
|------|------|----------|----------|----------|
| `todayMatchCount` | number | 当日比赛列表总数 | `0` | 始终展示为 `今日 N 场` |
| `todayOpportunityCount` | number | PK/量化中 `main_pick + playable` 数量 | `0` | 始终展示为 `机会 N` |
| `todayRiskCount` | number | 熔断、数据低质、专家过热、强风险等明显风险场次数 | `0` | 仅 `N > 0` 且需要提醒时展示 `风险 N` |

首页最终文案规则：

```text
无明显风险：今日 N 场｜机会 N
有明显风险：今日 N 场｜机会 N｜风险 N
```

#### 29.5.2 PK 裁判通用字段

| 字段 | 必需级别 | 用途 |
|------|----------|------|
| `matchId` / `matchNum` | P0 | 页面定位比赛与跳转 |
| `playType` | P0 | 区分 SPF、让球、大小球 |
| `finalDirection` | P0 | 最终推荐方向或观望 |
| `decisionLevel` | P0 | 主推 / 可做 / 谨慎 / 观望 |
| `stars` | P0 | 页面星级表达 |
| `riskLevel` | P0 | 低 / 中 / 高风险表达 |
| `riskTags` | P0 | 风险标签展示与筛选 |
| `degradeReasons` | P0 | 降级/观望原因 |
| `decisionNarrative` | P0 | 一句话解释 |
| `agreementScore` | P1 | 多来源一致度 |
| `conflictType` | P1 | 分歧类型回测 |
| `valueEdge` | P1 | 价值边际 |
| `expectedValue` | P1 | EV 与 ROI 验证 |
| `featureSnapshotId` | P2 | 赛前快照和赛后复盘关联 |

#### 29.5.3 缺失兜底规则

| 缺失场景 | 页面行为 | 计算行为 |
|----------|----------|----------|
| 无专家共识 | 显示“专家数据暂缺”或隐藏专家列 | PK 基础结论继续输出 |
| 无 AI 分析 | 显示“AI 分析暂缺”或隐藏 AI 风险 | 不影响功守道/PK 基础判断 |
| 无市场赔率 | EV/市场列显示“待补充” | 不升高价值标签，必要时降为谨慎 |
| 无完赛结果 | 回测明细显示“未结算” | 不纳入命中率/ROI 统计 |
| 数据质量低 | 展示数据质量风险 | 星级上限按硬规则处理 |

### 29.6 模块验收清单

#### 29.6.1 首页

- 顶部不再显示“老鹰智选”；
- 顶部显示 `今日 N 场｜机会 N`；
- 有明显风险时显示 `今日 N 场｜机会 N｜风险 N`；
- 无风险时不展示风险字段；
- “最多推荐”模块标题、布局、数据、跳转保持不变；
- “最热场次”模块标题、布局、数据、跳转保持不变；
- 页面不新增三张统计大卡，不新增模型状态卡。

#### 29.6.2 量化排行榜

- 至少能按 `decisionLevel` 区分主推、可做、谨慎、观望；
- 每场展示方向、星级、风险标签和一句话理由；
- 缺少 AI/专家/市场数据时不白屏；
- 风险场次不能被误展示为“稳胆”。

#### 29.6.3 PK 弹窗

- 用户能看到 PK 最终方向、决策等级、星级、风险标签；
- 用户能看到至少一种“为什么升星/降级/观望”的解释；
- 多来源数据存在时，可展示专家、功守道、AI、市场、PK 的方向差异；
- `fusionConsensus = meltdown`、负 EV、数据质量低等硬规则必须在页面表达。

#### 29.6.4 回测分析页

- 能按决策等级查看样本、命中率和 ROI；
- 能区分未结算样本与有效样本；
- 能展示降级规则是否有效；
- 样本不足时必须明确提示“仅供观察”。

#### 29.6.5 模型仪表盘

- 排行不只按命中率；
- 必须展示样本量、ROI、稳定性或校准状态；
- 样本不足模型不参与可靠性排名或明确标记；
- 动态权重只作为建议，不自动覆盖生产规则。

### 29.7 测试与发布门禁

| 类型 | 范围 | 验收点 |
|------|------|--------|
| 单元/模块测试 | PK 字段组装、风险规则、EV/降级规则 | 不破坏原 PK 基础结论 |
| API 冒烟 | 比赛列表、PK 详情、量化榜、回测统计 | 返回结构稳定，缺字段有兜底 |
| 前端主链路 | 首页 → 最多推荐/最热场次 → 量化榜 → PK 弹窗 → 回测/模型 | 页面不白屏，入口可点击 |
| 回归检查 | 原首页布局、方案入口、底部导航 | 原有模块不位移、不丢失 |
| 数据质量 | 完赛结果、样本过滤、未结算处理 | 统计口径不混入未结算样本 |
| 发布前门禁 | `npm run test:p0`、`npm run preflight` | 未通过不得宣称可发布 |

### 29.8 风险与回滚策略

| 风险 | 触发场景 | 回滚/降级 |
|------|----------|-----------|
| 首页首屏被挤压 | 摘要样式占用过高 | 摘要改为单行小字，仅保留 `今日 N 场｜机会 N` |
| 数据暂缺导致白屏 | 新字段未返回或返回空 | 全部字段使用默认值，模块局部隐藏 |
| 风险数误伤体验 | 风险口径过宽导致每天都有风险 | 仅统计明显风险；必要时先不上风险字段 |
| 外部信号不稳定 | AI/专家/市场数据延迟 | PK 基础结论继续输出，外部列显示暂缺 |
| 回测样本污染 | 未结算或低质量样本进入统计 | 严格过滤，显示样本不足提示 |
| 动态权重误入生产 | 未验证权重直接覆盖规则 | 权重建议只读展示，进入生产需另走实验审批 |

### 29.9 可拆分开发任务

| 任务ID | 优先级 | 任务 | 涉及模块 | 验收结果 |
|--------|--------|------|----------|----------|
| PKD-M1-01 | P0 | 首页顶部最小摘要 | 首页 | 显示 `今日 N 场｜机会 N`，原模块不动 |
| PKD-M1-02 | P0 | 首页风险字段条件展示 | 首页 | 仅有明显风险时追加 `风险 N` |
| PKD-M2-01 | P0 | PK 裁判输出字段标准化 | PK/量化 | `decisionLevel`、`riskTags`、`degradeReasons` 有统一口径 |
| PKD-M3-01 | P0 | PK 弹窗解释区 | PK 弹窗 | 能解释升星、降级、观望原因 |
| PKD-M3-02 | P1 | 量化排行榜机会分层 | 量化排行榜 | 主推/可做/谨慎/观望可筛选或识别 |
| PKD-M4-01 | P1 | 回测页 PK 裁判验证 | 回测分析 | 能按决策等级看命中率和 ROI |
| PKD-M5-01 | P1 | 模型可靠性排行 | 模型仪表盘 | 展示样本、ROI、稳定性、校准说明 |
| PKD-M6-01 | P2 | 赛前快照与赛后归因 | 数据闭环 | 可按 `conflictType`、玩法、联赛、EV 区间回测 |
| PKD-M6-02 | P2 | Walk-Forward/Monte Carlo 验证 | 实验/回测 | 输出权重建议和风险评估，不直接改生产 |

### 29.10 开发前确认清单

开发开始前必须确认：

1. 首页只做方案 B，不做结构重排；
2. “最多推荐”和“最热场次”保持原样；
3. P0 不引入新的强依赖外部系统；
4. 所有新增字段都有缺失兜底；
5. 回测统计必须排除未结算样本；
6. 新增持久化必须走数据库适配器；
7. 发布前必须跑 P0 测试和 preflight；
8. 本章节任务表可作为后续拆 issue、排期和验收依据。

---

## 附录A：版本变更日志

| 版本 | 日期 | 详细变更 | 代码变更文件 |
|------|------|---------|------------|
| **pk_v2.3-dev-blueprint-doc** | 2026-06-13 | **开发落地蓝本整理**：新增实施边界、开发顺序、页面到文件索引、统一数据契约、模块验收清单、测试门禁、风险回滚和可拆分任务表 | 文档变更；暂不改代码 |
| **pk_v2.2-page-copy-doc** | 2026-06-13 | **页面文案规划**：新增回测分析页、模型表现仪表盘与首页最小增强的页面定位；首页只加顶部轻量摘要 `今日 N 场｜机会 N`，有明显风险时追加 `风险 N`，保留“最多推荐/最热场次”不动 | 文档变更；暂不改代码 |
| **pk_v2.2-fusion-doc** | 2026-06-13 | **对比融合方案**：新增专家共识、功守道、AI预测分析与 PK 量化的模块定位、标准化数据合同、分歧裁判机制、EV价值判断、三玩法独立融合、硬性降级、页面展示、排行榜机会榜与赛后复盘闭环 | 文档变更；暂不改代码 |
| **pk_v2.1-page-doc** | 2026-06-13 | **页面优化方案**：新增量化排行榜与 PK 弹窗页面定位、字段清单、统一数据合同、三玩法分栏、风控解释、图表说明与 P0/P1/P2 实施优先级 | 文档变更；暂不改代码 |
| **pk_v2.1-doc** | 2026-06-13 | **准确率提升方案**：新增实际数据审计、8维目标架构、7维短期权重、8维中期权重、概率门禁、数据质量门禁、Walk-Forward 验证与灰度路线 | 文档变更；暂不改代码 |
| **pk_v2.0** | 2026-06-09 | **实力评分权重优化**：pwScore 0.3→0.35, gdScore 0.3→0.25, crossValue 0.2→0.15, adCombined 0.2→0.25 | `pk_scorer.js` calcPowerScores |
| | | **进球评分权重优化**：bigBallRatio 0.3→0.35, attDefGoal 0.3→0.25 | `pk_scorer.js` calcGoalScores |
| | | **共识奖励**：strong 共识 + 验证分 ≥85 → compositeScore +3 | `pk_scorer.js` computeAllScores |
| | | **版本追踪系统**：新增 `pk_scorer_version` / `experiment_id` / `experiment_group` 字段 | `pk_scorer.js`, `prediction_log.js`, `index.js`, `backfill_full_models.js` |
| | | **版本对比 API**：`POST /api { action: 'pk-version-compare' }` | `index.js`, `prediction_log.js` queryPKVersionCompare |
| **pk_v1.0** | 初始版 | 原始 7 维评分算法、4 因子加权归一化、方向判定矩阵 | 基线 |
