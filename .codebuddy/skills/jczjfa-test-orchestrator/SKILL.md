# jczjfa-test-orchestrator

## ⚠️ MUST 检查清单
1. 语法 → `node -c <changed-files>`
2. lint → `npm run lint:fix`
3. P0测试 → `npm run test:p0`
4. preflight → `npm run preflight`（全绿才能提交，铁律#8）
5. 截图 → Playwright导航→截图→对比基线

## 命令
```
npm run lint:fix && npm run test:p0  # 开发后
npm run preflight                     # 提交前7步
npx jest --testPathPattern=<file>     # 单文件
```

## preflight 7步
ESLint→Prettier→P0(8套)→P1(8套)→P2(12套)→覆盖率→npm audit

## Fallback
| 失败 | 降级 |
|------|------|
| preflight不过 | 定位→修复→重跑 |
| P0失败 | 单文件定位 |
| 截图超时 | 确认服务器可达 |
