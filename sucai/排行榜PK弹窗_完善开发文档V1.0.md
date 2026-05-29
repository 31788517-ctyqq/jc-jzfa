# 量化数据排行榜 & PK弹窗 — 完善开发文档 V1.0

**对标文档**：`sucai/pk-zs.md`（足球雷达排行榜·完整产品文档 V3.0 终极整合版）
**生成日期**：2026-05-29
**文档状态**：待评审 | 禁止直接修改

---

## 一、现状扫描总览

当前代码已实现三tab排行榜（实力 / 进球 / 热度）+ 三tab PK弹窗（实力PK / 进球PK / 热度PK）的基本框架，但**与 pk-zs.md V3.0 存在 4 类共 15 项差距**。

| 分级 | 含义 | 数量 |
|:---|:---|:---|
| **P0** | 公式/数据错误，影响正确性 | 5 项 |
| **P1** | 功能缺失，影响信息完整性 | 5 项 |
| **P2** | 展示不规范，影响产品一致性 | 3 项 |
| **P3** | UI/UX 细节优化 | 2 项 |

---

## 二、P0 — 公式/数据错误

### P0-1：实力PK弹窗 → `colSums` 列合计计算使用旧字段公式

**文件**：`preview/js/pages/match-pk.js` → `renderPKPower()` 第 269~292 行

**问题**：Power PK 的列合计（colSums）和数据行取值沿用旧版字段计算方式，与 `quant-rank.js` 的 `mergeItem()` 输出的新字段不匹配，导致占比计算错误。

| 维度 | 当前错误代码 | 应改为 |
|:---|:---|:---|
| 净胜球 | `parseFloat(String(item.goalDiff).split('/')[0])` | `parseFloat(item.gdScore) \|\| 0` |
| 胜平负 | `(item.crossWin\|\|0) - (item.crossLose\|\|0)` | `parseFloat(item.crossValue) \|\| 0` |
| 综合实力 | `item.totalAdvantageValue - 50` | `parseFloat(item.pwScore) \|\| 0`（pwScore 已是 [-1,1] 区间） |
| 攻守实力 | `item.attackAdvantageValue + item.defenseAdvantageValue - 100` | `parseFloat(item.adCombined) \|\| 0` |

**影响**：PK 结果卡的占比、各维度PK比较的数值全部失真。

---

### P0-2：实力PK弹窗 → PK结果卡"胜平负PK"维度使用原始场次差值

**文件**：`preview/js/pages/match-pk.js` → `renderPowerDuel()` 第 326 行

```javascript
{ label: '胜平负PK', va: (a.crossWin || 0) - (a.crossLose || 0), vb: (b.crossWin || 0) - (b.crossLose || 0) }
```

**问题**：`crossWin`/`crossLose` 在 `mergeItem` 中保留为原始近10场胜平负场次（如 `"6"`），直接相减得到的是场次差值而非归一化后的交叉对冲值。pk-zs.md 定义的胜平负交叉为 `(H_wins + G_losses - H_losses - G_wins) / 10`。

**应改为**：使用 `a.crossValue`（或 `parseFloat(a.crossValue) || 0`），该字段已是按 pk-zs.md 2.2.B 公式计算的归一化结果。

---

### P0-3：进球PK弹窗 → PK结果卡6个维度映射错误

**文件**：`preview/js/pages/match-pk.js` → `renderPKCard()` 第 189~197 行

**问题**：当前 PK 结果卡的 6 行维度映射了错误的字段键名：

| 当前PK标签 | 当前取值键 | 错误原因 |
|:---|:---|:---|
| 进球数PK | `totalGoalsExpect` / `totalGoalsValue` | 功守道弹窗字段，非 mergeItem 进球维度 |
| 大小球PK | `totalGoalsValue` | 同上 |
| 攻防进球占比PK | `attackAdvantageValue` | 实力维度字段 |
| 实力进球占比PK | `totalAdvantageValue` | 实力维度字段 |
| 交锋进球占比PK | `crossWin` | 用公式 `(crossWin\|\|0)-(crossLose\|\|0)` 完全靠猜 |
| 破甲和占比PK | `attackAdvantageValue + defenseAdvantageValue` | 再次用实力维度拼凑 |

**应改为**：使用 `mergeItem` 的进球维度字段进行 PK 比较：

| PK标签 | 键名 | 说明 |
|:---|:---|:---|
| 合计PK | `totalSum` | pk-zs.md 进球维度的合计值 |
| 大球比例PK | `bigBallRatio` | 百分比值（0~100） |
| 攻防进球PK | `attDefGoal` | |
| 实力进球PK | `strengthGoal` | |
| 交锋进球PK | `headToHeadGoal` | |
| 破甲和PK | `breakArmor` | |

各维度PK均比较绝对值大小（高一队获胜）。

---

### P0-4：排名页面 + PK弹窗 → 列名"净胜球"统一为"净胜球量化"

| 文件 | 位置 | 说明 |
|:---|:---|:---|
| `preview/js/pages/quant-rank.js` | Power tab 列表头 第 268 行 | 当前 `'净胜球'` |
| `preview/js/pages/match-pk.js` | Power PK 表头 第 259 行 | 当前 `<br>净胜球<br>占比` |

pk-zs.md 2.3 表格中列名定义为**"净胜球量化"**，两处需统一。

---

### P0-5：排名页面实力tab → 胜平负交叉列仅显示数值，缺失完整双组概率

**文件**：`preview/js/pages/quant-rank.js` → `renderCrossValue()` 第 395~403 行

**问题**：pk-zs.md 2.2.B + 2.3 表格规定胜平负交叉显示格式为：

> "胜XX% 平XX% 负XX% (让0) + 让胜XX% 让平XX% 让负XX% (让R)"

当前仅显示一个数值（`crossValue = (hWins + aLosses - hLosses - aWins) / 10`），缺失不让球组的胜平负概率和让球组的让胜/让平/让负概率。

**后端已提供双组数据**：
- `crossSpfWin / crossSpfDraw / crossSpfLose`（不让球组概率，百分比）
- `crossHcpWin / crossHcpDraw / crossHcpLose`（让球组概率，百分比）
- `crossRq`（让球数值）

**需要**：`mergeItem()` 补充提取上述字段，`renderCrossValue()` 改为双行紧凑格式。

---

## 三、P1 — 功能缺失

### P1-1：排名页面 + PK弹窗 → 缺失 M3.7 四重一致性验证展示

**文件**：
- `preview/js/pages/quant-rank.js` → Goal tab 表格列定义（第 280~297 行）
- `preview/js/pages/match-pk.js` → `renderPKGoal()` PK结果卡区域

**需要展示的内容**（pk-zs.md 第五部分）：

| 展示项 | 后端字段 | 格式 |
|:---|:---|:---|
| 四重验证最终基准 | `fusionFinalHome` + `fusionFinalAway` | `E_final = H值 + A值` |
| 一致性状态标签 | `fusionConsensus` | "强一致" / "弱一致" / "⚠️熔断" |

- **排名页面**：Goal tab 新增一列（表头："四重验证"），展示 `fusionFinalHome + fusionFinalAway` 最终基准值，并附带状态标签。
- **PK弹窗**：Goal PK 结果卡上方新增一行展示 A队 vs B队的最终基准值对比及一致性状态标签。

**后端已就绪**：`fusionConsensus`, `fusionFinalHome`, `fusionFinalAway`, `fusionFused` 均存在于 gongshoudao-all API 返回中。

---

### P1-2：排名页面实力tab → 缺失攻防格局（attackPattern）徽章

**文件**：`preview/js/pages/quant-rank.js` → Power tab 渲染逻辑（第 263~278 行）

**背景**：pk-zs.md 2.2.D 第三阶段定义了三种攻防格局：
- "对攻为主"（`Adv_进攻 > 0.15 且 Adv_防守 > -0.05`）
- "防守为主"（`Adv_防守 > 0.15 且 Adv_进攻 > -0.05`）
- "攻守平衡"（其余）

**后端已提供**：`attackPattern` 字段（string 值如 "对攻为主"）

**需要**：在每个实力榜行末、攻守实力值后增加一个小型彩色标签：
- 对攻为主 → 橙红色底（`#e65100`）
- 防守为主 → 蓝色底（`#1565c0`）
- 攻守平衡 → 灰色底（`#757575`）

---

### P1-3：PK弹窗 → 胜平负交叉列需展示完整双组概率

**文件**：`preview/js/pages/match-pk.js` → Power PK 表格（`renderPKPower`）

**问题**：对应 P0-5 在排名页面，PK 弹窗的胜平负交叉列同样仅展示数值，应改为双组概率格式。

PK 弹窗列宽更紧凑，双组概率需要换行展示：
```
不让球: +12% 胜
让0.5: +8% 让胜
```

---

### P1-4：热度PK弹窗 → 缺少 PK 结果卡片

**文件**：`preview/js/pages/match-pk.js` → `renderPKHot()` 第 376~438 行

**问题**：当前热度 PK 弹窗只展示"指标对比表格"，不像实力PK和进球PK那样有**PK结果卡**（即 A vs B 各项竞争的结果行 + 总PK胜负）。

**需要**：新增热度 PK 结果卡，包含以下维度比较：
1. 关注热度PK（`hotFocusNum` 绝对值大小）
2. 冷热指数PK（`heatIndex` — 过热/冻结偏离度）
3. 静态实力差PK（`staticDiff` — 盘口差距）
4. 亚指临盘PK（`oddsLive`）
5. 总PK：统计各队获胜维度数

**注意**：冷热指数的"更优"判定需特殊设计（过热不一定好）。

---

### P1-5：排名页面 Goal tab → 大球比例值范围确认

**文件**：`preview/js/pages/quant-rank.js` → `renderGoalCell()` 第 417~432 行

**确认结果** ✅：后端 `server/gongshoudao/goal.js:200` 中 `bigBallRatio` 已 `* 100`，输出 **0~100 百分比值**（如 `65` 表示 65%）。当前 `toFixed(1) + '%'` 格式化逻辑正确，PK弹窗 `parseFloat(item.bigBallRatio)` 取值逻辑正确。**无需改动。**

---

## 四、P2 — 展示不规范

### P2-1：排名页面 Power tab → 表头"总排序"含义确认

**文件**：`preview/js/pages/quant-rank.js` 第 267 行

列表头显示"总排序"，其值是**四维等权平均得分**（`totalScore`），不是排名序号。pk-zs.md 2.3 表格中此列就叫"总排序"，展示分位值（+0.225）。当前数值格式为 `+0.xx` / `-0.xx`，与 pk-zs.md 一致 ✅。**无需改动。**

---

### P2-2：Goal PK 弹窗 → 列名"大球占比"统一为"大球比例"

| 文件 | 位置 | 当前 | 应改为 |
|:---|:---|:---|:---|
| `preview/js/pages/match-pk.js` | `renderPKGoal()` 表头 第 87~93 行 | "大球占比" | "大球比例" |

排名页面已使用"大球比例"，PK弹窗需要统一。

---

### P2-3：实力PK弹窗 → 表头列名对齐排名页面

**文件**：`preview/js/pages/match-pk.js` → 第 261~266 行

当前表头带 `<br>占比`，如"净胜球<br>占比""胜平负<br>占比"等。排名页面列名已定义为"净胜球量化""胜平负交叉""综合实力""攻守实力"，PK弹窗列名去掉"占比"后缀（占比由列合计行单独展示）。

**统一格式**：
```
<th>净胜球<br>量化</th>
<th>胜平负<br>交叉</th>
<th>综合<br>实力</th>
<th>攻守<br>实力</th>
```

---

## 五、P3 — UI/UX 细节优化

### P3-1：排名页面 → 攻防格局徽章 hover 提示

**文件**：`preview/js/pages/quant-rank.js`

为攻防格局徽章增加 `title` 属性，hover 时显示完整定义：
- 对攻为主：进攻优势度 > 0.15 且防守优势度 > -0.05
- 防守为主：防守优势度 > 0.15 且进攻优势度 > -0.05
- 攻守平衡：其余情况

---

### P3-2：M3.7 熔断状态视觉差异化

**文件**：`preview/index.html` → CSS 区域

新增三种状态样式：
- 强一致 → 绿色标签 `.fusion-strong { background: #e8f5e9; color: #2e7d32; }`
- 弱一致 → 黄色标签 `.fusion-weak { background: #fff8e1; color: #f9a825; }`
- 熔断 → 红色标签 `.fusion-meltdown { background: #ffebee; color: #c62828; }` 附带 tooltip "模型严重分歧，强制采用临盘基准"

---

## 六、改动文件清单

| 文件 | 改动项 | 级别 |
|:---|:---|:---|
| `preview/js/pages/quant-rank.js` | mergeItem 补充 crossSpf/Hcp 字段、fusion 字段；renderCrossValue 改造为双组概率；Goal tab 新增四重验证列；Power tab 新增格局徽章；列名"净胜球"→"净胜球量化" | P0-4, P0-5, P1-1, P1-2 |
| `preview/js/pages/match-pk.js` | renderPKPower colSums 字段修正、PK卡维度校正；renderPKGoal PK卡维度重构+融合显示；renderPKHot 新增PK结果卡；胜平负列双组概率；列名统一"大球比例" | P0-1~P0-4, P1-1, P1-3, P1-4, P2-2, P2-3 |
| `preview/index.html` | 新增 `.pattern-badge` CSS（三种颜色）；新增 `.fusion-consensus` CSS（三类状态）；攻防格局徽章样式 | P1-2, P3-1, P3-2 |

---

## 七、实施优先级与依赖

```
Phase 1（P0 必修）
├── P0-1 修正 Power PK 列合计计算 → match-pk.js
├── P0-2 修正 Power PK 结果卡"胜平负PK"维度 → match-pk.js
├── P0-3 修正 Goal PK 结果卡全部6个维度 → match-pk.js
├── P0-4 列名统一（"净胜球"→"净胜球量化"） → quant-rank.js + match-pk.js
└── P0-5 胜平负交叉双组概率展示 → quant-rank.js

Phase 2（P1 功能补全）
├── P1-1 M3.7 四重验证展示 → quant-rank.js + match-pk.js
├── P1-2 攻防格局徽章 → quant-rank.js + index.html CSS
├── P1-3 PK弹窗胜平负交叉双组概率格式化 → match-pk.js
├── P1-4 热度PK结果卡 → match-pk.js
└── P1-5 大球比例格式确认 ✅ 无需改动

Phase 3（P2/P3 规范化）
├── P2-2 "大球占比"→"大球比例" → match-pk.js
├── P2-3 PK弹窗表头列名对齐 → match-pk.js
├── P3-1 格局徽章 hover 提示 → quant-rank.js
└── P3-2 熔断状态差异化 CSS → index.html
```

---

## 八、后端依赖确认清单

| 依赖项 | 当前状态 | 来源 |
|:---|:---|:---|
| `crossSpfWin/Draw/Lose` 不让球组概率 | ✅ 已返回 | gongshoudao-all API |
| `crossHcpWin/Draw/Lose` 让球组概率 | ✅ 已返回 | gongshoudao-all API |
| `crossRq` 让球数 | ✅ 已返回 | gongshoudao-all API |
| `fusionConsensus` 融合状态字符串 | ✅ 已返回 | gongshoudao-all API |
| `fusionFinalHome / fusionFinalAway` 最终基准 | ✅ 已返回 | gongshoudao-all API |
| `fusionFused` 是否触发熔断 | ✅ 已返回 | gongshoudao-all API |
| `attackPattern` 攻防格局 | ✅ 已返回 | gongshoudao-all API |
| `bigBallRatio` 大球比例值范围 | ✅ 百分比 0~100 | `goal.js:200` 已 `*100` |

---

**文档结束** — 请评审后进入开发实施。
