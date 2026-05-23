/**
 * DeepSeek API 客户端
 * 用于生成比赛 AI 五维分析内容
 */
const https = require('https');
const http = require('http');

const API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-a4a33977f39547fc89cbdb443539a7c3';
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-chat';
const TIMEOUT = 60000; // 60秒超时

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
  return `请深度分析以下比赛，并按照五维分析框架输出完整的分析报告。

**比赛信息**
- 联赛：${matchInfo.leagueName || '未知'}
- 主队：${matchInfo.homeName || '未知'}
- 客队：${matchInfo.visitName || '未知'}
- 比赛时间：${matchInfo.date || '未知'}
- 场次编号：${matchInfo.num || ''}

请通过你的知识库搜索球队信息，包括但不限于：
- 双方积分排名、近期战绩
- 核心球员状态、伤病情况
- 历史交锋记录
- 盘口赔率数据
- 大小球趋势

**重要规则**：在输出的任何字段（尤其是积分排名字段）中引用球队时，必须使用上面给定的全称（${matchInfo.homeName || '主队'}和${matchInfo.visitName || '客队'}），不得使用简称或别称。

请以 JSON 格式输出（以下 JSON 中的值仅为字段类型说明，请基于你的知识库生成真实数据，不要照抄）：
{
  "confidence": "<整数0-100, 你对本场分析的确信度>",
  "基础面": {
    "概括": "<15字以内摘要>",
    "积分排名": "<结合双方联赛排名与积分形势, 60字以内>",
    "攻防全景数据": {
      "header": ["数据项", "主队", "客队"],
      "rows": [
        ["赛季场均进球", "<浮点数>", "<浮点数>"],
        ["赛季场均失球", "<浮点数>", "<浮点数>"],
        ["近6场场均进球", "<浮点数>", "<浮点数>"],
        ["近6场场均失球", "<浮点数>", "<浮点数>"],
        ["核心射手", "<状态描述>", "<状态描述>"]
      ]
    },
    "核心结论": "<60字以内>"
  },
  "状态面": {
    "概括": "<15字以内摘要>",
    "主队近况": "<格式: 近6场X胜X平X负, 附状态描述, 60字以内>",
    "客队近况": "<同上>",
    "历史对阵": "<近N次交手战绩, 60字以内>",
    "伤病影响": {
      "header": ["球队", "缺阵情况", "影响评估"],
      "rows": [
        ["<主队/客队>", "<具体伤停球员>", "<高/中/低>"]
      ]
    },
    "队内氛围": "<40字以内>",
    "核心结论": "<60字以内>"
  },
  "动机面": {
    "概括": "<15字以内>",
    "战意强度": "<双方抢分意愿+比赛重要性, 80字以内>"
  },
  "对位面": {
    "概括": "<15字以内>",
    "攻防博弈": "<60字以内>",
    "节奏控制": "<60字以内>",
    "主场氛围": "<40字以内>",
    "战术与教练风格": "<50字以内>",
    "核心结论": "<60字以内>"
  },
  "市场面": {
    "概括": "<15字以内>",
    "盘口与赔率": "<初始盘口+赔率趋势, 60字以内>",
    "大小球": "<大小球盘口分析, 60字以内>",
    "数据变化解读": "<盘口赔率变化趋势, 50字以内>",
    "诱导可能": "<是否存在诱导痕迹, 40字以内>",
    "核心结论": "<60字以内>"
  },
  "核心看点": {
    "核心看点": "<本场最关键1-2个博弈点, 80字以内>",
    "变数提醒": "<影响赛果的不确定性因素, 60字以内>"
  },
  "预测建议": [
    {"玩法": "胜平负", "建议方向": "<如: 主胜 / 让平>", "核心逻辑": "<30字以内>"},
    {"玩法": "大小球", "建议方向": "<如: 大球 / 小球>", "核心逻辑": "<30字以内>"},
    {"玩法": "比分预测", "建议方向": "<如: 2:1 / 1:0>", "核心逻辑": "<30字以内>"}
  ]
}`;
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
  buildUserPrompt
};
