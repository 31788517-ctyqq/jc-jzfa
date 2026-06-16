/**
 * server/core/alert-monitor.js
 * ═══ 运维告警监控 (V12) ═══
 *
 * 检测项:
 *   🔴 P0: PM2 进程离线 / 崩溃循环 / API 健康 / 登录失败 / data.json 损坏
 *   🟡 P0.5: 推荐同步停滞 / 方案生成空 / 回填失败 / 赛果校验 / 数据库写入失败
 *   🟢 P1: API 延迟 / Cache 过期 / AI 调用失败 / 赔率缺失
 *
 * 输出:
 *   alerts.json — 所有未读告警（前端轮询 + 页面弹窗）
 *   email-alerter — 邮件通知 31788517@qq.com
 */

const fs = require('fs');
const path = require('path');

const ALERT_FILE = path.join(__dirname, '..', 'alerts.json');
const ALERT_RETENTION_H = 24; // 告警保留 24 小时

// ═══ 状态追踪（防止重复告警） ═══
const _state = {
  // PM2 进程状态
  lastCrashLoopCheck: 0, crashLoopCount: 0,
  // 健康检查
  healthFailStreak: 0, lastHealthFail: 0,
  // 登录失败
  loginFailStreak: 0, lastLoginFail: 0,
  // 推荐同步
  lastRecSyncTime: 0,
  // 方案生成
  lastPlanCheck: 0, emptyPlanStreak: 0,
  // 回填
  backfillFailStreak: 0,
  // 赛果校验
  lastScoreVerify: 0,
  // 数据库
  dbWriteFailCount: 0,
  // 发送历史（同一类型 30min 只发一次）
  emailSent: {},
};

// ═══ 加载/保存告警 ═══
function loadAlerts() {
  try {
    if (fs.existsSync(ALERT_FILE)) return JSON.parse(fs.readFileSync(ALERT_FILE, 'utf8'));
  } catch (e) {}
  return [];
}

function saveAlerts(alerts) {
  // 清理 24 小时前的已读告警
  const cutoff = Date.now() - ALERT_RETENTION_H * 3600 * 1000;
  const cleaned = alerts.filter(function (a) {
    return !a.readAt || a.readAt > cutoff;
  });
  try {
    fs.writeFileSync(ALERT_FILE + '.tmp', JSON.stringify(cleaned, null, 2));
    fs.renameSync(ALERT_FILE + '.tmp', ALERT_FILE);
  } catch (e) {}
}

// ═══ 告警写入 ═══
function pushAlert(level, title, detail, action, opts) {
  opts = opts || {};
  const alerts = loadAlerts();
  // 去重：同类告警 5 分钟内不重复
  const dupWindow = 5 * 60 * 1000;
  const now = Date.now();
  const dup = alerts.find(function (a) {
    return a.level === level && a.title === title && now - a.time < dupWindow;
  });
  if (dup && !opts.force) return null;

  const alert = {
    id: 'alert_' + now + '_' + Math.random().toString(36).slice(2, 6),
    level: level,
    title: title,
    detail: detail,
    action: action || '',
    time: now,
    timeStr: new Date(now).toISOString(),
    readAt: null,
    readBy: null,
  };
  alerts.unshift(alert);
  saveAlerts(alerts);

  // ★ 触发邮件（P0/P0.5 级别）
  if (level !== 'P1' && opts.email !== false) {
    shouldSendEmail(level, title, detail, action);
  }

  return alert;
}

// ═══ 邮件节流 ═══
function shouldSendEmail(level, title, detail, action) {
  const now = Date.now();
  const key = level + ':' + title;
  const last = _state.emailSent[key] || 0;
  if (now - last < 30 * 60 * 1000) return; // 30 分钟内不重复发
  _state.emailSent[key] = now;

  // 异步发送，不阻塞监控循环
  try {
    const mailer = require('./email-alerter');
    mailer.send(level, title, detail, action);
  } catch (e) {
    console.error('[alert-monitor] 邮件触发失败:', e.message);
  }
}

// ═══ P0 检测 ═══

/** 检测 PM2 进程状态（由 data_sync 健康循环调用，传入 pm2 列表结果） */
function checkPM2Status(pm2Summary) {
  // pm2Summary 格式: { jcSync: { status, pid, restarts }, jcZjfa: { status } }
  if (!pm2Summary) return;

  // 1a. jc-sync 离线
  if (pm2Summary.jcSync && pm2Summary.jcSync.status !== 'online') {
    pushAlert('P0', 'jc-sync 进程离线', 'status=' + pm2Summary.jcSync.status, 'SSH 到服务器执行: pm2 restart jc-sync');
  }

  // 1b. jc-zjfa 离线
  if (pm2Summary.jcZjfa && pm2Summary.jcZjfa.status !== 'online') {
    pushAlert('P0', 'jc-zjfa 进程离线', 'status=' + pm2Summary.jcZjfa.status, 'SSH 到服务器执行: pm2 restart jc-zjfa');
  }

  // 2. 崩溃循环: 10 分钟内重启 ≥ 5 次
  const now = Date.now();
  if (pm2Summary.jcSync && pm2Summary.jcSync.restarts > 0) {
    if (now - _state.lastCrashLoopCheck > 600000) {
      _state.crashLoopCount = pm2Summary.jcSync.restarts;
      _state.lastCrashLoopCheck = now;
    } else {
      const newCrashes = pm2Summary.jcSync.restarts - _state.crashLoopCount;
      if (newCrashes >= 5) {
        pushAlert(
          'P0', 'jc-sync 崩溃循环',
          '10 分钟内重启 ' + newCrashes + ' 次 (总计 ' + pm2Summary.jcSync.restarts + ')',
          '查看日志: pm2 logs jc-sync --lines 50',
          { force: true },
        );
        _state.crashLoopCount = pm2Summary.jcSync.restarts;
      }
    }
  }
}

/** 检测 API 健康（由外部定时器调用） */
function checkHealth(healthy) {
  if (!healthy) {
    _state.healthFailStreak++;
    _state.lastHealthFail = Date.now();
    if (_state.healthFailStreak >= 3) {
      pushAlert('P0', 'API 健康检查失败', '连续 ' + _state.healthFailStreak + ' 次失败', '检查服务器状态: pm2 list && curl localhost:3000/api/health');
    }
  } else {
    _state.healthFailStreak = 0;
  }
}

/** 检测 midou 登录（由 token_manager 调用） */
function checkLoginFailed(reason) {
  _state.loginFailStreak++;
  _state.lastLoginFail = Date.now();
  if (_state.loginFailStreak >= 3) {
    pushAlert('P0', 'midou API 登录连续失败', '连续 ' + _state.loginFailStreak + ' 次失败: ' + (reason || '未知'), '检查账户余额/密码是否有效');
  }
}

/** 登录成功后重置 */
function checkLoginSuccess() {
  _state.loginFailStreak = 0;
}

// ═══ P0.5 检测 ═══

/** 检测推荐数据同步停滞 */
function checkRecSyncStagnant(dateStr, recsPerMatch) {
  _state.lastRecSyncTime = Date.now();
  // recsPerMatch: { matchId: recsTotal } — 各场比赛的推荐总数
  var hasData = false;
  Object.keys(recsPerMatch || {}).forEach(function (k) {
    if (recsPerMatch[k] > 0) hasData = true;
  });
  if (!hasData) {
    pushAlert('P0.5', '今日推荐数据为空', dateStr + ' 所有比赛 recs_total=0', '手动触发: python deploy.py --fast (重启 jc-sync)');
  }
}

/** 检测今日方案为空（由 refreshPlanCache 调用） */
function checkEmptyPlans(dateStr, planCount) {
  if (planCount === 0) {
    _state.emptyPlanStreak++;
    if (_state.emptyPlanStreak >= 1) {
      pushAlert('P0.5', '今日方案为空', dateStr + ' 未生成任何方案 (第' + _state.emptyPlanStreak + '次检测)', '检查推荐数据: recommNum 和 recs 是否匹配');
    }
  } else {
    _state.emptyPlanStreak = 0;
  }
  _state.lastPlanCheck = Date.now();
}

/** 检测回填失败 */
function checkBackfillFailed(dateStr, backfilled, total) {
  if (backfilled === 0 && total > 0) {
    _state.backfillFailStreak++;
    if (_state.backfillFailStreak >= 3) {
      pushAlert('P0.5', '赛果回填连续失败', dateStr + ' ' + total + ' 场已完赛但回填=0 (第' + _state.backfillFailStreak + '次)', '检查 midou API token 和 footballDataList');
    }
  } else {
    _state.backfillFailStreak = 0;
  }
}

/** 检测赛果校验异常 */
function checkScoreVerify(dateStr, totalMatches, mismatchCount) {
  if (mismatchCount >= Math.max(1, totalMatches * 0.5)) {
    pushAlert('P0.5', '赛果校验异常', dateStr + ': ' + mismatchCount + '/' + totalMatches + ' 场比分不一致', '执行 score-corrector 手动修正');
  }
}

/** 数据库写入失败 */
function checkDBWriteFail(errorMsg) {
  _state.dbWriteFailCount++;
  if (_state.dbWriteFailCount >= 3) {
    pushAlert('P0.5', '数据库写入持续失败', '累计 ' + _state.dbWriteFailCount + ' 次: ' + (errorMsg || ''), '检查磁盘空间: df -h');
  }
}

// ═══ P1 检测 ═══

/** API 响应延迟 */
function checkApiLatency(endpoint, ms) {
  if (ms > 8000) {
    pushAlert('P1', 'API 响应延迟', endpoint + ' 耗时 ' + ms + 'ms (>8s)', '检查 CPU/内存: pm2 monit');
  }
}

function checkOddsMissing(dateStr) {
  pushAlert('P1', '赔率数据缺失', dateStr + ' odds 数据为空', '等待 500.com 赔率自动抓取');
}

// ═══ 公开 API ═══

/** 获取未读告警列表（供前端轮询） */
function getUnreadAlerts(username) {
  const alerts = loadAlerts();
  // 返回所有未读 + 指定用户未读
  return alerts.filter(function (a) {
    return !a.readAt || (username && a.readBy === username && !a.readAt);
  });
}

/** 标记已读 */
function markRead(alertId, username) {
  const alerts = loadAlerts();
  const found = alerts.find(function (a) { return a.id === alertId; });
  if (found) {
    found.readAt = Date.now();
    found.readBy = username || 'system';
    saveAlerts(alerts);
    return true;
  }
  return false;
}

/** 标记全部已读 */
function markAllRead(username) {
  const alerts = loadAlerts();
  var count = 0;
  alerts.forEach(function (a) {
    if (!a.readAt) {
      a.readAt = Date.now();
      a.readBy = username || 'system';
      count++;
    }
  });
  if (count > 0) saveAlerts(alerts);
  return count;
}

/** 获取告警统计 */
function getAlertSummary() {
  const alerts = loadAlerts();
  const unread = alerts.filter(function (a) { return !a.readAt; });
  const p0 = unread.filter(function (a) { return a.level === 'P0'; });
  const p05 = unread.filter(function (a) { return a.level === 'P0.5'; });
  return {
    total: unread.length,
    p0: p0.length,
    p05: p05.length,
    latest: unread[0] || null,
  };
}

module.exports = {
  // P0
  checkPM2Status, checkHealth, checkLoginFailed, checkLoginSuccess,
  // P0.5
  checkRecSyncStagnant, checkEmptyPlans, checkBackfillFailed, checkScoreVerify, checkDBWriteFail,
  // P1
  checkApiLatency, checkOddsMissing,
  // 查询
  getUnreadAlerts, markRead, markAllRead, getAlertSummary,
  // 写告警
  pushAlert,
};
