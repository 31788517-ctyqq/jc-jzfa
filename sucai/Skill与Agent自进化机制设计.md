# Skill / Agent 自进化机制设计

> 2026-06-16 | 目标：让系统从每次返工中自动学到教训，不再依赖人工记忆。

---

## 现状痛点

```
人踩坑 → 人发现规律 → 人写进文档 → AI 下次读到 → 避开
     ↑                              ↑
  可能没人总结                  可能没人写
```

当前 754 个 commit 中 56% 是 fix/revert，说明这个链条断裂严重。

---

## 三层自进化架构

### Layer 1：`update_memory` —— 即时记忆（已可用）

```javascript
// 每次发现新坑，AI 调用此工具持久化关键事实
update_memory({
  title: "新模块XXX必须在deploy.py中加入",
  knowledge: "server/core/xxx.js 依赖 server/core/yyy.js，部署遗漏导致全线500"
})
```

**优点**：立即可用，跨会话持久  
**局限**：只能存事实，不能存"检测规则"

### Layer 2：`references/lessons.md` —— 教训库自动追加

在 deploy-ops 的 lessons.md 中增加**自动追加协议**：

```markdown
## 🤖 自动追加协议（AI 执行规则）

当你在本次会话中发现一个新的部署教训时：
1. 确认这是新问题（不是已有教训的变体）
2. 调用 read_file 读取当前 lessons.md
3. 在底部追加一条新记录，格式：
   ```
   | YYYY-MM-DD | 教训描述 | 避免方法 |
   ```
4. 同时调用 update_memory 持久化关键事实
```

**优点**：教训库自动增长  
**局限**：依赖 AI 主动判断"这是新教训"

### Layer 3：`pre-commit-check.cjs` —— 规则自动编码（核心）

这是最关键的一层。每一个新发现的犯错模式，都应固化为一个新的检查函数：

```javascript
// scripts/pre-commit-check.cjs — 当前 6 项检查
// 每次发现新犯错的模式，在此追加新检查函数

// 检查 7: （新增）禁止在 PR 中提交敏感配置
function checkSensitiveConfig() { ... }

// 检查 8: （新增）ESLint 规则自动同步
function checkESLintRules() { ... }
```

**进化路径**：

```
第 1 次踩坑 → 人写进 AGENTS.md 或 Skill
第 2 次踩同样的坑 → 人追加到 pre-commit-check.cjs 作为阻断规则
第 N 次 → pre-commit 自动阻断，不再需要人记忆
```

---

## 具体操作流程

### 新问题发现时的 AI 响应协议

在 AGENTS.md 中增加：

```markdown
## 🧠 新问题自学习协议

当本次会话中发生任何需要修复的问题时，AI 必须在会话结束前：

1. **判断严重度**：
   - P0（阻断了核心功能/部署）→ 立即追加到 pre-commit-check.cjs
   - P1（导致返工 3 次以上）→ 追加到对应 Skill 的 references/lessons.md
   - P2（偶然问题）→ 调用 update_memory 记录

2. **更新 issue 追踪**：
   - 在 sucai/ 下新增或更新诊断报告

3. **通知用户**：
   - 总结本次新学到了什么
   - 建议是否需要追加到 __不可动区域__ 清单
```

### 部署后自动复盘

在 `deploy.py` 部署完成后自动记录：

```python
# deploy.py 部署后追加
def log_deploy_result(success, issues):
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "git_hash": GIT_HASH,
        "success": success,
        "issues": issues,  # 如 ["SW 缓存未刷新", "404 on /assets/icon.svg"]
        "fixes_applied": []  # 部署过程中的修复操作
    }
    append_json("sucai/deploy-history.json", log_entry)
```

这样 `deploy-history.json` 会积累每次部署的问题记录，AI 可以分析趋势。

---

## 效果预期

| 层级 | 机制 | 触发方式 | 延迟 |
|------|------|---------|------|
| L1 | `update_memory` | AI 自动 | 即时 |
| L2 | `references/lessons.md` | AI 追加 | 本次会话内 |
| L3 | `pre-commit-check.cjs` | 人确认后追加 | 下次提交前 |
| - | `sucai/deploy-history.json` | deploy.py 自动写 | 部署完成后 |

### 理想循环

```
开发上线 → 出问题 → AI 识别是新模式
  → L1: update_memory 记住 ← 下次会话可用
  → L2: 追加到 lessons.md ← 下次加载 Skill 可见
  → 人确认严重度 → L3: 追加到 pre-commit-check ← 物理阻断
  → deploy-history 记录 ← 趋势分析

下次同一个人/同一个项目 → L3 自动阻断 → 不再犯
```

---

## 当前可以立即做的

1. **在 AGENTS.md 增加自学习协议**（5 分钟）
2. **在 deploy-ops SKILL.md 增加自动追加指令**（已可做）
3. **每次修复一个 bug 后，追问"这个应该加入 pre-commit-check 吗？"**
