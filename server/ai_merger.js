/**
 * AI 交叉合并引擎
 * 对 DeepSeek + 豆包两个模型的分析结果进行去重、冲突裁决、互补合并
 */

/**
 * 计算两段文本的相似度（基于字符集 Jaccard + 词级重叠）
 * 返回 0-1 之间的相似度
 */
function textSimilarity(a, b) {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0;
  var sa = String(a), sb = String(b);
  if (sa === sb) return 1.0;
  if (sa.length < 10 && sb.length < 10) return 0; // 太短的不比较

  // 字符级 Jaccard
  var setA = {}, setB = {};
  for (var i = 0; i < sa.length - 1; i++) setA[sa.slice(i, i + 2)] = true;
  for (var j = 0; j < sb.length - 1; j++) setB[sb.slice(j, j + 2)] = true;
  var overlap = 0, total = 0;
  for (var k in setA) { total++; if (setB[k]) overlap++; }
  for (var k in setB) { if (!setA[k]) total++; }
  if (total === 0) return 0.5;

  // 词级重合加权（中文用单字）
  var wordsA = sa.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split('');
  var wordsB = sb.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').split('');
  var setWA = {}, setWB = {}, wordOverlap = 0;
  for (var wi = 0; wi < wordsA.length; wi++) setWA[wordsA[wi]] = true;
  for (var wj = 0; wj < wordsB.length; wj++) setWB[wordsB[wj]] = true;
  var wordTotal = Math.max(Object.keys(setWA).length, Object.keys(setWB).length);
  for (var wk in setWA) { if (setWB[wk]) wordOverlap++; }
  if (wordTotal === 0) wordTotal = 1;
  var wordSim = wordOverlap / wordTotal;

  var charSim = overlap / Math.max(total, 1);
  return charSim * 0.4 + wordSim * 0.6;
}

/**
 * 检测两个预测方向是否相反
 */
function isOppositePrediction(dsDir, dbDir) {
  if (!dsDir || !dbDir) return false;
  var ds = String(dsDir).trim(), db = String(dbDir).trim();
  // 胜平负相反
  if ((ds === '主胜' && (db === '客胜' || db === '主负')) ||
      (db === '主胜' && (ds === '客胜' || ds === '主负'))) return true;
  // 大小球相反
  if ((ds === '大球' && db === '小球') || (ds === '小球' && db === '大球')) return true;
  // 让球方向相反
  if ((ds === '让胜' && (db === '让负' || db === '让平')) ||
      (db === '让胜' && (ds === '让负' || ds === '让平'))) return true;
  return false;
}

/**
 * 互补合并：将两段文字拼接，去冗余句
 */
function complementMerge(a, b) {
  if (!a && !b) return '';
  if (!a) return String(b);
  if (!b) return String(a);
  var sa = String(a).trim(), sb = String(b).trim();
  // 若 b 完全包含在 a 中，直接返回 a
  if (sa.indexOf(sb) >= 0) return sa;
  // 简单拼接，中间用"。"连接
  if (sa.slice(-1) === '。' || sb.slice(0, 1) === '。') return sa + ' ' + sb;
  return sa + '。' + sb;
}

/**
 * 解析预测建议为结构化的玩法→方向映射
 */
function parsePredictions(predsArray) {
  var map = {};
  if (!predsArray || !Array.isArray(predsArray)) return map;
  predsArray.forEach(function (p) {
    var playType = (p['玩法'] || '').trim();
    var direction = (p['建议方向'] || '').trim();
    if (playType && direction) {
      map[playType] = { direction: direction, logic: p['核心逻辑'] || '' };
    }
  });
  return map;
}

/**
 * 主合并函数
 * @param {Object} deepseekResult - { content, confidence, rawResponse }
 * @param {Object} doubaoResult - { content, confidence, rawResponse }
 * @param {Object} matchInfo - 比赛基本信息
 * @returns {Object} 合并后的结果 { content, confidence, _mergeMeta }
 */
function mergeAnalyses(deepseekResult, doubaoResult, matchInfo) {
  var ds = deepseekResult.content || {};
  var db = doubaoResult.content || {};
  var dsConf = typeof ds.confidence === 'number' ? ds.confidence : 70;
  var dbConf = typeof db.confidence === 'number' ? db.confidence : 70;

  var merged = {};
  var conflicts = []; // 记录冲突信息

  // ── 步骤① 结构对齐 ──
  var sections = ['基础面', '状态面', '动机面', '对位面', '市场面', '核心看点'];
  sections.forEach(function (section) {
    var dsSection = ds[section] || {};
    var dbSection = db[section] || {};
    merged[section] = {};

    // 收集所有字段
    var fields = {};
    for (var k in dsSection) { if (dsSection.hasOwnProperty(k)) fields[k] = true; }
    for (var k in dbSection) { if (dbSection.hasOwnProperty(k)) fields[k] = true; }

    for (var field in fields) {
      var dsVal = dsSection[field];
      var dbVal = dbSection[field];

      // 表格类保留两份（攻防全景数据等）
      if (field === '攻防全景数据' || field === '伤病影响') {
        // 优先用 DeepSeek 的表格（数据更规范）
        merged[section][field] = dsVal || dbVal;
        continue;
      }

      // 字符串类字段去重
      if (typeof dsVal === 'string' && typeof dbVal === 'string') {
        var sim = textSimilarity(dsVal, dbVal);
        if (sim > 0.85) {
          // 高度相似 → 取 confidence 更高者的版本
          merged[section][field] = dsConf >= dbConf ? dsVal : dbVal;
        } else if (sim > 0.5) {
          // 部分相似 → 互补拼接（去冗余句）
          merged[section][field] = complementMerge(dsVal, dbVal);
        } else {
          // 低相似度 → DeepSeek 为主
          merged[section][field] = dsVal || dbVal;
          if (dsVal && dbVal && dsVal !== dbVal) {
            conflicts.push({
              section: section,
              field: field,
              deepseek: clipText(dsVal, 60),
              doubao: clipText(dbVal, 60),
              severity: sim < 0.3 ? 'high' : 'medium',
              resolved: 'deepseek_primary'
            });
          }
        }
      } else if (dsVal !== undefined && dbVal === undefined) {
        merged[section][field] = dsVal;
      } else if (dsVal === undefined && dbVal !== undefined) {
        merged[section][field] = dbVal;
      } else if (dsVal !== undefined && dbVal !== undefined) {
        // 非字符串类型 → DeepSeek 优先
        merged[section][field] = dsVal;
      }
    }

    // 确保 "概括" 字段存在
    if (!merged[section]['概括']) {
      merged[section]['概括'] = dsSection['概括'] || dbSection['概括'] || '';
    }
  });

  // ── 步骤③ 预测建议冲突裁决 ──
  var dsPreds = parsePredictions(ds['预测建议'] || []);
  var dbPreds = parsePredictions(db['预测建议'] || []);
  merged['预测建议'] = [];

  var playTypes = {};
  for (var pt in dsPreds) { if (dsPreds.hasOwnProperty(pt)) playTypes[pt] = true; }
  for (var pt in dbPreds) { if (dbPreds.hasOwnProperty(pt)) playTypes[pt] = true; }

  var predictionConflict = false; // 是否发生方向冲突

  for (var playType in playTypes) {
    var dsDir = dsPreds[playType] ? dsPreds[playType].direction : '';
    var dbDir = dbPreds[playType] ? dbPreds[playType].direction : '';
    var dsLogic = dsPreds[playType] ? dsPreds[playType].logic : '';
    var dbLogic = dbPreds[playType] ? dbPreds[playType].logic : '';

    var finalDirection = dsDir || dbDir;
    var finalLogic = dsLogic || dbLogic;
    var conflictNote = '';

    if (dsDir && dbDir && isOppositePrediction(dsDir, dbDir)) {
      // 预测方向相反
      predictionConflict = true;
      var confGap = Math.abs(dsConf - dbConf);
      if (confGap > 30) {
        // 一方明显更有信心 → 取高信心模型
        finalDirection = dsConf >= dbConf ? dsDir : dbDir;
        finalLogic = dsConf >= dbConf ? dsLogic : dbLogic;
        conflictNote = '交叉验证：另一模型持不同观点（' + (dsConf >= dbConf ? '豆包倾向' + dbDir : 'DeepSeek倾向' + dsDir) + '），已采用高置信度模型建议';
      } else {
        // 信心接近 → DeepSeek 为主 + 分歧提示
        finalDirection = dsDir;
        finalLogic = dsLogic;
        conflictNote = '另一AI模型持不同观点（倾向' + dbDir + '），存在观点分歧，请谨慎参考';
      }
      conflicts.push({
        section: '预测建议',
        field: playType,
        deepseek: dsDir,
        doubao: dbDir,
        severity: 'critical',
        resolution: confGap > 30 ? 'high_confidence_wins' : 'deepseek_primary',
        note: conflictNote
      });
    }

    merged['预测建议'].push({
      '玩法': playType,
      '建议方向': finalDirection,
      '核心逻辑': finalLogic
    });

    // 如果有冲突提示，加入核心逻辑
    if (conflictNote) {
      var lastPred = merged['预测建议'][merged['预测建议'].length - 1];
      lastPred['核心逻辑'] = lastPred['核心逻辑'] + '。' + conflictNote;
    }
  }

  // ── 步骤④ 变数提醒补充分歧 ──
  if (predictionConflict && merged['核心看点']) {
    var existingRemind = merged['核心看点']['变数提醒'] || '';
    var conflictSummary = conflicts
      .filter(function (c) { return c.severity === 'critical'; })
      .map(function (c) { return '⚠️ ' + c.note; })
      .join('；');
    if (conflictSummary && existingRemind.indexOf(conflictSummary) < 0) {
      merged['核心看点']['变数提醒'] = existingRemind
        ? existingRemind + ' ' + conflictSummary
        : conflictSummary;
    }
  }

  // ── 步骤⑤ JSON 重组 ──
  // 综合 confidence
  var finalConf = Math.round((dsConf + dbConf) / 2);
  merged.confidence = finalConf;

  // 附加合并元数据（不影响前端渲染，但用于调试）
  merged['_mergeMeta'] = {
    merged: true,
    sources: ['deepseek', 'doubao'],
    modelConfidence: { deepseek: dsConf, doubao: dbConf },
    conflicts: conflicts
  };

  console.log('[ai_merger] 合并完成: confidence=' + finalConf +
    (dsConf && dbConf ? (' (DS:' + dsConf + ', DB:' + dbConf + ')') : '') +
    ', 冲突数=' + conflicts.length +
    (predictionConflict ? ' [有方向冲突]' : ' [无方向冲突]'));

  return {
    content: merged,
    confidence: finalConf,
    _mergeMeta: merged['_mergeMeta']
  };
}

function clipText(text, maxLen) {
  var s = String(text || '');
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 3) + '...';
}

module.exports = { mergeAnalyses };
