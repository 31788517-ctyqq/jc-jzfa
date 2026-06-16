# jczjfa-test-orchestrator · 测试编排

> ⚠️ 加载后必须逐项执行质量门禁

---

## 🔴 强制检查清单

```
□ 1. 语法检查？      → node -c <changed-files>
□ 2. lint 通过？     → npm run lint:fix
□ 3. 单元测试？      → npm run test:p0
□ 4. preflight？     → npm run preflight（全绿才能提交）
□ 5. E2E 截图？      → Playwright 导航 → 截图 → 对比基线
```

---

## ⚡ 测试命令

```powershell
npm run lint:fix          # ESLint 修复
npm run test:p0           # P0 单元测试
npm run test:coverage     # 覆盖率
npm run preflight         # 7 步质量门禁（提交前必须）
npx jest -- --testPathPattern=<file>  # 单文件测试
```

---

## 🔑 质量门禁（preflight 7 步）

1. Node 语法检查
2. ESLint
3. Jest P0 测试
4. 覆盖率阈值
5. deploy.py 语法
6. SW 格式校验
7. 关键字符串确认

---

## 🖥️ E2E 验证

```powershell
# Playwright MCP 浏览器自动化
playwright_navigate → zj.100qiu.com
→ playwright_click("我的") → playwright_screenshot
→ playwright_click("排行") → playwright_screenshot
→ 无 401 / 无白屏 = 通过
```

---
## 🆘 Fallback（检查清单某项不通过时）

| 失败项 | 降级路径 |
|--------|---------|
| preflight 某步不通过 | 定位失败步骤 → 修复 → 重新 `npm run preflight` |
| Jest P0 测试失败 | `npx jest -- --testPathPattern=<file>` 单文件定位 |
| Playwright 截图超时 | 检查网络 → 确认服务器可达 → 缩小截图范围 |
| 覆盖率不达标 | 补充关键路径测试 → 重新 `npm run test:coverage` |

> 所有 fallback 均失败 → 中止提交，向用户报告瓶颈。
