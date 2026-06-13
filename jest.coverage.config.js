const base = require('./jest.config');

const liveHttpSuites = [
  'admin-full-check',
  'data-pipeline-odds-score',
  'odds-prize-calc',
  'plan-design-flow',
  'plan-design-strict',
  'referral-e2e-edge',
  'referral-e2e-flow',
  'referral-e2e-strict',
  'referral-e2e-ultra',
  'referral-multi-renewal',
  'today-full-flow',
].join('|');

module.exports = {
  ...base,
  setupFiles: [...(base.setupFiles || []), '<rootDir>/jest.coverage.setup.js'],
  testPathIgnorePatterns: [
    ...(base.testPathIgnorePatterns || []),
    `server[\\\\/]tests[\\\\/](${liveHttpSuites})\\.test\\.js$`,
  ],
};
