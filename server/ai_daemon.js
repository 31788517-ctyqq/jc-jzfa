/**
 * AI 核心看点定时生成脚本
 * - 每天 11:30：批量生成当日所有未结束比赛的五维分析
 * - 每天 16:30：批量生成当日所有未结束比赛的五维分析（二次更新）
 * - 当天最后一场结束后：不生成新比赛
 */
const path = require('path');
const fs = require('fs');

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

// ★ P1-4: AI 缓存最大保留 90 天
const AI_CACHE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

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
    const today = new Date().toISOString().slice(0, 10);
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

    // ★ P1-4: 写入前清理 90 天前的过期条目
    const cutoffTime = Date.now() - AI_CACHE_MAX_AGE_MS;
    const cleaned = {};
    let purgedCount = 0;
    Object.keys(cache).forEach(function (k) {
      const entry = cache[k];
      if (entry && entry.updatedAt) {
        const entryTime = new Date(entry.updatedAt).getTime();
        if (entryTime < cutoffTime) {
          purgedCount++;
          return;
        }
      }
      cleaned[k] = entry;
    });
    if (purgedCount > 0) {
      log('清理 ' + purgedCount + ' 个过期 AI 缓存条目');
    }

    fs.writeFileSync(aiFile, JSON.stringify(cleaned));
    return true;
  } catch (e) {
    log('保存预测失败: ' + e.message);
  }
}

/**
 * 处理单场比赛（双模型并行 + 合并）
 */
function processMatch(match) {
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
 * 每天 11:30 批量生成
 */
function dailyBatch() {
  if (isRunning) {
    log('任务已在运行，跳过');
    return;
  }
  isRunning = true;
  log('========== 每日 AI 批量分析开始 ==========');

  const matches = getTodayMatches();
  log('今日未结束比赛: ' + matches.length + ' 场');

  if (matches.length === 0) {
    log('今日无比赛，跳过');
    isRunning = false;
    return;
  }

  // 串行处理，每场间隔 2 秒
  function processNext(index) {
    if (index >= matches.length) {
      log('========== 每日 AI 批量分析完成 ==========');
      isRunning = false;
      return;
    }
    return processMatch(matches[index])
      .then(function () {
        return new Promise(function (r) {
          setTimeout(r, 2000);
        });
      })
      .then(function () {
        return processNext(index + 1);
      });
  }

  processNext(0);
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
  log('AI 定时守护进程启动（每日 11:30 + 16:30）');

  // 立即运行一次（如果当前时间在生成点之后且今日未运行）
  dailyBatch();

  // 设置每天 11:30 定时
  var delay1130 = getDelayToTarget(11, 30);
  log('首次 11:30 定时将在 ' + Math.round(delay1130 / 3600000) + ' 小时后触发');
  dailyTimer1130 = setTimeout(function run1130() {
    dailyBatch();
    dailyTimer1130 = setTimeout(run1130, 24 * 3600000);
  }, delay1130);

  // 设置每天 16:30 定时
  var delay1630 = getDelayToTarget(16, 30);
  log('首次 16:30 定时将在 ' + Math.round(delay1630 / 3600000) + ' 小时后触发');
  dailyTimer1630 = setTimeout(function run1630() {
    dailyBatch();
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
 * ★ P1-4: 清理 ai_cache.json 中超过 maxAgeMs 的过期条目
 * @param {number} maxAgeMs 最大保留时间（默认 90 天）
 * @returns {number} 清理的条目数
 */
function cleanAiCache(maxAgeMs) {
  maxAgeMs = maxAgeMs || AI_CACHE_MAX_AGE_MS;
  const aiFile = path.join(__dirname, 'ai_cache.json');
  if (!fs.existsSync(aiFile)) return 0;
  try {
    const cache = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    const cutoffTime = Date.now() - maxAgeMs;
    const cleaned = {};
    let purgedCount = 0;
    Object.keys(cache).forEach(function (k) {
      const entry = cache[k];
      if (entry && entry.updatedAt) {
        const entryTime = new Date(entry.updatedAt).getTime();
        if (entryTime < cutoffTime) {
          purgedCount++;
          return;
        }
      }
      cleaned[k] = entry;
    });
    if (purgedCount > 0) {
      fs.writeFileSync(aiFile, JSON.stringify(cleaned));
      log('cleanAiCache: 清理 ' + purgedCount + ' 个过期条目（剩余 ' + Object.keys(cleaned).length + ' 条）');
    }
    return purgedCount;
  } catch (e) {
    log('cleanAiCache 失败: ' + e.message);
    return 0;
  }
}

module.exports = { start, stop, dailyBatch, getTodayMatches, cleanAiCache };
