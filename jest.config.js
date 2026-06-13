/**
 * Jest 测试配置 — JC-ZJFA 项目
 *
 * 运行: npm test                     (全部测试)
 *       npx jest --testPathPattern=Phase1   (指定阶段)
 *       npx jest --coverage           (带覆盖率)
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/server/tests', '<rootDir>/server/gongshoudao/tests', '<rootDir>/preview/tests'],
  testMatch: ['**/*.test.js'],
  // smoke_api 需要运行中的服务器，仅通过 npm run test:smoke 手动执行
  testPathIgnorePatterns: ['smoke_api'],
  moduleDirectories: ['node_modules', '<rootDir>/server'],
  collectCoverageFrom: [
    'server/core/**/*.js',
    'server/gongshoudao/**/*.js',
    'server/prediction_log.js',
    'server/scheduler_v2.js',
    '!server/gongshoudao/tests/**',
    '!server/gongshoudao/test*.js',
    '!server/gongshoudao/e2e_test.js',
  ],
  coverageThreshold: {
    global: {
      statements: 25,
      branches: 20,
      functions: 25,
      lines: 25,
    },
  },
  // 需要 mock 的模块
  moduleNameMapper: {
    // 兼容前端资源版本号导入（如 ./foo.js?v=202606080441）
    '^(\\.{1,2}/.*)\\.js\\?v=.*$': '$1.js',
    // 数据库模块默认 mock — 用完整工程路径防止匹配 node_modules 内的同名文件
    '<rootDir>/server/database$': '<rootDir>/server/tests/__mocks__/database.js',
    // http-utils mock
    '^../http-utils$': '<rootDir>/server/tests/__mocks__/http-utils.js',
    '^./http-utils$': '<rootDir>/server/tests/__mocks__/http-utils.js',
    // logger mock
    '^../logger$': '<rootDir>/server/tests/__mocks__/logger.js',
    '^./logger$': '<rootDir>/server/tests/__mocks__/logger.js',
    // alert mock
    '^../alert$': '<rootDir>/server/tests/__mocks__/alert.js',
    '^./alert$': '<rootDir>/server/tests/__mocks__/alert.js',
  },
  transform: {
    '^.+\\.js$': 'babel-jest',
  },
  transformIgnorePatterns: ['\\\\node_modules\\\\', '/node_modules/'],
  verbose: true,
};
