# 性能优化基线参考 v1.0

> 配合 AGENTS.md 性能预算使用。每次优化操作前后必读。

---

## 1. 测量协议

### 1.1 Playwright 本地测量（推荐，脚本化）

```powershell
# FCP/LCP 测量
npx playwright test preview/tests/e2e/perf-pages.spec.js

# 手动单页测量
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);
  await client.send('Performance.enable');
  await page.goto('https://zj.100qiu.com/', { waitUntil: 'networkidle' });
  const metrics = await client.send('Performance.getMetrics');
  const fcp = metrics.metrics.find(m => m.name === 'FirstContentfulPaint');
  console.log('FCP:', (fcp.value / 1000).toFixed(0) + 'ms');
  await page.screenshot({ path: '_screenshots/baseline.png', fullPage: true });
  await browser.close();
})();
"
```

### 1.2 Lighthouse CLI（综合评分）

```powershell
npx lighthouse https://zj.100qiu.com/ --view --preset=desktop --output=html --output-path=_screenshots/lh-report.html
```

### 1.3 关键检查点

每次优化后至少验证：
- [ ] FCP 不倒退（≤150ms）
- [ ] 首页 Playwright 截图无白屏/布局错乱
- [ ] 底部 5 个 Tab 逐个点击 → 全部正常渲染
- [ ] SW 缓存版本号正确（`jczjfa-static-v12`）

---

## 2. CSS 拆分策略

### 2.1 现状
- `preview/css/app.css` 335KB（gzip 56KB）— 包含全部 17 个页面的样式
- Vite 构建生成 4 个 CSS chunk，但 app.css 是最大的单体

### 2.2 拆分原则

| 规则 | 说明 |
|------|------|
| **公共样式**留在 app.css | Design Tokens、reset、navbar、tabbar、skeleton、通用动画 |
| **页面专属样式**抽到独立 CSS | 每个页面一个 `page-{name}.css` |
| **Vite CSS Code Split** | `cssCodeSplit: true` 已开启，需确保页面 JS import 对应 CSS |
| **关键 CSS 内联** | 首屏（navbar + tabbar + 首页首屏）继续内联在 `<template>` 中 |
| **非首屏异步加载** | `media="print" onload="this.media='all'"` 模式 |

### 2.3 拆分步骤

```
1. 用 PurgeCSS 扫描每页实际使用的 class → 输出 used-classes.json
2. app.css 按页面拆分 → app.css(公共) + page-home.css + page-plans.css + ...
3. 每个页面 JS import 对应 CSS（如 home.js → import '../css/page-home.css'）
4. Vite 构建验证：检查 dist/assets/ 下各页面 CSS chunk 大小
5. Playwright 截图验证每页样式完整性
6. 删除 app.css 中已迁移的页面专属样式
```

### 2.4 预期收益

```
拆分前: app.css 56KB gzip（首屏加载全部）
拆分后: app.css(公共) 15KB + page-home.css 8KB = 23KB gzip 首屏
        page-plans.css 5KB, page-match.css 4KB... 按需加载
```

---

## 3. Bundle 分析

### 3.1 查看 chunk 大小

```powershell
# 构建后查看
npx vite build
node -e "const fs=require('fs');const g=fs.readdirSync('preview/dist/assets');g.filter(f=>/(css|js)$/.test(f)).sort((a,b)=>fs.statSync('preview/dist/assets/'+b).size-fs.statSync('preview/dist/assets/'+a).size).slice(0,15).forEach(f=>console.log((fs.statSync('preview/dist/assets/'+f).size/1024).toFixed(1)+'KB',f))"
```

### 3.2 可视化分析（可选）

```powershell
npm install -D rollup-plugin-visualizer
# 在 vite.config.js 中添加插件 → 生成 stats.html
```

### 3.3 当前 Vite 输出基线 (v19.0)

| Chunk | 大小 | gzip |
|-------|------|------|
| main-fusion.js | 89.6 KB | - |
| home.js | 50.4 KB | - |
| app.css | 334.9 KB | 56.2 KB |
| plans.js | 56.3 KB | 14.5 KB |
| match-detail.js | 39.2 KB | 12.0 KB |

---

## 4. Brotli 启用指南

### 4.1 Nginx 配置

```nginx
# 需先安装 ngx_brotli 模块（编译或动态加载）
brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css application/javascript application/json text/html;
```

### 4.2 验证

```bash
curl -H "Accept-Encoding: br" -I https://zj.100qiu.com/preview/js/main-fusion.js | grep content-encoding
# 期望: content-encoding: br
```

---

## 5. 性能回归门禁

### 5.1 部署前检查

```
□ 1. Vite build 完成 → 对比上一次 dist/ chunk 大小，无意外膨胀
□ 2. Playwright FCP 测量 → 对比基线，倒退 <10%
□ 3. Playwright 截图 → 5 tab 逐个切换，无白屏/布局错乱
□ 4. Lighthouse 桌面端 ≥85 → 记录分数
□ 5. SW 缓存版本号已 bump（如改 sw.js 策略）
```

### 5.2 回退触发条件

| 条件 | 动作 |
|------|------|
| FCP 倒退 >20% | 阻断部署，定位根因 |
| 任一 Tab 白屏 | 阻断部署，检查 CSS 拆分完整性 |
| 首页截图布局错乱 | 阻断部署，检查关键 CSS 内联 |
| Lighthouse <80 | 警告但不阻断（可后续优化） |

---

## 6. 数据缓存增强策略

### 6.1 IndexedDB 持久化

```
当前: 内存 setCache/getCache → 刷新即丢
目标: IndexedDB 持久化 → 二次打开 0ms

实现要点:
- 比赛数据 TTL 5min（赛前变化频繁）
- 排行数据 TTL 30min
- 方案数据 TTL 10min
- Stale-while-revalidate: 先显示缓存 → 后台更新
```

### 6.2 API ETag

```
当前: 无协商缓存，每次返回完整 JSON
目标: /api/home-bundle 等高频接口返回 ETag
      客户端带 If-None-Match → 304 空响应
```

---

## 7. 预加载策略优化

### 7.1 当前策略

```
T+0s:   首屏 home.js (modulepreload)
T+2s:   plans.js (_preloadMods)
T+4s:   charts.js + ECharts
```

### 7.2 优化后策略（建议）

```
T+0s:   首屏 home.js (modulepreload, fetchpriority=high)
T+0.5s: requestIdleCallback → plans.js + match-list.js + ranking.js （top 3 tab）
T+2s:   其余低频页面
T+4s:   ECharts（保持）
```

---

> 深度参考：AGENTS.md § 性能预算、§ Skill 强制加载规则 #5（CSS 改动后 Playwright 验证）
