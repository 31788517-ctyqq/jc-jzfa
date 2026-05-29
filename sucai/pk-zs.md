# 足球雷达排行榜·完整产品文档（V3.0 终极整合版）

**文档状态**：✅ 已锁定 | 可交付开发 | 禁止篡改
**适用对象**：产品经理 / UI设计师 / 前端开发 / 后端开发 / 算法工程师
**整合声明**：本文档整合了《实力PK》、《进球数预测》、《热度PK》三大模块，并依据《足球全景智算分析系统》与《功守道·八阵图 V24.0》对核心算法进行了统一修正与补全。**所有算法以本文档为准。**

---

## 第一部分：全局规范与数据字典

### 1.1 全局通用规则

1.  **视角唯一性**：所有计算以**主队视角**为准。**正数 (+)** 代表主队占优，**负数 (-)** 代表客队占优。
2.  **精度规范**：
    -   中间计算过程浮点数保留 **4位小数**。
    -   最终展示百分比保留 **2位小数** (如 `18.73%`)。
    -   SP值展示保留 **2位小数**。
3.  **占比计算**：
    -   分母（列合计）始终为该列**绝对值之和**。
    -   \(\text{占比} = \frac{\text{单项数值}}{\text{列合计}}\)（保留正负符号）。
4.  **动态PK逻辑**：用户勾选多场点击“PK”时，**列合计**仅基于当前勾选的行重新计算。
5.  **数据缺失处理**：大球比例相关数据缺失时，默认取值 **50%**。

### 1.2 核心数据字段映射表

本文档所有算法均基于以下从《足球全景智算分析系统》中提取的 JS 字段。后端开发必须确保这些字段被正确计算和传递。

| 数学符号 | 字段名 | 中文释义 | 业务口径与逻辑说明 |
| :--- | :--- | :--- | :--- |
| \( homePower, guestPower \) | homePower, guestPower | 主/客队战力指数 | 综合身价、排名、战绩的实力量化评分（0-100）。 |
| \( rq \) | rq | 竞彩让球数 | 竞彩官方胜平负玩法的固定让球设定（如 -1 代表主让一球）。 |
| \( G_h, G_a \) | homeAvgGoals, guestAvgGoals | 主/客队近期场均进球 | 近10场比赛的平均进球数。 |
| \( G_{ha}, G_{ah} \) | homeAvgConceded, guestAvgConceded | 主/客队近期场均失球 | 近10场比赛的平均失球数。 |
| \( G_{hh}, G_{ha} \) | homeHomeAvgGoals, homeHomeAvgConceded | 主队主场场均进/失球 | 主队在主场比赛时的场均进球和失球。 |
| \( G_{aa}, G_{ah} \) | awayAwayAvgGoals, awayAwayAvgConceded | 客队客场场均进/失球 | 客队在客场比赛时的场均进球和失球。 |
| \( Eff_{atk,h}, Eff_{atk,a} \) | homeEnterEfficiency, guestEnterEfficiency | 主/客队进攻效率 | 进球数 / 射门次数。 |
| \( Eff_{def,h}, Eff_{def,a} \) | homePreventEfficiency, guestPreventEfficiency | 主/客队防守效率 | 失球数 / 被射门次数。 |
| \( W_6, D_6, L_6 \) | homeSpf, guestSpf | 主/客队近期胜平负走势 | 球队最近10场比赛的具体胜、平、负场数。 |
| \( WG2_h, WG1_h \) | homeWinGap_2, homeWinGap_1 | 主队赢球净胜统计 | 主队获胜时，净胜2+球与净胜1球的场次。 |
| \( LG2_h, LG1_h \) | homeLoseGap_2, homeLoseGap_1 | 主队输球净负统计 | 主队落败时，净负2+球与净负1球的场次。 |
| \( WG2_a, WG1_a \) | awayWinGap_2, awayWinGap_1 | 客队赢球净胜统计 | 客队获胜时，净胜2+球与净胜1球的场次。 |
| \( LG2_a, LG1_a \) | awayLoseGap_2, awayLoseGap_1 | 客队输球净负统计 | 客队落败时，净负2+球与净负1球的场次。 |
| \( Q0_h, Q1_h, Q2p_h \) | homeWinQiu_0/1/2 | 主队进球数分布 | 主队过去10场中，进球数为 0、1、2+ 球的场次。 |
| \( C0_h, C1_h, C2p_h \) | homeLoseQiu_0/1/2 | 主队失球数分布 | 主队过去10场中，失球数为 0、1、2+ 球的场次。 |
| \( Q0_a, Q1_a, Q2p_a \) | awayWinQiu_0/1/2 | 客队进球数分布 | 客队过去10场中，进球数为 0、1、2+ 球的场次。 |
| \( C0_a, C1_a, C2p_a \) | awayLoseQiu_0/1/2 | 客队失球数分布 | 客队过去10场中，失球数为 0、1、2+ 球的场次。 |
| \( P_h, P_d, P_a \) | lastWinRate, lastDrawRate, lastLoseRate | 欧指临盘胜平负概率 | 基于欧指即时赔率更新的最新理论概率。 |
| \( dxqLastPan \) | dxqLastPan | 大小球临盘界限 | 机构即时设定的进球数分界线（如2.5）。 |
| \( lastPan \) | lastPan | 亚指临盘盘口 | 即时亚指盘口数值（如 -0.75）。 |

---

## 第二部分：实力PK模块

### 2.1 产品定义与核心指标

**产品定位**：通过多维度量化算法，将抽象的球队实力转化为标准化的可视化数值体系。输出以 **主队视角** 为准。

| 维度 | 定义 | 数据极性 | 算法来源 |
| :--- | :--- | :--- | :--- |
| **净胜球量化** | 基于攻防频次还原的真实预期净胜球。 | + 主队预期进球多 | 源自主客近期期望模块（本模块2.2.A） |
| **胜平负交叉** | 基于真实历史赛果的交叉对冲，稳定性高于赔率。 | + 主队赛果占优 | 源自近期战绩统计（基于文档二Cross-2修正） |
| **综合实力** | 结合静态基本面与动态近期状态的双轨评分。 | + 主队基本面强 | 源自M1双轨量化（基于文档二M1修正） |
| **攻守实力** | 基于功守道V24.0模型，细分进攻与防守的效率差。 | + 主队攻守平衡/压制 | 源自《功守道·八阵图 V24.0》（基于文档三完整算法） |

### 2.2 核心算法详解

#### A. 净胜球量化 (Goal Difference Quantification)

**目标**：通过射门次数与效率还原底层攻防频次，计算预期进球差。

**数据映射**：
- \(G_h\): `homeAvgGoals`
- \(G_{ha}\): `homeAvgConceded`
- \(Eff_{atk,h}\): `homeEnterEfficiency`
- \(Eff_{def,h}\): `homePreventEfficiency`
- 客队变量同理。

**第一阶段：还原底层攻防次数**
\[
\text{Atk}_h = \frac{G_h}{Eff_{atk,h} + 0.001},\quad
\text{ShotAgainst}_h = \frac{G_{ha}}{Eff_{def,h} + 0.001}
\]
\[
\text{Atk}_a = \frac{G_a}{Eff_{atk,a} + 0.001},\quad
\text{ShotAgainst}_a = \frac{G_{ah}}{Eff_{def,a} + 0.001}
\]

**第二阶段：计算四维呼吸权重**
\[
\beta_1 = \frac{\text{Atk}_h}{\text{Atk}_h + \text{ShotAgainst}_a},\quad
\beta_2 = \frac{\text{Atk}_a}{\text{Atk}_a + \text{ShotAgainst}_h}
\]
\[
\beta_3 = \frac{G_{hh} - G_{ha}}{G_{hh} + G_{ha} + 1},\quad
\beta_4 = \frac{G_{aa} - G_{ah}}{G_{aa} + G_{ah} + 1}
\]

**第三阶段：终极进球期望计算**
\[
E_h = \beta_1 \times \text{Atk}_h + \beta_3 \times G_{hh}
\]
\[
E_a = \beta_2 \times \text{Atk}_a + \beta_4 \times G_{aa}
\]

**最终输出**：
\[
\text{净胜球量化} = E_h - E_a
\]

---

#### B. 胜平负交叉 (Result Cross Advantage) - **基于文档二Cross-2修正**

**目标**：利用合并后的主客队近10场净胜球分布，计算不让球与让球（R=rq）情况下的胜平负概率。

**数据准备：构造合并净胜球分布（主队视角，共20场）**
| 净胜球档位 | 合并场次 |
| :--- | :--- |
| +2 | \(WG2_h + LG2_a\) |
| +1 | \(WG1_h + LG1_a\) |
| 0 | \(PG_h + PG_a\) |
| -1 | \(LG1_h + WG1_a\) |
| -2 | \(LG2_h + WG2_a\) |

**不让球组（让球数 \(R = 0\)）**
\[
P_{\text{主胜}} = \frac{WG2_h + WG1_h + LG2_a + LG1_a}{20} \times 100\%
\]
\[
P_{\text{平局}} = \frac{PG_h + PG_a}{20} \times 100\%
\]
\[
P_{\text{客胜}} = \frac{LG2_h + LG1_h + WG2_a + WG1_a}{20} \times 100\%
\]

**让球组（让球数 \(R = rq\)）**
对于每个净胜球档位 \(d\)，计算偏移后的判断：
- 若 \(d - R > 0\) → 让胜
- 若 \(d - R = 0\) → 让平
- 若 \(d - R < 0\) → 让负

统计20场中让胜、让平、让负的场次数，计算百分比。

**最终输出**：
\[
\text{胜平负交叉} = \text{“胜XX% 平XX% 负XX% (让0) + 让胜XX% 让平XX% 让负XX% (让R)”}
\]

---

#### C. 综合实力量化 (Composite Strength - Dual Track) - **基于文档二M1修正**

**目标**：60%静态硬实力 + 40%动态状态。

**数据映射**：
- `homePower`, `guestPower`：静态战力指数
- `homeSpf`, `guestSpf`：近10场胜/平/负场次
- 加权得分率计算所需近6场、近3场、近1场数据需从比赛明细提取。

**静态实力量化**
\[
\text{StaticAdv} = \frac{\text{homePower} - \text{guestPower}}{\text{homePower} + \text{guestPower}}
\]

**动态状态**
从近10场数据中，进一步提取近6场（\(W_6, D_6, L_6\)）、近3场（\(W_3, D_3, L_3\)）、近1场（\(W_1, D_1, L_1\)）的胜平负场次。
\[
P_6 = \frac{3W_6 + D_6}{18},\quad P_3 = \frac{3W_3 + D_3}{9},\quad P_1 = \frac{3W_1 + D_1}{3}
\]
\[
\text{状态值}_{\text{主}} = 0.5 \times P_6 + 0.3 \times P_3 + 0.2 \times P_1
\]
\[
\text{状态值}_{\text{客}} = 0.5 \times P_6^{(a)} + 0.3 \times P_3^{(a)} + 0.2 \times P_1^{(a)}
\]
\[
\text{DynAdv} = \frac{\text{状态值}_{\text{主}} - \text{状态值}_{\text{客}}}{\text{状态值}_{\text{主}} + \text{状态值}_{\text{客}}}
\]

**最终输出**
\[
\text{综合实力} = 0.6 \times \text{StaticAdv} + 0.4 \times \text{DynAdv}
\]

---

#### D. 攻守实力量化 (Attack-Defense Dao V24.0) - **基于文档三完整算法**

**目标**：严格按顺序执行以下数学模型，浮点数保留4位小数。

**第一阶段：进攻相对优势度**

1. **赢球格局得分对冲**
   \[
   \text{WinScore}_h = 2 \times WG2_h + 1 \times WG1_h + 0.5 \times PG_h
   \]
   \[
   \text{WinScore}_a = 2 \times WG2_a + 1 \times WG1_a + 0.5 \times PG_a
   \]
   \[
   \text{对冲赢球格局} = \frac{\text{WinScore}_h - \text{WinScore}_a}{10}
   \]

2. **攻击力纯能效对冲**
   \[
   \text{AtkEff}_h = \frac{G_h}{Eff_{atk,h} + 0.001},\quad
   \text{AtkEff}_a = \frac{G_a}{Eff_{atk,a} + 0.001}
   \]
   \[
   \text{对冲攻击能效} = \frac{\text{AtkEff}_h - \text{AtkEff}_a}{\max(\text{AtkEff}_h, \text{AtkEff}_a, 0.01)}
   \]

3. **进球厚度分布对冲**
   \[
   \text{Thick}_h = 0 \times Q0_h + 1 \times Q1_h + 2 \times Q2p_h
   \]
   \[
   \text{Thick}_a = 0 \times Q0_a + 1 \times Q1_a + 2 \times Q2p_a
   \]
   \[
   \text{对冲进球厚度} = \frac{\text{Thick}_h - \text{Thick}_a}{10}
   \]

4. **合成进攻优势**
   \[
   Adv_{\text{进攻}} = 0.4 \times \text{对冲赢球格局} + 0.35 \times \text{对冲攻击能效} + 0.25 \times \text{对冲进球厚度}
   \]

**第二阶段：防守相对优势度**

1. **输球空间与容错对冲**
   \[
   \text{LossScore}_h = 2 \times LG2_h + 1 \times LG1_h,\quad
   \text{LossScore}_a = 2 \times LG2_a + 1 \times LG1_a
   \]
   \[
   \text{对冲输球空间} = \frac{\text{LossScore}_a - \text{LossScore}_h}{10}
   \]

2. **防御纯能效对冲**
   \[
   \text{DefEff}_h = \frac{G_{ha}}{Eff_{def,h} + 0.001},\quad
   \text{DefEff}_a = \frac{G_{ah}}{Eff_{def,a} + 0.001}
   \]
   \[
   \text{对冲防御能效} = \frac{\text{DefEff}_a - \text{DefEff}_h}{\max(\text{DefEff}_h, \text{DefEff}_a, 0.01)}
   \]

3. **失球厚度与零封率对冲**
   \[
   \text{ConcededThick}_h = 0 \times C0_h + 1 \times C1_h + 2 \times C2p_h
   \]
   \[
   \text{ConcededThick}_a = 0 \times C0_a + 1 \times C1_a + 2 \times C2p_a
   \]
   \[
   \text{对冲失球厚度} = \frac{\text{ConcededThick}_a - \text{ConcededThick}_h}{10}
   \]

4. **合成防守优势**
   \[
   Adv_{\text{防守}} = 0.4 \times \text{对冲输球空间} + 0.35 \times \text{对冲防御能效} + 0.25 \times \text{对冲失球厚度}
   \]

**第三阶段：格局划分与权重融合**

1. **进攻权重**
   \[
   w_{\text{进攻}} = \frac{1}{1 + e^{-Adv_{\text{进攻}}}}
   \]
2. **防守权重**
   \[
   w_{\text{防守}} = 1 - w_{\text{进攻}}
   \]
3. **最终输出**
   \[
   \text{攻守实力} = w_{\text{进攻}} \times Adv_{\text{进攻}} + w_{\text{防守}} \times Adv_{\text{防守}}
   \]

**攻防格局判定**：
- 若 \( Adv_{\text{进攻}} > 0.15 \) 且 \( Adv_{\text{防守}} > -0.05 \) → “对攻为主”
- 若 \( Adv_{\text{防守}} > 0.15 \) 且 \( Adv_{\text{进攻}} > -0.05 \) → “防守为主”
- 否则 → “攻守平衡”

### 2.3 UI/UX设计规范

#### 表格布局（默认视图：量化数值）
| 序号 | 对阵 | 净胜球量化 | 胜平负交叉 | 综合实力 | 攻守实力 | **总排序** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 利物浦 vs 切尔西 | +0.35 | +0.18 | +0.22 | +0.15 | **+0.225** |

#### 交互逻辑
- **总排序算法**：四项指标等权平均。
  \[
  \text{总排序} = \frac{1}{4}(\text{净胜球量化} + \text{胜平负交叉} + \text{综合实力} + \text{攻守实力})
  \]
- **PK功能**：勾选多场比赛后，重新计算当前选中行的“列合计”及各项“占比”。

---

## 第三部分：进球数预测与PK模块

### 3.1 产品定义与核心指标

**产品定位**：大小球研判核心工具，输出标准化的进球预期，支持多场横向对比。

| 维度 | 定义 | 算法来源 |
| :--- | :--- | :--- |
| **合计** | 各维度绝对值之和 | \( \text{合计} = \sum \|维度_i\| \) |
| **大球比例** | 综合主客及交锋的大球倾向 | 本模块3.2.A |
| **攻防进球** | 基于射门次数与效率还原的物理进球预期 | M3_A（同2.2.A净胜球量化阶段的 \(E_h + E_a\)） |
| **实力进球** | 基于武力值与厚度的加权进球预期 | M3_B（本模块3.2.C） |
| **交锋进球** | 基于双方历史交手的进球惯性 | M3.6（本模块3.2.D） |
| **破甲和** | 衡量双方防线被击穿的难度总和 | 本模块3.2.E |

### 3.2 核心算法详解

#### A. 大球比例 (Big Ball Ratio)
**数据映射**：主/客队大球率、交锋大球率（近10场总进球≥3球的场次比例）。
\[
\text{大球比例} = 0.4 \times \text{主队大球率} + 0.4 \times \text{客队大球率} + 0.2 \times \text{交锋大球率}
\]

#### B. 攻防进球 (M3_A: Shot Restoration)
直接使用 **【2.2.A 净胜球量化】** 阶段计算的 \(E_h\) 和 \(E_a\)：
\[
\text{攻防进球} = E_h + E_a
\]

#### C. 实力进球 (M3_B: Attack-Defense Weighting) - **基于文档二补全**
**数据映射**：主客队静态进球能力（取历史场均进球加权值，若无则用 `G_h`/`G_a`），综合实力优势 `Adv_comp` 来自 **【2.2.C 综合实力】**。
\[
\text{实力进球} = 0.5 \times (G_h + G_a) \times (1 + 0.2 \times Adv_comp)
\]

#### D. 交锋进球 (M3.6: Head-to-Head)
**数据映射**：`jiaoFenDesc`（近6次交锋总进球 \(G_6\)），`jiaoFenMatch1/2`（近2次交锋总进球 \(G_2\)）。
\[
\text{交锋进球} = 0.3 \times G_6 + 0.7 \times G_2
\]

#### E. 破甲和 (Penetration Sum)
**数据映射**：复用 **【2.2.A】** 中的 `Atk_h`, `ShotAgainst_a`, `Atk_a`, `ShotAgainst_h`。
\[
\text{破甲和} = \frac{\text{Atk}_h}{\text{ShotAgainst}_a + 0.5} + \frac{\text{Atk}_a}{\text{ShotAgainst}_h + 0.5}
\]

### 3.3 UI/UX设计规范

#### 表格布局
| 序号 | 对阵 | 大球比例 | 攻防进球 | 实力进球 | 交锋进球 | 破甲和 | **合计** |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 利物浦 vs 切尔西 | 65% | 2.85 | 2.60 | 2.40 | 1.95 | **9.80** |

#### 底部PK面板
勾选多场比赛后，底部面板动态展示合计值及各项占比。

---

## 第四部分：热度PK模块

### 4.1 产品定义与核心指标

**产品定位**：资金流向与市场情绪监测模块，数据**每半小时更新一次**。

| 维度 | 定义 | 应用场景 |
| :--- | :--- | :--- |
| **让球数 (rq)** | 亚洲让球盘口 | 决定冷热算法分支 |
| **市场关注热度 (H)** | 市场总体关注量、成交量或活跃度指标 | 判断资金深度 |
| **冷热指数 (HI)** | 投注比例与理论概率的比值 | 核心判断依据 |
| **主/客队特征** | 球队基本面/盘口特征描述 | 辅助定性分析 |
| **静态实力差** | 基本面硬实力差距 | 验证热度合理性 |
| **亚指临盘** | 当前亚洲盘水位变化 | 配合热度看赔付风险 |

### 4.2 核心算法详解

**核心变量**：
- \(H\)：`hotFocusNum`（市场关注热度）
- \(bet_h, bet_a\)：`homeBetPercent`, `awayBetPercent`（主客队投注比例）
- \(P_h, P_a\)：`lastWinRate`, `lastLoseRate`（欧指临盘胜/负概率）
- \(rq\)：让球数

#### 冷热指数算法 (\(HI\))

**场景 A：一球受让 (\(rq = -1\))**
\[
HI = \frac{bet_h}{P_h}
\]
判定：\(HI > 1.40\) 🔥严重过热；\(0.85 \le HI \le 1.40\) 🎯筹码均衡；\(HI < 0.85\) 🧊逆向冷藏。

**场景 B：一球让球 (\(rq = +1\))**
\[
HI = \frac{bet_a}{P_a}
\]
判定标准同场景A。

**场景 C：深盘受让 (\(rq \le -2\))**
\[
HI = \frac{bet_h}{P_h \times (1 + 0.2 \times |rq|)}
\]
判定：\(HI > 1.30\) 🔥过热；\(1.10 < HI \le 1.30\) ⚠️微热；\(HI \le 1.10\) 🎯正常。

**场景 D：深盘让球 (\(rq \ge +2\))**
\[
HI = \frac{bet_a}{P_a \times (1 + 0.2 \times rq)}
\]
判定标准同场景C。

### 4.3 UI/UX设计规范

| 序号 | 对阵 | 让球数 | 市场热度 | 冷热指数 | 主队特征 | 客队特征 | 静态实力差 | 亚指临盘 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 利物浦 vs 切尔西 | -1 | 1200w | **1.52 🔥** | 主场龙 | 客场虫 | +0.18 | 0.85 |

---

## 第五部分：M3.7 四重一致性验证与熔断（进球数预测核心）

为确保进球数预测的稳定性，后端必须在M3_A、M3_B、M3_C的基础上，执行以下融合逻辑，并将**最终基准**输出给前端用于展示或比分预测。

**输入源**：
- \(E_A = \text{攻防进球}\)（来自3.2.B）
- \(E_B = \text{实力进球}\)（来自3.2.C）
- \(E_C = \text{交锋进球}\)（来自3.2.D）
- \(P_{asia} = dxqLastPan\)（大小球临盘界限）

**一致性判定与熔断**：
计算两两差值的绝对值 \(d_{AB} = |E_A - E_B|\)，\(d_{AC} = |E_A - E_C|\)，\(d_{BC} = |E_B - E_C|\)。
- **强一致（3对差值 ≤ 0.3）**：
  \[
  E_{\text{final}} = \frac{E_A + E_B + E_C}{3}
  \]
- **弱一致（2对差值 ≤ 0.3）**：剔除分歧值，取剩余两个的平均值。
- **严重分歧/熔断（≤1对差值 ≤ 0.3）**：
  \[
  E_{\text{final}} = P_{asia}
  \]
  UI显示“⚠️ 模型严重分歧，强制熔断保护”。

**UI展示**：前端在进球预测表格中，应展示此最终基准，并附带一致性状态标签（如“强一致”、“弱一致”、“熔断”）。

---

**文档结束**