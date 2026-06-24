/**
 * server/core/redis-client.js — Redis 共享缓存客户端
 *
 * 用途:
 *   - 跨 API 实例共享缓存 (cluster:3 前提条件)
 *   - Session 热点缓存 (减少 DB 查询)
 *   - API 响应缓存 (home-bundle/match-list/plan-list)
 *   - 限流计数器 (令牌桶)
 *
 * 降级策略:
 *   - Redis 不可用时自动降级到内存缓存 (Map)
 *   - 不阻断主流程，仅影响缓存命中率
 *   - 日志提示降级状态
 *
 * 配置 (server/.env):
 *   REDIS_HOST=127.0.0.1
 *   REDIS_PORT=6379
 *   REDIS_PASSWORD= (可选)
 *   REDIS_DB=0
 *   REDIS_ENABLED=true (false 则直接用内存模式)
 */

const net = require('net');

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';
const REDIS_DB = parseInt(process.env.REDIS_DB || '0', 10);
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';
// ★ P2 调试: 打印 REDIS 配置（启动时）
console.log('[redis] 配置: ENABLED=' + REDIS_ENABLED + ' HOST=' + REDIS_HOST + ':' + REDIS_PORT + ' DB=' + REDIS_DB);

// ═══ 内存降级缓存 ═══
const _memCache = new Map();
const _memTTL = new Map();
const _memCounters = new Map();

function _memGet(key) {
  const ttl = _memTTL.get(key);
  if (ttl && Date.now() > ttl) {
    _memCache.delete(key);
    _memTTL.delete(key);
    return null;
  }
  return _memCache.get(key) || null;
}

function _memSet(key, value, ttlMs) {
  _memCache.set(key, value);
  if (ttlMs > 0) {
    _memTTL.set(key, Date.now() + ttlMs);
  } else {
    _memTTL.delete(key);
  }
}

function _memDel(key) {
  _memCache.delete(key);
  _memTTL.delete(key);
}

// ═══ Redis 协议 (RESP) 轻量实现 ═══
// 不依赖 ioredis/redis 库，用原生 net 实现 PING/GET/SET/DEL/EXPIRE/INCR/EXISTS

let _socket = null;
let _connected = false;
let _connecting = false;
const _commandQueue = [];
let _responseBuffer = '';
let _currentResolver = null;
let _currentRejecter = null;
let _degraded = !REDIS_ENABLED;
let _lastConnectAttempt = 0;
const RECONNECT_INTERVAL = 10000; // 10 秒重试

function _encodeCommand(...args) {
  let cmd = '*' + args.length + '\r\n';
  for (const arg of args) {
    const s = String(arg);
    cmd += '$' + Buffer.byteLength(s) + '\r\n' + s + '\r\n';
  }
  return cmd;
}

function _parseResponse(buf) {
  // 简化 RESP 解析：支持 +OK / -ERR / :int / $bulk / *array
  if (buf.length === 0) return { value: null, consumed: 0, incomplete: true };

  const firstChar = buf[0];
  const lineEnd = buf.indexOf('\r\n');
  if (lineEnd < 0) return { value: null, consumed: 0, incomplete: true };

  const line = buf.slice(1, lineEnd).toString('utf8');
  const consumed = lineEnd + 2;

  if (firstChar === 0x2b) {
    // + Simple String
    return { value: line, consumed };
  }
  if (firstChar === 0x2d) {
    // - Error
    return { value: new Error(line), consumed, isError: true };
  }
  if (firstChar === 0x3a) {
    // : Integer
    return { value: parseInt(line, 10), consumed };
  }
  if (firstChar === 0x24) {
    // $ Bulk String
    const len = parseInt(line, 10);
    if (len < 0) return { value: null, consumed };
    const dataEnd = consumed + len + 2;
    if (buf.length < dataEnd) return { value: null, consumed: 0, incomplete: true };
    return { value: buf.slice(consumed, consumed + len).toString('utf8'), consumed: dataEnd };
  }
  if (firstChar === 0x2a) {
    // * Array
    const count = parseInt(line, 10);
    if (count < 0) return { value: null, consumed };
    let offset = consumed;
    const arr = [];
    for (let i = 0; i < count; i++) {
      const sub = _parseResponse(buf.slice(offset));
      if (sub.incomplete) return { value: null, consumed: 0, incomplete: true };
      arr.push(sub.value);
      offset += sub.consumed;
    }
    return { value: arr, consumed: offset };
  }

  return { value: null, consumed, isError: false };
}

function _connect() {
  if (_connected || _connecting || _degraded) return Promise.resolve();
  if (Date.now() - _lastConnectAttempt < RECONNECT_INTERVAL) return Promise.resolve();
  _connecting = true;
  _lastConnectAttempt = Date.now();

  return new Promise((resolve) => {
    try {
      _socket = net.createConnection(REDIS_PORT, REDIS_HOST);

      _socket.on('connect', () => {
        _socket.setTimeout(10000);

        // ★ 逐条发送 AUTH 和 SELECT，避免合并发送时 AUTH 响应被混淆
        let _initBuffer = '';
        let initPhase = REDIS_PASSWORD ? 0 : 1; // 0=等待AUTH响应, 1=等待SELECT响应, 2=完成
        const onDataInit = (data) => {
          _initBuffer += data.toString('utf8');
          const lines = _initBuffer.split('\r\n').filter(l => l.length > 0);

          for (const line of lines) {
            if (initPhase === 0) {
              // AUTH 响应
              // AUTH 成功，发送 SELECT
              if (line.startsWith('-')) {
                console.warn('[redis] AUTH失败: ' + line);
                _socket.removeListener('data', onDataInit);
                _connecting = false;
                _connected = false;
                _degraded = true;
                resolve();
                return;
              }
              initPhase = 1;
              _initBuffer = '';
              _socket.write(_encodeCommand('SELECT', REDIS_DB));
              return; // 等待下一个 data 事件
            } else if (initPhase === 1) {
              // SELECT 响应
              // SELECT 成功
              initPhase = 2;
              _socket.removeListener('data', onDataInit);
              _connecting = false;
              _connected = true;
              _degraded = false;
              _socket.setTimeout(0);

              // 切换到正常数据处理模式
              _socket.on('data', (d) => {
                _responseBuffer += d.toString('binary');
                _processBuffer();
              });

              console.log('[redis] 已连接 ' + REDIS_HOST + ':' + REDIS_PORT + ' DB=' + REDIS_DB);

              const queue = _commandQueue.splice(0);
              queue.forEach(function (item) {
                _exec(item.cmd, item.resolve, item.reject);
              });
              resolve();
              return;
            }
          }
        };
        _socket.on('data', onDataInit);

        // 发送第一条命令
        if (REDIS_PASSWORD) {
          _socket.write(_encodeCommand('AUTH', REDIS_PASSWORD));
        } else {
          _socket.write(_encodeCommand('SELECT', REDIS_DB));
        }

        // 超时保护
        setTimeout(() => {
          if (!_connected) {
            try { _socket.removeListener('data', onDataInit); } catch (_) {}
            _connecting = false;
            _degraded = true;
            console.warn('[redis] AUTH初始化超时，降级到内存缓存');
            resolve();
          }
        }, 10000);
      });

      _socket.on('error', (e) => {
        _connecting = false;
        _connected = false;
        if (!_degraded) {
          console.warn('[redis] 连接失败，降级到内存缓存: ' + e.message);
          _degraded = true;
        }
        // 排空队列，用内存模式执行
        const queue = _commandQueue.splice(0);
        queue.forEach(function (item) {
          _execMem(item.cmd, item.resolve, item.reject);
        });
        resolve();
      });

      _socket.on('close', () => {
        _connecting = false;
        _connected = false;
        if (!_degraded) {
          console.warn('[redis] 连接断开，降级到内存缓存');
          _degraded = true;
        }
      });

      // ★ 不在这里注册 data 监听器，等 init 完成后在 on('connect') 中注册
      // 防止 init 阶段的 AUTH 响应被当作命令响应处理

      _socket.on('timeout', () => {
        console.warn('[redis] 连接超时，降级到内存缓存');
        _socket.destroy();
        _connecting = false;
        _connected = false;
        _degraded = true;
        resolve();
      });
    } catch (e) {
      _connecting = false;
      _degraded = true;
      resolve();
    }
  });
}

function _processBuffer() {
  if (!_currentResolver) return;
  const buf = Buffer.from(_responseBuffer, 'binary');
  const result = _parseResponse(buf);
  if (result.incomplete) return;
  _responseBuffer = _responseBuffer.slice(result.consumed);
  if (result.isError) {
    _currentRejecter(result.value);
  } else {
    _currentResolver(result.value);
  }
  _currentResolver = null;
  _currentRejecter = null;
  // 处理下一条
  if (_commandQueue.length > 0 && _connected) {
    const next = _commandQueue.shift();
    _exec(next.cmd, next.resolve, next.reject);
  }
}

function _exec(cmd, resolve, reject) {
  if (!_connected || !_socket || _socket.destroyed) {
    _execMem(cmd, resolve, reject);
    return;
  }
  if (_currentResolver) {
    _commandQueue.push({ cmd, resolve, reject });
    return;
  }
  _currentResolver = resolve;
  _currentRejecter = reject;
  try {
    _socket.write(cmd);
  } catch (e) {
    _currentResolver = null;
    _currentRejecter = null;
    _execMem(cmd, resolve, reject);
  }
}

function _execMem(cmd, resolve, reject) {
  // 解析命令用于内存模式
  const lines = cmd.split('\r\n');
  const args = [];
  for (let i = 2; i < lines.length; i += 2) {
    if (lines[i] && lines[i].startsWith('$')) args.push(lines[i + 1] || '');
  }
  const op = (args[0] || '').toUpperCase();
  const key = args[1];

  if (op === 'GET') {
    const val = _memGet(key);
    resolve(val);
  } else if (op === 'SET') {
    let ttlMs = 0;
    if (args[3] === 'PX') ttlMs = parseInt(args[4], 10);
    _memSet(key, args[2], ttlMs);
    resolve('OK');
  } else if (op === 'DEL') {
    _memDel(key);
    resolve(1);
  } else if (op === 'INCR') {
    const v = (_memCounters.get(key) || 0) + 1;
    _memCounters.set(key, v);
    resolve(v);
  } else if (op === 'EXPIRE') {
    const ttl = parseInt(args[2], 10) * 1000;
    if (_memCache.has(key)) {
      _memTTL.set(key, Date.now() + ttl);
    }
    resolve(1);
  } else if (op === 'EXISTS') {
    resolve(_memCache.has(key) ? 1 : 0);
  } else if (op === 'PING') {
    resolve('PONG');
  } else {
    resolve(null);
  }
}

// ═══ 公开 API ═══

/**
 * 初始化 Redis 连接（异步，不阻塞）
 */
function init() {
  if (!REDIS_ENABLED) {
    console.log('[redis] REDIS_ENABLED=false，使用内存缓存模式');
    return Promise.resolve();
  }
  return _connect().catch(() => {});
}

/**
 * GET key
 * @returns {Promise<string|null>}
 */
function get(key) {
  return new Promise((resolve, reject) => {
    _exec(_encodeCommand('GET', key), resolve, reject);
  });
}

/**
 * SET key value [PX ttlMs]
 */
function set(key, value, ttlMs) {
  return new Promise((resolve, reject) => {
    if (ttlMs > 0) {
      _exec(_encodeCommand('SET', key, value, 'PX', ttlMs), resolve, reject);
    } else {
      _exec(_encodeCommand('SET', key, value), resolve, reject);
    }
  });
}

/**
 * 获取 JSON 值（自动 parse）
 */
async function getJSON(key) {
  const val = await get(key);
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch (e) {
    return null;
  }
}

/**
 * 设置 JSON 值（自动 stringify）
 */
async function setJSON(key, value, ttlMs) {
  return set(key, JSON.stringify(value), ttlMs);
}

/**
 * DEL key
 */
function del(key) {
  return new Promise((resolve, reject) => {
    _exec(_encodeCommand('DEL', key), resolve, reject);
  });
}

/**
 * INCR key (原子计数器，用于限流)
 */
function incr(key) {
  return new Promise((resolve, reject) => {
    _exec(_encodeCommand('INCR', key), resolve, reject);
  });
}

/**
 * EXISTS key
 */
function exists(key) {
  return new Promise((resolve, reject) => {
    _exec(_encodeCommand('EXISTS', key), resolve, reject);
  });
}

/**
 * 是否已降级到内存模式
 */
function isDegraded() {
  return _degraded;
}

/**
 * 是否已连接 Redis
 */
function isConnected() {
  return _connected && !_degraded;
}

/**
 * 关闭连接
 */
function close() {
  if (_socket) {
    try {
      _socket.destroy();
    } catch (e) {}
  }
  _connected = false;
}

module.exports = {
  init,
  get,
  set,
  getJSON,
  setJSON,
  del,
  incr,
  exists,
  isDegraded,
  isConnected,
  close,
};
