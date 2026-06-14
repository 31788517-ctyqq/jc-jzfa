/**
 * ═══ 多源赛果核实器 (Result Verifier) ═══
 * P1 Layer 2: 多渠道数据交叉对账，≥2 票才采纳
 *
 * 数据源: midou data.json / sporttery / 500.com / m.100qiu.com
 * 匹配键: num + homeName + visitName + date 四元组模糊匹配
 * 投票规则: ≥2 票 → 采纳，1 票 → 采纳但标记低置信度
 */

var fs = require('fs');
var path = require('path');

/**
 * 归一化场次匹配键
 * @param {object} match - { num, homeName, visitName, date, kickoffTime? }
 * @returns {object} { num, homeName, visitName, date, matchKey, homeTokens, visitTokens }
 */
function normalizeMatchKey(match) {
  if (!match) return null;
  var num = (match.num || match.matchNum || '').trim();
  var home = (match.homeName || match.home || '').trim();
  var visit = (match.visitName || match.visit || match.awayName || '').trim();
  var dt = '';
  if (match.date) {
    dt = String(match.date).slice(0, 10);
  } else if (match.kickoffTime) {
    dt = String(match.kickoffTime).slice(0, 10);
  }

  // 归一化队名：去让球标记、统一大小写、去空格
  function cleanTeamName(name) {
    return name
      .replace(/\s*\(\+?\d+\)\s*/g, '') // 去让球 "(+2)" "(-1)"
      .replace(/\s*\[.*?\]\s*/g, '') // 去方括号标注
      .trim();
  }

  var homeClean = cleanTeamName(home);
  var visitClean = cleanTeamName(visit);

  // 生成唯一匹配键
  var matchKey = [num, homeClean, visitClean, dt].join('_').toLowerCase();

  return {
    num: num,
    homeName: homeClean,
    visitName: visitClean,
    date: dt,
    matchKey: matchKey,
    homeTokens: tokenize(homeClean),
    visitTokens: tokenize(visitClean),
  };
}

/**
 * 中文队名分词
 */
function tokenize(name) {
  if (!name) return [];
  // 常见后缀/前缀
  var clean = name.replace(/队$/g, '').replace(/城$/g, '').replace(/联$/g, '').replace(/斯$/g, '').replace(/亚$/g, '');
  // 2-gram 分词
  var tokens = [];
  for (var i = 0; i < clean.length - 1; i++) {
    tokens.push(clean.substring(i, i + 2));
  }
  tokens.push(clean);
  return tokens;
}

/**
 * 队名模糊匹配
 * @returns {number} 0-1 相似度
 */
function matchTeams(name1, name2) {
  if (!name1 || !name2) return 0;
  var n1 = name1.toLowerCase().trim();
  var n2 = name2.toLowerCase().trim();

  // 精确匹配
  if (n1 === n2) return 1.0;

  // 包含匹配（如 "加拿大" 包含于 "加拿大(-1)"）
  if (n1.indexOf(n2) >= 0 || n2.indexOf(n1) >= 0) return 0.95;

  // Token 匹配
  var t1 = tokenize(n1);
  var t2 = tokenize(n2);
  var matched = 0;
  for (var i = 0; i < t1.length; i++) {
    for (var j = 0; j < t2.length; j++) {
      if (t1[i] === t2[j]) {
        matched++;
        break;
      }
    }
  }
  var maxLen = Math.max(t1.length, t2.length);
  return maxLen > 0 ? matched / maxLen : 0;
}

/**
 * 跨源匹配 — 将多源 match 对象按 matchKey 分组
 * @param {Array} sources - [{ source, match }]
 * @returns {Array} 分组后 [{ matchKey, entries: [{source, match, score, halfScore, status}] }]
 */
function crossMatch(sources) {
  // 1. 归一化
  var normalized = [];
  sources.forEach(function (s) {
    var key = normalizeMatchKey(s.match);
    if (!key || !key.num || !key.date) return;
    key._source = s.source;
    key._raw = s.match;
    normalized.push(key);
  });

  // 2. 按精确 matchKey 分组
  var groups = {};
  normalized.forEach(function (n) {
    var mk = n.matchKey;
    if (!groups[mk]) groups[mk] = [];
    groups[mk].push(n);
  });

  // 3. 模糊匹配合并 — 将相似但 key 不同的组合并
  var keys = Object.keys(groups);
  var merged = [];
  var used = {};

  for (var i = 0; i < keys.length; i++) {
    if (used[keys[i]]) continue;
    var group = groups[keys[i]].slice();
    var anchor = groups[keys[i]][0];
    used[keys[i]] = true;

    for (var j = i + 1; j < keys.length; j++) {
      if (used[keys[j]]) continue;
      var other = groups[keys[j]][0];
      // 日期必须相同
      if (anchor.date !== other.date) continue;
      // 编号相同 OR 对阵相似
      var numMatch = anchor.num === other.num;
      var homeSim = matchTeams(anchor.homeName, other.homeName);
      var visitSim = matchTeams(anchor.visitName, other.visitName);
      var teamSim = (homeSim + visitSim) / 2;

      if (numMatch || teamSim >= 0.7) {
        group = group.concat(groups[keys[j]]);
        used[keys[j]] = true;
      }
    }

    merged.push({
      matchKey: keys[i],
      anchorName: anchor.num + ' ' + anchor.homeName + ' vs ' + anchor.visitName + ' ' + anchor.date,
      entries: group,
    });
  }

  return merged;
}

/**
 * 投票引擎 — 对一组 match entry 投票产出最可信值
 * @param {Array} entries - [{ source, homeName, score, halfScore, matchStatus }]
 * @returns {object} { score, halfScore, status, confidence, votes, sourceVotes }
 */
function voteScore(entries) {
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    // 单源：采纳但标记低置信
    var e = entries[0]._raw || entries[0];
    return {
      score: e.score || '',
      halfScore: e.halfScore || '',
      status: e.matchStatus != null ? e.matchStatus : e._raw ? e._raw.matchStatus : 0,
      confidence: 0.33,
      totalSources: 1,
      votes: {},
      sourceVotes: [entries[0]._source || 'unknown'],
      note: '单源数据，待多源确认',
    };
  }

  // 多源投票
  var scores = {}; // { '1-1': [source1, source2], '0-1': [source1] }
  var halves = {};
  var statuses = {};
  var sourceSet = {};

  entries.forEach(function (entry) {
    var src = entry._source || 'unknown';
    sourceSet[src] = true;
    var raw = entry._raw || entry;

    var sc = raw.score || '';
    var hs = raw.halfScore || raw.half_score || '';
    var st = raw.matchStatus != null ? raw.matchStatus : raw.matchStatus !== undefined ? raw.matchStatus : 0;

    if (sc) {
      if (!scores[sc]) scores[sc] = [];
      scores[sc].push(src);
    }
    if (hs) {
      if (!halves[hs]) halves[hs] = [];
      halves[hs].push(src);
    }
    if (st >= 0) {
      var stKey = st >= 2 ? 'finished' : st === 1 ? 'live' : 'pending';
      if (!statuses[stKey]) statuses[stKey] = [];
      statuses[stKey].push(src);
    }
  });

  function pickWinner(votesMap) {
    var best = '',
      bestCount = 0;
    Object.keys(votesMap).forEach(function (k) {
      if (votesMap[k].length > bestCount) {
        best = k;
        bestCount = votesMap[k].length;
      }
    });
    return { value: best, count: bestCount, total: entries.length };
  }

  var scoreWinner = pickWinner(scores);
  var halfWinner = pickWinner(halves);
  var statusWinner = pickWinner(statuses);
  var totalSources = Object.keys(sourceSet).length;
  var confidence = Math.min(1, scoreWinner.count / 2); // ≥2票 → 1.0, 1票 → 0.5

  var winner = {
    score: scoreWinner.value,
    halfScore: halfWinner.value,
    status: statusWinner.value === 'finished' ? 2 : statusWinner.value === 'live' ? 1 : 0,
    confidence: confidence,
    totalSources: totalSources,
    votes: {
      score: scores,
      halfScore: halves,
      status: statuses,
    },
    sourceVotes: Object.keys(sourceSet),
    note: scoreWinner.count >= 2 ? '≥2票通过' : '待更多源确认',
  };

  return winner;
}

/**
 * 从 midou data.json 提取完赛比赛作为数据源
 */
function extractMidouSource(dataJson, dateStr) {
  var entries = [];
  var mMap = dataJson.m || {};
  Object.keys(mMap).forEach(function (k) {
    var x = mMap[k];
    var dt = (x.date || '').slice(0, 10);
    if (dt !== dateStr) return;
    if (x.matchStatus < 2) return; // 只要完赛的
    entries.push({
      source: 'midou',
      match: {
        num: x.num || '',
        homeName: x.homeName || '',
        visitName: x.visitName || '',
        date: dt,
        score: x.score || '',
        halfScore: x.halfScore || '',
        matchStatus: x.matchStatus,
        matchId: x.matchId,
      },
    });
  });
  return entries;
}

function _extractMatchNum(raw) {
  var m = String(raw || '').match(/(周[一二三四五六日]\d{3})/);
  return m ? m[1] : '';
}

function _extractDate(raw) {
  var m = String(raw || '').match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function _normalizeScore(raw) {
  if (!raw) return '';
  return String(raw).trim().replace(/\s+/g, '').replace(/:/g, '-').replace(/：/g, '-');
}

/**
 * 从 SP 官方详情文件提取赛果源（权威优先）
 */
function extractSportterySource(dateStr, opts) {
  opts = opts || {};
  var oddsDir = opts.oddsDir || path.join(__dirname, '..', 'sporttery_odds');
  var entries = [];
  if (!fs.existsSync(oddsDir)) return entries;

  var files = fs.readdirSync(oddsDir).filter(function (f) {
    return f.endsWith('.json');
  });

  files.forEach(function (f) {
    try {
      var data = JSON.parse(fs.readFileSync(path.join(oddsDir, f), 'utf8'));
      var dt = _extractDate(data.matchInfo);
      if (dt !== dateStr) return;

      var lottery = data.lotteryResult || {};
      var scoreRaw = lottery['比分'] && lottery['比分'].outcome ? lottery['比分'].outcome : data.score;
      var score = _normalizeScore(scoreRaw);
      if (!score || score === '-:-') return;

      entries.push({
        source: 'sporttery',
        match: {
          num: _extractMatchNum(data.matchNum),
          homeName: data.home || '',
          visitName: data.away || '',
          date: dt,
          score: score,
          halfScore: '',
          matchStatus: 2,
          matchId: f.replace('.json', ''),
        },
      });
    } catch (e) {
      /* ignore broken file */
    }
  });

  return entries;
}

/**
 * 从 500 live 文件提取已完赛源（用于 SP 缺失时的暂采纳）
 */
function extractLive500Source(dateStr, opts) {
  opts = opts || {};
  var liveFile = opts.liveFile || path.join(__dirname, '..', 'live_scores.json');
  var entries = [];
  if (!fs.existsSync(liveFile)) return entries;

  try {
    var live = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    (live.matches || []).forEach(function (m) {
      var dt = (m.date || '').slice(0, 10);
      if (dt !== dateStr) return;
      if (!(m.matchStatus >= 2)) return;
      var score = _normalizeScore(m.score);
      if (!score || score === '-:-') return;
      entries.push({
        source: 'live500',
        match: {
          num: m.num || '',
          homeName: m.homeName || m.home || '',
          visitName: m.visitName || m.away || '',
          date: dt,
          score: score,
          halfScore: m.halfScore || '',
          matchStatus: 2,
          matchId: m.matchId,
        },
      });
    });
  } catch (e) {
    return [];
  }

  return entries;
}

/**
 * 入口：核实单日赛果
 * @param {string} dateStr  '2026-06-12'
 * @param {object} opts     { midouDataJson, extraSources[] }
 * @returns {object} { date, results: [{ anchorName, verified: {score, confidence, ...} }] }
 */
function verifyDate(dateStr, opts) {
  opts = opts || {};
  var allSources = [];

  // 1. midou 数据源
  var midouData = opts.midouDataJson;
  if (!midouData) {
    try {
      midouData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
    } catch (e) {}
  }
  if (midouData) {
    var midouEntries = extractMidouSource(midouData, dateStr);
    allSources = allSources.concat(midouEntries);
  }

  // 2. 外部数据源（sporttery/500/100qiu — 后续扩展）
  if (opts.extraSources) {
    allSources = allSources.concat(opts.extraSources);
  }

  if (allSources.length === 0) return { date: dateStr, results: [] };

  // 3. 跨源匹配分组
  var groups = crossMatch(allSources);

  // 4. 逐组投票
  var results = [];
  groups.forEach(function (g) {
    var voted = voteScore(g.entries);
    if (voted) {
      results.push({
        anchorName: g.anchorName,
        sourcesCount: g.entries.length,
        entries: g.entries, // ← 保留原始 entries 供 overlay 取 matchId
        uniqueSources: voted.sourceVotes,
        verified: voted,
      });
    }
  });

  return { date: dateStr, results: results };
}

module.exports = {
  normalizeMatchKey: normalizeMatchKey,
  matchTeams: matchTeams,
  crossMatch: crossMatch,
  voteScore: voteScore,
  verifyDate: verifyDate,
  extractMidouSource: extractMidouSource,
  extractSportterySource: extractSportterySource,
  extractLive500Source: extractLive500Source,
};
