/**
 * AI 核心看点定时生成脚本
 * - 每天 11:30：批量生成当日所有未结束比赛的五维分析（双模型 DeepSeek + 豆包）
 * - 每天 16:30：精简刷新（仅豆包 + 缓存命中跳过，大幅降费）
 * - 当天最后一场结束后：不生成新比赛
 * - 缓存新鲜度：4 小时内已生成则跳过
 * - 熔断比赛自动跳过（功守道 fusionConsensusType === 'meltdown'）
 *
 * ★ P0-1 降级开关:
 *   FEATURE_RICH_PROMPT=1 → AI Prompt 注入全维度数据（赔率趋势/基本面/热度/融合特征）
 *   FEATURE_RICH_PROMPT=0 (默认) → 仅注入 500.com 战绩（当前行为）
 */
const path = require('path');
const fs = require('fs');

const RICH_PROMPT_ENABLED = String(process.env.FEATURE_RICH_PROMPT || '0') === '1';

// 尝试加载 database（SQLite模式），失败则 fallback 到 data.json 模式
let database = null;
let useDB = false;
try {
  database = require('./database');
  database.initDatabase();
  useDB = true;
  console.log('[ai_daemon] 数据库模式');
} catch (e) {
  console.log('[ai_daemon] 数据库不可用，使用 data.json 模式:', e.message);
}

const deepseek = require('./deepseek');
const doubao = require('./doubao');
const aiMerger = require('./ai_merger');

const LOG_FILE = path.join(__dirname, '..', 'logs', 'ai_daemon.log');

// ★ P3-1: AI 缓存最大保留 30 天（降低 ai_cache.json 膨胀速度）
const AI_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// ★ 费用优化: 缓存新鲜度阈值（4小时内已分析则跳过）
const CACHE_FRESH_MS = 4 * 60 * 60 * 1000;

function log(msg) {
  const line = '[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

let isRunning = false;

/**
 * 获取当天比赛列表
 */
function getTodayMatches() {
  if (useDB) {
    return database.getTodayUnfinishedMatches() || [];
  }
  // data.json fallback
  try {
    const dataFile = path.join(__dirname, 'data.json');
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const matches = data.m || {};
    const now = new Date();
    const today =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');
    const list = [];
    Object.keys(matches).forEach(function (k) {
      const m = matches[k];
      if (!m || !m.date) return;
      if (m.date.slice(0, 10) !== today) return;
      if (m.matchStatus >= 3) return;
      list.push({
        matchId: k.replace('m_', ''),
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        date: m.date || '',
        num: m.num || '',
        matchStatus: m.matchStatus || 0,
        startTime: m.startTime || '',
      });
    });
    return list;
  } catch (e) {
    log('获取比赛列表失败: ' + e.message);
    return [];
  }
}

/**
 * 保存 AI 分析结果（双模型合并版本）
 */
function savePrediction(matchId, matchInfo, mergedResult, dsResult, dbResult) {
  if (useDB) {
    return database.upsertAIPrediction(matchId, {
      leagueName: matchInfo.leagueName,
      homeName: matchInfo.homeName,
      visitName: matchInfo.visitName,
      matchDate: matchInfo.date,
      content: mergedResult.content || mergedResult,
      confidence: mergedResult.confidence || (mergedResult.content && mergedResult.content.confidence) || 0,
      rawPrompt: JSON.stringify({ system: deepseek.buildSystemPrompt(), user: deepseek.buildUserPrompt(matchInfo) }),
      rawResponse: (dsResult && dsResult.rawResponse) || '',
      tokenUsage: (dsResult && dsResult.tokenUsage) || 0,
    });
  }
  // ai_cache.json 记录（新格式：含 sources）
  try {
    const aiFile = path.join(__dirname, 'ai_cache.json');
    let cache = {};
    if (fs.existsSync(aiFile)) cache = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    const now = new Date().toISOString();
    cache[matchId] = {
      content: mergedResult.content || mergedResult,
      confidence: mergedResult.confidence || (mergedResult.content && mergedResult.content.confidence) || 0,
      updatedAt: now,
      merged: !!(dsResult && dbResult),
      sources: {
        deepseek: dsResult
          ? {
              content: dsResult.content || null,
              confidence: (dsResult.content && dsResult.content.confidence) || 70,
              generatedAt: now,
            }
          : null,
        doubao: dbResult
          ? {
              content: dbResult.content || null,
              confidence: (dbResult.content && dbResult.content.confidence) || 70,
              generatedAt: now,
            }
          : null,
      },
    };

    // ★ P0-3: 写入 ai_cache.json（清洗由每日 cleanAiCache 统一分层归档）
    fs.writeFileSync(aiFile, JSON.stringify(cache));
    return true;
  } catch (e) {
    log('保存预测失败: ' + e.message);
  }
}

/**
 * 检查比赛是否在缓存保鲜期内（4小时内已分析）
 * @returns {boolean}
 */
function isMatchCached(matchId) {
  try {
    const aiFile = path.join(__dirname, 'ai_cache.json');
    if (!fs.existsSync(aiFile)) return false;
    const cache = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    const entry = cache[matchId];
    if (!entry || !entry.updatedAt) return false;
    const age = Date.now() - new Date(entry.updatedAt).getTime();
    return age < CACHE_FRESH_MS;
  } catch (e) {
    return false;
  }
}

/**
 * 检查比赛是否为功守道熔断（数据质量差，跳过 AI 分析）
 * @param {string} matchId
 * @returns {boolean}
 */
function isMeltdown(matchId) {
  try {
    const gsPath = path.join(__dirname, 'gongshoudao', 'cache.json');
    if (!fs.existsSync(gsPath)) return false;
    const gsCache = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
    const globalGS = gsCache._global || {};
    // matchId 可能是 m_123456 或 123456 格式
    const entry = globalGS[matchId] || globalGS['m_' + matchId];
    if (entry && entry.fusionConsensusType === 'meltdown') {
      log('跳过熔断比赛: ' + matchId);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

/**
 * 处理单场比赛（双模型并行 + 合并）
 * 带缓存检查 + 熔断过滤
 */
function processMatch(match, options) {
  options = options || {};
  const skipCache = options.skipCache !== undefined ? options.skipCache : false;

  // 熔断比赛跳过
  if (isMeltdown(match.matchId)) {
    log('熔断跳过: ' + match.matchId);
    return Promise.resolve({ matchId: match.matchId, success: false, skipped: 'meltdown' });
  }

  // 缓存命中跳过（11:30 首次分析不跳过，16:30 刷新时跳过）
  if (!skipCache && isMatchCached(match.matchId)) {
    log('缓存命中跳过: ' + match.matchId);
    return Promise.resolve({ matchId: match.matchId, success: true, cached: true });
  }

  log('处理比赛: ' + match.homeName + ' vs ' + match.visitName + ' (' + match.matchId + ')');

  return Promise.all([
    deepseek
      .generateAnalysis(match)
      .then(function (r) {
        return {
          source: 'deepseek',
          content: r.content,
          confidence: (r.content && r.content.confidence) || 70,
          rawResponse: r.rawResponse,
          tokenUsage: r.tokenUsage,
          parseError: r.parseError,
        };
      })
      .catch(function (err) {
        log('DeepSeek 失败 ' + match.matchId + ': ' + err.message);
        return { source: 'deepseek', error: err.message };
      }),
    doubao
      .generateAnalysis(match)
      .then(function (r) {
        return {
          source: 'doubao',
          content: r.content,
          confidence: (r.content && r.content.confidence) || 70,
          rawResponse: r.rawResponse,
          tokenUsage: r.tokenUsage,
          parseError: r.parseError,
        };
      })
      .catch(function (err) {
        log('豆包 失败 ' + match.matchId + ': ' + err.message);
        return { source: 'doubao', error: err.message };
      }),
  ]).then(function (results) {
    const dsResult = results[0];
    const dbResult = results[1];

    if (dsResult.content && dbResult.content) {
      // 双模型成功 → 合并
      const merged = aiMerger.mergeAnalyses(
        { content: dsResult.content, confidence: dsResult.confidence },
        { content: dbResult.content, confidence: dbResult.confidence },
        match,
      );
      savePrediction(match.matchId, match, merged, dsResult, dbResult);
      log('完成 ' + match.matchId + ': 双模型合并 confidence=' + merged.confidence);
      return { matchId: match.matchId, success: true, merged: true };
    } else if (dsResult.content) {
      // 仅 DeepSeek 成功
      savePrediction(match.matchId, match, dsResult, dsResult, null);
      log('完成 ' + match.matchId + ': 仅 DeepSeek (豆包失败)');
      return { matchId: match.matchId, success: true, merged: false, partial: true };
    } else if (dbResult.content) {
      // 仅豆包成功
      savePrediction(match.matchId, match, dbResult, null, dbResult);
      log('完成 ' + match.matchId + ': 仅豆包 (DeepSeek失败)');
      return { matchId: match.matchId, success: true, merged: false, partial: true };
    } else {
      // 都失败
      log('双失败 ' + match.matchId + ': DS=' + (dsResult.error || '') + ', DB=' + (dbResult.error || ''));
      return { matchId: match.matchId, success: false, error: '双模型均失败' };
    }
  });
}

/**
 * ★ 费用优化: 精简模式 — 仅用豆包（不用 DeepSeek），适合 16:30 二次刷新
 * 先检查缓存 + 熔断，通过后仅调用豆包
 */
function processMatchLight(match) {
  if (isMeltdown(match.matchId)) {
    log('[精简] 熔断跳过: ' + match.matchId);
    return Promise.resolve({ matchId: match.matchId, success: false, skipped: 'meltdown' });
  }
  if (isMatchCached(match.matchId)) {
    log('[精简] 缓存命中跳过: ' + match.matchId);
    return Promise.resolve({ matchId: match.matchId, success: true, cached: true });
  }

  log('[精简] 仅豆包: ' + match.homeName + ' vs ' + match.visitName + ' (' + match.matchId + ')');

  return doubao
    .generateAnalysis(match)
    .then(function (r) {
      if (r.content) {
        savePrediction(match.matchId, match, r, null, {
          content: r.content,
          rawResponse: r.rawResponse,
          tokenUsage: r.tokenUsage,
        });
        log('[精简] 完成 ' + match.matchId + ' (仅豆包)');
        return { matchId: match.matchId, success: true, partial: true };
      }
      log('[精简] 豆包解析失败 ' + match.matchId);
      return { matchId: match.matchId, success: false, error: '豆包解析失败' };
    })
    .catch(function (err) {
      log('[精简] 豆包失败 ' + match.matchId + ': ' + err.message);
      return { matchId: match.matchId, success: false, error: err.message };
    });
}

/**
 * 每天 11:30 批量生成（双模型完整版，skipCache=true 确保首次强制刷新）
 */
function dailyBatch() {
  return dailyBatchCore(false, false);
}

/**
 * 每天 16:30 批量生成（精简版：仅豆包 + 缓存检查）
 */
function dailyBatchLight() {
  return dailyBatchCore(true, false);
}

function dailyBatchCore(isLight, skipCache) {
  if (isRunning) {
    log('任务已在运行，跳过');
    return;
  }
  isRunning = true;
  const modeLabel = isLight ? '精简刷新（仅豆包）' : '双模型完整分析';
  log('========== 每日 AI 批量分析开始 [' + modeLabel + '] ==========');

  const matches = getTodayMatches();
  log('今日未结束比赛: ' + matches.length + ' 场');

  if (matches.length === 0) {
    log('今日无比赛，跳过');
    isRunning = false;
    return;
  }

  // 预处理: 统计熔断 + 缓存命中数
  var meltdownCount = 0;
  var cacheHitCount = 0;
  matches.forEach(function (m) {
    if (isMeltdown(m.matchId)) meltdownCount++;
    else if (!skipCache && isMatchCached(m.matchId)) cacheHitCount++;
  });
  var willProcess = matches.length - meltdownCount - cacheHitCount;
  log('熔断跳过: ' + meltdownCount + ' 场, 缓存命中: ' + cacheHitCount + ' 场, 实际需处理: ' + willProcess + ' 场');

  // 串行处理，每场间隔 2 秒
  function processNext(index) {
    if (index >= matches.length) {
      log('========== 每日 AI 批量分析完成 [' + modeLabel + '] ==========');
      isRunning = false;
      return Promise.resolve(); // 返回 Promise 供上层 await
    }
    var match = matches[index];
    var processor = isLight
      ? processMatchLight
      : function (m) {
          return processMatch(m, { skipCache: skipCache });
        };
    return processor(match)
      .then(function () {
        return new Promise(function (r) {
          setTimeout(r, 2000);
        });
      })
      .then(function () {
        return processNext(index + 1);
      });
  }

  return processNext(0);
}

/**
 * 计算到 11:30 的延迟
 */
function getDelayToTarget(hour, minute) {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

let dailyTimer1130 = null;
let dailyTimer1630 = null;

function start() {
  log('AI 定时守护进程启动（11:30/16:30 双模型 + 模型补算闭环）');

  // 立即运行一次
  dailyBatch();

  // 设置每天 11:30 定时（双模型 + 模型闭环）
  var delay1130 = getDelayToTarget(11, 30);
  log('首次 11:30(双模型+闭环) 将在 ' + Math.round(delay1130 / 3600000) + ' 小时后触发');
  dailyTimer1130 = setTimeout(function run1130() {
    dailyBatch().then(function () {
      // AI 完成后触发模型补算闭环（GS→PK）
      try {
        var ds = require('./data_sync');
        if (ds && ds.runModelClosure) {
          return ds.runModelClosure(new Date().toISOString().slice(0, 10), { reason: 'ai_1130' });
        }
      } catch (e) { log('[1130] 模型闭环触发失败: ' + e.message); }
    });
    dailyTimer1130 = setTimeout(run1130, 24 * 3600000);
  }, delay1130);

  // 设置每天 16:30 定时（双模型 + 模型闭环 + 缓存检查）
  var delay1630 = getDelayToTarget(16, 30);
  log('首次 16:30(双模型+闭环) 将在 ' + Math.round(delay1630 / 3600000) + ' 小时后触发');
  dailyTimer1630 = setTimeout(function run1630() {
    dailyBatch().then(function () {
      try {
        var ds = require('./data_sync');
        if (ds && ds.runModelClosure) {
          return ds.runModelClosure(new Date().toISOString().slice(0, 10), { reason: 'ai_1630' });
        }
      } catch (e) { log('[1630] 模型闭环触发失败: ' + e.message); }
    });
    dailyTimer1630 = setTimeout(run1630, 24 * 3600000);
  }, delay1630);
}

function stop() {
  if (dailyTimer1130) clearTimeout(dailyTimer1130);
  if (dailyTimer1630) clearTimeout(dailyTimer1630);
  dailyTimer1130 = null;
  dailyTimer1630 = null;
  log('AI 守护进程已停止');
}

// 直接运行时执行批量任务
if (require.main === module) {
  log('手动触发生成');
  dailyBatch();
}

/**
 * ★ P1-4→P0-3: 分层归档 ai_cache.json 中超期条目（数据零丢失）
 * 热层: ai_cache.json 保留最近 maxAgeMs 的条目用于实时查询
 * 冷层: ai_archive/ 归档超期条目，永久保存
 * @param {number} maxAgeMs 最大保留时间（默认 30 天）
 * @returns {number} 归档的条目数
 */
function cleanAiCache(maxAgeMs) {
  maxAgeMs = maxAgeMs || AI_CACHE_MAX_AGE_MS;
  const aiFile = path.join(__dirname, 'ai_cache.json');
  if (!fs.existsSync(aiFile)) return 0;
  try {
    const cache = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    const cutoffTime = Date.now() - maxAgeMs;
    const cleaned = {};
    const archived = {};
    let archivedCount = 0;
    Object.keys(cache).forEach(function (k) {
      const entry = cache[k];
      if (entry && entry.updatedAt) {
        const entryTime = new Date(entry.updatedAt).getTime();
        if (entryTime < cutoffTime) {
          archived[k] = entry; // 移至归档
          archivedCount++;
          return;
        }
      }
      cleaned[k] = entry; // 保留在热层
    });
    if (archivedCount > 0) {
      // 写回热层（不含超期条目）
      fs.writeFileSync(aiFile, JSON.stringify(cleaned));

      // 归档到冷层
      const archiveDir = path.join(__dirname, 'ai_archive');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const archiveFile = path.join(archiveDir, 'ai_archive_' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '.json');
      let existing = {};
      if (fs.existsSync(archiveFile)) {
        try { existing = JSON.parse(fs.readFileSync(archiveFile, 'utf8')); } catch (e) {}
      }
      Object.assign(existing, archived);
      fs.writeFileSync(archiveFile, JSON.stringify(existing));

      log('cleanAiCache: 分层归档 ' + archivedCount + ' 条 → ' + archiveFile + ' (热层剩余 ' + Object.keys(cleaned).length + ' 条)');
    }
    return archivedCount;
  } catch (e) {
    log('cleanAiCache 失败: ' + e.message);
    return 0;
  }
}

module.exports = { start, stop, dailyBatch, dailyBatchLight, getTodayMatches, cleanAiCache };
