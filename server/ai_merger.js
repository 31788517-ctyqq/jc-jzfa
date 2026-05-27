/**
 * AI 交叉合并引擎
 * 对 DeepSeek + 豆包两个模型的分析结果进行去重、冲突裁决、互补合并
 */

const fs = require('fs');
const path = require('path');

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
 * 从"X胜X平X负"文本中解析 W/D/L 数值
 * 返回 { w: N, d: N, l: N } 或 null
 */
function parseWinDrawLoss(text) {
  if (!text) return null;
  var str = String(text);
  var m = str.match(/(\d+)\s*胜\s*(\d+)\s*平\s*(\d+)\s*负/);
  if (m) return { w: parseInt(m[1], 10), d: parseInt(m[2], 10), l: parseInt(m[3], 10) };
  // 反向匹配 "X负X平X胜"
  m = str.match(/(\d+)\s*负\s*(\d+)\s*平\s*(\d+)\s*胜/);
  if (m) return { w: parseInt(m[3], 10), d: parseInt(m[2], 10), l: parseInt(m[1], 10) };
  // 简写格式 "4W 1D 1L"
  m = str.match(/(\d+)\s*[WＷwｗ]\s*(\d+)\s*[DＤdｄ]\s*(\d+)\s*[LＬlｌ]/i);
  if (m) return { w: parseInt(m[1], 10), d: parseInt(m[2], 10), l: parseInt(m[3], 10) };
  return null;
}

/**
 * 对比两队近期战绩，检测冲突
 * @param {Object} dsStateSection - DeepSeek 的状态面
 * @param {Object} dbStateSection - 豆包 的状态面
 * @param {string} homeTeam - 主队名称
 * @param {string} awayTeam - 客队名称
 * @returns {Object|null} 冲突检测结果
 */
function checkRecentFormConflict(dsStateSection, dbStateSection, homeTeam, awayTeam) {
  var dsHomeText = (dsStateSection || {})['主队近况'] || '';
  var dsAwayText = (dsStateSection || {})['客队近况'] || '';
  var dbHomeText = (dbStateSection || {})['主队近况'] || '';
  var dbAwayText = (dbStateSection || {})['客队近况'] || '';

  var dsHome = parseWinDrawLoss(dsHomeText);
  var dsAway = parseWinDrawLoss(dsAwayText);
  var dbHome = parseWinDrawLoss(dbHomeText);
  var dbAway = parseWinDrawLoss(dbAwayText);

  // 两个模型都必须有可解析的数据才做检测
  if (!dsHome && !dbHome && !dsAway && !dbAway) return null;

  var result = { detected: false, conflicts: {} };

  // 检测主队数据冲突
  if (dsHome && dbHome) {
    var homeConflict = !(dsHome.w === dbHome.w && dsHome.d === dbHome.d && dsHome.l === dbHome.l);
    result.conflicts.home = {
      conflict: homeConflict,
      deepseek: dsHome,
      doubao: dbHome,
      deepseekText: dsHomeText,
      doubaoText: dbHomeText
    };
    if (homeConflict) result.detected = true;
  } else if (dsHome && !dbHome) {
    result.conflicts.home = { conflict: false, deepseek: dsHome, doubao: null, deepseekText: dsHomeText, doubaoText: '' };
  } else if (!dsHome && dbHome) {
    result.conflicts.home = { conflict: false, deepseek: null, doubao: dbHome, deepseekText: '', doubaoText: dbHomeText };
  } else {
    result.conflicts.home = { conflict: false, deepseek: null, doubao: null, deepseekText: '', doubaoText: '' };
  }

  // 检测客队数据冲突
  if (dsAway && dbAway) {
    var awayConflict = !(dsAway.w === dbAway.w && dsAway.d === dbAway.d && dsAway.l === dbAway.l);
    result.conflicts.away = {
      conflict: awayConflict,
      deepseek: dsAway,
      doubao: dbAway,
      deepseekText: dsAwayText,
      doubaoText: dbAwayText
    };
    if (awayConflict) result.detected = true;
  } else if (dsAway && !dbAway) {
    result.conflicts.away = { conflict: false, deepseek: dsAway, doubao: null, deepseekText: dsAwayText, doubaoText: '' };
  } else if (!dsAway && dbAway) {
    result.conflicts.away = { conflict: false, deepseek: null, doubao: dbAway, deepseekText: '', doubaoText: dbAwayText };
  } else {
    result.conflicts.away = { conflict: false, deepseek: null, doubao: null, deepseekText: '', doubaoText: '' };
  }

  result.severity = 'low';
  if (result.conflicts.home.conflict && result.conflicts.away.conflict) result.severity = 'high';
  else if (result.conflicts.home.conflict || result.conflicts.away.conflict) result.severity = 'medium';

  return result.detected ? result : null;
}

/**
 * 对比攻防全景数据表格，检测数值冲突
 * @param {Array} dsRows - DeepSeek 的 rows
 * @param {Array} dbRows - 豆包 的 rows
 * @returns {Object|null} { detected, conflicts: [{label, dsHome, dsAway, dbHome, dbAway, conflict}], dsRows, dbRows }
 */
function checkAttackDefenseConflict(dsRows, dbRows) {
  if (!dsRows || !dsRows.length || !dbRows || !dbRows.length) {
    // 只有一方有数据，不算冲突
    return null;
  }

  // 建索引：按 row[0]（数据项标签）匹配
  var dsMap = {};
  dsRows.forEach(function (row, i) { if (row && row.length >= 3) dsMap[row[0]] = row; });
  var dbMap = {};
  dbRows.forEach(function (row, i) { if (row && row.length >= 3) dbMap[row[0]] = row; });

  var conflictRows = [];
  var hasConflict = false;

  for (var label in dsMap) {
    var dsRow = dsMap[label], dbRow = dbMap[label];
    if (!dsRow) continue;
    var dsHome = String(dsRow[1] || ''), dsAway = String(dsRow[2] || '');
    var dbHome = dbRow ? String(dbRow[1] || '') : '';
    var dbAway = dbRow ? String(dbRow[2] || '') : '';

    // 解析数值
    var dsHomeNum = parseFloat(dsHome), dsAwayNum = parseFloat(dsAway);
    var dbHomeNum = parseFloat(dbHome), dbAwayNum = parseFloat(dbAway);

    // 射手标签等非数值字段直接跳过比较
    if (isNaN(dsHomeNum) || isNaN(dsAwayNum)) continue;
    if (dbRow && (isNaN(dbHomeNum) || isNaN(dbAwayNum))) continue;

    // 比较差异（>0.1 视为冲突，因为不同数据源可能略有差异）
    var homeDiff = dbRow ? Math.abs(dsHomeNum - dbHomeNum) : 0;
    var awayDiff = dbRow ? Math.abs(dsAwayNum - dbAwayNum) : 0;
    var isConflict = (homeDiff > 0.1 || awayDiff > 0.1);

    conflictRows.push({
      label: label,
      dsHome: dsHome, dsAway: dsAway,
      dbHome: dbHome, dbAway: dbAway,
      conflict: isConflict,
      homeDiff: Math.round(homeDiff * 100) / 100,
      awayDiff: Math.round(awayDiff * 100) / 100
    });
    if (isConflict) hasConflict = true;
  }

  // 如果有只豆包有的行（DeepSeek没有），也加上
  for (var lbl in dbMap) {
    if (!dsMap[lbl]) {
      var dbOnlyRow = dbMap[lbl];
      if (dbOnlyRow && dbOnlyRow.length >= 3) {
        conflictRows.push({
          label: lbl,
          dsHome: '', dsAway: '',
          dbHome: String(dbOnlyRow[1] || ''), dbAway: String(dbOnlyRow[2] || ''),
          conflict: false, // 独有数据不算冲突
          homeDiff: 0, awayDiff: 0
        });
      }
    }
  }

  if (!conflictRows.length) return null;

  // 按冲突行数决定 severity
  var conflictCount = conflictRows.filter(function (r) { return r.conflict; }).length;
  var severity = conflictCount === 0 ? 'none' : (conflictCount <= 2 ? 'low' : 'medium');

  return {
    detected: hasConflict,
    conflicts: conflictRows,
    severity: severity,
    dsRows: dsRows,
    dbRows: dbRows
  };
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
 * 加载500.com合并数据，用于交叉校验
 * @param {string} dateStr - 日期 YYYY-MM-DD
 * @returns {Object|null}
 */
function loadShujuForValidation(dateStr) {
  try {
    var shujuFile = path.join(__dirname, 'shuju_data', 'shuju_merged_' + dateStr + '.json');
    if (!fs.existsSync(shujuFile)) return null;
    return JSON.parse(fs.readFileSync(shujuFile, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** 辅助：安全计算场均（保留1位小数），返回字符串 */
function calcAvg(total, games) {
  if (total === undefined || total === null || games === undefined || games <= 0) return '?';
  return (total / games).toFixed(1);
}

/**
 * 校验并修正攻防全景数据 + 近期战绩
 * 如果 AI 模型输出的数值与500.com不一致，用500.com数据覆盖
 * @param {Object} merged - 当前合并后的内容对象
 * @param {Object} matchInfo - 比赛基本信息
 * @returns {Object} 修正后的 merged 对象
 */
function validateAndFixFromShuju(merged, matchInfo) {
  if (!matchInfo || !matchInfo.date) return merged;
  var dateStr = (matchInfo.date || '').slice(0, 10);
  if (!dateStr) return merged;

  var shujuData = loadShujuForValidation(dateStr);
  if (!shujuData) return merged;

  var matchShuju = (shujuData.matches || {})[matchInfo.num || ''];
  if (!matchShuju || !matchShuju.recentForm) return merged;

  var rf = matchShuju.recentForm;

  // 获取攻防数据源：优先近10场同联赛 → fallback 近10场全联赛
  var h10, a10;
  if (rf.last10League && rf.last10League.home && rf.last10League.home.wins !== undefined) {
    h10 = rf.last10League.home;
    a10 = rf.last10League.away || {};
  } else if (rf.last10 && rf.last10.home && rf.last10.home.wins !== undefined) {
    h10 = rf.last10.home;
    a10 = rf.last10.away || {};
  } else {
    return merged;
  }

  var h6 = (rf.last6 || {}).home || {};
  var a6 = (rf.last6 || {}).away || {};

  // ⭐ 修正攻防全景数据表格
  var fixedRows = [
    ['赛季场均进球', calcAvg(h10.goals, 10), calcAvg(a10.goals, 10)],
    ['赛季场均失球', calcAvg(h10.conceded, 10), calcAvg(a10.conceded, 10)],
    ['近6场场均进球', calcAvg(h6.goals, 6), calcAvg(a6.goals, 6)],
    ['近6场场均失球', calcAvg(h6.conceded, 6), calcAvg(a6.conceded, 6)],
    ['核心射手', '根据知识库补充', '根据知识库补充']
  ];

  if (merged['基础面'] && merged['基础面']['攻防全景数据']) {
    var oldRows = merged['基础面']['攻防全景数据'].rows || [];
    // 简单检测：如果现有 rows 长度不对或数值缺失，强制覆盖
    var needFix = oldRows.length < 4;
    merged['基础面']['攻防全景数据'].rows = fixedRows;
    merged['基础面']['攻防全景数据']._verified = true;
    merged['基础面']['攻防全景数据']._source = '500.com';
    if (needFix || merged['基础面']['攻防全景数据']._wasWrong) {
      console.log('[ai_merger] 攻防全景数据已用500.com数据覆盖');
    }
  }

  // ⭐ 修正近期战绩主客队 WDL
  var formHomeStats, formAwayStats;
  var h6f = (rf.last6 || {}).home || {};
  var a6f = (rf.last6 || {}).away || {};
  if (h6f.wins !== undefined) { formHomeStats = h6f; formAwayStats = a6f; }
  else { formHomeStats = h10; formAwayStats = a10; }

  var fixedHomeForm = '近6场' + (formHomeStats.wins || 0) + '胜' + (formHomeStats.draws || 0) + '平' + (formHomeStats.losses || 0) + '负';
  var fixedAwayForm = '近6场' + (formAwayStats.wins || 0) + '胜' + (formAwayStats.draws || 0) + '平' + (formAwayStats.losses || 0) + '负';

  if (merged['状态面']) {
    var oldHome = merged['状态面']['主队近况'] || '';
    var oldAway = merged['状态面']['客队近况'] || '';
    // 解析旧值中的 WDL
    var oldHomeWDL = parseWinDrawLoss(oldHome);
    var oldAwayWDL = parseWinDrawLoss(oldAway);
    var needFixHome = !oldHomeWDL ||
      oldHomeWDL.w !== (formHomeStats.wins || 0) ||
      oldHomeWDL.d !== (formHomeStats.draws || 0) ||
      oldHomeWDL.l !== (formHomeStats.losses || 0);
    var needFixAway = !oldAwayWDL ||
      oldAwayWDL.w !== (formAwayStats.wins || 0) ||
      oldAwayWDL.d !== (formAwayStats.draws || 0) ||
      oldAwayWDL.l !== (formAwayStats.losses || 0);

    if (needFixHome || needFixAway) {
      merged['状态面']['主队近况'] = fixedHomeForm;
      merged['状态面']['客队近况'] = fixedAwayForm;
      merged['状态面']['_recentFormVerified'] = true;
      console.log('[ai_merger] 近期战绩已用500.com数据覆盖: 主队=' + fixedHomeForm + ' 客队=' + fixedAwayForm);
    }
  }

  return merged;
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

      // 表格类特殊处理
      if (field === '攻防全景数据') {
        // DeepSeek 表格为主，同时保留豆包表格供交叉验证
        merged[section][field] = dsVal || dbVal;
        if (dsVal && dbVal) {
          merged[section]['_attackDefenseDsRows'] = (dsVal && dsVal.rows) ? dsVal.rows : null;
          merged[section]['_attackDefenseDbRows'] = (dbVal && dbVal.rows) ? dbVal.rows : null;
        }
        continue;
      }
      if (field === '伤病影响') {
        // 优用 DeepSeek 的表格
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

  // ── 步骤② 近期战绩交叉验证 ──
  var recentFormCheck = checkRecentFormConflict(
    ds['状态面'] || {}, db['状态面'] || {},
    (matchInfo && matchInfo.homeName) || '',
    (matchInfo && matchInfo.visitName) || ''
  );
  if (recentFormCheck) {
    merged['状态面']['_recentFormCheck'] = recentFormCheck;
    // 记录冲突
    if (recentFormCheck.conflicts.home && recentFormCheck.conflicts.home.conflict) {
      conflicts.push({
        section: '状态面',
        field: '主队近况',
        deepseek: clipText(recentFormCheck.conflicts.home.deepseekText || '', 60),
        doubao: clipText(recentFormCheck.conflicts.home.doubaoText || '', 60),
        severity: recentFormCheck.severity || 'medium',
        resolved: 'both_shown',
        dsW: recentFormCheck.conflicts.home.deepseek ? recentFormCheck.conflicts.home.deepseek.w : null,
        dsD: recentFormCheck.conflicts.home.deepseek ? recentFormCheck.conflicts.home.deepseek.d : null,
        dsL: recentFormCheck.conflicts.home.deepseek ? recentFormCheck.conflicts.home.deepseek.l : null,
        dbW: recentFormCheck.conflicts.home.doubao ? recentFormCheck.conflicts.home.doubao.w : null,
        dbD: recentFormCheck.conflicts.home.doubao ? recentFormCheck.conflicts.home.doubao.d : null,
        dbL: recentFormCheck.conflicts.home.doubao ? recentFormCheck.conflicts.home.doubao.l : null
      });
    }
    if (recentFormCheck.conflicts.away && recentFormCheck.conflicts.away.conflict) {
      conflicts.push({
        section: '状态面',
        field: '客队近况',
        deepseek: clipText(recentFormCheck.conflicts.away.deepseekText || '', 60),
        doubao: clipText(recentFormCheck.conflicts.away.doubaoText || '', 60),
        severity: recentFormCheck.severity || 'medium',
        resolved: 'both_shown',
        dsW: recentFormCheck.conflicts.away.deepseek ? recentFormCheck.conflicts.away.deepseek.w : null,
        dsD: recentFormCheck.conflicts.away.deepseek ? recentFormCheck.conflicts.away.deepseek.d : null,
        dsL: recentFormCheck.conflicts.away.deepseek ? recentFormCheck.conflicts.away.deepseek.l : null,
        dbW: recentFormCheck.conflicts.away.doubao ? recentFormCheck.conflicts.away.doubao.w : null,
        dbD: recentFormCheck.conflicts.away.doubao ? recentFormCheck.conflicts.away.doubao.d : null,
        dbL: recentFormCheck.conflicts.away.doubao ? recentFormCheck.conflicts.away.doubao.l : null
      });
    }
  }

  // ── 步骤②b 攻防全景数据交叉验证 ──
  var adDsRows = merged['基础面']['_attackDefenseDsRows'];
  var adDbRows = merged['基础面']['_attackDefenseDbRows'];
  if (adDsRows && adDbRows) {
    var adCheck = checkAttackDefenseConflict(adDsRows, adDbRows);
    if (adCheck && adCheck.detected) {
      merged['基础面']['_attackDefenseCheck'] = adCheck;
      adCheck.conflicts.forEach(function (c) {
        if (c.conflict) {
          conflicts.push({
            section: '基础面',
            field: '攻防全景数据' + '-' + c.label,
            deepseek: c.dsHome + '/' + c.dsAway,
            doubao: c.dbHome + '/' + c.dbAway,
            severity: adCheck.severity || 'medium',
            resolved: 'both_shown',
            diff: c.homeDiff + '/' + c.awayDiff
          });
        }
      });
    }
    // 即使无冲突也保留交叉数据供前端展示一致性
    if (adCheck && !adCheck.detected) {
      merged['基础面']['_attackDefenseCheck'] = adCheck;
    }
  }

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

  // ── 步骤④b 500.com 数据交叉校验与强制覆盖 ──
  // 攻防全景数据和近期战绩必须以500.com预计算值为准
  merged = validateAndFixFromShuju(merged, matchInfo);

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

module.exports = { mergeAnalyses, validateAndFixFromShuju, loadShujuForValidation };
