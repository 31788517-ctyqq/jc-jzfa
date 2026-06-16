# JC-ZJFA 页面性能系统性优化方案

> 分析日期：2026-06-16
> 数据来源：本地探针 (tab_perf_result.json / scheme_slow_result.json) + 生产探针 (scheme_slow_result_prod*.json)

---

## 一、性能现状量化

### 1.1 核心指标对比

| 指标 | 本地 (localhost) | 生产 (zj.100qiu.com) | 恶化倍数 |
|------|----------------|---------------------|---------|
| 首页方案卡片打开 (冷) | 381ms | 1,587~3,320ms | **4~9x** |
| 首页方案卡片打开 (热) | 81ms | 16,608~25,348ms | **205~313x** 🔴 |
| match-list API 平均延迟 | 97ms | 7,098~11,309ms | **73~117x** |
| ranking-list API | 41ms | 3,816~9,475ms | **93~231x** |
| daily-profit-7d API | 28ms | 7,162~10,607ms | **256~379x** |
| week-dates API | 41ms | 6,136~9,789ms | **150~239x** |
| auth-session API | 79ms | 4,868~5,189ms | **62~66x** |
| plan-list API | 11ms | 4,959~6,930ms | **451~630x** |
| my-plan-stats API | 6ms | 7,599~12,074ms | **1,267~2,012x** 🔴 |

### 1.2 最慢单次请求 (生产环境)

| 请求 | 最慢耗时 | 场景 |
|------|---------|------|
| match-list | 25,325ms (25秒) | 方案页同时请求 |
| my-plan-stats | 21,204ms (21秒) | 方案页我的方案 |
| daily-profit-7d | 19,737ms (20秒) | 首页盈利图 |
| week-dates | 18,136ms (18秒) | 日期选择器 |

### 1.3 用户体感

- **首次打开首页**：白屏 → 数据出现需 **16~25 秒**
- **切换 Tab 到方案页**：等待 **4~7 秒** 才能看到方案卡片
- **我的方案标签**：另需 **12~21 秒** 加载统计数据

---

## 二、根因分析

### 根因 1：全量 data.json 同步读盘是共享瓶颈 🔴 [核心]

**现象**：生产环境同一时间点，`match-list` / `ranking-list` / `daily-profit-7d` / `week-dates` / `match-top-directions` 五个 API 的平均延迟都飙到 7~12 秒。

**原因**：
- 所有核心 API handler 的第一步都是 `getDataJson()` → `fs.readFileSync(data.json)`
- 生产环境 data.json 随着历史数据积累不断膨胀（包含数月比赛+推荐数据）
- 每次 `readFileSync` 阻塞 Node.js 事件循环，多次并发请求排队
- PM2 cluster:2 只有 2 个 worker，5 个并发 API 请求加 auth-session 共 6 个 → 至少 4 个排队

**证据链**：
```
scheme_slow_result_prod.json 中，5 个 API (t0 均在 1781556748xxx):
  match-list:      197ms  (先完成，持有数据在内存)
  ranking-list:    558ms  (后续，内存缓存命中)
  daily-profit-7d: 476ms  (后续)
  week-dates:      343ms  (后续)

scheme_slow_result_prod_run2.json 中（场景切换后顺序打乱）:
  match-list:      1,411ms / 2,965ms / 15,533ms / 25,325ms（递增！）
  my-plan-stats:   2,943ms / 21,204ms
  daily-profit-7d: 1,476ms / 19,737ms
  week-dates:      1,442ms / 18,136ms
  
  说明：并发争抢加剧 → 越后发起的请求排队越久
```

### 根因 2：首页 API 请求风暴 🔴

**首页加载触发链**（initPage → startAuthedPage → loadHome）：

```
时间轴 (ms):
  0     loadHome() 发射:
        ├── api('ranking-list', {})      → POST /api
        ├── api('match-list', {})        → POST /api  
        └── api('daily-profit-7d', {days:7}) → POST /api  ← 最重的计算

+500   _preloadData('home') 发射:
        ├── api('plan-list', {})         → POST /api
        └── api('hit-rate-stats', {})    → POST /api

+1200  switchTab('home') P1 prefetch:
        ├── api('plan-list', {})         → POST /api (去重，不发)
        └── api('hit-rate-stats', {})    → POST /api (去重，不发)

→ 0~500ms 窗口内同时有 5 个 POST /api 请求竞争 2 个 worker
```

### 根因 3：daily-profit-7d 计算复杂度 O(n²) 🔴

**handler 逻辑**（server/index.js L2817-2900）：
```
1. 读 data.json → 遍历全部 mMap 获取所有日期
2. 取最近 9 天 → 对每一天：
   3. 遍历全部 mMap 筛选当天比赛（O(total_matches) × 9）
   4. 对每场比赛调用 plan-generator 生成方案
   5. 收益计算
```

数据积累越多，每次请求计算量线性增长。生产环境可能已有数百天的数据，导致单次请求 10~20 秒。

### 根因 4：match-list 多重文件读取 + 冗余遍历 🟡

**单次 match-list 请求的 I/O 路径**：
```
1. fs.readFileSync(data.json)           ← 同步读大文件
2. getOddsHistory(dateStr)  → 读 odds_history JSON
3. getAllplaysData() → 读 odds_500_allplays.json（可能触发磁盘 IO）
4. getGsGlobalMap() → 功守道缓存映射
5. 遍历 mMap 全部条目过滤日期 → 构建列表
6. 读 live_scores.json → 合并即时比分
7. 对未缓存比赛触发后台 refreshCache()（异步，不阻塞响应）
```

文件中 `mMap` 按 key 遍历所有历史比赛，虽然只返回当天比赛，但过滤操作遍历了全部。

### 根因 5：auth-session 阻塞初始加载 🟡

**initPage 流程**（main-fusion.js L1360）：
```javascript
if (!hasAuthToken()) {
    loadHome();  // 直接加载，快
} else {
    api('auth-session') → .then(startAuthedPage);  // 等 5 秒才加载首页！
}
```

已登录用户必须等 auth-session API 返回（生产环境 5 秒+）才能看到首页内容。

### 根因 6：my-plan-stats 全量重算 🟡

每次请求都执行：
```javascript
plans = plans.map(function(p) { return recalcPlanResult(p); });
var stats = computeUserPlanStats(plans);
```

用户方案越多，重算越慢。生产环境单次 7~21 秒。

### 根因 7：CSS 和 JS 体积大 🟢

| 文件 | 大小 |
|------|------|
| vendor.js | ~35KB (合并 api+utils+state+auth) |
| main-fusion.js | 76.5 KB |
| plans.js | **103.3 KB** (最大单体) |
| match-pk-fusion.js | 76.7 KB |
| match-detail.js | 67.2 KB |
| home.js | 44.2 KB |
| app.css | ~40KB+ (含所有页面样式) |

首屏加载（首次访问，无 SW 缓存）：**~250KB+ JS + ~50KB+ CSS**，在弱网下需要 3~5 秒。

---

## 三、优化方案（按优先级排列）

### 🔴 P0 (必须立即实施 — 预计收益 80%+)

#### P0-1：data.json 内存常驻 + 增量更新

**当前状态**：每次 API 调用都 `readFileSync(data.json)`，阻塞事件循环。

**方案**：
- 启动时一次性加载 data.json 到内存（`_dataJsonCache`）
- 通过 `fs.watch` 或定时检查 mtime 实现增量更新（仅重读变化的部分）
- 所有 handler 直接读内存缓存，消除磁盘 I/O

**预期收益**：各 API 延迟从 7~12 秒降至 1~2 秒（减少 6~10 秒的 I/O 等待）

#### P0-2：daily-profit-7d 预计算 + 缓存

**当前状态**：每次请求都做 O(n²) 的遍历+计算。

**方案**：
- 在 `data_sync.js` 每次同步完成后，后台预计算最近 7 天的每日盈利
- 写入 `daily_profit_cache.json`（或 SQLite 表），设置 10 分钟 TTL
- handler 直接读缓存返回，不再运行时计算

**预期收益**：daily-profit-7d 从 7~20 秒 → <100ms

#### P0-3：my-plan-stats 增量缓存

**当前状态**：每次请求全量重算所有历史方案的赛果。

**方案**：
- 方案保存时记录 `isPlanWon` 状态到 SQLite / JSON
- `data_sync.js` 中 outcome-backfill 流程自动更新已有方案的赛果
- handler 只做聚合统计（count/income/hitRate），不做逐条重算

**预期收益**：my-plan-stats 从 7~21 秒 → <200ms

#### P0-4：auth-session 后移至非阻塞

**当前状态**：已登录用户必须等 auth-session API 返回才渲染首页。

**方案**：
- initPage 中先渲染首页 + loadHome()（利用本地 token 判断显示 UI）
- auth-session 异步调用，成功后更新 UI（如显示用户头像/名称）
- 需要认证的页面点击时才校验 session

**预期收益**：首页 FCP 提前 5 秒（消除 auth-session 等待）

---

### 🟡 P1 (高优先级 — 预计收益 15%+)

#### P1-1：首页 API 合并批处理

**当前状态**：首页同时发 5 个独立 API 请求竞争 2 个 worker。

**方案**：
- 新增 `action: 'home-bundle'` 批处理端点
- 一次性返回 `{ matches, ranking, profit7d, planList, hitRateStats }`
- 服务端一次读取 data.json，串行计算后打包返回

**预期收益**：
- 请求数从 5 → 1，消除排队竞争
- 内存缓存命中时，data.json 只读一次，各子计算共享

#### P1-2：match-list 日期间索引优化

**当前状态**：每次请求遍历 mMap 全部条目过滤日期。

**方案**：
- 在 data.json 内存缓存中维护 `_mMapByDate` 索引（`{ "2026-06-15": [match1, match2, ...] }`）
- match-list handler 直接 `mMapByDate[dateStr]`，O(1) 查找

**预期收益**：match-list 过滤耗时从 O(n) 降为 O(1)

#### P1-3：增加 PM2 实例数

**当前状态**：cluster:2，6 个并发请求排队。

**方案**：
- 调整为 `cluster:4` 或 `cluster:max`（根据服务器 CPU 核数）
- 评估数据表明 2 核不足以处理首页请求风暴

**预期收益**：并发吞吐提升 2x，排队时间减半

---

### 🟢 P2 (中优先级 — 锦上添花)

#### P2-1：前端代码拆分优化

**当前状态**：plans.js (103KB) / main-fusion.js (76KB) / match-pk-fusion.js (77KB) 过大。

**方案**：
- plans.js 拆分：方案列表渲染 / 方案日期选择器 / 方案分享分别独立 chunk
- match-pk-fusion.js 按视图模式（表格/图表）拆分
- 未登录用户不需要加载 pricing/payment/subscription 等付费模块

**预期收益**：首屏 JS 体积减少 40~60%，弱网加载提升 2~3 秒

#### P2-2：CSS 分割

**当前状态**：app.css 包含所有页面样式，首页渲染被非首屏样式阻塞。

**方案**：
- 提取首屏关键 CSS 内联到 HTML `<style>`（home 页 + tabbar + navbar）
- app.css 改为异步加载（media="print" onload 方式已有部分实施，可扩展）
- 各页面独立 CSS chunk，按需加载

**预期收益**：FCP 提升 1~2 秒

#### P2-3：数据预取策略优化

**当前状态**：`_preloadData('home')` 在 500ms 后发起 plan-list + hit-rate-stats 预取，进一步加重 loadHome 并发压力。

**方案**：
- 首页预取延迟到 3 秒后（用户大概率在看首页内容）
- 或将 P1-1 home-bundle 已包含这些数据，无需额外预取

---

## 四、实施路线图

```
Week 1: P0-1 (data.json 内存常驻) + P0-4 (auth-session 后移)
        → 预计首页打开时间从 16~25s 降至 5~8s

Week 2: P0-2 (daily-profit-7d 预计算) + P0-3 (my-plan-stats 增量缓存)
        → 预计首页打开时间降至 2~3s

Week 3: P1-1 (首页 API 批处理) + P1-2 (日期索引) + P1-3 (PM2 扩容)
        → 预计首页打开时间降至 <1s

Week 4+: P2-1 (代码拆分) + P2-2 (CSS 分割) + P2-3 (预取优化)
        → 弱网环境也 <2s
```

---

## 五、风险提示

1. **data.json 内存常驻**：需注意内存占用（预估 <50MB），加上其他缓存总内存 <200MB，服务器 2GB 内存可承受
2. **home-bundle 批处理**：单次请求耗时可能较长（串行计算），需设置合理的超时
3. **方案预计算**：需与 data_sync.js 的同步节奏对齐，确保数据新鲜度
4. **PM2 扩容**：更多 worker = 更多内存，需监控实际内存使用

---

## 六、监控指标

优化前后对比监控：

| 指标 | 优化前 (当前) | 目标 |
|------|-------------|------|
| 首页热打开 (warm openMs) | 16~25s | <2s |
| 首页冷打开 (cold openMs) | 1.5~3.3s | <3s |
| match-list API p95 | 25s | <500ms |
| daily-profit-7d API | 20s | <100ms |
| auth-session API | 5s | <1s |
| 方案页切换延迟 | 4~7s | <500ms |

建议持续使用 `.codebuddy/scheme_slow_probe_prod.cjs` 探针验证每次优化效果。
