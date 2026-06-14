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
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const TIMEOUT = 90000; // 90秒超时（DeepSeek 分析耗时较长）

/** 加载合并后的 shuju 数据（含500.com近10场+近6场） */
function loadShujuData(matchInfo) {
  try {
    const dateStr = (matchInfo.date || '').slice(0, 10);
    if (!dateStr) return null;
    const shujuFile = path.join(__dirname, 'shuju_data', 'shuju_merged_' + dateStr + '.json');
    if (!fs.existsSync(shujuFile)) return null;
    const shuju = JSON.parse(fs.readFileSync(shujuFile, 'utf8'));
    const matchNum = matchInfo.num || '';
    return (shuju.matches || {})[matchNum] || null;
  } catch (e) {
    return null;
  }
}

/** 格式化500.com统计数据为可读文本 */
function formatShujuStats(shuju) {
  if (!shuju || !shuju.recentForm) return '';

  const rf = shuju.recentForm;
  const parts = [];

  // 近10场（全联赛）
  const h10 = rf.last10 ? rf.last10.home : null;
  const a10 = rf.last10 ? rf.last10.away : null;
  if (h10 && h10.wins !== undefined) {
    parts.push('【500.com 近10场战绩（所有赛事）——请严格以此数据为准】');
    parts.push(formatTeamStats('主队', h10));
    parts.push(formatTeamStats('客队', a10));
  }

  // 近10场（同联赛）
  const h10L = rf.last10League ? rf.last10League.home : null;
  const a10L = rf.last10League ? rf.last10League.away : null;
  if (h10L && h10L.wins !== undefined) {
    parts.push('');
    parts.push('【500.com 近10场战绩（同联赛赛事）】');
    parts.push(formatTeamStats('主队', h10L));
    parts.push(formatTeamStats('客队', a10L));
  }

  // 近6场
  const h6 = rf.last6 ? rf.last6.home : null;
  const a6 = rf.last6 ? rf.last6.away : null;
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
  const s = stats;
  const wdl = (s.wins || 0) + '胜' + (s.draws || 0) + '平' + (s.losses || 0) + '负';
  const goals = s.goals !== undefined ? '进' + s.goals + '球' : '';
  const conceded = s.conceded !== undefined ? '失' + s.conceded + '球' : '';
  const pct = [];
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
  const rf = shujuData.recentForm;

  // 优先近10场同联赛 → fallback 近10场全联赛
  let h10, a10;
  if (rf.last10League && rf.last10League.home && rf.last10League.home.wins !== undefined) {
    h10 = rf.last10League.home;
    a10 = rf.last10League.away || {};
  } else if (rf.last10 && rf.last10.home && rf.last10.home.wins !== undefined) {
    h10 = rf.last10.home;
    a10 = rf.last10.away || {};
  } else {
    return null;
  }

  const h6 = (rf.last6 || {}).home || {};
  const a6 = (rf.last6 || {}).away || {};

  return {
    header: ['数据项', '主队', '客队'],
    rows: [
      ['赛季场均进球', calcAvg(h10.goals, 10), calcAvg(a10.goals, 10)],
      ['赛季场均失球', calcAvg(h10.conceded, 10), calcAvg(a10.conceded, 10)],
      ['近6场场均进球', calcAvg(h6.goals, 6), calcAvg(a6.goals, 6)],
      ['近6场场均失球', calcAvg(h6.conceded, 6), calcAvg(a6.conceded, 6)],
      ['核心射手', '根据知识库补充', '根据知识库补充'],
    ],
    _verified: true,
    _source: '500.com',
  };
}

/**
 * 基于500.com数据预计算近期战绩 WDL
 * @param {Object} shujuData - 500.com 合并数据
 * @returns {Object|null} {home:{w,d,l}, away:{w,d,l}, _verified}
 */
function buildRecentFormWDL(shujuData) {
  if (!shujuData || !shujuData.recentForm) return null;
  const rf = shujuData.recentForm;

  // 优先近6场 → fallback 近10场同联赛 → fallback 近10场全联赛
  let homeStats, awayStats;
  const h6 = (rf.last6 || {}).home || {};
  const a6 = (rf.last6 || {}).away || {};
  if (h6.wins !== undefined) {
    homeStats = h6;
    awayStats = a6;
  } else {
    const h10L = (rf.last10League || {}).home || {};
    const a10L = (rf.last10League || {}).away || {};
    if (h10L.wins !== undefined) {
      homeStats = h10L;
      awayStats = a10L;
    } else {
      const h10 = (rf.last10 || {}).home || {};
      const a10 = (rf.last10 || {}).away || {};
      homeStats = h10;
      awayStats = a10;
    }
  }

  return {
    home: { w: homeStats.wins || 0, d: homeStats.draws || 0, l: homeStats.losses || 0 },
    away: { w: awayStats.wins || 0, d: awayStats.draws || 0, l: awayStats.losses || 0 },
    _verified: true,
  };
}

/**
 * 构建五维分析的 System Prompt（P0-2: 精简版）
 */
function buildSystemPrompt() {
  return (
    '你是专业足球分析师。按以下框架生成中文JSON，仅输出JSON不含其他文字。\n' +
    '1.基础面(积分排名,攻防数据,核心结论) 2.状态面(近况,对阵,伤病,氛围,结论)\n' +
    '3.动机面(战意强度) 4.对位面(攻防博弈,节奏,主场,战术,结论)\n' +
    '5.市场面(盘口赔率,大小球,变化,诱导,结论) 6.核心看点(博弈点,变数提醒)\n' +
    '7.预测建议(胜平负/大小球/比分,各含方向+核心逻辑)\n' +
    '规则：数据用提供的信息，每字段≤100字，表用Markdown'
  );
}

/**
 * 构建用户 Prompt（P0-2: 精简版，减少 30% token 消耗）
 */
function buildUserPrompt(matchInfo) {
  var shujuData = loadShujuData(matchInfo);
  var shujuText = shujuData ? formatShujuStats(shujuData) : '';
  var adTable = shujuData ? buildAttackDefenseTable(shujuData) : null;
  var formWDL = shujuData ? buildRecentFormWDL(shujuData) : null;

  var prompt =
    '分析比赛：' +
    (matchInfo.leagueName || '') +
    ' ' +
    (matchInfo.homeName || '') +
    ' vs ' +
    (matchInfo.visitName || '') +
    ' ' +
    (matchInfo.num || '') +
    '\n\n';

  // V9.1: 系统预计算数据
  var sysData = buildSystemDataSection(matchInfo);
  if (sysData) prompt += sysData + '\n\n';

  if (shujuData && adTable && formWDL) {
    prompt += '【锁定数据——必须使用以下数值】\n';
    prompt += JSON.stringify(adTable) + '\n';
    prompt += '主近6场:' + formWDL.home.w + 'W' + formWDL.home.d + 'D' + formWDL.home.l + 'L  ';
    prompt += '客近6场:' + formWDL.away.w + 'W' + formWDL.away.d + 'D' + formWDL.away.l + 'L\n';
  } else if (shujuText) {
    prompt += shujuText + '\n其他信息请搜索补充。\n';
  } else {
    prompt += '请搜索：积分排名,近期战绩,伤病,交锋,盘口,大小球。\n';
  }

  prompt +=
    '\nJSON:{"confidence":0-100,"基础面":{"概括":"","积分排名":"",' +
    '"攻防全景数据":{"header":["项","主","客"],"rows":[["赛季场均进球","",""],["赛季场均失球","",""],["近6场场均进球","",""],["近6场场均失球","",""],["核心射手","",""]]},"核心结论":""},' +
    '"状态面":{"概括":"","主队近况":"","客队近况":"","历史对阵":"","伤病影响":{"header":["队","缺阵","影响"],"rows":[["","",""]]},"队内氛围":"","核心结论":""},' +
    '"动机面":{"概括":"","战意强度":""},' +
    '"对位面":{"概括":"","攻防博弈":"","节奏控制":"","主场氛围":"","战术与教练风格":"","核心结论":""},' +
    '"市场面":{"概括":"","盘口与赔率":"","大小球":"","数据变化解读":"","诱导可能":"","核心结论":""},' +
    '"核心看点":{"核心看点":"","变数提醒":""},' +
    '"预测建议":[{"玩法":"胜平负","建议方向":"","核心逻辑":""},{"玩法":"大小球","建议方向":"","核心逻辑":""},{"玩法":"比分预测","建议方向":"","核心逻辑":""}]}';

  return prompt;
}

/**
 * ★ V9.1: 构建系统预计算数据段（J-01 AI Prompt 数据注入）
 * 从 JczqBasic + 功守道缓存注入真实数据，减少 AI 编造
 */
function buildSystemDataSection(matchInfo) {
  try {
    const parts = [];
    parts.push('【系统预计算数据 — 基于真实数据分析，不要编造】');
    parts.push('');

    const dateStr = (matchInfo.date || '').slice(0, 10);
    const matchNum = String(matchInfo.num || '').replace(/^[^\\d]*/, '');

    // ── 一、基本面（JczqBasic） ──
    try {
      const database = require('./database');
      if (database.isAvailable && database.isAvailable()) {
        const basic = database.getJczqBasic(dateStr, matchNum);
        if (basic) {
          parts.push('一、基本面（来源：竞彩 JczqBasic 官方数据）');
          if (basic.homePower != null)
            parts.push('- 战力指数: 主队 ' + basic.homePower + '/100，客队 ' + basic.guestPower + '/100');
          if (basic.homeJiFenHomeAll != null)
            parts.push(
              '- 积分均值: 主队场均 ' + basic.homeJiFenHomeAll + ' 分，客队客场场均 ' + basic.awayJiFenGuest + ' 分',
            );
          if (basic.homeWinPan != null) {
            parts.push(
              '- 赢盘率: 主队约 ' +
                Math.round((basic.homeWinPan / 2) * 100) +
                '%，客队约 ' +
                Math.round((basic.guestWinPan / 2) * 100) +
                '%',
            );
          }
          if (basic.homeEnterEfficiency != null)
            parts.push('- 进攻效率: 主 ' + basic.homeEnterEfficiency + '，客 ' + basic.guestEnterEfficiency);
          if (basic.homePreventEfficiency != null)
            parts.push('- 防守效率: 主 ' + basic.homePreventEfficiency + '，客 ' + basic.guestPreventEfficiency);
          if (basic.jiaoFenDesc) parts.push('- 历史交锋: ' + basic.jiaoFenDesc);
          parts.push('');
        }
      }
    } catch (e) {
      /* 静默 */
    }

    // ── 二、功守道量化 ──
    try {
      const gsPath = require('path').join(__dirname, 'gongshoudao', 'cache.json');
      const fs = require('fs');
      if (fs.existsSync(gsPath)) {
        const gsCache = JSON.parse(fs.readFileSync(gsPath, 'utf8'));
        const globalGS = gsCache._global || {};
        const cacheKey = matchInfo.matchId || matchInfo.num;
        const gs = globalGS[cacheKey];
        if (gs) {
          parts.push('二、功守道量化分析（系统预计算）');
          if (gs.ladderLabel) parts.push('- 实力阶梯: ' + gs.ladderLabel);
          if (gs.totalAdvantageRaw != null)
            parts.push('- 实力优势度: ' + (gs.totalAdvantageRaw >= 0 ? '+' : '') + gs.totalAdvantageRaw);
          if (gs.xgHome != null && gs.xgAway != null)
            parts.push('- 预期进球(xG): 主 ' + gs.xgHome + ' - ' + gs.xgAway + ' 客');
          if (gs.fusionConsensusType)
            parts.push('- 融合共识: ' + gs.fusionConsensusType + ' (strong=强一致/weak=弱一致/meltdown=熔断待定)');
          if (gs.stabilityOverall != null) parts.push('- 进球分布稳定性: ' + gs.stabilityOverall + '/100');

          // 比分 TOP3
          const scores = gs.scores || [];
          const top3 = scores.slice(0, 3).filter(function (s) {
            return s && s.score && s.score !== '--';
          });
          if (top3.length > 0) {
            parts.push(
              '- 比分概率 TOP' +
                top3.length +
                ': ' +
                top3
                  .map(function (s) {
                    return s.score + '(' + (s.percent || '?') + ')';
                  })
                  .join(', '),
            );
          }
          parts.push('');
        }
      }
    } catch (e) {
      /* 静默 */
    }

    // ── 三、市场面（JczqBasic 真实赔率数据） ──
    try {
      const database = require('./database');
      if (database.isAvailable && database.isAvailable()) {
        const basic = database.getJczqBasic(dateStr, matchNum);
        if (basic) {
          parts.push('三、市场面（来源：竞彩 JczqBasic + JczqChange 真实数据 — 请基于此数据写市场面分析）');

          // 欧指概率
          if (basic.winRate != null || basic.lastWinRate != null) {
            const wR = basic.winRate ? (basic.winRate * 100).toFixed(1) : '?';
            const dR = basic.drawRate ? (basic.drawRate * 100).toFixed(1) : '?';
            const lR = basic.loseRate ? (basic.loseRate * 100).toFixed(1) : '?';
            const lwR = basic.lastWinRate ? (basic.lastWinRate * 100).toFixed(1) : '?';
            const ldR = basic.lastDrawRate ? (basic.lastDrawRate * 100).toFixed(1) : '?';
            const llR = basic.lastLoseRate ? (basic.lastLoseRate * 100).toFixed(1) : '?';
            parts.push(
              '- 欧指隐含概率: 初盘 主' +
                wR +
                '%/平' +
                dR +
                '%/客' +
                lR +
                '% → 临盘 主' +
                lwR +
                '%/平' +
                ldR +
                '%/客' +
                llR +
                '%',
            );
          }

          // 离散度
          if (basic.initDiscreteDiff != null && basic.lastDiscreteDiff != null) {
            const shift = (basic.lastDiscreteDiff - basic.initDiscreteDiff).toFixed(3);
            const trend = parseFloat(shift) > 0 ? '扩大' : '收窄';
            parts.push(
              '- 离散度变化: 初盘 ' + basic.initDiscreteDiff + ' → 临盘 ' + basic.lastDiscreteDiff + ' (' + trend + ')',
            );
          }

          // 亚指盘口
          if (basic.initPan != null && basic.lastPan != null) {
            const shift = (basic.lastPan - basic.initPan).toFixed(2);
            const dir = parseFloat(shift) > 0 ? '升盘' : parseFloat(shift) < 0 ? '降盘' : '不变';
            parts.push('- 亚指盘口: 初盘 ' + basic.initPan + ' → 临盘 ' + basic.lastPan + ' (' + dir + ')');
          }

          // 大小球
          if (basic.dxqLastPan != null) {
            const initText = basic.dxqInitPan != null ? ' (初盘 ' + basic.dxqInitPan + ')' : '';
            parts.push('- 大小球盘口: ' + basic.dxqLastPan + '球' + initText);
          }

          // 支持率
          if (basic.winPercent != null || basic.drawPercent != null || basic.losePercent != null) {
            const wp = basic.winPercent || 0;
            const dp = basic.drawPercent || 0;
            const lp = basic.losePercent || 0;
            parts.push('- 市场支持率: 主 ' + wp + '% / 平 ' + dp + '% / 客 ' + lp + '%');
          }

          // 北单 SP
          if (basic.homeWinAward != null && basic.drawAward != null && basic.guestWinAward != null) {
            const hA = basic.homeWinAward;
            const dA = basic.drawAward;
            const aA = basic.guestWinAward;
            const totalInv = 1 / hA + 1 / dA + 1 / aA;
            const hImp = ((1 / hA / totalInv) * 100).toFixed(1);
            const dImp = ((1 / dA / totalInv) * 100).toFixed(1);
            const aImp = ((1 / aA / totalInv) * 100).toFixed(1);
            parts.push(
              '- 北单 SP: 主 ' +
                hA +
                ' (隐含概率 ' +
                hImp +
                '%) / 平 ' +
                dA +
                ' (' +
                dImp +
                '%) / 客 ' +
                aA +
                ' (' +
                aImp +
                '%)',
            );
          }

          // 热度
          if (basic.hotFocusNum != null) parts.push('- 市场关注热度: ' + basic.hotFocusNum + ' 人关注');

          parts.push('');
        }
      }
    } catch (e) {
      /* 静默 */
    }

    if (parts.length <= 2) return null; // 无有效数据
    return parts.join('\n');
  } catch (e) {
    return null;
  }
}

/**
 * 调用 DeepSeek API 发送请求
 */
function callDeepSeek(messages, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    const url = new URL(BASE_URL + '/chat/completions');
    const payload = JSON.stringify({
      model: MODEL,
      messages: messages,
      temperature: options.temperature !== undefined ? options.temperature : 0.5,
      max_tokens: options.maxTokens || 1024,
    });

    const httpOpts = {
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
    const req = transport.request(httpOpts, function (res) {
      let body = '';
      res.on('data', function (chunk) {
        body += chunk;
      });
      res.on('end', function () {
        if (res.statusCode !== 200) {
          return reject(new Error('DeepSeek API error ' + res.statusCode + ': ' + body.slice(0, 200)));
        }
        try {
          const data = JSON.parse(body);
          const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
          if (!content) return reject(new Error('DeepSeek 返回为空'));
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
      reject(new Error('DeepSeek API 超时'));
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
 * @returns {Promise<Object>} 生成的分析结果
 */
function generateAnalysis(matchInfo, options) {
  var opts = options || {};
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(matchInfo) },
  ];

  console.log('[deepseek] 开始生成分析: ' + matchInfo.homeName + ' vs ' + matchInfo.visitName);
  const startTime = Date.now();

  // P2-2: 指数退避重试（最多2次）
  var attempt = 0;
  var maxRetries = opts.maxRetries || 0;
  function tryCall() {
    return callDeepSeek(messages, opts).catch(function (e) {
      if (attempt < maxRetries) {
        attempt++;
        var delay = Math.min(2000 * Math.pow(2, attempt), 15000);
        console.log('[deepseek] 重试 ' + attempt + '/' + maxRetries + ', 等待 ' + delay + 'ms');
        return new Promise(function (r) {
          setTimeout(r, delay);
        }).then(tryCall);
      }
      throw e;
    });
  }

  return tryCall().then(function (result) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
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
  formatShujuStats,
};
