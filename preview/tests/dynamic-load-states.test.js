/**
 * P2: dynamic-load-states.test.js
 * 动态加载状态 — 懒加载/API重试/WebSocket/缓存
 *
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const MAIN_FUSION = path.join(__dirname, '..', 'js', 'main-fusion.js');
const API = path.join(__dirname, '..', 'js', 'api.js');
const WS_CLIENT = path.join(__dirname, '..', 'js', 'ws-client.js');
const CHARTS_JS = path.join(__dirname, '..', 'js', 'charts.js');
const PLANS = path.join(__dirname, '..', 'js', 'pages', 'plans.js');

function src(f) {
  const buf = fs.readFileSync(f);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le');
  let s = buf.toString('utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

describe('P2: dynamic-load-states — 动态加载状态', () => {
  // ═══════════════════════════════════════════
  // 1. main-fusion.js 懒加载
  // ═══════════════════════════════════════════
  describe('1. main-fusion.js 模块懒加载', () => {
    const mf = src(MAIN_FUSION);

    it('1.1 _mod 懒加载函数存在', () => {
      expect(mf).toContain('_mod');
    });

    it('1.2 ES 模块原生缓存 + 加载失败重试延迟', () => {
      // _mod() 利用 ES import() 原生缓存，失败后 setTimeout 延迟重试
      expect(mf).toContain('setTimeout');
    });

    it('1.3 动态导入 import() 用法', () => {
      expect(mf).toContain('import(');
    });

    it('1.4 加载失败重试机制', () => {
      expect(mf).toContain('重试');
    });

    it('1.5 预加载模块 _preloadMods', () => {
      expect(mf).toContain('_preloadMods');
    });

    it('1.6 goDetail 懒加载代理', () => {
      expect(mf).toContain('window.goDetail');
    });

    it('1.7 closeAI 懒加载代理', () => {
      expect(mf).toContain('window.closeAI');
    });

    it('1.8 showGongshoudao 懒加载代理', () => {
      expect(mf).toContain('window.showGongshoudao');
    });

    it('1.9 switchTab 函数存在', () => {
      expect(mf).toContain('function switchTab') || expect(mf).toContain('window.switchTab');
    });
  });

  // ═══════════════════════════════════════════
  // 2. api.js API 层
  // ═══════════════════════════════════════════
  describe('2. api.js API 层', () => {
    const ap = src(API);

    it('2.1 api 函数使用 POST + JSON', () => {
      expect(ap).toContain('POST');
      expect(ap).toContain('application/json');
    });

    it('2.2 认证 token 注入 (X-Auth-Token)', () => {
      expect(ap).toContain('X-Auth-Token');
    });

    it('2.3 设备 ID 注入 (X-Device-Id)', () => {
      expect(ap).toContain('X-Device-Id');
    });

    it('2.4 30s 超时 AbortController', () => {
      expect(ap).toContain('AbortController') || expect(ap).toContain('30000');
    });

    it('2.5 重试逻辑 retries', () => {
      expect(ap).toContain('retries');
    });

    it('2.6 code=401 时触发 auth:unauthorized', () => {
      expect(ap).toContain('401');
      expect(ap).toContain('auth:unauthorized');
    });

    it('2.7 pending 响应透传', () => {
      expect(ap).toContain('pending');
    });
  });

  // ═══════════════════════════════════════════
  // 3. ws-client.js WebSocket
  // ═══════════════════════════════════════════
  describe('3. ws-client.js WebSocket', () => {
    const ws = src(WS_CLIENT);

    it('3.1 initWS 初始化函数', () => {
      expect(ws).toContain('export function initWS');
    });

    it('3.2 WebSocket 连接 URL 构建', () => {
      expect(ws).toContain('WebSocket');
      expect(ws).toContain('ws://') || expect(ws).toContain('wss://');
    });

    it('3.3 断线重连逻辑 scheduleReconnect', () => {
      expect(ws).toContain('reconnect');
    });

    it('3.4 指数退避重连 MAX_RECONNECT_DELAY', () => {
      expect(ws).toContain('MAX_RECONNECT_DELAY') || expect(ws).toContain('30000');
    });

    it('3.5 事件回调 onScoreUpdate', () => {
      expect(ws).toContain('onScoreUpdate');
    });

    it('3.6 事件回调 onRecommendUpdate', () => {
      expect(ws).toContain('onRecommendUpdate');
    });

    it('3.7 事件回调 onStatusChange', () => {
      expect(ws).toContain('onStatusChange');
    });

    it('3.8 ping/pong 心跳机制', () => {
      expect(ws).toContain('ping') || expect(ws).toContain('Interval');
    });

    it('3.9 比分缓存 _scoreCache 去重', () => {
      expect(ws).toContain('_scoreCache');
    });
  });

  // ═══════════════════════════════════════════
  // 4. charts.js ECharts 懒加载
  // ═══════════════════════════════════════════
  describe('4. charts.js ECharts 懒加载', () => {
    const ch = src(CHARTS_JS);

    it('4.1 echartsReady 未就绪时等待', () => {
      expect(ch).toContain('echartsReady');
    });

    it('4.2 等待队列 echartsWaiters', () => {
      expect(ch).toContain('echartsWaiters');
    });

    it('4.3 加载成功后 resolve 等待队列', () => {
      expect(ch).toContain('resolve') || expect(ch).toContain('resolve');
    });
  });

  // ═══════════════════════════════════════════
  // 5. sessionStorage/localStorage 缓存
  // ═══════════════════════════════════════════
  describe('5. 缓存策略', () => {
    it('5.1 main-fusion 有缓存机制', () => {
      const mf = src(MAIN_FUSION);
      expect(mf).toContain('cache') || expect(mf).toContain('Cache') || expect(mf).toContain('Storage');
    });

    it('5.2 api.js 有 token 缓存', () => {
      const ap = src(API);
      expect(ap).toContain('getAuthToken');
    });

    it('5.3 plans 方案列表有缓存策略', () => {
      const pl = src(PLANS);
      expect(pl).toContain('getCache') || expect(pl).toContain('setCache') || expect(pl).toContain('sessionStorage');
    });
  });
});
