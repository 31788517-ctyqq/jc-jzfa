/**
 * Mock: server/database.js
 * 为 prediction_log / scheduler_v2 等模块提供可控制的 mock 数据库
 */

let _mockData = {
  matches: [],
  recommends: [],
  crawl_logs: [],
  ai_predictions: [],
  prediction_logs: [],
};

let _available = false;

function __reset() {
  _mockData = {
    matches: [],
    recommends: [],
    crawl_logs: [],
    ai_predictions: [],
    prediction_logs: [],
  };
  _available = false;
}

function __seed(table, rows) {
  if (!_mockData[table]) _mockData[table] = [];
  _mockData[table].push(...rows);
}

function __setAvailable(val) {
  _available = val;
}

function initDatabase() {
  _available = true;
  return true;
}
function isAvailable() {
  return _available;
}

function getDatabase() {
  if (!_available) return null;

  // 模拟 sql.js prepare/bind/step/getAsObject 接口
  return {
    prepare(sql) {
      return new MockStatement(sql);
    },
    exec(sql) {
      return new MockStatement(sql).execRaw();
    },
    run(sql, params) {
      return new MockStatement(sql).bind(params || [])._runDirect();
    },
    getRowsModified() {
      return this._rowsModified || 0;
    },
    _rowsModified: 0,
  };
}

function closeDatabase() {
  _available = false;
}

// ── Mock Statement ──
class MockStatement {
  constructor(sql) {
    this._sql = sql;
    this._params = [];
    this._stepIdx = -1;
    this._results = [];
    this._execResults = null;
  }

  bind(params) {
    this._params = params;
    this._executeQuery();
    return this;
  }

  step() {
    this._stepIdx++;
    return this._stepIdx < this._results.length;
  }

  getAsObject() {
    return this._results[this._stepIdx] || null;
  }

  free() {}

  _executeQuery() {
    this._results = [];
    this._stepIdx = -1;

    const sql = this._sql.toLowerCase().trim();

    // prediction_logs 表操作
    if (sql.includes('prediction_logs')) {
      if (sql.includes('select')) {
        this._results = _mockData.prediction_logs;
        // 简单 id 匹配过滤
        if (sql.includes('where matchid = ?') && this._params.length >= 1) {
          this._results = _mockData.prediction_logs.filter((r) => r.matchId == this._params[0]);
        }
        if (sql.includes('where actual_score is not null')) {
          this._results = this._results.filter((r) => r.actual_score && r.actual_score !== '');
        }
        if (sql.includes('where date = ?') && this._params.length >= 1) {
          this._results = this._results.filter((r) => r.date === this._params[0]);
        }
      } else if (sql.includes('insert') || sql.includes('update')) {
        // 写操作暂存
      }
    }

    // matches 表
    if (sql.includes('from matches')) {
      if (sql.includes('select')) {
        this._results = _mockData.matches;
      }
    }

    // crawl_logs
    if (sql.includes('from crawl_logs')) {
      this._results = _mockData.crawl_logs;
    }

    // ai_predictions
    if (sql.includes('from ai_predictions')) {
      this._results = _mockData.ai_predictions;
    }
  }

  execRaw() {
    // 返回 sql.js exec() 格式
    const cols = [];
    const vals = [];
    if (this._execResults && this._execResults.length) {
      cols.push(...Object.keys(this._execResults[0]));
      vals.push(...this._execResults.map((r) => Object.values(r)));
    }
    return cols.length ? [{ columns: cols, values: vals }] : [];
  }

  _runDirect() {
    const sql = this._sql.toLowerCase().trim();
    if (sql.startsWith('insert')) {
      // 简单 INSERT 处理
      const newRow = {};
      const match = sql.match(/\(([^)]+)\)\s*values\s*\(([^)]+)\)/i);
      if (match && this._params.length) {
        const cols = match[1].split(',').map((c) => c.trim());
        cols.forEach((c, i) => {
          newRow[c] = this._params[i];
        });
        _mockData.prediction_logs.push(newRow);
      }
    }
    return { changes: 1 };
  }
}

// ── getAdapter mock ──
function getAdapter() {
  const adp = {
    execOne: function () {
      return null;
    },
    execAll: function () {
      return [];
    },
    execRun: function () {
      return { changes: 0 };
    },
    execDDL: function () {},
    close: function () {},
    raw: null,
  };
  return adp;
}

// ── 完整导出 mock ──
module.exports = {
  initDatabase,
  initAuthDatabase: function () { _available = true; return true; }, // ★ P0 mock
  initArchiveDatabase: function () { return true; }, // ★ P1 mock
  isAvailable,
  isAuthDbAvailable: function () { return _available; }, // ★ P0 mock
  isArchiveDbAvailable: function () { return false; }, // ★ P1 mock
  getDatabase,
  getAdapter,
  getAuthAdapter: getAdapter, // ★ P0 mock: 认证DB适配器 = 主DB适配器
  getArchiveAdapter: getAdapter, // ★ P1 mock: 归档DB适配器 = 主DB适配器
  closeDatabase,
  // Matches
  upsertMatch: () => {},
  batchUpsertMatches: () => {},
  getMatchesByDate: () => [],
  getAllMatches: () => [],
  getAllLeagues: () => [],
  // Recommends
  batchUpsertRecommends: () => {},
  getRecommendsByMatchId: () => [],
  updateRecommendResult: () => {},
  getStaleRecommendations: () => [],
  // Crawl logs
  logCrawl: () => {},
  getCrawledDates: () => [],
  // Stats
  getHitRateStats: () => [],
  getDailyTrend: () => [],
  getFilterStats: () => ({ matchCount: 0, leagueCount: 0, directionCount: 0 }),
  getFilterRate: () => ({
    hitCount: 0,
    totalCount: 0,
    hitRate: 0,
    conditionSummary: '',
    detailList: [],
    dailyResults: [],
  }),
  // AI
  upsertAIPrediction: () => {},
  getAIPrediction: () => null,
  // Today
  getTodayUnfinishedMatches: () => [],
  getTodayMatchSummary: () => ({
    todayDate: '',
    totalMatches: 0,
    finishedMatches: 0,
    unfinishedMatches: 0,
    canShowCards: false,
  }),
  // Test helpers
  __reset,
  __seed,
  __setAvailable,
  _mockData,
};
