/**
 * server/core/odds-tracker.js
 * 赔率变化追踪 — Delta 检测 + JSONL 日志 + 历史读取
 *
 * 策略: 对比新旧赔率快照，只记录有实质性变化的场次/玩法字段。
 * 存储: JSONL 追加写（每行一条变化记录），30天自动清理。
 *
 * 用法:
 *   const { detectChanges, appendDeltaLog, getDeltaHistory, cleanupOldDeltas } = require('./odds-tracker');
 */

const fs = require('fs');
const path = require('path');

/**
 * 深度对比新旧赔率，返回有变化的字段映射
 * @param {Object} oldOdds  旧赔率快照 { spf, rqspf, halfFull, totalGoals }
 * @param {Object} newOdds  新赔率快照（同上结构）
 * @param {string} matchNum 竞彩编号（仅用于日志）
 * @returns {Object|null}  有变化时返回 { 字段路径: "旧值→新值" }，无变化返回 null
 */
function detectChanges(oldOdds, newOdds, matchNum) {
  const changes = {};
  const paths = [
    'spf.home',
    'spf.draw',
    'spf.away',
    'rqspf.home',
    'rqspf.draw',
    'rqspf.away',
    'halfFull.hh',
    'halfFull.hd',
    'halfFull.ha',
    'halfFull.dh',
    'halfFull.dd',
    'halfFull.da',
    'halfFull.ah',
    'halfFull.ad',
    'halfFull.aa',
    'totalGoals.0',
    'totalGoals.1',
    'totalGoals.2',
    'totalGoals.3',
    'totalGoals.4',
    'totalGoals.5',
    'totalGoals.6',
    'totalGoals.7+',
    'totalGoals.7',
    // ★ BF 比分 (scores): 使用冒号分隔的比分标签作 key
    'scores.1:0',
    'scores.2:0',
    'scores.2:1',
    'scores.3:0',
    'scores.3:1',
    'scores.3:2',
    'scores.4:0',
    'scores.4:1',
    'scores.4:2',
    'scores.5:0',
    'scores.5:1',
    'scores.5:2',
    'scores.胜其它',
    'scores.0:0',
    'scores.1:1',
    'scores.2:2',
    'scores.3:3',
    'scores.平其它',
    'scores.0:1',
    'scores.0:2',
    'scores.1:2',
    'scores.0:3',
    'scores.1:3',
    'scores.2:3',
    'scores.0:4',
    'scores.1:4',
    'scores.2:4',
    'scores.0:5',
    'scores.1:5',
    'scores.2:5',
    'scores.负其它',
  ];

  for (const p of paths) {
    const oldVal = _getNested(oldOdds, p);
    const newVal = _getNested(newOdds, p);
    if (oldVal != null && newVal != null && Math.abs(oldVal - newVal) > 0.001) {
      changes[p] = oldVal.toFixed(2) + '→' + newVal.toFixed(2);
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * 追加 Delta 日志（JSONL 格式，每行一条记录）
 * @param {string} oddsDir  odds_history 目录路径
 * @param {string} dateStr  日期 YYYY-MM-DD
 * @param {string} matchNum 竞彩编号
 * @param {Object} changes  detectChanges 返回的变化 map
 */
function appendDeltaLog(oddsDir, dateStr, matchNum, changes) {
  const logPath = path.join(oddsDir, dateStr + '_delta.jsonl');
  const entry =
    JSON.stringify({
      ts: new Date().toISOString(),
      num: matchNum,
      changes: changes,
    }) + '\n';
  try {
    fs.appendFileSync(logPath, entry, 'utf-8');
  } catch (e) {
    // 静默失败，不影响主流程
  }
}

/**
 * 读取某个场次当天的赔率变化历史
 * @param {string} oddsDir  odds_history 目录
 * @param {string} dateStr  日期
 * @param {string} matchNum 竞彩编号
 * @returns {Array} 变化记录数组，按时间排序
 */
function getDeltaHistory(oddsDir, dateStr, matchNum) {
  const logPath = path.join(oddsDir, dateStr + '_delta.jsonl');
  if (!fs.existsSync(logPath)) return [];
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    return lines
      .map(function (l) {
        try {
          return JSON.parse(l);
        } catch (e) {
          return null;
        }
      })
      .filter(function (e) {
        return e && e.num === matchNum;
      })
      .sort(function (a, b) {
        return a.ts.localeCompare(b.ts);
      });
  } catch (e) {
    return [];
  }
}

/**
 * 读取某天的所有 delta 记录
 * @param {string} oddsDir
 * @param {string} dateStr
 * @returns {Array}
 */
function getAllDeltaLogs(oddsDir, dateStr) {
  const logPath = path.join(oddsDir, dateStr + '_delta.jsonl');
  if (!fs.existsSync(logPath)) return [];
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    return lines
      .map(function (l) {
        try {
          return JSON.parse(l);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * 清理过期的 delta 日志（默认保留 30 天）
 * @param {string} oddsDir
 * @param {number} retentionDays 保留天数，默认 30
 * @returns {number} 清理的文件数
 */
function cleanupOldDeltas(oddsDir, retentionDays) {
  retentionDays = retentionDays || 30;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;
  try {
    const files = fs.readdirSync(oddsDir);
    for (const f of files) {
      if (!f.endsWith('_delta.jsonl')) continue;
      const dateStr = f.replace('_delta.jsonl', '');
      const date = new Date(dateStr + 'T00:00:00+08:00');
      if (!isNaN(date.getTime()) && date.getTime() < cutoff) {
        fs.unlinkSync(path.join(oddsDir, f));
        cleaned++;
      }
    }
  } catch (e) {
    // 静默失败
  }
  return cleaned;
}

/** 获取嵌套对象值 */
function _getNested(obj, pathStr) {
  const parts = pathStr.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

module.exports = {
  detectChanges,
  appendDeltaLog,
  getDeltaHistory,
  getAllDeltaLogs,
  cleanupOldDeltas,
};
