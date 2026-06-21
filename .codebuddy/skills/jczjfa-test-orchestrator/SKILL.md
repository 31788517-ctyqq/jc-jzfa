# jczjfa-test-orchestrator v19

## 检查清单
```
□ 1. 语法检查？         → node -c <changed-files>
□ 2. lint 通过？        → npm run lint:fix
□ 3. 单元测试？         → npm run test:p0
□ 4. preflight？        → npm run preflight（全绿才能提交）
□ 5. E2E 截图？         → Playwright 导航→截图→对比基线
```

## 命令
```
npm run lint:fix && npm run test:p0   # 开发后
npm run preflight                      # 提交前（7步）
npm run test:coverage                  # 覆盖率
npx jest -- --testPathPattern=<file>   # 单文件
```

## preflight 7 步
ESLint → Prettier → P0(8套) → P1(8套) → P2(12套gongshoudao) → 覆盖率 → npm audit

## Fallback
| 失败 | 降级 |
|------|------|
| preflight 某步不通过 | 定位→修复→重跑 |
| Jest P0 失败 | `--testPathPattern=<file>` 单文件定位 |
| 截图超时 | 检查网络→确认服务器可达 |
| 覆盖率不达标 | 补充关键路径测试 |
