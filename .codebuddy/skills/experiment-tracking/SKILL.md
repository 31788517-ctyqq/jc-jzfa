---
name: experiment-tracking
description: AI 预测实验追踪 - 追踪 DeepSeek prompt 变更、模型参数调整对命中率的影响，实现实验版本对比与回滚决策
version: 1.0.0
---

# 实验追踪 (Experiment Tracking)

追踪 AI 预测实验、指标和模型效果。针对足彩 AI 预测场景定制。

## 对比

| 维度         | 轻量方案 (内置)    | MLflow                | W&B                   |
| ------------ | ----------------- | --------------------- | --------------------- |
| **部署**     | 无需额外服务       | 需自建服务            | 云端                   |
| **适用**     | Prompt 实验追踪   | 完整 MLOps            | 团队协作               |
| **可视化**   | console + backtest| Basic                 | Excellent             |
| **成本**     | 免费               | 免费（自建）          | 有限免费               |

**本项目推荐**: 轻量方案（内置在 `prediction_log` 中）+ 回测页面可视化

---

## 追踪内容

### 实验维度

| 类别 | 示例 |
| ---- | ---- |
| **Prompt 参数** | prompt 版本、temperature、top_p、max_tokens |
| **Prompt 内容** | 足球知识注入、五维分析维度、推荐逻辑 |
| **数据源** | 500.com 版本、米斗版本、功守道版本 |
| **评分模型** | PK 权重配置、功守道阈值 |
| **目标指标** | SPF 命中率、大小球命中率、比分命中率 |
| **系统环境** | Git commit、执行时间、日期范围 |

### 实验记录字段

```javascript
// prediction_logs 实验追踪扩展字段
{
  // AI Prompt 元数据
  ai_prompt_version: 'v2.3',       // Prompt 版本
  ai_prompt_hash: 'a1b2c3d4',     // Prompt 内容哈希
  ai_model: 'deepseek-chat',       // 模型
  ai_temperature: 0.7,             // 温度
  ai_max_tokens: 4096,             // 最大 token

  // 数据源版本
  gs_cache_version: '20260501',    // 功守道缓存版本
  midou_data_version: 'v3',        // 米斗数据版本
  pk_scorer_version: 'v2.1',       // PK评分版本

  // 实验标记
  experiment_id: 'exp_001',        // 实验 ID
  experiment_group: 'control',     // 实验分组 (control/treatment)
  experiment_note: '增强联赛知识',  // 实验说明
}
```

---

## 实验流程

### 1. 实验设计

```
┌──────────────────────────────────────────┐
│              实验注册                      │
│  • 命名实验 (exp_001_prompt_v2.3)         │
│  • 定义对照组 (prompt_v2.2)               │
│  • 定义处理组 (prompt_v2.3)               │
│  • 设定评估指标 (SPF命中率 + 大小球命中率) │
└──────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────┐
│              数据分区                      │
│  • 训练集 (60%): Prompt 开发              │
│  • 验证集 (20%): 参数选择                 │
│  • 测试集 (20%): 最终评估                 │
└──────────────────────────────────────────┘
```

### 2. 实验执行

```javascript
/**
 * 实验追踪器
 * 集成在 prediction_log 中使用
 */
class ExperimentTracker {
  /**
   * @param {Object} db - prediction_log 数据库实例
   */
  constructor(db) {
    this.db = db;
  }

  /**
   * 注册实验
   * @param {Object} config
   * @param {string} config.experimentId - 实验 ID
   * @param {string} config.experimentGroup - 分组
   * @param {Object} config.metadata - 元数据
   */
  registerExperiment(config) {
    // 存入 prediction_logs 的 experiment 扩展字段
    // 同时写入 experiment_registry 表
    this.ensureExperimentTable();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO experiment_registry
        (experiment_id, experiment_group, metadata_json, status, created_at)
      VALUES (?, ?, ?, 'running', datetime('now','localtime'))
    `);
    stmt.bind([
      config.experimentId,
      config.experimentGroup,
      JSON.stringify(config.metadata || {}),
    ]);
    stmt.step();
    stmt.free();
  }

  /**
   * 标记预测记录所属实验
   * @param {string} matchId
   * @param {string} experimentId
   * @param {string} experimentGroup
   */
  tagPrediction(matchId, experimentId, experimentGroup) {
    this.db.run(
      `UPDATE prediction_logs
       SET experiment_id = ?, experiment_group = ?
       WHERE matchId = ?`,
      [experimentId, experimentGroup, matchId]
    );
  }

  /**
   * 对比实验组 vs 对照组命中率
   * @param {string} experimentId
   * @returns {Object} 对比结果
   */
  compareExperiment(experimentId) {
    const controlData = this.db.exec(`
      SELECT * FROM prediction_logs
      WHERE experiment_id = ? AND experiment_group = 'control'
        AND actual_spf IS NOT NULL AND actual_spf != ''
    `);
    const treatmentData = this.db.exec(`
      SELECT * FROM prediction_logs
      WHERE experiment_id = ? AND experiment_group = 'treatment'
        AND actual_spf IS NOT NULL AND actual_spf != ''
    `);

    const controlHitRate = this._computeHitRate(controlData);
    const treatmentHitRate = this._computeHitRate(treatmentData);

    const improvement = treatmentHitRate.hitRate - controlHitRate.hitRate;
    const significant = this._isSignificant(controlHitRate, treatmentHitRate);

    return {
      experimentId,
      control: controlHitRate,
      treatment: treatmentHitRate,
      improvement,
      significant,
      recommendation: improvement > 0.02
        ? 'adopt' : improvement > -0.02 ? 'keep' : 'reject',
    };
  }

  /**
   * 实验阶段性报告
   */
  generateReport(experimentId) {
    const comparison = this.compareExperiment(experimentId);

    // 按联赛细分
    const byLeague = {};
    const leagues = this.db.exec(`
      SELECT DISTINCT leagueName FROM prediction_logs
      WHERE experiment_id = ?
    `);
    leagues.forEach(lg => {
      // ... 按联赛统计
    });

    return {
      experimentId,
      timestamp: new Date().toISOString(),
      summary: comparison,
      byLeague,
      byConfidence: {},  // 按置信度分组
      rawData: {
        totalMatches: comparison.control.total + comparison.treatment.total,
      },
    };
  }

  _computeHitRate(data) { /* 命中率计算 */ }
  _isSignificant(a, b) { /* 统计显著性检验 */ }

  ensureExperimentTable() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS experiment_registry (
        experiment_id TEXT PRIMARY KEY,
        experiment_group TEXT,
        metadata_json TEXT,
        status TEXT DEFAULT 'running',
        result_json TEXT,
        created_at TEXT,
        completed_at TEXT
      )
    `);
  }
}
```

---

## 实验决策指南

| 场景 | 决策 |
| ---- | ---- |
| 处理组命中率提升 > 3% | 立即采纳 |
| 处理组命中率提升 1-3% | A/B 测试扩大样本后决定 |
| 处理组命中率变化 < 1% | 保留现用 Prompt |
| 处理组命中率下降 | 回滚至上一版本 |

---

## 与 prediction_log 集成

`prediction_logs` 表需增加字段：
- `ai_prompt_version TEXT` - Prompt 版本
- `ai_model TEXT` - AI 模型
- `experiment_id TEXT` - 实验 ID
- `experiment_group TEXT` - 实验分组

回测页面 `preview/js/pages/hit-rate.js` 增加：
- 实验对比视图
- 按实验分组过滤
- 实验效果趋势图

---

## 资源

- MLflow: https://mlflow.org/docs/latest/
- W&B: https://docs.wandb.ai/

---

*Experiment Tracking Skill - JC-ZJFA 项目专用*
