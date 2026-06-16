# 回测模式代码示例

> 回测框架的 3 个核心类的完整实现，供 AI 在需要时参考。

## 1. PredictionBacktester — 命中率计算

```javascript
class PredictionBacktester {
  constructor(options = {}) {
    this.trainRatio = options.trainRatio || 0.6;
    this.valRatio = options.valRatio || 0.2;
  }

  splitByTime(logs) {
    const sorted = [...logs].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const n = sorted.length;
    return {
      train: sorted.slice(0, Math.floor(n * 0.6)),
      val: sorted.slice(Math.floor(n * 0.6), Math.floor(n * 0.8)),
      test: sorted.slice(Math.floor(n * 0.8)),
    };
  }

  computeHitRate(logs, source) {
    const filtered = logs.filter(r => {
      if (source === 'ai') return r.ai_spf && r.actual_spf;
      if (source === 'pk') return r.pk_direction && r.actual_spf;
      if (source === 'gs') return r.gs_top_score && r.actual_score;
      return false;
    });
    const total = filtered.length;
    if (!total) return { hitRate: 0, total: 0, hits: 0 };
    let hits = 0;
    filtered.forEach(r => {
      if (source === 'ai' && r.ai_spf === r.actual_spf) hits++;
      if (source === 'pk' && r.pk_direction === r.actual_spf) hits++;
      if (source === 'gs' && r.gs_top_score.replace(/-/g, ':') === r.actual_score) hits++;
    });
    return { hitRate: +(hits / total).toFixed(4), total, hits, misses: total - hits };
  }

  computeHitRateByLeague(logs, source) {
    const map = {}; logs.forEach(r => { (map[r.leagueName||'未知']??=[]).push(r); });
    const result = {}; Object.keys(map).forEach(lg => result[lg] = this.computeHitRate(map[lg], source));
    return result;
  }

  computeHitRateByConfidence(logs, source) {
    const buckets = { high: [], mid: [], low: [] };
    logs.forEach(r => {
      const conf = source === 'ai' ? +(r.ai_confidence||0) : +(r.pk_composite_score||0);
      if (conf >= 80) buckets.high.push(r);
      else if (conf >= 60) buckets.mid.push(r);
      else buckets.low.push(r);
    });
    return { high: this.computeHitRate(buckets.high, source), mid: this.computeHitRate(buckets.mid, source), low: this.computeHitRate(buckets.low, source) };
  }
}
```

## 2. MonteCarloIncome — 收入模拟

```javascript
class MonteCarloIncome {
  constructor(nSims = 1000, conf = 0.95) { this.n = nSims; this.conf = conf; }

  bootstrapReturns(returns, periods) {
    const p = periods || returns.length, sims = [];
    for (let i = 0; i < this.n; i++) {
      const s = []; for (let j = 0; j < p; j++) s.push(returns[Math.floor(Math.random()*returns.length)]);
      sims.push(s);
    }
    return sims;
  }

  analyzeDrawdowns(returns) {
    const sims = this.bootstrapReturns(returns), dds = [];
    sims.forEach(r => { let eq = 1, pk = 1, md = 0; r.forEach(v => { eq *= 1+v; if(eq>pk) pk=eq; const d = (eq-pk)/pk; if(d<md) md=d; }); dds.push(md); });
    dds.sort((a,b)=>a-b);
    return { expected: this.mean(dds), median: this.median(dds), worst95pct: dds[Math.floor((1-this.conf)/2*this.n)], worstCase: dds[0] };
  }

  confidenceInterval(returns, periods) {
    const sims = this.bootstrapReturns(returns, periods || returns.length);
    const tr = sims.map(s => s.reduce((a,b)=>a*(1+b),1)-1).sort((a,b)=>a-b);
    return { expected: this.mean(tr), lowerBound: tr[Math.floor((1-this.conf)/2*this.n)], upperBound: tr[Math.floor((1+this.conf)/2*this.n)], probLoss: tr.filter(r=>r<0).length/this.n };
  }

  mean(a) { return a.reduce((x,y)=>x+y,0)/a.length; }
  median(a) { return a.length%2 ? a[Math.floor(a.length/2)] : (a[a.length/2-1]+a[a.length/2])/2; }
}
```

## 3. WalkForwardAnalyzer — 时间窗口验证

```javascript
class WalkForwardAnalyzer {
  constructor(trainDays = 30, testDays = 7, anchored = false) {
    this.trainDays = trainDays; this.testDays = testDays; this.anchored = anchored;
  }

  generateSplits(logs) {
    const sorted = [...logs].sort((a,b) => (a.date||'').localeCompare(b.date||''));
    const splits = []; let idx = this.trainDays;
    while (idx + this.testDays <= sorted.length) {
      const start = this.anchored ? 0 : idx - this.trainDays;
      splits.push({ train: sorted.slice(start, idx), test: sorted.slice(idx, idx+this.testDays), label: `days_${start}-${idx+this.testDays}` });
      idx += this.testDays;
    }
    return splits;
  }

  analyze(logs, computeFn) {
    const splits = this.generateSplits(logs), results = [];
    splits.forEach(s => { const t1 = computeFn(s.train), t2 = computeFn(s.test); results.push({ split: s.label, train: t1, test: t2, degradation: t2.hitRate - t1.hitRate }); });
    const rates = results.map(r => r.test.hitRate);
    return { splits: results, avgTestHitRate: rates.reduce((a,b)=>a+b,0)/rates.length, minTestHitRate: Math.min(...rates), maxTestHitRate: Math.max(...rates), stability: 1 - (Math.max(...rates)-Math.min(...rates)) };
  }
}
```

## 4. 综合性能指标

```javascript
function calculateMetrics(returns, initialCapital = 10000) {
  const equity = [initialCapital];
  returns.forEach(r => equity.push(equity[equity.length-1]*(1+r)));
  const totalReturn = equity[equity.length-1]/initialCapital-1;
  const annualReturn = (1+totalReturn)**(365/returns.length)-1;
  const sharpe = (annualReturn-0.02)/(stdDev(returns)*Math.sqrt(365));
  let peak = equity[0], maxDD = 0;
  equity.forEach(v => { if(v>peak) peak=v; const dd=(v-peak)/peak; if(dd<maxDD) maxDD=dd; });
  const wins = returns.filter(r=>r>0), losses = returns.filter(r=>r<0);
  return {
    totalReturn: totalReturn.toFixed(4), annualReturn: annualReturn.toFixed(4),
    sharpeRatio: sharpe.toFixed(4), maxDrawdown: maxDD.toFixed(4),
    winRate: (wins.length/returns.length).toFixed(4),
    profitFactor: losses.length ? (wins.reduce((a,b)=>a+b,0)/Math.abs(losses.reduce((a,b)=>a+b,0))).toFixed(2) : 'Inf',
    totalTrades: returns.length
  };
}
function stdDev(a) { const m = a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length); }
```
