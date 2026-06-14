/**
 * auto_heal.js — 数据缺口自动检测与修复
 *
 * 策略:
 *   1. 每分钟检查最近7天 data.json 赛程覆盖率
 *   2. 发现有赛程缺口 → 依次尝试: SP官方源 → midou310 → 告警
 *   3. 检查 odds_history 赔率覆盖率 → 触发 catch_up 补抓
 *   4. 检查 allplays 全玩法赔率 → 触发 batch_fetch_500all 补抓
 *   5. 检查 gongshoudao 缓存 → 提示需手动触发
 *
 * 用法: 由 data_sync.js 健康监控自动调用
 *   const autoHeal = require('./auto_heal');
 *   autoHeal.checkAndHeal(); // 检查最近7天
 *   autoHeal.checkAndHeal({ days: 5 }); // 检查最近5天
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger').child('auto_heal');

const DATA_FILE = path.join(__dirname, 'data.json');
const ODDS_DIR = path.join(__dirname, 'odds_history');
const ALLPLAYS_FILE = path.join(__dirname, 'ttyingqiu_data', 'odds_500_allplays.json');
const GS_CACHE = path.join(__dirname, 'gongshoudao', 'cache.json');

// ═══ 工具函数 ═══
function fmtLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function genRecentDates(days) {
  const dates = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(fmtLocal(d));
  }
  return dates;
}

// ═══ 检查1: data.json 赛程覆盖率 ═══
function checkMatchCoverage(dates) {
  const gaps = [];
  try {
    if (!fs.existsSync(DATA_FILE)) {
      dates.forEach((d) => gaps.push({ date: d, type: 'match', severity: 'critical', detail: 'data.json 文件不存在' }));
      return gaps;
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const mMap = data.m || {};

    for (const d of dates) {
      let count = 0;
      Object.values(mMap).forEach((m) => {
        if (m && m.date && m.date.slice(0, 10) === d) count++;
      });

      if (count === 0) {
        // 判断是否是周末（周末极可能有比赛）
        const dow = new Date(d + 'T00:00:00+08:00').getDay();
        const isWeekend = dow === 0 || dow === 6;

        gaps.push({
          date: d,
          type: 'match',
          severity: isWeekend ? 'critical' : 'warning',
          detail: `赛程缺失: 0 场比赛`,
          weekend: isWeekend,
        });
      }
    }
  } catch (e) {
    logger.error('[auto_heal] 赛程检查异常: ' + e.message);
  }
  return gaps;
}

// ═══ 检查2: odds_history 赔率覆盖率 ═══
function checkOddsCoverage(dates) {
  const gaps = [];
  for (const d of dates) {
    const fp = path.join(ODDS_DIR, d + '.json');
    if (!fs.existsSync(fp) || fs.statSync(fp).size < 100) {
      // 仅当 data.json 中有该日赛程时才报缺
      try {
        if (fs.existsSync(DATA_FILE)) {
          const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
          let hasMatches = false;
          Object.values(data.m || {}).forEach((m) => {
            if (m && m.date && m.date.slice(0, 10) === d) hasMatches = true;
          });
          if (hasMatches) {
            gaps.push({ date: d, type: 'odds', severity: 'warning', detail: '赔率数据缺失' });
          }
        }
      } catch (e) {}
    }
  }
  return gaps;
}

// ═══ 检查3: allplays 全玩法赔率 ═══
function checkAllplaysCoverage(dates) {
  const gaps = [];
  try {
    if (!fs.existsSync(ALLPLAYS_FILE)) {
      dates.forEach((d) =>
        gaps.push({ date: d, type: 'allplays', severity: 'warning', detail: 'allplays 文件不存在' }),
      );
      return gaps;
    }
    const ap = JSON.parse(fs.readFileSync(ALLPLAYS_FILE, 'utf8'));
    for (const d of dates) {
      if (!ap[d]) {
        // 检查是否有赛程
        try {
          if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            let hasMatches = false;
            Object.values(data.m || {}).forEach((m) => {
              if (m && m.date && m.date.slice(0, 10) === d) hasMatches = true;
            });
            if (hasMatches) {
              gaps.push({ date: d, type: 'allplays', severity: 'warning', detail: '全玩法赔率缺失' });
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    logger.error('[auto_heal] allplays 检查异常: ' + e.message);
  }
  return gaps;
}

// ═══ 修复1: 赛程缺口 → 使用 SP 官方源补齐 ═══
async function healMatchGap(dateStr) {
  logger.info('[auto_heal] 尝试修复赛程缺口: ' + dateStr);
  try {
    const { syncGovSchedule } = require('./sync_gov_schedule');
    const result = await syncGovSchedule();
    if (result && result.success) {
      logger.info('[auto_heal] SP源赛程同步成功: +' + (result.added || 0) + ' 场');
      return { fixed: true, method: 'gov_schedule', detail: result };
    }
  } catch (e) {
    logger.info('[auto_heal] SP源赛程同步失败: ' + e.message);
  }

  // 回退: 尝试 midou310
  try {
    const { syncMatchList } = require('./data_sync');
    await syncMatchList(dateStr);
    logger.info('[auto_heal] midou 赛程同步完成: ' + dateStr);
    return { fixed: true, method: 'midou', detail: 'syncMatchList' };
  } catch (e) {
    logger.error('[auto_heal] midou 赛程同步也失败: ' + e.message);
    return { fixed: false, error: e.message };
  }
}

// ═══ 修复2: 赔率缺口 → 触发 catch_up ═══
async function healOddsGap(dateStr) {
  logger.info('[auto_heal] 尝试修复赔率缺口: ' + dateStr);
  try {
    const { fetchOdds } = require('./fetch_500odds');
    const odds = await fetchOdds(dateStr);
    const count = Object.keys(odds).length;
    if (count > 0) {
      const filePath = path.join(ODDS_DIR, dateStr + '.json');
      fs.writeFileSync(filePath, JSON.stringify({ date: dateStr, odds }));
      logger.info('[auto_heal] 赔率补抓成功: ' + count + ' 场');
      return { fixed: true, method: 'fetch_500odds', count };
    }
    return { fixed: false, reason: 'no_data' };
  } catch (e) {
    logger.error('[auto_heal] 赔率补抓失败: ' + e.message);
    return { fixed: false, error: e.message };
  }
}

// ═══ 修复3: allplays 缺口 → 标记待补 ═══
async function healAllplaysGap(dateStr) {
  logger.info('[auto_heal] allplays 缺口记录: ' + dateStr + ' (需 batch_fetch_500all 补抓)');
  // allplays 需要全量重新 fetch（单日无法独立补），记录到缺失列表
  const missingFile = path.join(__dirname, 'allplays_missing.json');
  let missing = [];
  try {
    if (fs.existsSync(missingFile)) missing = JSON.parse(fs.readFileSync(missingFile, 'utf8'));
  } catch (e) {}
  if (!missing.includes(dateStr)) {
    missing.push(dateStr);
    fs.writeFileSync(missingFile, JSON.stringify(missing.sort(), null, 2));
  }
  return { fixed: false, method: 'deferred', detail: '已加入补抓队列' };
}

// ═══ 主入口 ═══
async function checkAndHeal(opts = {}) {
  const days = opts.days || 7;
  const dates = genRecentDates(days);
  const now = fmtLocal(new Date());

  logger.info('[auto_heal] 检查最近 ' + days + ' 天数据完整性: ' + dates[0] + ' ~ ' + dates[dates.length - 1]);

  // 仅检查过去日期（今天可能有比赛但赛程还没出）
  const pastDates = dates.filter((d) => d < now);

  // 1. 赛程检查
  const matchGaps = checkMatchCoverage(pastDates);
  if (matchGaps.length > 0) {
    logger.warn('[auto_heal] ⚠ 发现 ' + matchGaps.length + ' 天赛程缺口: ' + matchGaps.map((g) => g.date).join(', '));
    // 只修复最近3天的（更旧的需要手动补）
    const recentGaps = matchGaps.filter((g) => {
      const diff = Math.floor((new Date(now).getTime() - new Date(g.date).getTime()) / 86400000);
      return diff <= 3;
    });
    for (const gap of recentGaps) {
      const result = await healMatchGap(gap.date);
      logger.info('[auto_heal] 赛程修复: ' + gap.date + ' → ' + JSON.stringify(result));
    }
    if (recentGaps.length < matchGaps.length) {
      const oldGaps = matchGaps.filter((g) => !recentGaps.includes(g));
      logger.warn('[auto_heal] ' + oldGaps.length + ' 天较旧缺口需手动修复: ' + oldGaps.map((g) => g.date).join(', '));
    }
  }

  // 2. 赔率检查
  const oddsGaps = checkOddsCoverage(pastDates);
  if (oddsGaps.length > 0) {
    logger.warn('[auto_heal] ⚠ 发现 ' + oddsGaps.length + ' 天赔率缺口');
    for (const gap of oddsGaps) {
      await healOddsGap(gap.date);
    }
  }

  // 3. allplays 检查
  const apGaps = checkAllplaysCoverage(pastDates);
  if (apGaps.length > 0) {
    logger.warn('[auto_heal] ⚠ 发现 ' + apGaps.length + ' 天 allplays 缺口');
    // 记录到缺失列表即可（allplays 通过 batch_fetch 全量补）
    for (const gap of apGaps) {
      await healAllplaysGap(gap.date);
    }
  }

  // 汇总
  const totalGaps = matchGaps.length + oddsGaps.length + apGaps.length;
  if (totalGaps === 0) {
    logger.info('[auto_heal] ✅ 最近 ' + days + ' 天数据完整');
  } else {
    logger.warn(
      '[auto_heal] ⚠ 共 ' +
        totalGaps +
        ' 个数据缺口 (赛程:' +
        matchGaps.length +
        ' 赔率:' +
        oddsGaps.length +
        ' allplays:' +
        apGaps.length +
        ')',
    );
  }

  return {
    checked: pastDates.length,
    gaps: {
      match: matchGaps.length,
      odds: oddsGaps.length,
      allplays: apGaps.length,
    },
    details: { match: matchGaps, odds: oddsGaps, allplays: apGaps },
  };
}

module.exports = { checkAndHeal, genRecentDates, checkMatchCoverage, checkOddsCoverage, checkAllplaysCoverage };
