/**
 * 豆包 (Doubao Seed 2.0 Pro) API 客户端
 * OpenAI-compatible /chat/completions 接口
 * 与 deepseek.js 复用同一套 Prompt 构建逻辑
 */
const https = require('https');
const http = require('http');

const API_KEY = process.env.DOUBAO_API_KEY || 'DUMMY_PLACEHOLDER';
const BASE_URL = process.env.DOUBAO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const MODEL = process.env.DOUBAO_MODEL || 'doubao-seed-2-0-code-preview-260215';
const TIMEOUT = 90000; // 90秒超时（复杂分析需更长时间）

// 复用 deepseek.js 的 Prompt 构建函数（保持两个模型接收完全相同的指令）
const deepseek = require('./deepseek');
const buildSystemPrompt = deepseek.buildSystemPrompt;
const buildUserPrompt = deepseek.buildUserPrompt;

/**
 * 调用豆包 API 发送请求（OpenAI-compatible）
 */
function callDoubao(messages) {
  return new Promise(function (resolve, reject) {
    const url = new URL(BASE_URL + '/chat/completions');
    const payload = JSON.stringify({
      model: MODEL,
      messages: messages,
      temperature: 0.7,
      max_tokens: 4096,
    });

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + API_KEY,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: TIMEOUT,
    };

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request(options, function (res) {
      let body = '';
      res.on('data', function (chunk) {
        body += chunk;
      });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('豆包 API error ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
        try {
          const data = JSON.parse(body);
          const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!content) return reject(new Error('豆包 返回为空'));
          // 提取 JSON（可能被 markdown 代码块包裹）
          const jsonMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || content.match(/(\{[\s\S]*\})/);
          const jsonStr = jsonMatch ? jsonMatch[1] : content;
          const result = JSON.parse(jsonStr.trim());
          resolve({
            content: result,
            rawResponse: content,
            tokenUsage: data.usage ? data.usage.total_tokens : 0,
          });
        } catch (e) {
          // 解析失败时返回原始文本
          resolve({
            content: null,
            rawResponse: body.slice(0, 500),
            tokenUsage: 0,
            parseError: e.message,
          });
        }
      });
    });

    req.on('timeout', function () {
      req.destroy();
      reject(new Error('豆包 API 超时'));
    });
    req.on('error', function (e) {
      reject(e);
    });
    req.write(payload);
    req.end();
  });
}

/**
 * 为单场比赛生成五维分析
 * @param {Object} matchInfo - 比赛信息 {matchId, homeName, visitName, leagueName, date, num}
 * @returns {Promise<Object>} 生成的分析结果 { content, rawResponse, tokenUsage }
 */
function generateAnalysis(matchInfo) {
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(matchInfo) },
  ];

  console.log('[doubao] 开始生成分析: ' + matchInfo.homeName + ' vs ' + matchInfo.visitName);
  const startTime = Date.now();

  return callDoubao(messages).then(function (result) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('[doubao] 生成完成，耗时 ' + elapsed + 's, tokens: ' + (result.tokenUsage || '?'));
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
  const results = [];
  function processNext(index) {
    if (index >= matchList.length) return Promise.resolve(results);
    const match = matchList[index];
    return generateAnalysis(match)
      .then(function (result) {
        results.push({
          matchId: match.matchId,
          success: !!result.content,
          content: result.content,
          tokenUsage: result.tokenUsage,
          error: result.parseError || null,
        });
        if (onProgress) onProgress(index + 1, matchList.length, results[index]);
        // 间隔 2 秒避免触发限流
        return new Promise(function (r) {
          setTimeout(r, 2000);
        }).then(function () {
          return processNext(index + 1);
        });
      })
      .catch(function (err) {
        console.error('[doubao] 批量生成失败: ' + match.matchId + ' - ' + err.message);
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
  callDoubao,
};
