# CSS Token 替换 · 逐页验证流程

## 铁律
1. **每改完一个页面/组件 → 立即 Playwright 截图对比**
2. **禁止批量替换 → 必须逐选择器替换**
3. **只替换颜色属性 (color/background/border/box-shadow)**
4. **禁止碰数值属性 (font-size/gap/padding/margin/width/height/border-radius)**
5. **截图对比无差异 → 才能进入下一个组件**

## 执行流程

### Step 1: 选一个页面/组件
```
例如: .home-my-btn 组件 (background: #10B981 → var(--jczj-success))
```

### Step 2: 查找该颜色在 color_map.json 中的所有出现
```
grep "#10B981" .codebuddy/baseline/css/color_map.json
→ 确认所有出现在允许替换的属性上 (color/background)
```

### Step 3: 替换 app.css
```
old: background: #10B981 !important;
new: background: var(--jczj-success) !important;
```

### Step 4: Playwright 截图该页面
```
导航到受影响的页面 → 全页截图 → 保存到 .codebuddy/baseline/css/verify/
命名为: {component}_{timestamp}.png
```

### Step 5: 目视对比
```
对比 baseline 截图 vs 修改后截图
→ 无差异: 继续下一个
→ 有差异: 回退修改, 检查 Token 映射是否正确
```

### Step 6: 每 5 个组件 → 全量回归
```
导航 15 个关键页面 → 截图 → 对比 baseline
→ 确认无回归后继续
```

## 关键页面清单 (必须截图对比)
- [ ] 首页 (#home)
- [ ] 方案页 (#plan)
- [ ] 排行榜 (#ranking)
- [ ] 比赛列表 (#match-list)
- [ ] 收益页 (#income)
- [ ] 命中率 (#hit-rate)
- [ ] 模型仪表板 (#model-dashboard)
- [ ] 数据健康 (#data-health)
- [ ] 登录页 (#login)
- [ ] TabBar (底部导航)
- [ ] AI 弹窗
- [ ] 功守道弹窗
- [ ] PK 弹窗

## 回滚方案
如果批量替换后出现大面积视觉问题:
```
# 秒级回滚:
cp /var/www/zj.100qiu.com/preview/css/app-legacy.css /var/www/zj.100qiu.com/preview/css/app.css
cp /root/server/preview/css/app-legacy.css /root/server/preview/css/app.css
nginx -s reload
```

## 禁止做的事
- ❌ 不用 sed 批量替换
- ❌ 不一次性改完所有页面
- ❌ 不在 master 上改
- ❌ 不替换数值属性
- ❌ 不改完不截图验证
