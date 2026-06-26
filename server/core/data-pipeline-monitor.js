/**
 * server/core/data-pipeline-monitor.js
 * 数据全链路管线监控 — 统一采集各阶段指标，前端看板数据源
 *
 * 5 阶段: scrape(抓取) → ingest(落盘) → compute(计算) → serve(服务) → display(展示)
 *
 * 用法:
 *   const monitor = require('./core/data-pipeline-monitor');
 *   monitor.recordScrape('500.com', { success: 32, total: 33, ms: 1200 });
 *   monitor.getPipelineDashboard(1); // 聚合看板数据
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════
// 进程内指标存储 (24h 自动清理)
// ═══════════════════════════════════════════

const MAX_RECORDS = 100000;
const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24h

const metrics = {
  scrape: {},        // { source: [ { time, success, total, ms, date }, ... ] }
  ingest: { total: 0, success: 0, error: 0, lastError: null, lastErrorTime: null },
  compute: {        // { stageName: [ { time, durationMs, outputCount, success }, ... ] }
    stages: {},
    planGen: { total: 0, success: 0, fail: 0, totalDurationMs: 0 },
  },
  serve: { total: 0, success: 0, totalMs: 0, p50: 0, p95: 0, latencies: [] },
  display: { checkCount: 0, passCount: 0, failCount: 0, reports: [] },
  // 历史趋势快照
  snapshots: [],
};

// ═══════════════════════════════════════════
// 质量评分权重
// ═══════════════════════════════════════════

const QUALITY_WEIGHTS = { scrape: 0.25, storage: 0.25, compute: 0.20, serve: 0.15, display: 0.15 };
const GATE_THRESHOLDS = { scrape: 0.90, storage: 0.85, compute: 0.80, serve: 0.95, display: 0.85 };

// ═══════════════════════════════════════════
// 工具: 截断数组防内存泄漏
// ═══════════════════════════════════════════

function _trim(arrKey, maxLen) {
  const arr = metrics[arrKey];
  if (Array.isArray(arr) && arr.length > maxLen) arr.splice(0, arr.length - maxLen);
}

// ═══════════════════════════════════════════
// 阶段1: 抓取 (Scrape)
// ═══════════════════════════════════════════

/**
 * 记录一次抓取结果
 * @param {string} source   - 数据源名称 '500.com' / 'midou310' / 'sporttery' / 'deepseek' / '豆包'
 * @param {object} result   - { success: number, total: number, ms: number, date?: string }
 */
function recordScrape(source, result) {
  if (!metrics.scrape[source]) metrics.scrape[source] = [];
  const entry = {
    time: Date.now(),
    success: result.success || 0,
    total: result.total || 0,
    ms: result.ms || 0,
    date: result.date || new Date().toISOString().slice(0, 10),
  };
  metrics.scrape[source].push(entry);
  if (metrics.scrape[source].length > MAX_RECORDS / 10) metrics.scrape[source].splice(0, 100);
}

// ═══════════════════════════════════════════
// 阶段2: 落盘 (Ingest)
// ═══════════════════════════════════════════

function recordIngest(success, errMsg) {
  metrics.ingest.total++;
  if (success) {
    metrics.ingest.success++;
  } else {
    metrics.ingest.error++;
    metrics.ingest.lastError = String(errMsg || 'unknown').slice(0, 200);
    metrics.ingest.lastErrorTime = new Date().toISOString();
  }
}

// ═══════════════════════════════════════════
// 阶段3: 计算 (Compute)
// ═══════════════════════════════════════════

function recordComputeStage(stageName, durationMs, outputCount, success) {
  if (!metrics.compute.stages[stageName]) metrics.compute.stages[stageName] = [];
  metrics.compute.stages[stageName].push({
    time: Date.now(),
    durationMs: durationMs || 0,
    outputCount: outputCount || 0,
    success: success !== false,
  });
  if (metrics.compute.stages[stageName].length > 1000) metrics.compute.stages[stageName].splice(0, 100);
}

function recordPlanGen(success, durationMs) {
  metrics.compute.planGen.total++;
  if (success) metrics.compute.planGen.success++;
  else metrics.compute.planGen.fail++;
  metrics.compute.planGen.totalDurationMs += durationMs || 0;
}

// ═══════════════════════════════════════════
// 阶段4: 服务 (Serve)
// ═══════════════════════════════════════════

function recordServe(success, ms) {
  metrics.serve.total++;
  if (success) metrics.serve.success++;
  metrics.serve.totalMs += ms || 0;
  metrics.serve.latencies.push(ms || 0);
  if (metrics.serve.latencies.length > 1000) metrics.serve.latencies.splice(0, 100);
}

// ═══════════════════════════════════════════
// 阶段5: 展示 (Display) — 渲染快照上报
// ═══════════════════════════════════════════

function recordDisplayCheck(pass) {
  metrics.display.checkCount++;
  if (pass) metrics.display.passCount++;
  else metrics.display.failCount++;
}

function recordRenderReport(report) {
  metrics.display.reports.push(Object.assign({ time: Date.now() }, report));
  if (metrics.display.reports.length > 500) metrics.display.reports.splice(0, 100);
}

// ═══════════════════════════════════════════
// 聚合计算
// ═══════════════════════════════════════════

function _calcScrapeStats(days) {
  const cutoff = Date.now() - days * 86400000;
  const sources = {};
  const sourceNames = Object.keys(metrics.scrape);

  sourceNames.forEach(function (name) {
    const records = (metrics.scrape[name] || []).filter(function (r) { return r.time >= cutoff; });
    if (records.length === 0) return;
    const total = records.reduce(function (s, r) { return s + r.total; }, 0);
    const success = records.reduce(function (s, r) { return s + r.success; }, 0);
    const avgMs = Math.round(records.reduce(function (s, r) { return s + r.ms; }, 0) / records.length);
    const lastRec = records[records.length - 1];
    sources[name] = {
      total, success,
      successRate: total > 0 ? Math.round((success / total) * 10000) / 100 : 0,
      avgMs,
      recordCount: records.length,
      lastSuccess: new Date(lastRec.time).toISOString(),
      daily: {}, // { date: { total, success } }
    };
    // 按日期聚合
    records.forEach(function (r) {
      if (!sources[name].daily[r.date]) sources[name].daily[r.date] = { total: 0, success: 0 };
      sources[name].daily[r.date].total += r.total;
      sources[name].daily[r.date].success += r.success;
    });
  });

  // 计算平均成功率
  let totalRate = 0, rateCount = 0;
  Object.keys(sources).forEach(function (name) {
    if (sources[name].total > 0) { totalRate += sources[name].successRate; rateCount++; }
  });
  const avgRate = rateCount > 0 ? Math.round((totalRate / rateCount) * 100) / 100 : 0;

  return { sources, avgRate, sourceCount: Object.keys(sources).length };
}

function _calcIngestStats() {
  const m = metrics.ingest;
  const rate = m.total > 0 ? Math.round((m.success / m.total) * 10000) / 100 : 100;
  return {
    total: m.total, success: m.success, error: m.error,
    successRate: rate + '%',
    consecutiveErrors: 0,
    lastError: m.lastError,
    lastErrorTime: m.lastErrorTime,
  };
}

function _calcComputeStats(days) {
  const cutoff = Date.now() - days * 86400000;
  const stages = {};
  const stageNames = Object.keys(metrics.compute.stages);

  stageNames.forEach(function (name) {
    const records = (metrics.compute.stages[name] || []).filter(function (r) { return r.time >= cutoff; });
    if (records.length === 0) return;
    const avgMs = Math.round(records.reduce(function (s, r) { return s + r.durationMs; }, 0) / records.length);
    const totalOutput = records.reduce(function (s, r) { return s + r.outputCount; }, 0);
    const successes = records.filter(function (r) { return r.success; }).length;
    stages[name] = {
      runs: records.length,
      success: successes,
      fail: records.length - successes,
      avgMs,
      totalOutput,
      lastRun: new Date(records[records.length - 1].time).toISOString(),
    };
  });

  const pg = metrics.compute.planGen;
  const planAvgMs = pg.total > 0 ? Math.round(pg.totalDurationMs / pg.total) : 0;

  return {
    stages,
    planGen: { total: pg.total, success: pg.success, fail: pg.fail, avgDurationMs: planAvgMs },
  };
}

function _calcServeStats() {
  const m = metrics.serve;
  const rate = m.total > 0 ? Math.round((m.success / m.total) * 10000) / 100 : 100;
  const avgMs = m.total > 0 ? Math.round(m.totalMs / m.total) : 0;
  // 计算 P50 / P95
  const sorted = m.latencies.slice().sort(function (a, b) { return a - b; });
  const len = sorted.length;
  const p50 = len > 0 ? sorted[Math.floor(len * 0.5)] : 0;
  const p95 = len > 0 ? sorted[Math.floor(len * 0.95)] : 0;
  return {
    total: m.total, success: m.success,
    successRate: rate + '%',
    avgMs,
    p50, p95,
    samples: len,
  };
}

function _calcDisplayStats() {
  const m = metrics.display;
  const rate = m.checkCount > 0 ? Math.round((m.passCount / m.checkCount) * 10000) / 100 : 100;
  return {
    checkCount: m.checkCount, passCount: m.passCount, failCount: m.failCount,
    passRate: rate + '%',
    recentReports: m.reports.slice(-20).reverse(),
  };
}

// ═══════════════════════════════════════════
// 综合质量评分
// ═══════════════════════════════════════════

function _calcQualityScore(days) {
  const scrape = _calcScrapeStats(days);
  const ingest = _calcIngestStats();
  const compute = _calcComputeStats(days);
  const serve = _calcServeStats();
  const display = _calcDisplayStats();

  // 各维度分 (0-100)
  function clamp(v) { return Math.min(100, Math.max(0, Math.round(v))); }

  // 抓取: 各源成功率平均
  let scrapeTotal = 0, scrapeCnt = 0;
  Object.keys(scrape.sources).forEach(function (name) {
    scrapeTotal += scrape.sources[name].successRate; scrapeCnt++;
  });
  const scrapeScore = scrapeCnt > 0 ? clamp(scrapeTotal / scrapeCnt) : 0;

  // 存储: 写入成功率
  const ingestRate = ingest.total > 0 ? (ingest.success / ingest.total) * 100 : 100;
  const storageScore = clamp(ingestRate);

  // 计算: 管线成功率
  let compTotalScore = 0, compCnt = 0;
  Object.keys(compute.stages).forEach(function (name) {
    const s = compute.stages[name];
    const r = s.runs > 0 ? (s.success / s.runs) * 100 : 100;
    compTotalScore += r; compCnt++;
  });
  const computeScore = compCnt > 0 ? clamp(compTotalScore / compCnt) : 0;

  // 服务: API 成功率
  const serveRate = serve.total > 0 ? (serve.success / serve.total) * 100 : 100;
  const serveScore = clamp(serveRate);

  // 展示: 渲染检测通过率
  const displayRate = display.checkCount > 0 ? (display.passCount / display.checkCount) * 100 : 100;
  const displayScore = clamp(displayRate);

  const overall = clamp(
    scrapeScore * QUALITY_WEIGHTS.scrape +
    storageScore * QUALITY_WEIGHTS.storage +
    computeScore * QUALITY_WEIGHTS.compute +
    serveScore * QUALITY_WEIGHTS.serve +
    displayScore * QUALITY_WEIGHTS.display
  );

  return {
    overall,
    dimensions: {
      scrape: scrapeScore,
      storage: storageScore,
      compute: computeScore,
      serve: serveScore,
      display: displayScore,
    },
    scores: { scrape: scrapeScore, storage: storageScore, compute: computeScore, serve: serveScore, display: displayScore },
  };
}

// ═══════════════════════════════════════════
// 文件新鲜度检查
// ═══════════════════════════════════════════

function getFileFreshness() {
  const files = [
    { key: 'data.json', path: path.join(__dirname, '..', 'data.json'), label: '比赛+推荐数据' },
    { key: 'midou_data.db', path: path.join(__dirname, '..', 'midou_data.db'), label: 'SQLite 主数据库' },
    { key: 'auth.db', path: path.join(__dirname, '..', 'auth.db'), label: '认证数据库' },
    { key: 'trends.json', path: path.join(__dirname, '..', 'trends.json'), label: '趋势统计' },
    { key: 'ai_cache.json', path: path.join(__dirname, '..', 'ai_cache.json'), label: 'AI 分析缓存' },
    { key: 'alerts.json', path: path.join(__dirname, '..', 'alerts.json'), label: '告警记录' },
    { key: 'scheduler_state.json', path: path.join(__dirname, '..', 'scheduler_state.json'), label: '调度器状态' },
  ];

  const result = [];
  files.forEach(function (f) {
    try {
      if (!fs.existsSync(f.path)) {
        result.push({ key: f.key, label: f.label, sizeKB: 0, ageMin: -1, status: 'missing' });
        return;
      }
      const stat = fs.statSync(f.path);
      const sizeKB = Math.round(stat.size / 1024);
      const ageMin = Math.round((Date.now() - stat.mtimeMs) / 60000);
      let status = 'fresh';
      if (ageMin > 120) status = 'stale';
      if (ageMin > 360) status = 'old';
      result.push({ key: f.key, label: f.label, sizeKB, ageMin, status, mtime: stat.mtimeMs });
    } catch (e) {
      result.push({ key: f.key, label: f.label, sizeKB: 0, ageMin: -1, status: 'error', error: e.message });
    }
  });
  return result;
}

// ═══════════════════════════════════════════
// 快照定时器 (每5分钟存一次趋势)
// ═══════════════════════════════════════════

function _takeSnapshot() {
  const q = _calcQualityScore(1);
  metrics.snapshots.push({
    time: Date.now(),
    overall: q.overall,
    dimensions: q.dimensions,
    scrapeAvgRate: _calcScrapeStats(1).avgRate,
  });
  if (metrics.snapshots.length > 1000) metrics.snapshots.splice(0, 100);
}

// 启动快照定时器
const _snapshotTimer = setInterval(_takeSnapshot, 5 * 60 * 1000);
_snapshotTimer.unref();

// ═══════════════════════════════════════════
// 主入口: 聚合看板数据
// ═══════════════════════════════════════════

/**
 * 获取采集看板数据 (Tab 5)
 */
function getPipelineDashboard(days) {
  days = days || 1;
  const scrape = _calcScrapeStats(days);
  const freshFiles = getFileFreshness();

  // 构建当日比赛级矩阵 (从最近的 scrape 记录反推)
  const dailyMatrix = {};
  const recentDate = new Date().toISOString().slice(0, 10);
  Object.keys(scrape.sources).forEach(function (name) {
    const src = scrape.sources[name];
    if (src.daily && src.daily[recentDate]) {
      dailyMatrix[name] = src.daily[recentDate];
    }
  });

  return {
    sources: scrape.sources,
    avgRate: scrape.avgRate,
    sourceCount: scrape.sourceCount,
    dailyProgress: {
      date: recentDate,
      totalMatches: Object.keys(dailyMatrix).length > 0
        ? Math.max.apply(null, Object.keys(dailyMatrix).map(function (k) { return dailyMatrix[k].total; }))
        : 0,
      matrix: dailyMatrix,
    },
    writes: _calcIngestStats(),
    fileFreshness: freshFiles,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 获取计算看板数据 (Tab 6)
 */
function getComputeDashboard(days) {
  days = days || 1;
  const compute = _calcComputeStats(days);
  const serve = _calcServeStats();

  // 构建管线状态
  const stages = [];
  Object.keys(compute.stages).forEach(function (name) {
    const s = compute.stages[name];
    stages.push({
      name: name,
      status: s.fail > 0 ? (s.success > s.fail ? 'warn' : 'error') : 'ok',
      duration: s.avgMs,
      output: s.totalOutput,
      runs: s.runs,
    });
  });

  return {
    pipeline: {
      stages: stages,
      planGen: compute.planGen,
    },
    api: serve,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 获取增强版 data-health 数据 (Tab 7 + 原有 data-health.js)
 */
function getHealthDashboard(days) {
  days = days || 1;
  const scrape = _calcScrapeStats(days);
  const quality = _calcQualityScore(days);

  // 趋势数据 (最近 24 个快照 = 2小时)
  const trendDates = [];
  const trendOverall = [];
  const trendScrape = [];
  const trendStorage = [];
  const trendCompute = [];
  const trendServe = [];
  const trendDisplay = [];
  const snapshots = metrics.snapshots.slice(-24);
  snapshots.forEach(function (s) {
    const d = new Date(s.time);
    trendDates.push(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
    trendOverall.push(s.overall);
    trendScrape.push(s.dimensions.scrape);
    trendStorage.push(s.dimensions.storage);
    trendCompute.push(s.dimensions.compute);
    trendServe.push(s.dimensions.serve);
    trendDisplay.push(s.dimensions.display);
  });

  // 从文件新鲜度推断存储评分
  const freshFiles = getFileFreshness();
  const freshCount = freshFiles.filter(function (f) { return f.status === 'fresh'; }).length;
  const storageScore = freshFiles.length > 0 ? Math.round((freshCount / freshFiles.length) * 100) : 0;

  return {
    fetchSources: scrape.sources,
    sourceCount: scrape.sourceCount,
    avgRate: scrape.avgRate,
    qualityScore: quality,
    fileFreshness: freshFiles,
    timeSeries: {
      dates: trendDates,
      overall: trendOverall,
      scrape: trendScrape,
      storage: trendStorage,
      compute: trendCompute,
      serve: trendServe,
      display: trendDisplay,
    },
    displayStats: _calcDisplayStats(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * 重置所有指标
 */
function resetAll() {
  Object.keys(metrics.scrape).forEach(function (k) { delete metrics.scrape[k]; });
  metrics.ingest = { total: 0, success: 0, error: 0, lastError: null, lastErrorTime: null };
  metrics.compute = { stages: {}, planGen: { total: 0, success: 0, fail: 0, totalDurationMs: 0 } };
  metrics.serve = { total: 0, success: 0, totalMs: 0, p50: 0, p95: 0, latencies: [] };
  metrics.display = { checkCount: 0, passCount: 0, failCount: 0, reports: [] };
  metrics.snapshots = [];
}

module.exports = {
  recordScrape,
  recordIngest,
  recordComputeStage,
  recordPlanGen,
  recordServe,
  recordDisplayCheck,
  recordRenderReport,
  getPipelineDashboard,
  getComputeDashboard,
  getHealthDashboard,
  getFileFreshness,
  resetAll,
  QUALITY_WEIGHTS,
  GATE_THRESHOLDS,
};
