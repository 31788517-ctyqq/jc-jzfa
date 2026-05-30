/**
 * WebSocket 实时推送模块 (P3-1)
 * 
 * 特点:
 *   - 基于原生 ws 协议，轻量无依赖
 *   - 自动检测 data.json 变更 → 推送比分/推荐的实时更新
 *   - 心跳保活 (30s ping)
 *   - 频道订阅: live_score, recommend, ai_analysis, health
 *   - 与 Express 共用端口（通过 server.on('upgrade')）
 * 
 * 客户端示例:
 *   const ws = new WebSocket('ws://localhost:3000/ws');
 *   ws.onmessage = (e) => {
 *     const msg = JSON.parse(e.data);
 *     if (msg.type === 'live_score_update') updateScore(msg.data);
 *     if (msg.type === 'recommend_update') updateRec(msg.data);
 *   };
 */

const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const LIVE_FILE = path.join(__dirname, 'live_scores.json');
const AI_CACHE_FILE = path.join(__dirname, 'ai_cache.json');

// ═══ WebSocket 服务 ═══
let wss = null;
let watchInterval = null;

const clients = new Set();
const subscriptions = new Map(); // clientId → Set<channel>

// 数据变更追踪
let _lastDataMtime = 0;
let _lastLiveMtime = 0;
let _lastAICacheMtime = 0;

/**
 * 解析 WebSocket 帧（兼容浏览器 ws://）
 * 只实现必要的帧类型，不依赖 ws 库
 */
function generateAcceptKey(clientKey) {
  const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  return crypto.createHash('sha1')
    .update(clientKey + GUID)
    .digest('base64');
}

function handleUpgrade(req, socket, head) {
  if (req.url !== '/ws') return;

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = generateAcceptKey(key);
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + acceptKey,
    '',
    ''
  ].join('\r\n');

  socket.write(responseHeaders);

  const clientId = crypto.randomBytes(8).toString('hex');
  clients.add({ id: clientId, socket });
  subscriptions.set(clientId, new Set(['live_score', 'recommend'])); // 默认订阅

  console.log('[ws] 客户端连接: ' + clientId + ' (总计 ' + clients.size + ')');

  // 心跳检测
  let heartbeatTimer = null;
  function resetHeartbeat() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      console.log('[ws] 心跳超时，断开: ' + clientId);
      socket.destroy();
    }, 60000);
  }
  resetHeartbeat();

  let buffer = Buffer.alloc(0);
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    
    // 解析 WebSocket 帧
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const opcode = firstByte & 0x0F;
      const masked = (buffer[1] & 0x80) !== 0;
      let payloadLen = buffer[1] & 0x7F;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) break;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) break;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskLen = masked ? 4 : 0;
      if (buffer.length < offset + maskLen + payloadLen) break;

      let payload;
      if (masked) {
        const maskKey = buffer.slice(offset, offset + 4);
        payload = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          payload[i] = buffer[offset + 4 + i] ^ maskKey[i % 4];
        }
      } else {
        payload = buffer.slice(offset, offset + payloadLen);
      }

      buffer = buffer.slice(offset + maskLen + payloadLen);

      if (opcode === 0x8) { // 关闭
        socket.destroy();
        return;
      } else if (opcode === 0x9) { // ping
        // 回复 pong
        const pong = Buffer.alloc(2);
        pong[0] = 0x8A; // pong frame
        pong[1] = 0x00;
        try { socket.write(pong); } catch (e) {}
        continue;
      } else if (opcode === 0x1) { // 文本
        try {
          const msg = JSON.parse(payload.toString('utf8'));
          if (msg.type === 'subscribe' && Array.isArray(msg.channels)) {
            subscriptions.set(clientId, new Set(msg.channels));
          } else if (msg.type === 'unsubscribe' && Array.isArray(msg.channels)) {
            const subs = subscriptions.get(clientId);
            if (subs) msg.channels.forEach(c => subs.delete(c));
          } else if (msg.type === 'ping') {
            // 客户端心跳
            resetHeartbeat();
            sendToClient(clientId, { type: 'pong', time: Date.now() });
          }
        } catch (e) {
          // 忽略非JSON消息
        }
      }
    }
  });

  socket.on('error', (e) => {
    console.log('[ws] 客户端错误: ' + clientId + ' - ' + e.message);
  });

  socket.on('close', () => {
    clients.forEach(c => {
      if (c.id === clientId) clients.delete(c);
    });
    subscriptions.delete(clientId);
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    console.log('[ws] 客户端断开: ' + clientId + ' (剩余 ' + clients.size + ')');
  });

  // 发送连接成功确认
  setTimeout(() => {
    sendToClient(clientId, { type: 'connected', clientId, time: Date.now() });
  }, 100);
}

/**
 * 发送消息到指定客户端
 */
function sendToClient(clientId, data) {
  const client = [...clients].find(c => c.id === clientId);
  if (!client) return;

  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const frame = createTextFrame(payload);
  try {
    client.socket.write(frame);
  } catch (e) {
    // 客户端已断开
  }
}

/**
 * 广播消息到所有订阅了指定频道的客户端
 */
function broadcast(channel, data) {
  if (clients.size === 0) return;
  
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const frame = createTextFrame(payload);

  clients.forEach(client => {
    const subs = subscriptions.get(client.id);
    if (subs && subs.has(channel)) {
      try {
        client.socket.write(frame);
      } catch (e) {
        // 客户端可能已断开
      }
    }
  });
}

function createTextFrame(payload) {
  const len = payload.length;
  let frame;

  if (len < 126) {
    frame = Buffer.alloc(2 + len);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = len;
    payload.copy(frame, 2);
  } else if (len < 65536) {
    frame = Buffer.alloc(4 + len);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    payload.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + len);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
    payload.copy(frame, 10);
  }

  return frame;
}

// ═══ 服务端心跳 ═══
function startHeartbeat() {
  setInterval(() => {
    if (clients.size === 0) return;
    const ping = Buffer.alloc(2);
    ping[0] = 0x89; // ping frame
    ping[1] = 0x00;
    clients.forEach(client => {
      try { client.socket.write(ping); } catch (e) {}
    });
  }, 30000);
}

// ═══ 数据变更检测与推送 ═══
function startDataWatcher() {
  if (watchInterval) clearInterval(watchInterval);

  watchInterval = setInterval(() => {
    try {
      // 1. 检测 data.json 变更 → 推送比分/推荐更新
      if (fs.existsSync(DATA_FILE)) {
        const stat = fs.statSync(DATA_FILE);
        if (stat.mtimeMs > _lastDataMtime) {
          _lastDataMtime = stat.mtimeMs;
          const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

          // 提取比分数据
          const scores = {};
          Object.entries(data.m || {}).forEach(([k, m]) => {
            if (m && m.matchStatus !== undefined) {
              const mid = k.replace('m_', '');
              scores[mid] = {
                status: m.matchStatus,
                score: m.score || '',
                halfScore: m.halfScore || '',
                duration: m.duration || '',
              };
            }
          });

          broadcast('live_score', { type: 'live_score_update', data: scores, time: new Date().toISOString() });

          // 提取推荐变更
          const recs = {};
          Object.entries(data.r || {}).forEach(([k, r]) => {
            const mid = k.replace('m_', '');
            const hasResult = r.some(rc => rc.result !== null && rc.result !== 2);
            if (hasResult) {
              recs[mid] = r.filter(rc => rc.result !== null && rc.result !== 2)
                .map(rc => ({ type: rc.type, num: rc.num, result: rc.result }));
            }
          });

          if (Object.keys(recs).length > 0) {
            broadcast('recommend', { type: 'recommend_update', data: recs, time: new Date().toISOString() });
          }
        }
      }

      // 2. 检测 live_scores.json 变更
      if (fs.existsSync(LIVE_FILE)) {
        const stat = fs.statSync(LIVE_FILE);
        if (stat.mtimeMs > _lastLiveMtime) {
          _lastLiveMtime = stat.mtimeMs;
          const liveData = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
          broadcast('live_score', { type: 'live_score_refresh', data: liveData, time: new Date().toISOString() });
        }
      }

      // 3. 检测 ai_cache.json 变更
      if (fs.existsSync(AI_CACHE_FILE)) {
        const stat = fs.statSync(AI_CACHE_FILE);
        if (stat.mtimeMs > _lastAICacheMtime) {
          _lastAICacheMtime = stat.mtimeMs;
          const aiData = JSON.parse(fs.readFileSync(AI_CACHE_FILE, 'utf8'));
          const updated = {};
          Object.entries(aiData).forEach(([mid, entry]) => {
            if (entry.content && entry.merged) {
              updated[mid] = { content: entry.content, confidence: entry.confidence };
            }
          });
          if (Object.keys(updated).length > 0) {
            broadcast('ai_analysis', { type: 'ai_analysis_update', data: updated, time: new Date().toISOString() });
          }
        }
      }
    } catch (e) {
      // 静默处理检测错误
    }
  }, 2000); // 每2秒检测一次
}

function getClientCount() {
  return clients.size;
}

/**
 * 初始化 WebSocket（集成到 HTTP server）
 * @param {http.Server} server Express 的 HTTP server 实例
 */
function attachToServer(server) {
  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head);
  });

  startHeartbeat();
  startDataWatcher();

  console.log('[ws] WebSocket 服务已启动 (ws://0.0.0.0:' + (server.address() ? server.address().port : '?') + '/ws)');
}

module.exports = { attachToServer, broadcast, getClientCount };
