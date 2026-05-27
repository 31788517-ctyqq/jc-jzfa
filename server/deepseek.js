/**
 * DeepSeek API 客户端
 * 用于生成比赛 AI 五维分析内容
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.DEEPSEEK_API_KEY || 'DUMMY_PLACEHOLDER';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-v4-pro';
const TIMEOUT = 60000; // 60秒超时

/** 加载合并后的 shuju 数据（含500.com近10场+近6场） */
function loadShujuData(matchInfo) {
  try {
    var dateStr = (matchInfo.date || '').slice(0, 10);
    if (!dateStr) return null;
    var shujuFile = path.join(__dirname, 'shuju_data', 'shuju_merged_' + dateStr + '.json');
    if (!fs.existsSync(shujuFile)) return null;
    var shuju = JSON.parse(fs.readFileSync(shujuFile, 'utf8'));
    var matchNum = matchInfo.num || '';
    return (shuju.matches || {})[matchNum] || null;
  } catch (e) {
    return null;
  }
}

/** 格式化500.com统计数据为可读文本 */
function formatShujuStats(shuju) {
  if (!shuju || !shuju.recentForm) return '';

  var rf = shuju.recentForm;
  var parts = [];

  // 近10场（全联赛）
  var h10 = rf.last10 ? rf.last10.home : null;
  var a10 = rf.last10 ? rf.last10.away : null;
  if (h10 && h10.wins !== undefined) {
    parts.push('【500.com 近10场战绩（所有赛事）——请严格以此数据为准】');
    parts.push(formatTeamStats('主队', h10));
    parts.push(formatTeamStats('客队', a10));
  }

  // 近10场（同联赛）
  var h10L = rf.last10League ? rf.last10League.home : null;
  var a10L = rf.last10League ? rf.last10League.away : null;
  if (h10L && h10L.wins !== undefined) {
    parts.push('');
    parts.push('【500.com 近10场战绩（同联赛赛事）】');
    parts.push(formatTeamStats('主队', h10L));
    parts.push(formatTeamStats('客队', a10L));
  }

  // 近6场
  var h6 = rf.last6 ? rf.last6.home : null;
  var a6 = rf.last6 ? rf.last6.away : null;
  if (h6 && h6.wins !== undefined) {
    parts.push('');
    parts.push('【500.com 近6场战绩】');
    parts.push(formatTeamStats('主队', h6));
    parts.push(formatTeamStats('客队', a6));
  }

  return parts.join('\n');
}

function formatTeamStats(label, stats) {
  if (!stats) return '';
  var s = stats;
  var wdl = (s.wins || 0) + '胜' + (s.draws || 0) + '平' + (s.losses || 0) + '负';
  var goals = s.goals !== undefined ? '进' + s.goals + '球' : '';
  var conceded = s.conceded !== undefined ? '失' + s.conceded + '球' : '';
  var pct = [];
  if (s.winPct !== undefined) pct.push('胜率' + s.winPct + '%');
  if (s.handicapPct !== undefined) pct.push('赢盘率' + s.handicapPct + '%');
  if (s.overPct !== undefined) pct.push('大球率' + s.overPct + '%');
  return label + ': ' + [wdl, goals, conceded, pct.join(' ')].filter(Boolean).join('，');
}

/** 辅助：安全计算场均（保留1位小数），返回字符串 */
function calcAvg(total, games) {
  if (total === undefined || total === null || games === undefined || games <= 0) return '?';
  return (total / games).toFixed(1);
}

/**
 * 基于500.com数据预计算攻防全景数据表格
 * @param {Object} shujuData - 500.com 合并数据
 * @returns {Object|null} {header, rows, _verified, _source}
 */
function buildAttackDefenseTable(shujuData) {
  if (!shujuData || !shujuData.recentForm) return null;
  var rf = shujuData.recentForm;

  // 优先近10场同联赛 → fallback 近10场全联赛
  var h10, a10;
  if (rf.last10League && rf.last10League.home && rf.last10League.home.wins !== undefined) {
    h10 = rf.last10League.home;
    a10 = rf.last10League.away || {};
  } else if (rf.last10 && rf.last10.home && rf.last10.home.wins !== undefined) {
    h10 = rf.last10.home;
    a10 = rf.last10.away || {};
  } else {
    return null;
  }

  var h6 = (rf.last6 || {}).home || {};
  var a6 = (rf.last6 || {}).away || {};

  return {
    header: ['数据项', '主队', '客队'],
    rows: [
      ['赛季场均进球', calcAvg(h10.goals, 10), calcAvg(a10.goals, 10)],
      ['赛季场均失球', calcAvg(h10.conceded, 10), calcAvg(a10.conceded, 10)],
      ['近6场场均进球', calcAvg(h6.goals, 6), calcAvg(a6.goals, 6)],
      ['近6场场均失球', calcAvg(h6.conceded, 6), calcAvg(a6.conceded, 6)],
      ['核心射手', '根据知识库补充', '根据知识库补充']
    ],
    _verified: true,
    _source: '500.com'
  };
}

/**
 * 基于500.com数据预计算近期战绩 WDL
 * @param {Object} shujuData - 500.com 合并数据
 * @returns {Object|null} {home:{w,d,l}, away:{w,d,l}, _verified}
 */
function buildRecentFormWDL(shujuData) {
  if (!shujuData || !shujuData.recentForm) return null;
  var rf = shujuData.recentForm;

  // 优先近6场 → fallback 近10场同联赛 → fallback 近10场全联赛
  var homeStats, awayStats;
  var h6 = (rf.last6 || {}).home || {};
  var a6 = (rf.last6 || {}).away || {};
  if (h6.wins !== undefined) {
    homeStats = h6; awayStats = a6;
  } else {
    var h10L = (rf.last10League || {}).home || {};
    var a10L = (rf.last10League || {}).away || {};
    if (h10L.wins !== undefined) {
      homeStats = h10L; awayStats = a10L;
    } else {
      var h10 = (rf.last10 || {}).home || {};
      var a10 = (rf.last10 || {}).away || {};
      homeStats = h10; awayStats = a10;
    }
  }

  return {
    home: { w: homeStats.wins || 0, d: homeStats.draws || 0, l: homeStats.losses || 0 },
    away: { w: awayStats.wins || 0, d: awayStats.draws || 0, l: awayStats.losses || 0 },
    _verified: true
  };
}

/**
 * 构建五维分析的 System Prompt
 */
function buildSystemPrompt() {
  return `你是一个专业的足球比赛分析师。请根据用户提供的比赛信息，严格按照"五维分析框架"生成中文分析内容。

分析框架严格参照以下结构：
1. 基础面：积分排名、攻防全景数据（表格）、核心结论
2. 状态面：主队近况、客队近况、历史对阵、伤病影响（表格）、队内氛围、核心结论
3. 动机面：战意强度
4. 对位面：攻防博弈、节奏控制、主场氛围、战术与教练风格、核心结论
5. 市场面：盘口与赔率、大小球、数据变化解读、诱导可能、核心结论
6. 核心看点：核心看点、变数提醒
7. 预测建议：胜平负建议、大小球建议、比分预测（表格形式）

要求：
- 使用中文回答
- 数据需基于你的知识库搜索真实信息，不要全部编造
- 每个字段字数控制在100字以内
- 表格使用 Markdown 格式
- 输出为 JSON 格式（方便程序解析）
- 只输出 JSON，不要有其他任何文字`;
}

/**
 * 构建用户 Prompt
 */
function buildUserPrompt(matchInfo) {
  var shujuData = loadShujuData(matchInfo);
  var shujuText = shujuData ? formatShujuStats(shujuData) : '';
  var adTable = shujuData ? buildAttackDefenseTable(shujuData) : null;
  var formWDL = shujuData ? buildRecentFormWDL(shujuData) : null;

  var prompt = '请深度分析以下比赛，并按照五维分析框架输出完整的分析报告。\n\n' +
    '**比赛信息**\n' +
    '- 联赛：' + (matchInfo.leagueName || '未知') + '\n' +
    '- 主队：' + (matchInfo.homeName || '未知') + '\n' +
    '- 客队：' + (matchInfo.visitName || '未知') + '\n' +
    '- 比赛时间：' + (matchInfo.date || '未知') + '\n' +
    '- 场次编号：' + (matchInfo.num || '') + '\n\n';

  // ⭐ 当有500.com数据时，注入锁定的攻防数据和近期战绩
  if (shujuData && adTable && formWDL) {
    prompt += '**以下是从500.com抓取并预计算的真实数据，你的输出中必须严格使用这些数值，不得修改或编造：**\n\n';
    prompt += '【攻防全景数据——必须原样输出表格中的数据，禁止修改任何数值】\n';
    prompt += JSON.stringify(adTable, null, 2) + '\n\n';
    prompt += '【近期战绩——必须原样使用以下 WDL 数值】\n';
    prompt += '主队近6场: ' + formWDL.home.w + '胜' + formWDL.home.d + '平' + formWDL.home.l + '负\n';
    prompt += '客队近6场: ' + formWDL.away.w + '胜' + formWDL.away.d + '平' + formWDL.away.l + '负\n\n';
    prompt += '【500.com 原始统计详情（供分析参考）】\n' + shujuText + '\n\n';
    prompt += '对于500.com未覆盖的部分（积分排名、历史交锋、伤病、盘口赔率等），请通过你的知识库搜索补充。\n\n';
    prompt += '**重要规则：**\n';
    prompt += '1. JSON 中「基础面.攻防全景数据」的 rows 数组必须使用上面预计算的表格数据，不得修改任何数值\n';
    prompt += '2. JSON 中「状态面.主队近况」必须为"近6场' + formWDL.home.w + '胜' + formWDL.home.d + '平' + formWDL.home.l + '负"\n';
    prompt += '3. JSON 中「状态面.客队近况」必须为"近6场' + formWDL.away.w + '胜' + formWDL.away.d + '平' + formWDL.away.l + '负"\n';
    prompt += '4. 其他字段（核心结论、分析文字等）请基于以上500.com真实数据进行深度分析\n';
  } else if (shujuText) {
    prompt += '**以下是从500.com抓取的真实概率统计，请严格基于此数据进行近况分析（勿编造）**\n' +
      shujuText + '\n\n' +
      '对于此数据未覆盖的部分（积分排名、历史交锋、伤病、盘口赔率等），请通过你的知识库搜索补充。\n';
  } else {
    prompt += '请通过你的知识库搜索球队信息，包括但不限于：\n' +
      '- 双方积分排名、近期战绩\n' +
      '- 核心球员状态、伤病情况\n' +
      '- 历史交锋记录\n' +
      '- 盘口赔率数据\n' +
      '- 大小球趋势\n';
  }

  prompt += '\n- **重要规则**：在输出的任何字段（尤其是积分排名字段）中引用球队时，必须使用上面给定的全称（' +
    (matchInfo.homeName || '主队') + '和' + (matchInfo.visitName || '客队') + '），不得使用简称或别称。\n\n';

  prompt += '请以 JSON 格式输出（以下 JSON 中的值仅为字段类型说明，请基于你的知识库生成真实数据，不要照抄）：\n' +
    '{\n' +
    '  "confidence": "<整数0-100, 你对本场分析的确信度>",\n' +
    '  "基础面": {\n' +
    '    "概括": "<15字以内摘要>",\n' +
    '    "积分排名": "<结合双方联赛排名与积分形势, 60字以内>",\n' +
    '    "攻防全景数据": {\n' +
    '      "header": ["数据项", "主队", "客队"],\n' +
    '      "rows": [\n' +
    '        ["赛季场均进球", "<浮点数>", "<浮点数>"],\n' +
    '        ["赛季场均失球", "<浮点数>", "<浮点数>"],\n' +
    '        ["近6场场均进球", "<浮点数>", "<浮点数>"],\n' +
    '        ["近6场场均失球", "<浮点数>", "<浮点数>"],\n' +
    '        ["核心射手", "<状态描述>", "<状态描述>"]\n' +
    '      ]\n' +
    '    },\n' +
    '    "核心结论": "<60字以内>"\n' +
    '  },\n' +
    '  "状态面": {\n' +
    '    "概括": "<15字以内摘要>",\n' +
    '    "主队近况": "<格式: 近6场X胜X平X负, 附状态描述, 60字以内>",\n' +
    '    "客队近况": "<同上>",\n' +
    '    "历史对阵": "<近N次交手战绩, 60字以内>",\n' +
    '    "伤病影响": {\n' +
    '      "header": ["球队", "缺阵情况", "影响评估"],\n' +
    '      "rows": [\n' +
    '        ["<主队/客队>", "<具体伤停球员>", "<高/中/低>"]\n' +
    '      ]\n' +
    '    },\n' +
    '    "队内氛围": "<40字以内>",\n' +
    '    "核心结论": "<60字以内>"\n' +
    '  },\n' +
    '  "动机面": {\n' +
    '    "概括": "<15字以内>",\n' +
    '    "战意强度": "<双方抢分意愿+比赛重要性, 80字以内>"\n' +
    '  },\n' +
    '  "对位面": {\n' +
    '    "概括": "<15字以内>",\n' +
    '    "攻防博弈": "<60字以内>",\n' +
    '    "节奏控制": "<60字以内>",\n' +
    '    "主场氛围": "<40字以内>",\n' +
    '    "战术与教练风格": "<50字以内>",\n' +
    '    "核心结论": "<60字以内>"\n' +
    '  },\n' +
    '  "市场面": {\n' +
    '    "概括": "<15字以内>",\n' +
    '    "盘口与赔率": "<初始盘口+赔率趋势, 60字以内>",\n' +
    '    "大小球": "<大小球盘口分析, 60字以内>",\n' +
    '    "数据变化解读": "<盘口赔率变化趋势, 50字以内>",\n' +
    '    "诱导可能": "<是否存在诱导痕迹, 40字以内>",\n' +
    '    "核心结论": "<60字以内>"\n' +
    '  },\n' +
    '  "核心看点": {\n' +
    '    "核心看点": "<本场最关键1-2个博弈点, 80字以内>",\n' +
    '    "变数提醒": "<影响赛果的不确定性因素, 60字以内>"\n' +
    '  },\n' +
    '  "预测建议": [\n' +
    '    {"玩法": "胜平负", "建议方向": "<如: 主胜 / 让平>", "核心逻辑": "<30字以内>"},\n' +
    '    {"玩法": "大小球", "建议方向": "<如: 大球 / 小球>", "核心逻辑": "<30字以内>"},\n' +
    '    {"玩法": "比分预测", "建议方向": "<如: 2:1 / 1:0>", "核心逻辑": "<30字以内>"}\n' +
    '  ]\n' +
    '}';

  return prompt;
}

/**
 * 调用 DeepSeek API 发送请求
 */
function callDeepSeek(messages) {
  return new Promise(function (resolve, reject) {
    var url = new URL(BASE_URL + '/chat/completions');
    var payload = JSON.stringify({
      model: MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 4096
    });

    var options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: TIMEOUT
    };

    var transport = url.protocol === 'https:' ? https : http;
    var req = transport.request(options, function (res) {
      var body = '';
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('DeepSeek API error ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
        try {
          var data = JSON.parse(body);
          var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!content) return reject(new Error('DeepSeek 返回为空'));
          // 提取 JSON（可能被 markdown 代码块包裹）
          var jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || content.match(/(\{[\s\S]*\})/);
          var jsonStr = jsonMatch ? jsonMatch[1] : content;
          var result = JSON.parse(jsonStr.trim());
          resolve({
            content: result,
            rawResponse: content,
            tokenUsage: data.usage ? data.usage.total_tokens : 0
          });
        } catch (e) {
          // 解析失败时返回原始文本
          resolve({
            content: null,
            rawResponse: body.slice(0, 500),
            tokenUsage: 0,
            parseError: e.message
          });
        }
      });
    });

    req.on('timeout', function () { req.destroy(); reject(new Error('DeepSeek API 超时')); });
    req.on('error', function (e) { reject(e); });
    req.write(payload);
    req.end();
  });
}

/**
 * 为单场比赛生成五维分析
 * @param {Object} matchInfo - 比赛信息 {matchId, homeName, visitName, leagueName, date, num}
 * @returns {Promise<Object>} 生成的分析结果
 */
function generateAnalysis(matchInfo) {
  var messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(matchInfo) }
  ];

  console.log('[deepseek] 开始生成分析: ' + matchInfo.homeName + ' vs ' + matchInfo.visitName);
  var startTime = Date.now();

  return callDeepSeek(messages).then(function (result) {
    var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('[deepseek] 生成完成，耗时 ' + elapsed + 's, tokens: ' + (result.tokenUsage || '?'));
    return result;
  });
}

/**
 * 批量生成多场比赛分析（串行，控制并发）
 * @param {Array} matchList - 比赛信息数组
 * @param {Function} onProgress - 进度回调 (index, total, result)
 * @returns {Promise<Array>}
 */
function batchGenerate(matchList, onProgress) {
  var results = [];
  function processNext(index) {
    if (index >= matchList.length) return Promise.resolve(results);
    var match = matchList[index];
    return generateAnalysis(match).then(function (result) {
      results.push({
        matchId: match.matchId,
        success: !!result.content,
        content: result.content,
        tokenUsage: result.tokenUsage,
        error: result.parseError || null
      });
      if (onProgress) onProgress(index + 1, matchList.length, results[index]);
      // 间隔 2 秒避免触发限流
      return new Promise(function (r) { setTimeout(r, 2000); }).then(function () {
        return processNext(index + 1);
      });
    }).catch(function (err) {
      console.error('[deepseek] 批量生成失败: ' + match.matchId + ' - ' + err.message);
      results.push({ matchId: match.matchId, success: false, error: err.message });
      if (onProgress) onProgress(index + 1, matchList.length, results[index]);
      return processNext(index + 1);
    });
  }
  return processNext(0);
}

module.exports = {
  generateAnalysis,
  batchGenerate,
  callDeepSeek,
  buildSystemPrompt,
  buildUserPrompt,
  buildAttackDefenseTable,
  buildRecentFormWDL,
  loadShujuData,
  formatShujuStats
};
