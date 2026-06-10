/**
 * server/core/sp_data_adapter.js — SP官方数据统一访问层
 *
 * 所有模块通过此适配器读取SP数据，SP无数据时回退到其他源。
 *
 * 数据源优先级:
 *   赛程/赛果/开奖   → SP sporttery_odds (showType=3) → data.json
 *   赔率(SPF/RQSPF)  → SP sporttery_odds → odds_history
 *   前瞻(交锋/积分/近况/射手/伤停) → SP sporttery_preview (showType=2)
 *   全玩法(BF/JQS/BQC) → SP tables → allplays
 *
 * 用法:
 *   const sp = require('./core/sp_data_adapter');
 *   const match = sp.getMatch('周日201', '2026-06-07');
 *   const odds = sp.getOdds('周日201', '2026-06-07');
 *   const preview = sp.getPreview(matchId);
 */

const fs = require('fs');
const path = require('path');

const ODDS_DIR = path.join(__dirname, '..', 'sporttery_odds');
const PREVIEW_DIR = path.join(__dirname, '..', 'sporttery_preview');
const DATA_FILE = path.join(__dirname, '..', 'data.json');
const ODDS_HISTORY_DIR = path.join(__dirname, '..', 'odds_history');

// ═══ 缓存 ═══
let _cache = { odds: {}, preview: {}, dataJson: null, dataJsonTime: 0 };
const CACHE_TTL = 60000; // 1分钟

function loadDataJson() {
  const now = Date.now();
  if (_cache.dataJson && now - _cache.dataJsonTime < CACHE_TTL) {
    return _cache.dataJson;
  }
  try {
    _cache.dataJson = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    _cache.dataJsonTime = now;
  } catch (e) {
    _cache.dataJson = { m: {}, r: {} };
  }
  return _cache.dataJson;
}

// ═══ 1) 获取比赛基本信息（赛程/赛果） ═══
function getMatch(matchNum, dateStr) {
  const data = loadDataJson();
  // 按 num 匹配
  for (const [key, m] of Object.entries(data.m || {})) {
    if (m && m.num === matchNum && m.date && m.date.slice(0, 10) === dateStr) {
      return m;
    }
  }
  return null;
}

// ═══ 2) 获取赔率（优先SP） ═══
function getOdds(matchNum, dateStr) {
  // 先查 SP odds 文件
  const oddsFiles = fs.readdirSync(ODDS_DIR).filter((f) => f.startsWith('20') && f.endsWith('.json'));

  for (const fname of oddsFiles) {
    const cached = _cache.odds[fname];
    let data;
    if (cached) {
      data = cached;
    } else {
      try {
        data = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, fname), 'utf8'));
        _cache.odds[fname] = data;
      } catch (e) {
        continue;
      }
    }

    const mn = (data.matchNum || '').match(/(周[一二三四五六日]\d{3})/);
    const mi = data.matchInfo || '';
    const dm = mi.match(/(\d{4}-\d{2}-\d{2})/);
    const d = dm ? dm[1] : '';

    if (mn && mn[1] === matchNum && d === dateStr) {
      // 提取赔率
      const tables = data.tables || [];
      const result = {
        matchId: fname.replace('.json', ''),
        home: data.home || '',
        away: data.away || '',
        score: data.score || '',
        lottery: data.lotteryResult || null,
        homeRecord: data.homeRecord || null,
        awayRecord: data.awayRecord || null,
        spf: null,
        rqspf: null,
        handicap: null,
        jqs: null,
        bqc: null,
      };

      for (const table of tables) {
        if (!Array.isArray(table) || table.length < 2) continue;
        const header = (table[0] || []).map((c) => String(c || '')).join(' ');

        // SPF
        if (header.includes('胜') && header.includes('平') && header.includes('负') && !header.includes('让球')) {
          for (let r = table.length - 1; r >= 0; r--) {
            const row = table[r] || [];
            const nums = row.map((c) => parseFloat(String(c).replace(/[↑↓]/g, ''))).filter((n) => !isNaN(n) && n > 1);
            if (nums.length >= 3) {
              result.spf = { home: nums[nums.length - 3], draw: nums[nums.length - 2], away: nums[nums.length - 1] };
              break;
            }
          }
        }
        // RQSPF
        if (header.includes('让球') || (header.includes('让') && header.includes('胜') && header.includes('负'))) {
          const hcp = parseInt((header.match(/[+-]?\d+/) || [''])[0]);
          if (!isNaN(hcp)) result.handicap = hcp;
          for (let r = table.length - 1; r >= 0; r--) {
            const row = table[r] || [];
            const nums = row.map((c) => parseFloat(String(c).replace(/[↑↓]/g, ''))).filter((n) => !isNaN(n) && n > 1);
            if (nums.length >= 3) {
              result.rqspf = { home: nums[nums.length - 3], draw: nums[nums.length - 2], away: nums[nums.length - 1] };
              break;
            }
          }
        }
        // JQS (总进球)
        if (
          header.includes('0') &&
          header.includes('1') &&
          header.includes('2') &&
          header.includes('3') &&
          !header.includes('胜') &&
          !header.includes('负') &&
          !header.includes('平平')
        ) {
          for (let r = table.length - 1; r >= 0; r--) {
            const row = table[r] || [];
            const nums = row.map((c) => parseFloat(String(c).replace(/[↑↓]/g, ''))).filter((n) => !isNaN(n) && n > 1);
            if (nums.length >= 6) {
              result.jqs = {
                0: nums[0],
                1: nums[1],
                2: nums[2],
                3: nums[3],
                4: nums[4],
                5: nums[5],
                6: nums[6],
                '7+': nums[7],
              };
              break;
            }
          }
        }
        // BQC (半全场)
        if (header.includes('胜胜') || header.includes('胜平') || header.includes('胜负')) {
          const bqcKeys = ['hh', 'hd', 'ha', 'dh', 'dd', 'da', 'ah', 'ad', 'aa'];
          for (let r = table.length - 1; r >= 0; r--) {
            const row = table[r] || [];
            const nums = row.map((c) => parseFloat(String(c).replace(/[↑↓]/g, ''))).filter((n) => !isNaN(n) && n > 1);
            if (nums.length >= 9) {
              result.bqc = {};
              for (let i = 0; i < 9; i++) result.bqc[bqcKeys[i]] = nums[i];
              break;
            }
          }
        }
      }

      return result;
    }
  }

  // 回退: odds_history
  const oddsFile = path.join(ODDS_HISTORY_DIR, dateStr + '.json');
  try {
    if (fs.existsSync(oddsFile)) {
      const hist = JSON.parse(fs.readFileSync(oddsFile, 'utf8'));
      const entry = (hist.odds || {})[matchNum];
      if (entry) return { ...entry, matchId: null, lottery: null, jqs: null, bqc: null, source: 'odds_history' };
    }
  } catch (e) {}

  return null;
}

// ═══ 3) 获取前瞻数据 ═══
function getPreview(matchId) {
  if (!matchId) return null;

  const previewFile = path.join(PREVIEW_DIR, matchId + '.json');

  const cached = _cache.preview[matchId];
  if (cached) return cached;

  if (fs.existsSync(previewFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(previewFile, 'utf8'));
      const result = {
        matchId,
        featureAnalysis: data.featureAnalysis || null,
        h2h: data.h2h || null,
        standings: data.standings || null,
        recentForm: data.recentForm || null,
        futureMatches: data.futureMatches || null,
        scorers: data.scorers || null,
        injuries: data.injuries || null,
      };
      _cache.preview[matchId] = result;
      return result;
    } catch (e) {}
  }
  return null;
}

// ═══ 4) 获取完整SP数据（赔率+前瞻+赛果） ═══
function getFullSPData(matchNum, dateStr) {
  const match = getMatch(matchNum, dateStr);
  const matchId = match ? match.matchId : null;

  return {
    match,
    odds: getOdds(matchNum, dateStr),
    preview: matchId ? getPreview(matchId) : null,
  };
}

// ═══ 5) 通过 matchNum 查找 matchId ═══
function findMatchIdByNum(matchNum, dateStr) {
  const data = loadDataJson();
  for (const [key, m] of Object.entries(data.m || {})) {
    if (m && m.num === matchNum && m.date && m.date.slice(0, 10) === dateStr) {
      return m.matchId || key.replace('m_', '');
    }
  }
  // 从 sporttery_odds 查找
  const files = fs.readdirSync(ODDS_DIR).filter((f) => f.startsWith('20'));
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(ODDS_DIR, f), 'utf8'));
      const mn = (d.matchNum || '').match(/(周[一二三四五六日]\d{3})/);
      const mi = d.matchInfo || '';
      const dm = mi.match(/(\d{4}-\d{2}-\d{2})/);
      if (mn && mn[1] === matchNum && dm && dm[1] === dateStr) {
        return f.replace('.json', '');
      }
    } catch (e) {}
  }
  return null;
}

// ═══ 6) 获取排名/战绩 ═══
function getRankings(matchNum, dateStr) {
  const odds = getOdds(matchNum, dateStr);
  if (!odds) return null;

  return {
    home: odds.homeRecord || null,
    away: odds.awayRecord || null,
  };
}

// ═══ 7) 获取开奖结果 ═══
function getLotteryResult(matchNum, dateStr) {
  const odds = getOdds(matchNum, dateStr);
  if (!odds || !odds.lottery) return null;

  const lr = odds.lottery;
  return {
    spf: lr['胜平负'] || null,
    rqspf: lr['让球胜平负'] || null,
    score: lr['比分'] || null,
    totalGoals: lr['总进球'] || null,
    halfFull: lr['半全场胜平负'] || null,
    scoreStr: odds.score || '',
    handicap: odds.handicap,
  };
}

// ═══ 8) 批量获取（按日期） ═══
function getDailySPData(dateStr) {
  const data = loadDataJson();
  const result = {};

  Object.entries(data.m || {}).forEach(([k, m]) => {
    if (!m || !m.date || m.date.slice(0, 10) !== dateStr || !m.num) return;
    const num = m.num;
    result[num] = getFullSPData(num, dateStr);
  });

  return result;
}

// 清除缓存（部署后调用）
function clearCache() {
  _cache = { odds: {}, preview: {}, dataJson: null, dataJsonTime: 0 };
}

module.exports = {
  getMatch,
  getOdds,
  getPreview,
  getFullSPData,
  findMatchIdByNum,
  getRankings,
  getLotteryResult,
  getDailySPData,
  clearCache,
};
