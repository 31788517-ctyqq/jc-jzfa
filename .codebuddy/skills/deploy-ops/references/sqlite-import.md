# SQLite 大数据导入避坑指南

> V8.2 重大教训：7MB gzip / 52K INSERT 导入的 5 个连环坑

## 坑 1: SQL 中换行符是字面量 `\n`

- **表象**: `gzip -dc dump | sqlite3 db` 2 秒完成但 0 行
- **根因**: dump 文件中换行是 `\` + `n`（两个字符），不是真换行符 0x0A
- **修复**: `data.replace('\\n', '\n')` → 重压缩

## 坑 2: 表未创建就导入

- **表象**: 5 万行 `no such table`
- **根因**: dump 只含 DELETE + INSERT，不含 CREATE TABLE
- **修复**: 先从本地获取 DDL 再到服务器建表

## 坑 3: 无事务包裹 → 极慢

- **表象**: 52K INSERT 每条 fsync → 预计 14 小时
- **修复**: `(echo "BEGIN;"; gzip -dc dump.gz; echo "COMMIT;") | sqlite3 db`
- **加速**: `PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;`

## 坑 4: Shell 嵌套引号冲突

- **表象**: `sh -c` 中嵌套单引号 → 命令解析失败
- **修复**: 写脚本文件到服务器再执行（避免引号地狱）

## 坑 5: 无进度监控

- **表象**: 76 秒无输出，不知道是卡死还是进行中
- **修复**: `nohup` 后台执行 + 每 2 秒轮询 DB 大小和行数

## 正确流程

```
1. 本地验证 dump 格式（换行符）
2. 本地修复 → 重压缩
3. 上传到服务器
4. 先建表 (CREATE TABLE IF NOT EXISTS)
5. 写 shell 脚本到服务器 (事务包裹 + PRAGMA 加速)
6. nohup 后台执行 + 轮询进度
7. 验证行数 → 确认后清理临时文件
```
