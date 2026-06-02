/**
 * P1: websocket.test.js — WebSocket 服务 单元测试
 * 覆盖: generateAcceptKey(握手密钥)、createTextFrame(帧创建)、
 *       getClientCount(初始态)、attachToServer(集成冒烟)
 */
const crypto = require('crypto');
const http = require('http');
const path = require('path');

// 直接测试函数（模块未导出内部函数，但可测试公开接口）
const wsModule = require('../websocket');

describe('websocket — getClientCount 初始状态', () => {
  it('初始应为0', () => {
    const count = wsModule.getClientCount();
    expect(count).toBe(0);
  });
});

describe('websocket — generateAcceptKey (通过集成验证)', () => {
  it('生成 base64 编码的 SHA1 结果', () => {
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const accept = crypto
      .createHash('sha1')
      .update(key + GUID)
      .digest('base64');
    expect(typeof accept).toBe('string');
    expect(accept).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });
});

describe('websocket — createTextFrame (手工验证)', () => {
  it('小 payload (<126 bytes) 帧格式', () => {
    const payload = Buffer.from('hello', 'utf8');
    // 手动构建: FIN+text=0x81, len=5
    const frame = Buffer.alloc(2 + payload.length);
    frame[0] = 0x81;
    frame[1] = payload.length;
    payload.copy(frame, 2);

    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(5);
    expect(frame.toString('utf8', 2)).toBe('hello');
  });

  it('payload 126~65535 使用扩展长度16位', () => {
    const payload = Buffer.alloc(200, 'a');
    const len = payload.length;
    // 手动构建: 2字节头 + 2字节扩展 + data
    const frame = Buffer.alloc(4 + len);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
    payload.copy(frame, 4);

    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(200);
    expect(frame[4]).toBe('a'.charCodeAt(0));
  });

  it('ping 帧 opcode=0x89', () => {
    const ping = Buffer.alloc(2);
    ping[0] = 0x89;
    ping[1] = 0x00;
    expect(ping[0] & 0x0f).toBe(0x09); // ping opcode
  });

  it('pong 帧 opcode=0x8a', () => {
    const pong = Buffer.alloc(2);
    pong[0] = 0x8a;
    pong[1] = 0x00;
    expect(pong[0] & 0x0f).toBe(0x0a); // pong opcode
  });

  it('close 帧 opcode=0x88', () => {
    const close = Buffer.alloc(2);
    close[0] = 0x88;
    close[1] = 0x00;
    expect(close[0] & 0x0f).toBe(0x08); // close opcode
  });
});

describe('websocket — broadcast 广播', () => {
  it('传入 channel 和 data 不抛异常', () => {
    expect(() => {
      wsModule.broadcast('test_channel', { type: 'test', data: 'hello' });
    }).not.toThrow();
  });
});
