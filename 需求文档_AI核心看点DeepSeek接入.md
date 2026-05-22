# AI核心看点 — DeepSeek 接入需求文档

> **版本**：v1.0  
> **创建时间**：2026-05-22  
> **关联模块**：比赛详情页 → AI预测核心看点弹窗  
> **目标**：用 DeepSeek 大模型自动搜索并生成本场比赛的 AI 深度解析内容，替代现有静态 Mock 数据。

---

## 一、需求背景

当前比赛详情页的"AI预测核心看点"弹窗使用静态 Mock 数据展示（如：浦和 vs 町田），所有比赛进入后内容完全一样。  
需要接入 DeepSeek API，根据当前比赛的真实信息（联赛、主客队、比赛时间、推荐方向等），搜索分析后生成个性化的五维分析内容。

---

## 二、数据来源

### 2.1 比赛基础信息（由系统提供）
```
{
  matchId: String,         // 如 "2039762"
  homeName: String,        // 主队名称
  visitName: String,       // 客队名称
  leagueName: String,      // 联赛名称
  date: String,            // 比赛日期
  matchStatus: Number,     // 0=未开始 1=上半场 2=下半场 3=结束
  num: String              // 场次编号
}
```

### 2.2 内容框架（由 `sucai/5wei_Markdown.md` 定义）
详见附件文件，包含 7 个区块：基础面、状态面、动机面、对位面、市场面、核心看点、预测建议。  
每个区块有具体的展示方式和字段说明。

---

## 三、DeepSeek API 接入

### 3.1 基本信息
| 项目 | 内容 |
|------|------|
| 接入文档 | https://api-docs.deepseek.com/zh-cn/ |
| API Key | `sk-a4a33977f39547fc89cbdb443539a7c3` |
| 接口地址 | `https://api.deepseek.com/v1/chat/completions` |
| 模型 | `deepseek-chat`（默认模型） |
| 调用方式 | POST JSON |

### 3.2 请求格式
```json
{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "system",
      "content": "你是一个专业的足球比赛分析师。请根据提供的比赛信息，按照五维分析框架生成分析内容。"
    },
    {
      "role": "user",
      "content": "请分析以下比赛：主队XXX vs 客队YYY，联赛ZZZ，日期2026-05-22 ..."
    }
  ],
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": false
}
```

### 3.3 响应处理
响应中的 `choices[0].message.content` 为生成的文本内容，需按约定格式解析为结构化数据存入数据库/缓存。

### 3.4 环境变量配置
```
DEEPSEEK_API_KEY=sk-a4a33977f39547fc89cbdb443539a7c3
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
```

---

## 四、Prompt 设计

### 4.1 System Prompt（角色定义）
```
你是一个专业的足球比赛分析师。请根据用户提供的比赛信息，严格按照"五维分析框架"生成中文分析内容。

分析框架严格参照以下结构：
1. 基础面：积分排名、攻防全景数据（表格）、核心结论
2. 状态面：主队近况、客队近况、历史对阵、伤病影响（表格）、队内氛围、核心结论
3. 动机面：战意强度
4. 对位面：攻防博弈、节奏控制、主场氛围、战术与教练风格、核心结论
5. 市场面：盘口与赔率、大小球、数据变化解读、诱导可能、核心结论
6. 核心看点：核心看点、变数提醒
7. 预测建议：胜平负建议、大小球建议、比分预测（表格形式）

要求：
- 使用中文回答
- 数据需基于真实信息搜索
- 每个字段字数控制在100字以内
- 表格使用 Markdown 格式
- 输出为 JSON 格式（方便程序解析）
```

### 4.2 User Prompt（比赛信息输入）
```
请深度分析以下即将进行的比赛，并按照五维分析框架输出完整的分析报告：

**比赛信息**
- 联赛：{{leagueName}}
- 主队：{{homeName}}
- 客队：{{visitName}}
- 比赛时间：{{date}}
- 场次编号：{{num}}

请通过你的知识库搜索球队信息，包括但不限于：
- 双方积分排名、近期战绩
- 核心球员状态、伤病情况
- 历史交锋记录
- 盘口赔率数据
- 大小球趋势

请以 JSON 格式输出，结构如下：
{
  "基础面": { "概括": "", "积分排名": "", "攻防全景数据": [...], "核心结论": "" },
  "状态面": { "概括": "", "主队近况": "", "客队近况": "", "历史对阵": "", "伤病影响": [...], "队内氛围": "", "核心结论": "" },
  "动机面": { "概括": "", "战意强度": "" },
  "对位面": { "概括": "", "攻防博弈": "", "节奏控制": "", "主场氛围": "", "战术与教练风格": "", "核心结论": "" },
  "市场面": { "概括": "", "盘口与赔率": "", "大小球": "", "数据变化解读": "", "诱导可能": "", "核心结论": "" },
  "核心看点": { "核心看点": "", "变数提醒": "" },
  "预测建议": [{"玩法": "", "建议方向": "", "核心逻辑": ""}]
}
```

---

## 五、数据存储方案

### 5.1 存储位置

**方案 A（SQLite 数据库）** — 新建 `ai_predictions` 表：
```sql
CREATE TABLE IF NOT EXISTS ai_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matchId TEXT NOT NULL UNIQUE,
  leagueName TEXT,
  homeName TEXT,
  visitName TEXT,
  matchDate TEXT,
  content TEXT,              -- JSON 格式完整分析内容
  confidence REAL,           -- AI 信心指数 (0-100)
  rawPrompt TEXT,            -- 发送给 DeepSeek 的完整 Prompt
  rawResponse TEXT,          -- DeepSeek 原始响应
  tokenUsage INTEGER,        -- Token 消耗量
  createdAt TEXT DEFAULT (datetime('now','localtime')),
  updatedAt TEXT DEFAULT (datetime('now','localtime'))
);
```

**方案 B（JSON 文件）** — 兼容当前 `data.json` 架构：
```
data.json.ai = {
  "matchId_xxx": { ...五维分析JSON },
  "matchId_yyy": { ... }
}
```

> 推荐使用方案 A（SQLite），查询效率高，便于后续统计和缓存管理。

### 5.2 缓存策略
- 生成的分析结果持久化存储
- 相同 `matchId` 在比赛结束后 24 小时内不重复生成
- 每天 11:30 批量任务会**覆盖更新**当日数据

---

## 六、定时任务设计

### 6.1 任务一：每日批量预热（11:30）
| 项目 | 内容 |
|------|------|
| 触发时间 | 每天 11:30（北京时间） |
| 执行内容 | 遍历当日所有未结束比赛（`matchStatus < 3`），依次调用 DeepSeek API 生成五维分析 |
| 并发控制 | 每秒最多 1 次请求（QPS 限制），每场比赛耗时约 5-15 秒 |
| 异常处理 | 单场失败不影响后续，失败场次记录日志并在下次定时任务重试 |
| 实现方式 | `node-schedule` 或 cron 表达式 `30 11 * * *` |

### 6.2 任务二：开赛前 1 小时刷新
| 项目 | 内容 |
|------|------|
| 触发时间 | 每场比赛开赛前 1 小时 |
| 执行内容 | 针对该场比赛重新调用 DeepSeek API（盘口可能有变化） |
| 调度方式 | 方案A：遍历今日比赛，计算 `date - 1h`，到点触发 |
|  | 方案B：每天 11:30 批量生成后，对每场设置独立的 `setTimeout` |
| 优势 | 确保分析基于最新盘口和实时信息 |

### 6.3 实现模块
新建文件 `server/ai_daemon.js`，参考现有 `scheduler.js` / `period_daemon.js` 架构：
```
ai_daemon.js
├── deepseekClient() — DeepSeek API 调用封装
├── generateAnalysis(matchInfo) — 生成单场五维分析
├── saveAnalysis(matchId, data) — 存储分析结果
├── batchGenerate(date) — 批量生成当天所有比赛
├── scheduleSingleMatch(match) — 为单场设置开赛前 1h 刷新
├── start() — 启动定时任务
└── stop() — 停止
```

---

## 七、前端交互调整

### 7.1 卡片入口控制
**规则**：当天最后一场比赛结束后，隐藏所有比赛的"AI预测核心看点"入口卡片。

**实现方式**：
- 后端新增 API `ai-predict-status`：返回当天是否还有未结束的比赛
- 前端 `loadDetail()` 加载详情页时，调用该 API 判断是否展示 AI 卡片
- 判断逻辑：`todayUnfinishedMatches > 0 ? 展示 : 隐藏`

### 7.2 弹窗数据加载
1. 弹出时先检查本地缓存（`ai_predictions` 表）
2. 有缓存 → 直接渲染
3. 无缓存 → 显示加载中 → 调用 API `/api?action=ai-predict&matchId=xxx` 触发生成 → 返回结果渲染
4. 生成失败 → 显示"分析生成中，请稍后再试"

### 7.3 加载态设计
```
┌─────────────────────────────┐
│  AI深度解析                  │
│                             │
│      ⏳ Loading...          │
│  正在搜索比赛信息，请稍候      │
│                             │
│  [确定]                     │
└─────────────────────────────┘
```

---

## 八、API 接口设计

### 8.1 获取/生成 AI 分析
```
POST /api
{
  "action": "ai-predict",
  "data": { "matchId": "2039762", "forceRefresh": false }
}

Response:
{
  "code": 1,
  "data": {
    "matchId": "2039762",
    "leagueName": "日职联",
    "homeName": "浦和",
    "visitName": "町田",
    "content": { ... 五维分析 JSON ... },
    "confidence": 74,
    "generatedAt": "2026-05-22T11:35:00Z"
  }
}
```

### 8.2 当天比赛状态
```
POST /api
{
  "action": "ai-predict-status",
  "data": {}

Response:
{
  "code": 1,
  "data": {
    "todayDate": "2026-05-22",
    "totalMatches": 14,
    "finishedMatches": 3,
    "unfinishedMatches": 11,
    "canShowCards": true     // 是否展示 AI 卡片入口
  }
}
```

### 8.3 手动触发批量生成（运维用）
```
POST /api
{
  "action": "ai-batch-generate",
  "data": { "date": "2026-05-22" }
}
```

---

## 九、成本估算

| 项目 | 估算 |
|------|------|
| 每天比赛数 | 约 10-30 场 |
| 每场 Token 消耗 | 约 3000-5000 tokens（含 Prompt + 响应） |
| 每天总 Token | 约 50,000-150,000 tokens |
| 每天调用次数 | 每场 1-2 次（批量 + 开赛前刷新），约 20-60 次 |
| DeepSeek 成本 | 约 $0.5-1.5/天（按 $.27/M tokens 计算） |

> 成本优化：同一场比赛 24 小时内不重复调用，减少冗余请求。

---

## 十、实施步骤

| 阶段 | 任务 | 文件 | 预计工时 |
|------|------|------|----------|
| **Phase 1** | DeepSeek API 封装 | 新建 `server/deepseek.js` | 2h |
| **Phase 2** | 数据存储层 | 修改 `server/database.js` 新增表 + 查询方法 | 1h |
| **Phase 3** | 定时任务调度 | 新建 `server/ai_daemon.js` | 3h |
| **Phase 4** | API 接口层 | 修改 `server/index.js` + `simple.js` | 1h |
| **Phase 5** | 前端弹窗接入 | 修改 `preview/index.html` | 3h |
| **Phase 6** | 卡片入口控制 | 前端 + API 联动 | 1h |
| **Phase 7** | 测试与上线 | 本地调优 → 生产部署 | 2h |

---

## 十一、注意事项

1. **API Key 安全**：Key 存储在 `.env` 文件中，不提交到 Git 仓库
2. **网络超时**：DeepSeek API 调用设置 60s 超时，超时后不阻塞后续比赛
3. **容错机制**：单场比赛生成失败不中断批量任务，记录错误日志
4. **Token 限制**：`max_tokens` 设为 4096，确保完整 JSON 输出不被截断
5. **内容审核**：DeepSeek 对特定敏感词有过滤，生成后需校验 JSON 格式完整性
6. **生产节点兼容性**：当前生产服务器 Node.js v10，需使用兼容写法（`.then/catch`，避免顶层 `await`）
7. **时区处理**：所有定时任务使用北京时间（UTC+8），与比赛时区保持一致

---

## 附录 A：五维分析 MD 框架

> 详见 `sucai/5wei_Markdown.md`

```md
# 球赛五维分析

## 基础面
> **概括：** （请在此填写本部分的概括标题）
-   **积分排名**（展示方式：文字总结概括，100字左右）
-   **攻防全景数据**（展示方式：表格展示；字段：赛季场均进球、场均失球、近6场场均进球、近6场场均失球、核心射手、近期攻防特点）
-   **核心结论**（100字左右）

## 状态面
-   主队近况 / 客队近况 / 历史对阵 / 伤病影响(表格) / 队内氛围 / 核心结论

## 动机面
-   战意强度（100字左右）

## 对位面
-   攻防博弈 / 节奏控制 / 主场氛围 / 战术与教练风格 / 核心结论

## 市场面
-   盘口与赔率 / 大小球 / 数据变化解读 / 诱导可能 / 核心结论

## 核心看点
-   核心看点 / 变数提醒

## 预测建议
-   预测建议（表格：玩法、建议方向、核心逻辑；玩法项：胜平负、大小球、比分预测）
```

## 附录 B：DeepSeek API 快速参考

```javascript
// Node.js 调用示例
const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
  },
  body: JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: '系统提示词...' },
      { role: 'user', content: '用户问题...' }
    ],
    temperature: 0.7,
    max_tokens: 4096
  })
});
const data = await response.json();
console.log(data.choices[0].message.content);
```
