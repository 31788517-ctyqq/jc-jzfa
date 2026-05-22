/**
 * 本地数据库模块 - 基于 better-sqlite3
 * 存储比赛数据、推荐数据、命中率数据
 */
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'midou_data.db');

let db;

/**
 * 初始化数据库，创建表结构
 */
function initDatabase() {
  db = new Database(DB_PATH);
  
  // 开启 WAL 模式提升并发性能
  db.pragma('journal_mode = WAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      matchId TEXT PRIMARY KEY,
      num TEXT,
      homeName TEXT,
      visitName TEXT,
      leagueName TEXT,
      startTime TEXT,
      matchStatus INTEGER DEFAULT 0,
      score TEXT DEFAULT '',
      recommNum INTEGER DEFAULT 0,
      date TEXT,
      fetchDate TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      updatedAt TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS recommends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT NOT NULL,
      type TEXT NOT NULL,
      num INTEGER DEFAULT 0,
      result INTEGER,
      fetchDate TEXT NOT NULL,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(matchId, type, fetchDate)
    );

    CREATE TABLE IF NOT EXISTS crawl_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      matchCount INTEGER DEFAULT 0,
      recommCount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      message TEXT,
      createdAt TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ai_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matchId TEXT NOT NULL UNIQUE,
      leagueName TEXT,
      homeName TEXT,
      visitName TEXT,
      matchDate TEXT,
      content TEXT,
      confidence REAL DEFAULT 0,
      rawPrompt TEXT,
      rawResponse TEXT,
      tokenUsage INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now','localtime')),
      updatedAt TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(matchStatus);
    CREATE INDEX IF NOT EXISTS idx_recommends_matchId ON recommends(matchId);
    CREATE INDEX IF NOT EXISTS idx_recommends_fetchDate ON recommends(fetchDate);
    CREATE INDEX IF NOT EXISTS idx_ai_predictions_matchId ON ai_predictions(matchId);
  `);

  console.log('[db] 数据库初始化完成:', DB_PATH);
  return db;
}

/**
 * 保存或更新比赛数据
 */
function upsertMatch(match) {
  const stmt = db.prepare(`
    INSERT INTO matches (matchId, num, homeName, visitName, leagueName, startTime, 
      matchStatus, score, recommNum, date, fetchDate, updatedAt)
    VALUES (@matchId, @num, @homeName, @visitName, @leagueName, @startTime,
      @matchStatus, @score, @recommNum, @date, @fetchDate, datetime('now','localtime'))
    ON CONFLICT(matchId) DO UPDATE SET
      matchStatus = @matchStatus,
      score = @score,
      recommNum = @recommNum,
      updatedAt = datetime('now','localtime')
  `);
  return stmt.run(match);
}

/**
 * 批量保存比赛数据
 */
function batchUpsertMatches(matches, fetchDate) {
  const insertMany = db.transaction((items) => {
    for (const m of items) {
      upsertMatch({
        matchId: String(m.matchId),
        num: m.num || '',
        homeName: m.homeName || '',
        visitName: m.visitName || '',
        leagueName: m.leagueName || '',
        startTime: m.startTime || '',
        matchStatus: m.matchStatus !== undefined ? m.matchStatus : 0,
        score: m.score || '',
        recommNum: m.recommNum || 0,
        date: fetchDate,
        fetchDate
      });
    }
  });
  insertMany(matches);
}

/**
 * 保存推荐数据
 */
function batchUpsertRecommends(matchId, items, fetchDate) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO recommends (matchId, type, num, result, fetchDate)
    VALUES (@matchId, @type, @num, @result, @fetchDate)
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run({
        matchId,
        type: r.type,
        num: r.num,
        result: r.result !== undefined ? r.result : null,
        fetchDate
      });
    }
  });
  insertMany(items);
}

/**
 * 记录抓取日志
 */
function logCrawl(date, matchCount, recommCount, status, message) {
  const stmt = db.prepare(`
    INSERT INTO crawl_logs (date, matchCount, recommCount, status, message)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(date, matchCount, recommCount, status, message);
}

/**
 * 查询已抓取的日期列表
 */
function getCrawledDates() {
  const rows = db.prepare('SELECT DISTINCT date FROM crawl_logs WHERE status = ? ORDER BY date').all('success');
  return rows.map(r => r.date);
}

/**
 * 查询某日期的比赛数据
 */
function getMatchesByDate(date) {
  return db.prepare('SELECT * FROM matches WHERE date = ? ORDER BY startTime ASC').all(date);
}

/**
 * 查询某场比赛的推荐数据
 */
function getRecommendsByMatchId(matchId, fetchDate) {
  if (fetchDate) {
    return db.prepare('SELECT * FROM recommends WHERE matchId = ? AND fetchDate = ?').all(matchId, fetchDate);
  }
  return db.prepare('SELECT * FROM recommends WHERE matchId = ?').all(matchId);
}

/**
 * 获取所有比赛数据（不按日期过滤）
 */
function getAllMatches() {
  return db.prepare('SELECT * FROM matches ORDER BY date DESC, startTime ASC').all();
}

/**
 * 获取命中率统计（每场比赛只取专家数前5的方向）
 */
function getHitRateStats(days = 60) {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  const dateStr = dateLimit.toISOString().slice(0, 10);

  const rows = db.prepare(`
    WITH ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY matchId, fetchDate ORDER BY num DESC) as rn
      FROM recommends
      WHERE result IS NOT NULL
    )
    SELECT r.type as direction, 
           COUNT(*) as totalRecommends,
           SUM(CASE WHEN r.result = 1 THEN 1 ELSE 0 END) as hitCount,
           SUM(CASE WHEN r.result = 0 THEN 1 ELSE 0 END) as missCount
    FROM ranked r
    WHERE r.rn <= 8 AND r.fetchDate >= ?
    GROUP BY r.type
    ORDER BY hitCount DESC
  `).all(dateStr);

  return rows.map(r => ({
    direction: r.direction,
    totalRecommends: r.totalRecommends,
    hitCount: r.hitCount,
    missCount: r.missCount,
    hitRate: r.totalRecommends > 0 ? Math.round(r.hitCount / r.totalRecommends * 100 * 10) / 10 : 0
  }));
}

/**
 * 获取每日命中率趋势（每场比赛只取专家数前5的方向）
 */
function getDailyTrend(days = 60) {
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - days);
  const dateStr = dateLimit.toISOString().slice(0, 10);

  const rows = db.prepare(`
    WITH ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY matchId, fetchDate ORDER BY num DESC) as rn
      FROM recommends
      WHERE result IS NOT NULL
    )
    SELECT r.fetchDate as date, r.type as direction,
           COUNT(*) as total,
           SUM(CASE WHEN r.result = 1 THEN 1 ELSE 0 END) as hits
    FROM ranked r
    WHERE r.rn <= 8 AND r.fetchDate >= ?
    GROUP BY r.fetchDate, r.type
    ORDER BY r.fetchDate ASC
  `).all(dateStr);

  // 整理成按日期分组的格式
  const dateMap = {};
  for (const r of rows) {
    if (!dateMap[r.date]) dateMap[r.date] = { date: r.date, directions: [] };
    dateMap[r.date].directions.push({
      direction: r.direction,
      hitRate: r.total > 0 ? Math.round(r.hits / r.total * 100 * 10) / 10 : 0
    });
  }

  return Object.values(dateMap);
}

/**
 * 获取所有联赛名称列表
 */
function getAllLeagues() {
  const rows = db.prepare('SELECT DISTINCT leagueName FROM matches WHERE leagueName IS NOT NULL AND leagueName != \'\' ORDER BY leagueName').all();
  return rows.map(r => r.leagueName).filter(Boolean);
}

/**
 * 查找已完赛但推荐结果为 null 的比赛（需要回填）
 * @returns {Array} [{matchId, fetchDate, type}] 需要回填的推荐记录
 */
function getStaleRecommendations() {
  const rows = db.prepare(`
    SELECT r.matchId, r.fetchDate, r.type, m.matchStatus, m.date as matchDate
    FROM recommends r
    JOIN matches m ON r.matchId = m.matchId
    WHERE r.result IS NULL
      AND (m.matchStatus >= 2 OR m.date < date('now','localtime','-2 days'))
    LIMIT 500
  `).all();
  return rows;
}

/**
 * 更新单条推荐结果
 */
function updateRecommendResult(matchId, type, fetchDate, result) {
  const stmt = db.prepare(`
    UPDATE recommends SET result = ? WHERE matchId = ? AND type = ? AND fetchDate = ?
  `);
  return stmt.run(result, matchId, type, fetchDate);
}

/**
 * 获取筛选页顶部统计卡片数据
 */
function getFilterStats() {
  // 完赛场次（有 result 的推荐所关联的去重比赛数）
  const matchRow = db.prepare(`
    SELECT COUNT(DISTINCT r.matchId) as cnt
    FROM recommends r
    WHERE r.result IS NOT NULL
  `).get();

  // 完赛涉及的联赛数
  const leagueRow = db.prepare(`
    SELECT COUNT(DISTINCT m.leagueName) as cnt
    FROM matches m
    INNER JOIN recommends r ON r.matchId = m.matchId
    WHERE r.result IS NOT NULL AND m.leagueName IS NOT NULL AND m.leagueName != ''
  `).get();

  // 方向数
  const dirRow = db.prepare(`
    SELECT COUNT(DISTINCT r.type) as cnt
    FROM recommends r
    WHERE r.result IS NOT NULL
  `).get();

  return {
    matchCount: matchRow ? matchRow.cnt : 0,
    leagueCount: leagueRow ? leagueRow.cnt : 0,
    directionCount: dirRow ? dirRow.cnt : 0
  };
}

/**
 * 方向类型分类
 */
function classifyDirType(type) {
  if (!type) return '其他';
  if (['胜', '平', '负'].includes(type)) return '胜平负';
  if (type.startsWith('让')) return '让球';
  if (['胜胜', '负负'].includes(type) || type.startsWith('半全场')) return '半全场';
  if (/^[\d,、]+$/.test(type)) return '进球数';
  if (type.startsWith('总进球')) return '进球数';
  if (/[平胜负让球]/.test(type) && (type.includes(',') || type.includes('、'))) return '双选';
  return '其他';
}

/**
 * 获取某一类型的子方向列表
 */
function getDirectionsByType(dirType) {
  const map = {
    '胜平负': ['胜', '平', '负'],
    '让球': ['让胜', '让平', '让负'],
    '进球数': ['总进球-1、2球','总进球-2、3球','总进球-3、4球','总进球-1、2、3球','总进球-2、3、4球','总进球-3、4、5球'],
    '双选': ['平、让平', '让胜、让平', '让平、让负', '胜、平', '平、负'],
    '半全场': ['半全场-胜胜', '半全场-负负']
  };
  return map[dirType] || [];
}

/**
 * 命中率筛选查询
 * @param {Object} params
 * @param {string} params.league - 联赛名，空串=全部
 * @param {string} params.timeRange - 'all'|'30'|'60'|'90'
 * @param {string} params.directionType - '胜平负'|'让球'|'进球数'|'双选'|'半全场'|''
 * @param {string} params.direction - 具体方向，空串=该类型全部
 * @param {number} params.rankTop - 0=全部, 1=第一名, 2=前二名...
 */
function getFilterRate(params) {
  const { league = '', timeRange = 'all', directionType = '', direction = '', rankType = '全部', rankTop = 0 } = params;

  let conditions = [];
  let bindParams = {};

  // 时间筛选
  if (timeRange !== 'all') {
    const days = parseInt(timeRange, 10);
    conditions.push("m.date >= date('now','localtime','-' || @days || ' days')");
    bindParams.days = days;
  }

  // 联赛筛选
  if (league) {
    conditions.push('m.leagueName = @league');
    bindParams.league = league;
  }

  // 方向筛选
  let dirList = [];
  if (directionType) {
    if (direction) {
      // 指定了具体方向
      dirList = [direction];
    } else {
      // 仅指定类型，取该类型下所有子方向
      dirList = getDirectionsByType(directionType);
    }
  }

  // 构建方向过滤条件
  let dirCondition = '';
  if (dirList.length > 0) {
    const placeholders = dirList.map((d, i) => {
      const key = `dir_${i}`;
      bindParams[key] = d;
      return `@${key}`;
    }).join(',');
    dirCondition = `AND r.type IN (${placeholders})`;
  }

  const whereStr = conditions.length > 0 ? 'AND ' + conditions.join(' AND ') : '';

  // 主查询：只保留全局排名第一且类型匹配的行
  const sql = `
    WITH all_ranked AS (
      SELECT r.matchId, r.type, r.num, r.result,
             m.homeName, m.visitName, m.leagueName, m.num as matchNum, m.date
      FROM recommends r
      JOIN matches m ON r.matchId = m.matchId
      WHERE r.result IS NOT NULL
        ${whereStr}
    ),
    global_max AS (
      SELECT matchId, MAX(num) as maxNum FROM all_ranked GROUP BY matchId
    ),
    type_matched AS (
      SELECT a.*
      FROM all_ranked a
      JOIN global_max g ON a.matchId = g.matchId
      WHERE a.num = g.maxNum
        ${dirCondition}
    )
    SELECT 
      matchId, type as direction, num as expertCount, result,
      homeName, visitName, leagueName, matchNum, date,
      ROW_NUMBER() OVER (PARTITION BY matchId ORDER BY num DESC) as rank
    FROM type_matched
    ORDER BY date DESC, rank ASC
  `;

  const detailRows = db.prepare(sql).all(bindParams);

  // 构建条件摘要
  const parts = [];
  if (league) parts.push(league);
  if (timeRange === '30') parts.push('近30天');
  else if (timeRange === '60') parts.push('近60天');
  else if (timeRange === '90') parts.push('近90天');
  if (directionType === '综合排名') parts.push('综合排名');
  if (direction && directionType && directionType !== '综合排名') parts.push(direction);
  else if (directionType && directionType !== '综合排名') parts.push(directionType);
  if (rankType !== '全部' && rankTop > 0) {
    const rankLabels = ['', '第一名', '前二名', '前三名', '前四名', '前五名', '前六名'];
    const rkName = rankType === '每场' ? '当天所有场次' : rankType;
    parts.push(rkName + '-' + rankLabels[rankTop]);
  }
  const conditionSummary = parts.length > 0 ? parts.join(' | ') : '全部条件';

  // 生成 dailyResults + 筛选结果统计（汇总一致性）
  const dailyMap = {};
  const today0 = new Date();
  const daysCount = timeRange === 'all' ? 30 : (parseInt(timeRange) || 30);
  for (let i = 0; i < daysCount; i++) {
    const d = new Date(today0);
    d.setDate(d.getDate() - i - 1);
    const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    dailyMap[ds] = { matchMax: {}, matchHit: {} };
  }
  detailRows.forEach(r => {
    if (r.date) {
      const dd = r.date.slice(0, 10);
      if (dailyMap[dd]) {
        if (!dailyMap[dd].matchMax[r.matchId] || dailyMap[dd].matchMax[r.matchId] < (r.expertCount || 0))
          dailyMap[dd].matchMax[r.matchId] = r.expertCount || 0;
        if (r.result === 1) dailyMap[dd].matchHit[r.matchId] = 1;
      }
    }
  });
  const isDaily = (rankType === '每天' && rankTop > 0);
  const isPerMatch = (rankType === '每场' && rankTop > 0);
  let totalTc = 0, totalHc = 0;
  const dailyResults = Object.keys(dailyMap).sort().reverse().slice(0, 30).map(k => {
    const m = dailyMap[k];
    let selected = [];
    if (isDaily) {
      const ranked = Object.keys(m.matchMax).sort((a, b) => m.matchMax[b] - m.matchMax[a]);
      selected = ranked.slice(0, rankTop);
    } else if (isPerMatch) {
      selected = Object.keys(m.matchMax);
    } else {
      selected = Object.keys(m.matchMax);
    }
    let tm = 0, hm = 0;
    selected.forEach(mid => { tm++; if (m.matchHit[mid]) hm++; });
    totalTc += tm; totalHc += hm;
    return {
      date: k.replace(/-/g, '/'),
      totalMatch: tm,
      hitMatch: hm,
      hitRate: tm > 0 ? Math.round(hm / tm * 1000) / 10 : 0
    };
  });
  // 筛选结果 = dailyResults 汇总
  const hitCount = totalHc;
  const totalCount = totalTc;
  const hitRate = totalCount > 0 ? Math.round(hitCount / totalCount * 1000) / 10 : 0;
      selected = Object.keys(m.matchMax);
    }
    let tm = 0, hm = 0;
    selected.forEach(mid => { tm++; if (m.matchHit[mid]) hm++; });
    return {
      date: k.replace(/-/g, '/'),
      totalMatch: tm,
      hitMatch: hm,
      hitRate: tm > 0 ? Math.round(hm / tm * 1000) / 10 : 0
    };
  });

  return {
    hitCount,
    totalCount,
    hitRate,
    conditionSummary,
    detailList: detailRows,
    dailyResults
  };
}

// ========== AI 预测存储 ==========

/**
 * 保存或更新 AI 五维分析
 */
function upsertAIPrediction(matchId, data) {
  const stmt = db.prepare(`
    INSERT INTO ai_predictions (matchId, leagueName, homeName, visitName, matchDate, content, confidence, rawPrompt, rawResponse, tokenUsage, updatedAt)
    VALUES (@matchId, @leagueName, @homeName, @visitName, @matchDate, @content, @confidence, @rawPrompt, @rawResponse, @tokenUsage, datetime('now','localtime'))
    ON CONFLICT(matchId) DO UPDATE SET
      leagueName = @leagueName,
      homeName = @homeName,
      visitName = @visitName,
      matchDate = @matchDate,
      content = @content,
      confidence = @confidence,
      rawPrompt = @rawPrompt,
      rawResponse = @rawResponse,
      tokenUsage = @tokenUsage,
      updatedAt = datetime('now','localtime')
  `);
  return stmt.run({
    matchId: matchId,
    leagueName: data.leagueName || '',
    homeName: data.homeName || '',
    visitName: data.visitName || '',
    matchDate: data.matchDate || '',
    content: typeof data.content === 'string' ? data.content : JSON.stringify(data.content || {}),
    confidence: data.confidence || 0,
    rawPrompt: data.rawPrompt || '',
    rawResponse: data.rawResponse || '',
    tokenUsage: data.tokenUsage || 0
  });
}

/**
 * 获取单场比赛的 AI 预测
 */
function getAIPrediction(matchId) {
  const row = db.prepare('SELECT * FROM ai_predictions WHERE matchId = ?').get(matchId);
  if (!row) return null;
  try { row.content = JSON.parse(row.content); } catch (e) { /* keep raw */ }
  return row;
}

/**
 * 获取今日所有未结束的比赛（用于 AI 定时任务）
 */
function getTodayUnfinishedMatches() {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT matchId, homeName, visitName, leagueName, date, num, matchStatus, startTime
    FROM matches
    WHERE date = ? AND matchStatus < 3
    ORDER BY startTime ASC
  `).all(today);
  return rows;
}

/**
 * 获取今日比赛汇总状态（前端卡片入口控制）
 */
function getTodayMatchSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const total = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date = ?').get(today);
  const finished = db.prepare('SELECT COUNT(*) as cnt FROM matches WHERE date = ? AND matchStatus = 3').get(today);
  return {
    todayDate: today,
    totalMatches: total ? total.cnt : 0,
    finishedMatches: finished ? finished.cnt : 0,
    unfinishedMatches: (total ? total.cnt : 0) - (finished ? finished.cnt : 0),
    canShowCards: ((total ? total.cnt : 0) - (finished ? finished.cnt : 0)) > 0
  };
}

/**
 * 关闭数据库连接
 */
function closeDatabase() {
  if (db) {
    db.close();
    console.log('[db] 数据库连接已关闭');
  }
}

module.exports = {
  initDatabase,
  batchUpsertMatches,
  batchUpsertRecommends,
  logCrawl,
  getCrawledDates,
  getMatchesByDate,
  getRecommendsByMatchId,
  getAllMatches,
  getHitRateStats,
  getDailyTrend,
  getAllLeagues,
  getStaleRecommendations,
  updateRecommendResult,
  getFilterStats,
  getFilterRate,
  upsertAIPrediction,
  getAIPrediction,
  getTodayUnfinishedMatches,
  getTodayMatchSummary,
  closeDatabase
};
