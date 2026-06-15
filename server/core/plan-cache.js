/**
 * 方案缓存共享模块 — index.js 和 data_sync.js 共享
 * 避免循环依赖
 */
var _buster = 0;
exports.getCacheBuster = function () { return _buster; };
exports.bumpCache = function () { _buster = Date.now(); };
