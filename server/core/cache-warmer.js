/**
 * ★ P2-2: 缓存预热模块
 *
 * 在 PM2 重启后第一时间预加载核心缓存，避免首个用户请求踩"冷启动"。
 * 预热范围: data.json / cache.json _global / allplays.json / 当日 odds_history
 */

const fs = require('fs');
const path = require('path');

/**
 * 预热核心缓存
 * @param {Object} options - 可选配置
 * @param {Function} options.onProgress - 进度回调 (step, message)
 * @returns {Object} 预热统计
 */
function warmUp(options) {
  options = options || {};
  const log =
    options.log ||
    function (msg) {
      console.log('[cache-warmer] ' + msg);
    };
  const stats = { steps: 0, errors: 0, files: {} };

  function step(name, fn) {
    try {
      const result = fn();
      stats.files[name] = { ok: true, size: typeof result === 'object' ? Object.keys(result).length : 'N/A' };
      stats.steps++;
      log(name + ' OK');
    } catch (e) {
      stats.files[name] = { ok: false, error: e.message };
      stats.errors++;
      log(name + ' FAIL: ' + e.message);
    }
  }

  // 1) 预加载 data.json
  step('data.json', function () {
    const dataPath = path.join(__dirname, '..', 'data.json');
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }
    return {};
  });

  // 2) 预加载 cache.json _global
  step('cache.json', function () {
    const gsPath = path.join(__dirname, '..', 'gongshoudao', 'cache.json');
    if (fs.existsSync(gsPath)) {
      const cache = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
      return cache['_global'] || {};
    }
    return {};
  });

  // 3) 预加载 allplays.json
  step('allplays.json', function () {
    const apPath = path.join(__dirname, '..', 'allplays.json');
    if (fs.existsSync(apPath)) {
      return JSON.parse(fs.readFileSync(apPath, 'utf8'));
    }
    return {};
  });

  // 4) 预加载当日 odds_history
  const today = new Date().toISOString().slice(0, 10);
  step('odds_history (' + today + ')', function () {
    const odPath = path.join(__dirname, '..', 'odds_history', today + '.json');
    if (fs.existsSync(odPath)) {
      return JSON.parse(fs.readFileSync(odPath, 'utf8'));
    }
    return {};
  });

  // 5) 预加载 jczq_change_cache.json（轻量）
  step('jczq_change_cache.json', function () {
    const ccPath = path.join(__dirname, '..', 'jczq_change_cache.json');
    if (fs.existsSync(ccPath)) {
      return JSON.parse(fs.readFileSync(ccPath, 'utf8'));
    }
    return {};
  });

  // 6) 预加载 ai_cache.json（轻量）
  step('ai_cache.json', function () {
    const aiPath = path.join(__dirname, '..', 'ai_cache.json');
    if (fs.existsSync(aiPath)) {
      return JSON.parse(fs.readFileSync(aiPath, 'utf8'));
    }
    return {};
  });

  log('预热完成: ' + stats.steps + ' 成功 / ' + stats.errors + ' 失败');
  return stats;
}

module.exports = { warmUp };
