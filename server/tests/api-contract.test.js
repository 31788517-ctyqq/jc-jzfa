const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.js');

const ACTION_MATRIX = {
  readOnlySafe: [
    'auth-session',
    'week-dates',
    'match-list',
    'recommend-trend',
    'ranking-list',
    'match-top-directions',
    'match-detail',
    'hit-rate-stats',
    'hit-rate-filter',
    'filter-leagues',
    'gongshoudao',
    'gongshoudao-all',
    'prediction-backtest',
    'quant-hot',
    'plan-catalog',
    'plan-list',
    'score-plan-list',
    'quant-plan-list',
    'income-stats',
    'filter-stats',
    'odds-trend',
    'match-preview',
    'match-odds',
    'cache-stats',
    'my-plan-list',
    'my-plan-stats',
    'batch-match-odds',
    'prediction-fusion',
    'model-dashboard',
    'data-health',
    'verify-results',
    'experiment-compare',
    'batch-consensus',
    'daily-profit-7d',
    'pk-version-compare',
    'user-list',
    'role-list',
    'error-log-summary',
    'payment-query-order',
    'subscription-status',
    'admin-subscription-list',
    'referral-info',
    'referral-account',
    'referral-commissions',
    'referral-withdraw-history',
    'admin-referral-commissions',
    'admin-referral-accounts',
    'admin-referral-withdraw-list',
  ],
  mutatingOrRequiresState: [
    'auth-login',
    'auth-register',
    'auth-logout',
    'auth-change-password',

    'sync-match-date',
    'sync-gov-schedule',
    'my-plan-save',
    'my-plan-delete',
    'user-create',
    'user-update-status',
    'role-permission-update',
    'user-role-update',
    'payment-create-order',
    'subscription-renew',
    'subscription-cancel-auto-renew',
    'subscription-enable-auto-renew',
    'admin-grant-subscription',
    'referral-withdraw-submit',
    'simulate-pay',
    'admin-referral-withdraw-process',
  ],
  heavyOrAsync: [
    'crawl-history',
    'crawl-status',
    'backfill-results',
    'backfill-status',
    'ai-predict',
    'ai-predict-status',
    'backtest-leagues',
    'ai-batch-generate',
    'auto-heal',
    'refill-expert-consensus',
    'refresh-predictions',
  ],
};

const READ_ONLY_SMOKE_CANDIDATES = [
  'week-dates',
  'match-list',
  'ranking-list',
  'match-odds',
  'batch-match-odds',
  'cache-stats',
  'my-plan-list',
  'prediction-fusion',
  'model-dashboard',
  'data-health',
  'experiment-compare',
  'batch-consensus',
  'odds-trend',
  'match-preview',
];

function readIndexSource() {
  return fs.readFileSync(INDEX_FILE, 'utf8');
}

function extractActions(source) {
  return Array.from(source.matchAll(/case\s+'([^']+)'\s*:/g), function (match) {
    return match[1];
  });
}

function flattenMatrix(matrix) {
  return Object.values(matrix).reduce(function (all, items) {
    return all.concat(items);
  }, []);
}

function collectDuplicates(items) {
  const seen = new Set();
  const dup = new Set();
  items.forEach(function (item) {
    if (seen.has(item)) dup.add(item);
    seen.add(item);
  });
  return Array.from(dup).sort();
}

function sortStrings(items) {
  return items.slice().sort();
}

describe('API action contract', () => {
  const source = readIndexSource();
  const extractedActions = extractActions(source);
  const matrixActions = flattenMatrix(ACTION_MATRIX);

  it('server/index.js 中的 action 不应重复定义', () => {
    expect(extractedActions.length).toBeGreaterThan(30);
    expect(collectDuplicates(extractedActions)).toEqual([]);
    expect(extractedActions.filter((action) => action === 'match-odds')).toHaveLength(1);
  });

  it('action 分类矩阵应完整覆盖当前 switch-case', () => {
    const missingInMatrix = extractedActions.filter(function (action) {
      return !matrixActions.includes(action);
    });
    const extraInMatrix = matrixActions.filter(function (action) {
      return !extractedActions.includes(action);
    });

    expect(collectDuplicates(matrixActions)).toEqual([]);
    expect(sortStrings(missingInMatrix)).toEqual([]);
    expect(sortStrings(extraInMatrix)).toEqual([]);
    expect(sortStrings(matrixActions)).toEqual(sortStrings(extractedActions));
  });

  it('readOnly smoke 候选 action 必须全部来自只读分组', () => {
    const readOnlySet = new Set(ACTION_MATRIX.readOnlySafe);
    const isolatedSet = new Set(ACTION_MATRIX.mutatingOrRequiresState.concat(ACTION_MATRIX.heavyOrAsync));

    READ_ONLY_SMOKE_CANDIDATES.forEach(function (action) {
      expect(extractedActions).toContain(action);
      expect(readOnlySet.has(action)).toBe(true);
      expect(isolatedSet.has(action)).toBe(false);
    });
  });

  it('关键回归 action 必须持续保留在 API 合同中', () => {
    [
      'match-odds',
      'batch-match-odds',
      'my-plan-list',
      'prediction-fusion',
      'model-dashboard',
      'data-health',
      'experiment-compare',
      'batch-consensus',
    ].forEach(function (action) {
      expect(extractedActions).toContain(action);
    });
  });
});
