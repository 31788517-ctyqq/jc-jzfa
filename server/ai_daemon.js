/**
 * AI 核心看点定时生成脚本
 * - 每天 11:30：批量生成当日所有未结束比赛的五维分析
 * - 开赛前 1 小时：刷新单场比赛分析（盘口变化）
 * - 当天最后一场结束后：不生成新比赛
 */
var path = require('path');
var fs = require('fs');

// 尝试加载 database（SQLite模式），失败则 fallback 到 data.json 模式
var database = null;
var useDB = false;
try {
  database = require('./database');
  database.initDatabase();
  useDB = true;
  console.log('[ai_daemon] 数据库模式');
} catch (e) {
  console.log('[ai_daemon] 数据库不可用，使用 data.json 模式:', e.message);
}

var deepseek = require('./deepseek');
var doubao = require('./doubao');
var aiMerger = require('./ai_merger');

var LOG_FILE = path.join(__dirname, '..', 'logs', 'ai_daemon.log');

function log(msg) {
  var line = '[' + new Date().toISOString().replace('T', ' ').slice(0, 19) + '] ' + msg;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (e) {}
}

var isRunning = false;

/**
 * 获取当天比赛列表
 */
function getTodayMatches() {
  if (useDB) {
    return database.getTodayUnfinishedMatches() || [];
  }
  // data.json fallback
  try {
    var dataFile = path.join(__dirname, 'data.json');
    var data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    var matches = data.m || {};
    var today = new Date().toISOString().slice(0, 10);
    var list = [];
    Object.keys(matches).forEach(function (k) {
      var m = matches[k];
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
        startTime: m.startTime || ''
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
      tokenUsage: (dsResult && dsResult.tokenUsage) || 0
    });
  }
  // ai_cache.json 记录（新格式：含 sources）
  try {
    var aiFile = path.join(__dirname, 'ai_cache.json');
    var cache = {};
    if (fs.existsSync(aiFile)) cache = JSON.parse(fs.readFileSync(aiFile, 'utf8'));
    var now = new Date().toISOString();
    cache[matchId] = {
      content: mergedResult.content || mergedResult,
      confidence: mergedResult.confidence || (mergedResult.content && mergedResult.content.confidence) || 0,
      updatedAt: now,
      merged: !!(dsResult && dbResult),
      sources: {
        deepseek: dsResult ? {
          content: dsResult.content || null,
          confidence: (dsResult.content && dsResult.content.confidence) || 70,
          generatedAt: now
        } : null,
        doubao: dbResult ? {
          content: dbResult.content || null,
          confidence: (dbResult.content && dbResult.content.confidence) || 70,
          generatedAt: now
        } : null
      }
    };
    fs.writeFileSync(aiFile, JSON.stringify(cache));
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
    deepseek.generateAnalysis(match).then(function (r) {
      return { source: 'deepseek', content: r.content, confidence: (r.content && r.content.confidence) || 70, rawResponse: r.rawResponse, tokenUsage: r.tokenUsage, parseError: r.parseError };
    }).catch(function (err) {
      log('DeepSeek 失败 ' + match.matchId + ': ' + err.message);
      return { source: 'deepseek', error: err.message };
    }),
    doubao.generateAnalysis(match).then(function (r) {
      return { source: 'doubao', content: r.content, confidence: (r.content && r.content.confidence) || 70, rawResponse: r.rawResponse, tokenUsage: r.tokenUsage, parseError: r.parseError };
    }).catch(function (err) {
      log('豆包 失败 ' + match.matchId + ': ' + err.message);
      return { source: 'doubao', error: err.message };
    })
  ]).then(function (results) {
    var dsResult = results[0];
    var dbResult = results[1];

    if (dsResult.content && dbResult.content) {
      // 双模型成功 → 合并
      var merged = aiMerger.mergeAnalyses(
        { content: dsResult.content, confidence: dsResult.confidence },
        { content: dbResult.content, confidence: dbResult.confidence },
        match
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
 * 设置开赛前 1 小时刷新定时器
 */
function schedulePreMatchRefresh(matches) {
  matches.forEach(function (match) {
    if (!match.startTime) return;
    try {
      var startDate = new Date(match.startTime.replace(/-/g, '/'));
      if (isNaN(startDate.getTime())) return;
      var refreshTime = startDate.getTime() - 3600000; // 1小时前
      var delay = refreshTime - Date.now();
      if (delay <= 0) return; // 已过刷新时间

      log('预约刷新 ' + match.matchId + ': ' + match.homeName + ' vs ' + match.visitName + ' 将在 ' + new Date(refreshTime).toISOString());
      setTimeout(function () {
        log('开赛前刷新: ' + match.matchId + ' ' + match.homeName + ' vs ' + match.visitName);
        processMatch(match);
      }, delay);
    } catch (e) {
      log('预约刷新失败 ' + match.matchId + ': ' + e.message);
    }
  });
}

/**
 * 每天 11:30 批量生成
 */
function dailyBatch() {
  if (isRunning) { log('任务已在运行，跳过'); return; }
  isRunning = true;
  log('========== 每日 AI 批量分析开始 ==========');

  var matches = getTodayMatches();
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
      // 设置开赛前刷新
      schedulePreMatchRefresh(matches);
      isRunning = false;
      return;
    }
    return processMatch(matches[index]).then(function () {
      return new Promise(function (r) { setTimeout(r, 2000); });
    }).then(function () {
      return processNext(index + 1);
    });
  }

  processNext(0);
}

/**
 * 计算到 11:30 的延迟
 */
function getDelayToTarget(hour, minute) {
  var now = new Date();
  var target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

var dailyTimer = null;
var preMatchTimers = [];

function start() {
  log('AI 定时守护进程启动');

  // 立即运行一次（如果当前时间在 11:30 之后且今日未运行）
  dailyBatch();

  // 设置每天 11:30 定时
  var delay = getDelayToTarget(11, 30);
  log('首次 11:30 定时将在 ' + Math.round(delay / 3600000) + ' 小时后触发');

  dailyTimer = setTimeout(function runDaily() {
    dailyBatch();
    dailyTimer = setTimeout(runDaily, 24 * 3600000);
  }, delay);
}

function stop() {
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = null;
  log('AI 守护进程已停止');
}

// 直接运行时执行批量任务
if (require.main === module) {
  log('手动触发生成');
  dailyBatch();
}

module.exports = { start, stop, dailyBatch, getTodayMatches };
