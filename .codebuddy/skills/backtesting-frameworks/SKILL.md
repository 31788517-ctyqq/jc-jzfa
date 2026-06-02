---
name: backtesting-frameworks
description: 构建足彩预测回测系统，支持 Walk-Forward 分析、Monte Carlo 验证、多维度性能指标计算。适用于验证 AI 预测方案命中率、评分模型效果、回测框架搭建。
---

# 预测回测框架

构建足彩 AI 预测方案的回测验证系统，避免常见偏差并产生可靠的策略性能评估。

## 适用场景

- 验证 AI 预测（DeepSeek/功守道/PK）命中率
- 方案收入回测（ROI、回撤、复利）
- 评分模型参数调优验证
- 新 prompt 上线前的回归测试

## 核心概念

### 1. 回测偏差

| 偏差类型 | 描述 | 缓解方案 |
| -------- | ---- | -------- |
| **前视偏差** | 使用未来信息预测过去 | 确保预测时间戳早于比赛时间 |
| **幸存者偏差** | 只统计有结果的比赛 | 统计所有已预测的场次 |
| **过拟合** | 对历史数据调参过度 | 预留 OOS 测试集 |
| **选择偏差** | 只挑高命中场次统计 | 全量统计/预注册 |
| **成本忽略** | 不计投注成本 | 计入佣金/税费 |

### 2. 回测结构

```
历史预测数据
      │
      ▼
┌─────────────────────────────────────────┐
│              训练集 (60%)               │
│   (Prompt 开发 & 参数优化)              │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│             验证集 (20%)                │
│   (参数选择, 不可窥探)                  │
└─────────────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────────────┐
│              测试集 (20%)               │
│   (最终性能评估)                         │
└─────────────────────────────────────────┘
```

### 3. Walk-Forward 分析

```
窗口1: [训练──────────][测试]
窗口2:      [训练──────────][测试]
窗口3:           [训练──────────][测试]
窗口4:                [训练──────────][测试]
                                     ─────▶ 时间
```

## 实现模式

### Pattern 1: 足彩命中率回测

```javascript
/**
 * 足彩预测命中率回测引擎
 */
class PredictionBacktester {
  /**
   * @param {Object} options
   * @param {number} options.trainRatio - 训练集比例 (默认0.6)
   * @param {number} options.valRatio - 验证集比例 (默认0.2)
   */
  constructor(options = {}) {
    this.trainRatio = options.trainRatio || 0.6;
    this.valRatio = options.valRatio || 0.2;
  }

  /**
   * 按时间分割数据集
   * @param {Array} logs - prediction_logs 数据
   * @returns {{train: Array, val: Array, test: Array}}
   */
  splitByTime(logs) {
    const sorted = [...logs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const n = sorted.length;
    const trainEnd = Math.floor(n * this.trainRatio);
    const valEnd = Math.floor(n * (this.trainRatio + this.valRatio));

    return {
      train: sorted.slice(0, trainEnd),
      val: sorted.slice(trainEnd, valEnd),
      test: sorted.slice(valEnd),
    };
  }

  /**
   * 计算命中率
   * @param {Array} logs - 预测日志
   * @param {string} source - 预测来源: 'ai' | 'pk' | 'gs'
   * @returns {Object} 命中率统计
   */
  computeHitRate(logs, source) {
    const filtered = logs.filter(r => {
      if (source === 'ai') return r.ai_spf && r.actual_spf;
      if (source === 'pk') return r.pk_direction && r.actual_spf;
      if (source === 'gs') return r.gs_top_score && r.actual_score;
      return false;
    });

    const total = filtered.length;
    if (total === 0) return { hitRate: 0, total: 0, hits: 0 };

    let hits = 0;
    filtered.forEach(r => {
      if (source === 'ai') { if (r.ai_spf === r.actual_spf) hits++; }
      if (source === 'pk') { if (r.pk_direction === r.actual_spf) hits++; }
      if (source === 'gs') {
        const gsScore = r.gs_top_score.replace(/-/g, ':');
        if (gsScore === r.actual_score) hits++;
      }
    });

    return {
      hitRate: parseFloat((hits / total).toFixed(4)),
      total,
      hits,
      misses: total - hits,
    };
  }

  /**
   * 按联赛分组统计命中率
   */
  computeHitRateByLeague(logs, source) {
    const leagueMap = {};
    logs.forEach(r => {
      const lg = r.leagueName || '未知';
      if (!leagueMap[lg]) leagueMap[lg] = [];
      leagueMap[lg].push(r);
    });

    const result = {};
    Object.keys(leagueMap).forEach(lg => {
      result[lg] = this.computeHitRate(leagueMap[lg], source);
    });
    return result;
  }

  /**
   * 按置信度分组统计命中率
   */
  computeHitRateByConfidence(logs, source) {
    const buckets = { high: [], mid: [], low: [] };

    logs.forEach(r => {
      const conf = source === 'ai'
        ? parseFloat(r.ai_confidence) || 0
        : parseFloat(r.pk_composite_score) || 0;

      if (conf >= 80) buckets.high.push(r);
      else if (conf >= 60) buckets.mid.push(r);
      else buckets.low.push(r);
    });

    return {
      high: this.computeHitRate(buckets.high, source),
      mid: this.computeHitRate(buckets.mid, source),
      low: this.computeHitRate(buckets.low, source),
    };
  }
}
```

### Pattern 2: Monte Carlo 收入模拟

```javascript
/**
 * 方案收入 Monte Carlo 模拟
 */
class MonteCarloIncome {
  /**
   * @param {number} nSimulations - 模拟次数 (默认 1000)
   * @param {number} confidence - 置信水平 (默认 0.95)
   */
  constructor(nSimulations = 1000, confidence = 0.95) {
    this.nSimulations = nSimulations;
    this.confidence = confidence;
  }

  /**
   * Bootstrap 模拟历史收入
   * @param {Array<number>} returns - 历史每次投注的回报率
   * @param {number|null} nPeriods - 模拟期数
   * @returns {Array<Array<number>>} 模拟结果
   */
  bootstrapReturns(returns, nPeriods = null) {
    const periods = nPeriods || returns.length;
    const sims = [];

    for (let i = 0; i < this.nSimulations; i++) {
      const sim = [];
      for (let j = 0; j < periods; j++) {
        const idx = Math.floor(Math.random() * returns.length);
        sim.push(returns[idx]);
      }
      sims.push(sim);
    }

    return sims;
  }

  /**
   * 分析最大回撤分布
   * @param {Array<number>} returns - 每期回报率
   * @returns {Object} 回撤分布
   */
  analyzeDrawdowns(returns) {
    const sims = this.bootstrapReturns(returns);
    const maxDrawdowns = [];

    sims.forEach(simReturns => {
      let equity = 1;
      let peak = 1;
      let maxDD = 0;

      simReturns.forEach(r => {
        equity *= (1 + r);
        if (equity > peak) peak = equity;
        const dd = (equity - peak) / peak;
        if (dd < maxDD) maxDD = dd;
      });

      maxDrawdowns.push(maxDD);
    });

    maxDrawdowns.sort((a, b) => a - b);
    const lowerIdx = Math.floor((1 - this.confidence) / 2 * this.nSimulations);
    const upperIdx = Math.floor((1 + this.confidence) / 2 * this.nSimulations);

    return {
      expected: this.mean(maxDrawdowns),
      median: this.median(maxDrawdowns),
      worst95pct: maxDrawdowns[lowerIdx],
      best5pct: maxDrawdowns[upperIdx],
      worstCase: maxDrawdowns[0],
    };
  }

  /**
   * 计算预期 ROI 置信区间
   */
  confidenceInterval(returns, periods = null) {
    const sims = this.bootstrapReturns(returns, periods || returns.length);
    const totalReturns = sims.map(sim => sim.reduce((a, b) => a * (1 + b), 1) - 1);

    totalReturns.sort((a, b) => a - b);
    const lower = Math.floor((1 - this.confidence) / 2 * this.nSimulations);
    const upper = Math.floor((1 + this.confidence) / 2 * this.nSimulations);

    return {
      expected: this.mean(totalReturns),
      lowerBound: totalReturns[lower],
      upperBound: totalReturns[upper],
      std: this.std(totalReturns),
      probLoss: totalReturns.filter(r => r < 0).length / this.nSimulations,
    };
  }

  mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
  median(arr) { return arr.length % 2 ? arr[Math.floor(arr.length / 2)] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2; }
  std(arr) { const m = this.mean(arr); return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length); }
}
```

### Pattern 3: Walk-Forward 验证

```javascript
/**
 * Walk-Forward 分析器
 * 验证方案在不同时间窗口的表现稳定性
 */
class WalkForwardAnalyzer {
  /**
   * @param {number} trainDays - 训练窗口天数
   * @param {number} testDays - 测试窗口天数
   * @param {boolean} anchored - 是否锚定起点 (渐增训练集)
   */
  constructor(trainDays = 30, testDays = 7, anchored = false) {
    this.trainDays = trainDays;
    this.testDays = testDays;
    this.anchored = anchored;
  }

  /**
   * 生成时间窗口分片
   * @param {Array} logs - 按时间排序的预测日志
   * @returns {Array<{train: Array, test: Array, label: string}>}
   */
  generateSplits(logs) {
    const sorted = [...logs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const splits = [];

    let trainEndIdx = this.trainDays;
    while (trainEndIdx + this.testDays <= sorted.length) {
      const trainStart = this.anchored ? 0 : trainEndIdx - this.trainDays;
      splits.push({
        train: sorted.slice(trainStart, trainEndIdx),
        test: sorted.slice(trainEndIdx, trainEndIdx + this.testDays),
        label: `days_${trainStart}-${trainEndIdx + this.testDays}`,
      });
      trainEndIdx += this.testDays;
    }

    return splits;
  }

  /**
   * 执行 Walk-Forward 分析
   * @param {Function} computeFn - (logs) => {hitRate, ...}
   */
  analyze(logs, computeFn) {
    const splits = this.generateSplits(logs);
    const results = [];

    splits.forEach(split => {
      const trainMetrics = computeFn(split.train);
      const testMetrics = computeFn(split.test);
      results.push({
        split: split.label,
        train: trainMetrics,
        test: testMetrics,
        degradation: testMetrics.hitRate - trainMetrics.hitRate,
      });
    });

    const testRates = results.map(r => r.test.hitRate);
    return {
      splits: results,
      avgTestHitRate: testRates.reduce((a, b) => a + b, 0) / testRates.length,
      minTestHitRate: Math.min(...testRates),
      maxTestHitRate: Math.max(...testRates),
      stability: 1 - (Math.max(...testRates) - Math.min(...testRates)),
    };
  }
}

module.exports = { PredictionBacktester, MonteCarloIncome, WalkForwardAnalyzer };
```

## 性能指标

```javascript
/**
 * 计算综合性能指标
 */
function calculateMetrics(returns, initialCapital = 10000) {
  const equity = [initialCapital];
  returns.forEach(r => equity.push(equity[equity.length - 1] * (1 + r)));

  // 基本指标
  const totalReturn = equity[equity.length - 1] / initialCapital - 1;
  const annualReturn = (1 + totalReturn) ** (365 / returns.length) - 1;
  const sharpe = (annualReturn - 0.02) / (stdDev(returns) * Math.sqrt(365));

  // 最大回撤
  let peak = equity[0], maxDD = 0;
  equity.forEach(v => {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  });

  // 胜率和盈亏比
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const winRate = returns.length > 0 ? wins.length / returns.length : 0;
  const profitFactor = losses.length > 0
    ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0))
    : Infinity;

  return {
    totalReturn: totalReturn.toFixed(4),
    annualReturn: annualReturn.toFixed(4),
    sharpeRatio: sharpe.toFixed(4),
    maxDrawdown: maxDD.toFixed(4),
    winRate: winRate.toFixed(4),
    profitFactor: isFinite(profitFactor) ? profitFactor.toFixed(2) : 'Inf',
    totalTrades: returns.length,
  };
}

function stdDev(arr) {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
```

## 最佳实践

### Do's

- **使用时间戳验证** - 确保预测时间 < 比赛时间
- **全量统计** - 不遗漏任何预测
- **OOS 测试** - 始终保留测试集
- **Walk-Forward** - 不仅是 train/test 分割
- **Monte Carlo** - 理解不确定性

### Don'ts

- **不要过拟合** - 限制 prompt 参数数量
- **不要选择偏差** - 不能只挑高分场次统计
- **不要忽略成本** - 计入方案投注本金
- **不要在全部历史上优化** - 保留测试集
