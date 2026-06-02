/**
 * Mock: server/logger.js
 */
const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => logger,
  startTimer: () => ({ end: () => 0 }),
};
module.exports = logger;
