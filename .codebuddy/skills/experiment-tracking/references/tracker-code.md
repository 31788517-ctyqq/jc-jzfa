# ExperimentTracker 实现代码

> 实验追踪的完整实现，集成在 prediction_log 中使用。

## ExperimentTracker 类

```javascript
class ExperimentTracker {
  constructor(db) {
    this.db = db;
  }

  registerExperiment(config) {
    this.ensureExperimentTable();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO experiment_registry
        (experiment_id, experiment_group, metadata_json, status, created_at)
      VALUES (?, ?, ?, 'running', datetime('now','localtime'))
    `);
    stmt.bind([config.experimentId, config.experimentGroup, JSON.stringify(config.metadata || {})]);
    stmt.step(); stmt.free();
  }

  tagPrediction(matchId, experimentId, experimentGroup) {
    this.db.run(`UPDATE prediction_logs SET experiment_id = ?, experiment_group = ? WHERE matchId = ?`,
      [experimentId, experimentGroup, matchId]);
  }

  compareExperiment(experimentId) {
    const controlData = this.db.exec(`SELECT * FROM prediction_logs WHERE experiment_id = ? AND experiment_group = 'control' AND actual_spf IS NOT NULL AND actual_spf != ''`);
    const treatmentData = this.db.exec(`SELECT * FROM prediction_logs WHERE experiment_id = ? AND experiment_group = 'treatment' AND actual_spf IS NOT NULL AND actual_spf != ''`);
    const control = this._computeHitRate(controlData), treatment = this._computeHitRate(treatmentData);
    const improvement = treatment.hitRate - control.hitRate;
    return { experimentId, control, treatment, improvement, significant: this._isSignificant(control, treatment),
      recommendation: improvement > 0.02 ? 'adopt' : improvement > -0.02 ? 'keep' : 'reject' };
  }

  generateReport(experimentId) {
    const comparison = this.compareExperiment(experimentId);
    return { experimentId, timestamp: new Date().toISOString(), summary: comparison, byLeague: {}, byConfidence: {} };
  }

  _computeHitRate(data) { /* 命中率计算，同 PredictionBacktester */ }
  _isSignificant(a, b) { /* 统计显著性检验 */ }

  ensureExperimentTable() {
    this.db.run(`CREATE TABLE IF NOT EXISTS experiment_registry (
      experiment_id TEXT PRIMARY KEY, experiment_group TEXT, metadata_json TEXT,
      status TEXT DEFAULT 'running', result_json TEXT, created_at TEXT, completed_at TEXT)`);
  }
}
```

## prediction_logs 扩展字段

```javascript
{
  ai_prompt_version: 'v2.3',       // Prompt 版本
  ai_prompt_hash: 'a1b2c3d4',     // Prompt 内容哈希
  ai_model: 'deepseek-chat',       // 模型名
  ai_temperature: 0.7,             // 温度
  ai_max_tokens: 4096,             // 最大 token
  gs_cache_version: '20260501',    // 功守道缓存版本
  midou_data_version: 'v3',        // 米斗数据版本
  pk_scorer_version: 'v2.1',       // PK评分版本
  experiment_id: 'exp_001',        // 实验 ID
  experiment_group: 'control',     // 对照组/实验组
  experiment_note: '增强联赛知识',  // 实验说明
}
```

## 实验决策指南

| 命中率变化 | 决策 |
|-----------|------|
| > +3% | ✅ 立即采纳 |
| +1%~3% | A/B 测试扩大样本 |
| < ±1% | 保留现用 Prompt |
| 下降 | ❌ 回滚至上一版本 |
