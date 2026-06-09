#!/usr/bin/env node
/**
 * scripts/fetch_h2h.js
 * 交锋历史抓取脚本 — 从 500.com 抓取两队历史交锋记录
 *
 * 蓝图 §3.2：h2h_history 表数据来源
 * 独立抓取脚本，不修改 fetch_500odds.js
 *
 * 用法: node scripts/fetch_h2h.js [--date 2026-06-04] [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ═══════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════

const DB_PATH = path.join(__dirname, '..', 'server', 'midou_data.db');
const TEAM_ALIASES_PATH = path.join(__dirname, '..', 'server', 'team_aliases.json');
const REQUEST_TIMEOUT = 15000;
const MAX_RETRIES = 2;

// ═══════════════════════════════════════════════════════
// 工具函数
// ═══════════════════════════════════════════════════════

function log(msg) {
  const time = new Date().toISOString().slice(11, 19);
  console.log(`[${time}] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: REQUEST_TIMEOUT }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

// ═══════════════════════════════════════════════════════
// 球队名称标准化
// ═══════════════════════════════════════════════════════

function normalizeTeamName(name) {
  if (!name) return '';
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .trim();
}

function loadTeamAliases() {
  try {
    if (fs.existsSync(TEAM_ALIASES_PATH)) {
      return JSON.parse(fs.readFileSync(TEAM_ALIASES_PATH, 'utf8'));
    }
  } catch (e) {
    log(`球队别名文件不存在或读取失败: ${e.message}`);
  }
  return {};
}

// ═══════════════════════════════════════════════════════
// 数据库操作
// ═══════════════════════════════════════════════════════

function getDbAdapter() {
  try {
    const db = require(path.join(__dirname, '..', 'server', 'database'));
    db.initDatabase();
    // wait for sql.js async init
    const start = Date.now();
    while (!db.isAvailable() && Date.now() - start < 10000) {
      // busy wait (sql.js async)
    }
    if (!db.isAvailable()) {
      log('数据库不可用（sql.js 初始化超时）');
      return null;
    }
    return db.getAdapter();
  } catch (e) {
    log(`数据库连接失败: ${e.message}`);
    return null;
  }
}

function getTodayMatches(adp, date) {
  if (!adp) return [];
  try {
    return adp.execAll(
      `SELECT matchId, num, homeName, visitName, leagueName, date
       FROM matches WHERE date = ? ORDER BY CAST(num AS INTEGER) ASC`,
      date,
    );
  } catch (e) {
    log(`查询比赛失败: ${e.message}`);
    return [];
  }
}

function saveH2H(adp, record) {
  if (!adp) return false;
  try {
    adp.execRun(
      `INSERT OR REPLACE INTO h2h_history
       (home_team, away_team, match_date, league, home_score, away_score,
        half_home_score, half_away_score, spf_result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.homeTeam,
      record.awayTeam,
      record.matchDate,
      record.league,
      record.homeScore,
      record.awayScore,
      record.halfHomeScore || null,
      record.halfAwayScore || null,
      record.result,
    );
    return true;
  } catch (e) {
    console.error(`保存 H2H 失败: ${e.message}`, record);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// 500.com 页面解析
// ═══════════════════════════════════════════════════════

/**
 * 简单 HTML 解析：从对阵表提取历史交锋记录
 * 注：实际生产环境建议接入现有 scrape_sporttery_odds.py 模式
 */
function parseH2HFrom500(html, homeTeam, awayTeam) {
  const records = [];
  try {
    // 查找历史同赔表格中的交锋记录
    // 500.com 页面结构：<table class="h2h"> ... <tr> ... </tr>

    // 简单的正则匹配（生产环境建议用 cheerio/jsdom）
    const h2hPattern = /<td[^>]*>(\d{4}-\d{2}-\d{2})<\/td>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>(\d+)-(\d+)<\/td>/gi;

    let match;
    while ((match = h2hPattern.exec(html)) !== null) {
      records.push({
        matchDate: match[1],
        league: match[2].trim(),
        homeScore: parseInt(match[3]),
        awayScore: parseInt(match[4]),
      });
    }
  } catch (e) {
    log(`H2H 解析失败: ${e.message}`);
  }
  return records;
}

/**
 * 从已知数据源生成模拟 H2H 记录（占位，待实际抓取实现）
 * 实际生产环境需对接 500.com API 或已有 shuju_data
 */
function generateMockH2H(homeTeam, awayTeam) {
  // 如果已有 shuju_data，优先从中提取
  try {
    const shujuDir = path.join(__dirname, '..', 'server', 'shuju_data');
    if (fs.existsSync(shujuDir)) {
      const files = fs
        .readdirSync(shujuDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse();
      if (files.length > 0) {
        const shuju = JSON.parse(fs.readFileSync(path.join(shujuDir, files[0]), 'utf8'));
        // TODO: 从 shuju_data 中提取 h2h 数据
        // shuju 文件格式需进一步调查
      }
    }
  } catch (e) {
    // 静默
  }

  // 无数据源时返回空数组（数据驱动，不硬编码）
  return [];
}

// ═══════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════

async function fetchH2HForMatch(adp, match, options = {}) {
  const { dryRun = false } = options;

  // 检查是否已有交锋记录
  if (adp) {
    const existing = adp.execOne(
      'SELECT COUNT(*) as cnt FROM h2h_history WHERE (home_team = ? AND away_team = ?) OR (home_team = ? AND away_team = ?)',
      match.homeName,
      match.visitName,
      match.visitName,
      match.homeName,
    );
    if (existing && existing.cnt > 0) {
      return { match: `${match.homeName} vs ${match.visitName}`, status: 'skip', count: existing.cnt };
    }
  }

  // 从 shuju_data 或其他数据源获取 h2h
  const records = generateMockH2H(match.homeName, match.visitName);

  if (records.length === 0) {
    return { match: `${match.homeName} vs ${match.visitName}`, status: 'no_data', count: 0 };
  }

  if (!dryRun && adp) {
    let saved = 0;
    for (const rec of records) {
      const homeTeam = normalizeTeamName(match.homeName);
      const awayTeam = normalizeTeamName(match.visitName);

      // 判断赛果
      let result = null;
      if (rec.homeScore > rec.awayScore) result = 'home';
      else if (rec.homeScore === rec.awayScore) result = 'draw';
      else result = 'away';

      if (
        saveH2H(adp, {
          homeTeam,
          awayTeam,
          matchDate: rec.matchDate,
          league: rec.league || match.leagueName,
          homeScore: rec.homeScore,
          awayScore: rec.awayScore,
          result,
        })
      ) {
        saved++;
      }
    }
    return { match: `${match.homeName} vs ${match.visitName}`, status: 'saved', count: saved };
  }

  return { match: `${match.homeName} vs ${match.visitName}`, status: 'dry_run', count: records.length };
}

async function main() {
  log('=== fetch_h2h.js 交锋历史抓取 ===');

  // 解析参数
  const args = process.argv.slice(2);
  const date = args.includes('--date') ? args[args.indexOf('--date') + 1] : new Date().toISOString().slice(0, 10);
  const dryRun = args.includes('--dry-run');

  log(`目标日期: ${date}, dry-run: ${dryRun}`);

  const adp = dryRun ? null : getDbAdapter();
  if (!adp && !dryRun) {
    log('数据库不可用，仅 dry-run 模式可用');
    process.exit(1);
  }

  // 获取当天的比赛列表
  const matches = getTodayMatches(adp, date);
  log(`当天比赛: ${matches.length} 场`);

  if (matches.length === 0) {
    log('无比赛需要抓取');
    return;
  }

  // 逐场抓取
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalNoData = 0;

  for (const match of matches) {
    try {
      const result = await fetchH2HForMatch(adp, match, { dryRun });

      if (result.status === 'saved') {
        totalSaved += result.count;
        log(`  ✅ ${result.match}: 保存 ${result.count} 条`);
      } else if (result.status === 'skip') {
        totalSkipped++;
        log(`  ⏭️ ${result.match}: 已有 ${result.count} 条`);
      } else {
        totalNoData++;
        log(`  ⚠️ ${result.match}: 无数据`);
      }

      // 控制请求频率
      await sleep(500);
    } catch (e) {
      log(`  ❌ ${match.homeName} vs ${match.visitName}: ${e.message}`);
    }
  }

  log('---');
  log(`完成: 保存 ${totalSaved} 条, 跳过 ${totalSkipped} 场(已有数据), 无数据 ${totalNoData} 场`);

  // 关闭数据库
  if (adp && adp.close) {
    try {
      adp.close();
    } catch (e) {}
  }
}

// ═══════════════════════════════════════════════════════
// 入口
// ═══════════════════════════════════════════════════════

if (require.main === module) {
  main()
    .then(() => {
      log('抓取完成');
      process.exit(0);
    })
    .catch((err) => {
      console.error('抓取失败:', err.message);
      process.exit(1);
    });
}

module.exports = { main, fetchH2HForMatch, getTodayMatches };
