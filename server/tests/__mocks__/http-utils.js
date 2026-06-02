/**
 * Mock: server/http-utils.js
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, 0));
}
function jitter(base, range) {
  return base + Math.floor(Math.random() * (range || 0));
}
function getWithUA(url) {
  return Promise.resolve({ data: {}, status: 200 });
}
function getWithRetry(url, retries) {
  return Promise.resolve({ data: {}, status: 200 });
}

module.exports = { sleep, jitter, getWithUA, getWithRetry, get: getWithUA };
