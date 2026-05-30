/**
 * WebSocket 实时推送客户端 (P3-1)
 *
 * 功能:
 *   - 自动连接 / 断线重连 (指数退避)
 *   - 实时比分更新 (无需刷新页面)
 *   - 推荐命中结果通知
 *   - AI 分析结果推送
 *
 * 用法:
 *   import { initWS } from './ws-client.js';
 *   initWS();  // 在 main-fusion.js 启动时调用
 */

const WS_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;
let pingInterval = null;

// 暴露给外部的事件回调
export const wsEvents = {
  onScoreUpdate: null,    // (scores: { [matchId]: { status, score, halfScore, duration } })
  onRecommendUpdate: null, // (recs: { [matchId]: [{ type, num, result }] })
  onAIAnalysisUpdate: null, // (analyses: { [matchId]: { content, confidence } })
  onStatusChange: null,    // (status: 'connected'|'disconnected'|'reconnecting')
};

// 缓存最近的比分数据，避免重复更新
let _scoreCache = {};

/**
 * 初始化 WebSocket 连接
 */
export function initWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return;
  connect();
}

/**
 * 建立连接
 */
function connect() {
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.warn('[WS] 创建连接失败:', e.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = function () {
    console.log('[WS] 已连接 ' + WS_URL);
    reconnectAttempts = 0;

    // 订阅频道
    ws.send(JSON.stringify({
      type: 'subscribe',
      channels: ['live_score', 'recommend', 'ai_analysis']
    }));

    // 通知状态变化
    if (wsEvents.onStatusChange) wsEvents.onStatusChange('connected');

    // 心跳 ping (25s)
    clearInterval(pingInterval);
    pingInterval = setInterval(function () {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);
  };

  ws.onmessage = function (e) {
    try {
      var msg = JSON.parse(e.data);

      switch (msg.type) {
        case 'connected':
          console.log('[WS] 服务端确认连接, clientId=' + msg.clientId);
          break;

        case 'pong':
          // 心跳回复，无需处理
          break;

        case 'live_score_update':
          handleScoreUpdate(msg.data);
          break;

        case 'recommend_update':
          handleRecommendUpdate(msg.data);
          break;

        case 'ai_analysis_update':
          handleAIAnalysisUpdate(msg.data);
          break;

        default:
          // 忽略未知消息类型
          break;
      }
    } catch (err) {
      console.warn('[WS] 消息解析失败:', err.message);
    }
  };

  ws.onclose = function (event) {
    console.log('[WS] 连接关闭 (code=' + event.code + ')');
    clearInterval(pingInterval);
    if (wsEvents.onStatusChange) wsEvents.onStatusChange('disconnected');

    // 非正常关闭则重连
    if (event.code !== 1000) {
      scheduleReconnect();
    }
  };

  ws.onerror = function (err) {
    console.warn('[WS] 连接错误');
    // onclose 会自动触发，无需额外处理
  };
}

/**
 * 断线重连 (指数退避: 1s → 2s → 4s → 8s → 16s → 30s)
 */
function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  reconnectAttempts++;

  console.log('[WS] ' + (delay / 1000) + 's 后重连 (第' + reconnectAttempts + '次)');
  if (wsEvents.onStatusChange) wsEvents.onStatusChange('reconnecting');

  reconnectTimer = setTimeout(function () {
    connect();
  }, delay);
}

/**
 * 断开连接
 */
export function disconnectWS() {
  clearInterval(pingInterval);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempts = 0;
  if (ws) {
    ws.close(1000, '手动关闭');
    ws = null;
  }
}

// ═══ 消息处理 ═══

/**
 * 处理实时比分更新 — 直接更新 DOM，无需完整刷新页面
 */
function handleScoreUpdate(scores) {
  if (!scores) return;

  var changed = false;
  for (var mid in scores) {
    if (!scores.hasOwnProperty(mid)) continue;
    var newData = scores[mid];
    var cached = _scoreCache[mid];

    // 检查是否有变化
    if (cached && cached.status === newData.status &&
        cached.score === newData.score &&
        cached.duration === newData.duration) {
      continue;
    }

    _scoreCache[mid] = newData;
    changed = true;

    // 更新对应卡片的 DOM
    var card = document.getElementById('mc-' + mid);
    if (!card) continue;

    // 更新比分
    var scoreEl = card.querySelector('.match-score');
    if (scoreEl && newData.score) {
      var parts = newData.score.replace('-', ':').split(':');
      if (parts.length === 2) {
        scoreEl.innerHTML = parts[0] + ' : ' + parts[1];
      }
    }

    // 更新时间/进行中标识
    var durEl = card.querySelector('.match-dur');
    if (newData.matchStatus === 1 && durEl && newData.duration) {
      durEl.textContent = newData.duration;
      card.classList.add('live');
    }

    // 更新半场比分
    var halfEl = card.querySelector('.match-half');
    if (halfEl && newData.halfScore) {
      halfEl.textContent = '(半 ' + newData.halfScore + ')';
    }

    // 比赛结束时闪烁一次
    if (newData.matchStatus >= 2 && cached && cached.matchStatus < 2) {
      card.classList.add('match-finished-flash');
      setTimeout(function () {
        card.classList.remove('match-finished-flash');
      }, 2000);
    }
  }

  if (changed && typeof wsEvents.onScoreUpdate === 'function') {
    wsEvents.onScoreUpdate(scores);
  }
}

/**
 * 处理推荐命中结果更新
 */
function handleRecommendUpdate(recs) {
  if (!recs || Object.keys(recs).length === 0) return;

  console.log('[WS] 推荐命中更新: ' + Object.keys(recs).length + ' 场比赛');

  // 通知外部回调
  if (typeof wsEvents.onRecommendUpdate === 'function') {
    wsEvents.onRecommendUpdate(recs);
  }

  // 显示轻量通知（比赛结束 + 有命中结果）
  var updatedIds = Object.keys(recs);
  if (updatedIds.length <= 3) {
    // 少量更新 → 逐个通知
    updatedIds.forEach(function(mid) {
      showUpdateToast(mid, recs[mid]);
    });
  } else {
    // 大量更新 → 汇总通知
    showUpdateToast(null, null, updatedIds.length);
  }
}

/**
 * 处理 AI 分析结果更新
 */
function handleAIAnalysisUpdate(analyses) {
  if (!analyses || Object.keys(analyses).length === 0) return;

  console.log('[WS] AI 分析更新: ' + Object.keys(analyses).length + ' 场比赛');

  if (typeof wsEvents.onAIAnalysisUpdate === 'function') {
    wsEvents.onAIAnalysisUpdate(analyses);
  }
}

// ═══ 轻量 Toast 通知 ═══
function showUpdateToast(mid, recs, batchCount) {
  var toast = document.getElementById('ws-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ws-toast';
    toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);' +
      'background:rgba(24,224,224,0.95);color:#06131B;padding:10px 20px;border-radius:20px;' +
      'font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 20px rgba(24,224,224,0.4);' +
      'transition:opacity 0.3s,transform 0.3s;opacity:0;transform:translateX(-50%) translateY(-10px);';
    document.body.appendChild(toast);
  }

  var msg = '';
  if (batchCount) {
    msg = '[WS] ' + batchCount + ' 场比赛推荐命中结果已更新';
  } else if (mid && recs) {
    var hitCount = recs.filter(function(r) { return r.result === 1; }).length;
    msg = '[WS] 比赛 ' + mid + ' ' + (hitCount > 0 ? hitCount + '个方向命中！' : '结果已更新');
  }

  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';

  // 3秒后自动消失
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px)';
  }, 3000);
}
