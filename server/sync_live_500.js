/**
 * sync_live_500.js — 500.com 即时比分抓取器
 *
 * 数据源: https://live.500.com/?e=YYYY-MM-DD (无需认证, GBK编码)
 * 字段: 场次 / 状态 / 比分 / 半场 / 黄牌 / 红牌 / FIFA排名
 *
 * 配合 data_sync.js:
 *   - 比分+红黄牌: 500.com (每2分钟)
 *   - 推荐/命中: midou310 (保持不变, 每20分钟)
 *
 * V16+ 赛后比分修正：
 *   - 完赛场次 score===halfScore → 请求 detail.php 获取红色全场比分
 *   - 去重：已修正过的 fid 不会重复请求
 *
 * 用法: node server/sync_live_500.js [date]
 *       默认: 今天
 */

const https = require('https');
const iconv = require('iconv-lite');
const fs = require('fs');
const path = require('path');

const LIVE_URL = 'https://live.500.com/?e=';
const DETAIL_URL = 'https://live.500.com/detail.php?fid=';
const LIVE_FILE = path.join(__dirname, 'live_scores.json');
const DATA_FILE = path.join(__dirname, 'data.json');

// ★ V16: 已修正 fid 去重集合（避免每个周期重复请求）
const _correctedFids = new Set();

// ═══ 工具 ═══
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Referer: 'https://live.500.com/',
          },
          timeout: 10000,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'gbk')));
        },
      )
      .on('error', reject);
  });
}

function atomicWrite(filePath, data) {
  const tmpFile = filePath + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, filePath);
}

function stripHtmlText(raw) {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractScoreFromCell(scoreCellHtml, matchStatus) {
  const cellHtml = String(scoreCellHtml || '');
  const plain = stripHtmlText(cellHtml);
  const m = plain.match(/(\d+)\s*[-:：]\s*(\d+)/);
  if (!m) return null;

  const h = parseInt(m[1], 10);
  const a = parseInt(m[2], 10);
  if (isNaN(h) || isNaN(a)) return null;

  const attrs = cellHtml.toLowerCase();
  const hasRedMark =
    /class\s*=\s*["'][^"']*red[^"']*["']/.test(attrs) ||
    /color\s*:\s*(?:#f00\b|#ff0000\b|#c00\b|#d00\b|red\b)/.test(attrs);
  const hasBlueMark =
    /class\s*=\s*["'][^"']*blue[^"']*["']/.test(attrs) ||
    /color\s*:\s*(?:#00f\b|#0000ff\b|#06c\b|#0099ff\b|blue\b)/.test(attrs);

  // 规则：完赛比分优先来自“完赛状态”；若有颜色标记则按颜色归因
  const source = hasRedMark ? 'red' : hasBlueMark ? 'blue' : matchStatus >= 2 ? 'status-final' : 'status-live';

  // 非完赛（蓝色/进行中）只作为过程比分，不提升状态
  if (matchStatus < 2 && source === 'red') {
    // 极端情况下出现红字但状态未同步，仍按赛中处理，避免误判终场
    return { score: h + '-' + a, homeGoals: h, awayGoals: a, source: 'live-red' };
  }

  return { score: h + '-' + a, homeGoals: h, awayGoals: a, source };
}

// ═══ 解析比赛数据（含红黄牌） ═══
function parse500Live(html) {
  const matches = [];

  // 找到主表格: 包含比赛数据的行
  // 每行格式: 场次 | 赛事 | 轮次 | 时间 | 状态 | 主队(含排名) | 盘口 | 客队(含排名+卡) | 比分 | ...
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const trContent = trMatch[1];
    const tds = [];
    let tdMatch;
    tdRegex.lastIndex = 0;
    while ((tdMatch = tdRegex.exec(trContent)) !== null) {
      tds.push(tdMatch[1]);
    }

    if (tds.length < 8) continue;

    // 第0列: 场次编号 (如 "周日201")
    const col0 = tds[0].replace(/<[^>]+>/g, '').trim();
    if (!/^周[一二三四五六日]\d{3}$/.test(col0)) continue;

    const matchNum = col0;

    // ═══ 提取各列 ═══
    // 第4列 (index 4): 状态 (完/中/推迟/取消)
    const statusStr = tds[4] ? tds[4].replace(/<[^>]+>/g, '').trim() : '';
    let matchStatus = 0;
    if (statusStr === '中' || statusStr === '进行' || statusStr === '1') matchStatus = 1;
    else if (statusStr === '完' || statusStr === '结束' || statusStr === '2') matchStatus = 2;
    else if (statusStr === '推迟' || statusStr === '取消' || statusStr === '3') matchStatus = 3;

    // ★ 提取红黄牌: 在球队名列中查找 <span class="yellowcard">/<span class="redcard">
    let homeYellow = '',
      homeRed = '',
      awayYellow = '',
      awayRed = '';

    // 遍历所有td，找含 yellowcard/redcard span 的列
    for (let i = 0; i < tds.length; i++) {
      const tdHTML = tds[i] || '';

      // 提取黄牌
      const ycMatch = tdHTML.match(/<span[^>]*class\s*=\s*["']yellowcard["'][^>]*>\s*(\d+)\s*<\/span>/i);
      // 提取红牌
      const rcMatch = tdHTML.match(/<span[^>]*class\s*=\s*["']redcard["'][^>]*>\s*(\d+)\s*<\/span>/i);

      if (ycMatch || rcMatch) {
        // 判断是主队还是客队侧
        // 主队通常在盘口列(第6列)之前，客队之后
        if (i <= 6) {
          if (ycMatch) homeYellow = ycMatch[1];
          if (rcMatch) homeRed = rcMatch[1];
        } else {
          if (ycMatch) awayYellow = ycMatch[1];
          if (rcMatch) awayRed = rcMatch[1];
        }
      }
    }

    // ═══ 提取球队名和比分 ═══
    // 第5列 (index 5): 主队名+排名
    const col5Text = tds[5]
      ? tds[5]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
      : '';

    // 第7列 (index 7): 客队名+排名+卡牌
    const col7Text = tds[7]
      ? tds[7]
          .replace(/<span[^>]*>.*?<\/span>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{2,}/g, ' ')
          .trim()
      : '';

    // 第8列 (index 8): 比分列（避免从盘口列误提取数字）
    const parsedScore = extractScoreFromCell(tds[8] || '', matchStatus);

    // ═══ 提取球队名 ═══
    // 主队: 从 col5 提取，去掉排名标记和数字
    let homeName = col5Text
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\d+$/g, '')
      .trim();
    // 客队: 从 col7 提取
    let visitName = col7Text
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\d+$/g, '')
      .trim();

    // 如果主队名没找到，用链接中的文字
    if (!homeName) {
      const aMatch = (tds[5] || '').match(/<a[^>]*>([^<]+)<\/a>/);
      if (aMatch) homeName = aMatch[1].trim();
    }
    if (!visitName) {
      const aMatch = (tds[7] || '').match(/<a[^>]*>([^<]+)<\/a>/);
      if (aMatch) visitName = aMatch[1].trim();
    }

    // ═══ 解析比分 ═══
    let homeGoals = -1,
      awayGoals = -1,
      score = '',
      scoreSource = '';
    if (parsedScore) {
      homeGoals = parsedScore.homeGoals;
      awayGoals = parsedScore.awayGoals;
      score = parsedScore.score;
      scoreSource = parsedScore.source || '';
    }

    // 状态以“状态列”为准：
    // - 完赛场次保留终场比分
    // - 未完赛场次可带过程比分，但不会提升为完赛

    // ═══ 半场比分 ═══
    let halfScore = '';
    for (let i = 9; i < Math.min(tds.length, 11); i++) {
      const t = tds[i] ? tds[i].replace(/<[^>]+>/g, '').trim() : '';
      if (/^\d+\s*[-:：]\s*\d+$/.test(t)) {
        halfScore = t.replace(/\s+/g, '').replace(/[:：]/, '-');
        break;
      }
    }

    // ═══ 比赛进行时间 ═══
    let duration = '';
    for (const td of tds) {
      const t = td.replace(/<[^>]+>/g, '').trim();
      if (/(\d+)\s*['\u2018\u2019′分]/.test(t)) {
        const m = t.match(/(\d+)/);
        if (m) duration = m[1] + "'";
        break;
      }
    }

    // ═══ 比赛时间 ═══
    let startTime = '';
    for (const td of tds.slice(0, 5)) {
      const t = td.replace(/<[^>]+>/g, '').trim();
      if (/^\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(t)) {
        startTime = t.replace('-', '/');
        break;
      }
    }

    // ★ V16: 提取详情页 fid（用于赛后比分修正）
    let fid = '';
    const fidMatch = trContent.match(/detail\.php\?fid=(\d+)/);
    if (fidMatch) fid = fidMatch[1];

    matches.push({
      matchNum,
      homeName,
      visitName,
      score,
      homeGoals,
      visitGoals: awayGoals,
      halfScore,
      matchStatus,
      duration,
      startTime,
      yellow: homeYellow || awayYellow ? `${homeYellow || '0'}/${awayYellow || '0'}` : '',
      red: homeRed || awayRed ? `${homeRed || '0'}/${awayRed || '0'}` : '',
      scoreSource,
      fid, // ★ V16: 详情页 fid
    });
  }

  return matches;
}

// ═══ 将比分合并到 data.json ═══
function syncToDataJson(liveMatches, dateStr) {
  let data = {};
  try {
    if (fs.existsSync(DATA_FILE)) {
      data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    return 0;
  }

  if (!data.m) data.m = {};

  // 构建 num→key 索引：
  // 1) 赛事归属日期 (m.date)
  // 2) 实际开赛日期 (m.startTime 的 MM-DD)
  // 说明：像“周六006”这类赛事可能归属前一日，但实际在次日凌晨开赛。
  // 若仅按 m.date 匹配，会导致 500 live 次日更新无法回填到该场。
  const numIndexByMatchDate = {};
  const numIndexByKickoffDate = {};
  const y = String(dateStr).slice(0, 4);

  Object.entries(data.m).forEach(([k, m]) => {
    if (!m || !m.num) return;

    const matchDate = String(m.date || '').slice(0, 10);
    if (matchDate === dateStr) {
      numIndexByMatchDate[m.num] = k;
    }

    const sm = String(m.startTime || '').match(/^(\d{2})-(\d{2})\s+\d{2}:\d{2}$/);
    if (sm) {
      const kickoffDate = `${y}-${sm[1]}-${sm[2]}`;
      if (kickoffDate === dateStr && !numIndexByKickoffDate[m.num]) {
        numIndexByKickoffDate[m.num] = k;
      }
    }
  });

  let updated = 0;
  let created = 0;
  for (const lm of liveMatches) {
    let key = numIndexByMatchDate[lm.matchNum] || numIndexByKickoffDate[lm.matchNum];
    let old = key ? data.m[key] : null;

    // ★ 主动创建缺失的比赛条目（修复孤儿matchId问题）
    if (!old && lm.homeName && lm.visitName) {
      // 生成唯一 key：优先用 date+num 组合避免跨周冲突
      const candidateKey = `${dateStr}_${lm.matchNum}`;
      if (!data.m[candidateKey]) {
        key = candidateKey;
        data.m[key] = {
          matchId: lm.matchId || ('500_' + lm.fid) || '',
          num: lm.matchNum,
          homeName: lm.homeName,
          visitName: lm.visitName,
          date: dateStr,
          startTime: lm.startTime || '',
          matchStatus: lm.matchStatus || 0,
          score: '',
          halfScore: '',
          league: '',
          leagueName: '',
        };
        created++;
        old = data.m[key];
        console.log('[sync_500] 创建缺失比赛: ' + key + ' ' + lm.matchNum + ' ' + lm.homeName + ' vs ' + lm.visitName);
      }
    }
    if (!old) continue;

    let changed = false;
    // ★ P0 Layer 1: 统一摄入门禁（替代分散的 per-field 过滤）
    const guard = require('./core/ingestion-guard');
    const v = guard.validateLiveMatch(old, lm);
    if (v.fields === null) {
      // 门禁裁定：跳过此比赛
      if (v.flags && v.flags.suspectHalftime) {
        console.warn(
          '[guard] 疑似半场误判(sync_500): ' +
            (lm.num || '') +
            ' dur=' +
            (lm.duration || '') +
            ' score=' +
            (lm.score || ''),
        );
      }
      continue;
    }
    var mergedFields = v.fields;
    if (lm.yellow) mergedFields.yellow = lm.yellow;
    if (lm.red) mergedFields.red = lm.red;

    // 逐字段比对并更新
    var hasChange = false;
    Object.keys(mergedFields).forEach(function (field) {
      const val = mergedFields[field];
      if (val !== undefined && val !== null && String(old[field]) !== String(val)) {
        // ★ V12: 半场比分保护 — 新比分=旧半场比分 → 跳过
        if (
          field === 'score' &&
          old.halfScore &&
          String(val).replace(/[:：]/, '-') === String(old.halfScore).replace(/[:：]/, '-') &&
          old.score &&
          old.score !== val
        ) {
          return; // skip this field update
        }
        old[field] = val;
        hasChange = true;
      }
    });
    if (hasChange) {
      changed = true;
      if (v.flags && v.flags.suspectHalftime) {
        console.warn(
          '[guard] 半场误判已修正(sync_500): ' +
            (lm.num || '') +
            ' ' +
            (lm.homeName || '') +
            ' vs ' +
            (lm.visitName || ''),
        );
      }
    }

    if (changed) updated++;
  }

  if (updated > 0) {
    atomicWrite(DATA_FILE, data);
  }
  return { updated, created };
}

// ═══ V16+: 赛后比分修正 — 从 detail.php 获取红色全场比分 ═══

/** 从 500.com 详情页提取全场比分 */
function fetchDetailScore(fid) {
  if (!fid) return Promise.resolve(null);
  const url = DETAIL_URL + fid;
  return new Promise((resolve) => {
    https
      .get(
        url,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9',
            Referer: 'https://live.500.com/',
          },
          timeout: 8000,
          rejectUnauthorized: false,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              const html = iconv.decode(Buffer.concat(chunks), 'gbk');
              // 提取红色全场比分：<span class="score" style="color:red">X - Y</span>
              const m = html.match(/<span class="score"[^>]*>\s*(\d+)\s*[-:：]\s*(\d+)\s*<\/span>/);
              if (m) {
                resolve({ score: m[1] + '-' + m[2], home: parseInt(m[1], 10), away: parseInt(m[2], 10) });
              } else {
                resolve(null);
              }
            } catch (e) {
              resolve(null);
            }
          });
        },
      )
      .on('error', () => resolve(null));
  });
}

/**
 * 赛后比分修正 — 对完赛场次 score===halfScore 或 score 为空时，用 detail.php 修正
 * @param {Array}  matches  - parse500Live 返回的原始比赛数组（含 fid）
 * @param {String} dateStr  - 日期
 * @returns {Number} 修正的场次数
 */
async function correctPostMatchScores(matches, dateStr) {
  // 收集需要修正的场次
  const pending = [];
  matches.forEach((m) => {
    if (m.matchStatus < 2) return; // 未完赛
    if (!m.fid) return; // 无详情页链接
    if (_correctedFids.has(m.fid)) return; // 已修正过

    const scNorm = String(m.score || '')
      .replace(/[:：]/g, '-')
      .trim();
    const hfNorm = String(m.halfScore || '')
      .replace(/[:：]/g, '-')
      .trim();

    // 触发条件：
    // 1. score 为空
    // 2. score===halfScore（非 0-0）
    // 3. ★ 历史日期（非今天）的已完赛比赛：500.com 对历史日期可能返回半场比分作为 score，
    //    halfScore 为空，无法通过条件 2 检测 → 始终用 detail.php 验证
    const today = new Date().toISOString().slice(0, 10);
    const isHistoricalDate = dateStr && dateStr !== today;
    const needFix = !scNorm || (hfNorm && scNorm === hfNorm && scNorm !== '0-0') || (isHistoricalDate && m.matchStatus >= 2);
    if (needFix) {
      pending.push(m);
    }
  });

  if (pending.length === 0) return 0;

  // 并发请求详情页（并发数 2，避免被限流）
  const CONCURRENCY = 2;
  let corrected = 0;

  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((m) => fetchDetailScore(m.fid).then((detail) => ({ match: m, detail }))),
    );

    for (const { match, detail } of results) {
      _correctedFids.add(match.fid); // 标记为已处理
      if (!detail) continue;

      const newScore = detail.score;
      const oldNorm = String(match.score || '')
        .replace(/[:：]/g, '-')
        .trim();
      const newNorm = newScore.replace(/[:：]/g, '-');

      if (newNorm === oldNorm) continue; // 没变化，跳过

      // 写入 data.json
      try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        if (!data.m) data.m = {};

        // 用 date+num 联合查找（避免跨周覆写）
        const y = String(dateStr).slice(0, 4);
        let found;
        Object.entries(data.m).forEach(([k, m]) => {
          if (!m || !m.num) return;
          if (m.num !== match.matchNum) return;
          const md = String(m.date || '').slice(0, 10);
          if (md === dateStr) {
            found = { key: k, match: m };
            return;
          }
          const sm = String(m.startTime || '').match(/^(\d{2})-(\d{2})\s+\d{2}:\d{2}$/);
          if (sm) {
            const kd = `${y}-${sm[1]}-${sm[2]}`;
            if (kd === dateStr) {
              found = { key: k, match: m };
            }
          }
        });

        if (found) {
          const oldScore = found.match.score;
          found.match.score = newScore;
          const tmpFile = DATA_FILE + '.tmp';
          fs.writeFileSync(tmpFile, JSON.stringify(data));
          fs.renameSync(tmpFile, DATA_FILE);
          corrected++;
          console.log(
            `[500live:detail] 修正 ${match.matchNum} ${match.homeName} vs ${match.visitName}: ${oldScore || '(空)'} → ${newScore}` +
              (match.halfScore ? ` (half=${match.halfScore})` : ''),
          );
        }
      } catch (e) {
        console.warn(`[500live:detail] 写入失败: ${match.matchNum} ${e.message}`);
      }
    }
  }

  return corrected;
}

// ═══ 主函数 ═══
async function fetchLive500(dateStr) {
  if (!dateStr) {
    const now = new Date();
    dateStr =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');
  }

  const url = LIVE_URL + dateStr;
  console.log(`[500live] 抓取 ${dateStr}: ${url}`);

  try {
    const html = await httpGet(url);
    console.log(`[500live] 响应: ${html.length} 字节`);

    const matches = parse500Live(html);
    console.log(`[500live] 解析: ${matches.length} 场比赛`);

    if (matches.length === 0) {
      console.log(`[500live] 无比赛数据`);
      return { success: true, matches: 0 };
    }

    // ★ V16: 写入 live_scores.json 前过滤半场误判（纵深防御，配合 API 层保护）
    // 500.com 对已完赛比赛可能只返回半场比分（score === halfScore 且 duration < 60）
    matches.forEach((m) => {
      const durNum = parseInt(m.duration || '0', 10);
      const scNorm = String(m.score || '').replace(/[:：]/g, '-');
      const hfNorm = String(m.halfScore || '').replace(/[:：]/g, '-');
      // 完赛场次 duration 不完整 + 比分=半场比分(非0:0) → 疑似半场误判，清除比分
      // 保留 matchStatus/duration，让出数据链路处理
      if (m.matchStatus >= 2 && durNum < 60 && scNorm && hfNorm && scNorm === hfNorm && scNorm !== '0-0') {
        console.warn(
          '[500live] 半场误判已拦截: ' +
            m.matchNum +
            ' ' +
            m.homeName +
            ' ' +
            scNorm +
            ' (dur=' +
            (m.duration || '') +
            ')',
        );
        m.score = '';
        m.homeGoals = -1;
        m.visitGoals = -1;
        m.scoreSource = (m.scoreSource || '') + '(half-filtered)';
      }
    });

    // 写入 live_scores.json
    const liveData = {
      date: dateStr,
      matches: matches.map((m) => ({
        num: m.matchNum,
        homeName: m.homeName,
        visitName: m.visitName,
        score: m.score,
        homeScore: m.homeGoals,
        visitScore: m.visitGoals,
        halfScore: m.halfScore,
        yellow: m.yellow,
        red: m.red,
        scoreSource: m.scoreSource || '',
        matchStatus: m.matchStatus,
        duration: m.duration,
        date: dateStr,
      })),
      updated: new Date().toISOString(),
    };
    atomicWrite(LIVE_FILE, liveData);

    // 合并到 data.json
    const syncResult = syncToDataJson(matches, dateStr);
    const updated = syncResult && syncResult.updated ? syncResult.updated : syncResult || 0;
    const created = syncResult && syncResult.created ? syncResult.created : 0;
    console.log(`[500live] data.json 更新: ${updated} 场, 新建: ${created} 场`);

    // ★ V16+: 赛后比分修正 — 用 detail.php 修正半场误判
    const corrected = await correctPostMatchScores(matches, dateStr);
    if (corrected > 0) {
      console.log(`[500live:detail] 赛后比分修正: ${corrected} 场`);
    }

    // 摘要
    const liveCount = matches.filter((m) => m.matchStatus === 1).length;
    const finishedCount = matches.filter((m) => m.matchStatus >= 2).length;
    console.log(`[500live] 赛中:${liveCount} 已结束:${finishedCount}`);

    return { success: true, matches: matches.length, live: liveCount, finished: finishedCount, updated };
  } catch (e) {
    console.error(`[500live] 失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

module.exports = { fetchLive500, parse500Live, syncToDataJson, correctPostMatchScores, fetchDetailScore, httpGet };

if (require.main === module) {
  const dateArg = process.argv[2] || null;
  fetchLive500(dateArg).then((r) => {
    console.log(`\nResult: ${JSON.stringify(r)}`);
    if (!r.success) process.exit(1);
  });
}
