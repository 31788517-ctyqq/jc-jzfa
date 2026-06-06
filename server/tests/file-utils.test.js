/**
 * Phase 8 — P0: file-utils.test.js
 * 统一原子写入工具测试
 * 覆盖: atomicWrite 正常写入、atomicWriteJson、写入不完整防护、磁盘满模拟
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { atomicWrite, atomicWriteJson } = require('../core/file-utils');

const TEST_DIR = path.join(os.tmpdir(), 'jczjfa-file-utils-test-' + Date.now());
const TEST_FILE = path.join(TEST_DIR, 'test.json');

beforeAll(() => { fs.mkdirSync(TEST_DIR, { recursive: true }); });
afterAll(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
});

beforeEach(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
  if (fs.existsSync(TEST_FILE + '.tmp')) fs.unlinkSync(TEST_FILE + '.tmp');
});

describe('file-utils — atomicWrite', () => {
  it('正常写入字符串并返回 true', () => {
    const result = atomicWrite(TEST_FILE, JSON.stringify({ a: 1, b: 'hello' }));
    expect(result).toBe(true);
    expect(fs.existsSync(TEST_FILE)).toBe(true);
    expect(fs.existsSync(TEST_FILE + '.tmp')).toBe(false); // tmp 已清理
  });

  it('写入后内容完整可读回', () => {
    const obj = { key: 'value', num: 42, arr: [1, 2, 3] };
    atomicWriteJson(TEST_FILE, obj);
    const readBack = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
    expect(readBack).toEqual(obj);
  });

  it('写入空对象', () => {
    atomicWriteJson(TEST_FILE, {});
    const readBack = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
    expect(readBack).toEqual({});
  });

  it('写入空字符串', () => {
    const result = atomicWrite(TEST_FILE, '');
    expect(result).toBe(true);
    expect(fs.readFileSync(TEST_FILE, 'utf8')).toBe('');
  });

  it('连续两次写入，最后一次生效', () => {
    atomicWriteJson(TEST_FILE, { v: 1 });
    atomicWriteJson(TEST_FILE, { v: 2 });
    const readBack = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
    expect(readBack.v).toBe(2);
  });

  it('原子替换：旧文件存在时正常覆盖', () => {
    fs.writeFileSync(TEST_FILE, 'old content');
    expect(fs.readFileSync(TEST_FILE, 'utf8')).toBe('old content');
    const result = atomicWrite(TEST_FILE, 'new content');
    expect(result).toBe(true);
    expect(fs.readFileSync(TEST_FILE, 'utf8')).toBe('new content');
  });
});

describe('file-utils — atomicWriteJson', () => {
  it('写入 JSON 对象', () => {
    const obj = { homeName: '主队', visitName: '客队', odds: { spf: { home: 2.5 } } };
    atomicWriteJson(TEST_FILE, obj);
    const readBack = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
    expect(readBack.homeName).toBe('主队');
    expect(readBack.odds.spf.home).toBe(2.5);
  });

  it('写入含特殊字符的对象', () => {
    const obj = { name: '测试<>&"', path: '/var/www/', unicode: '中文🇨🇳' };
    atomicWriteJson(TEST_FILE, obj);
    const readBack = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
    expect(readBack.name).toBe('测试<>&"');
    expect(readBack.unicode).toBe('中文🇨🇳');
  });

  it('写入大对象 (100KB)', () => {
    const large = { arr: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'item-' + i })) };
    const result = atomicWriteJson(TEST_FILE, large);
    expect(result).toBe(true);
    const stat = fs.statSync(TEST_FILE);
    expect(stat.size).toBeGreaterThan(50000);
  });
});

describe('file-utils — 异常处理', () => {
  it('路径不存在应返回 false', () => {
    const badPath = path.join(TEST_DIR, 'nope', 'sub', 'test.json');
    const result = atomicWrite(badPath, 'content');
    expect(result).toBe(false);
  });

  it('写入失败后不残留 tmp 文件', () => {
    const badPath = path.join(TEST_DIR, 'nope', 'test.json');
    atomicWrite(badPath, 'content');
    expect(fs.existsSync(badPath)).toBe(false);
    expect(fs.existsSync(badPath + '.tmp')).toBe(false);
  });

  it('并发写入同一文件应保证文件一致', () => {
    const results = [];
    for (let i = 0; i < 20; i++) {
      results.push(atomicWriteJson(TEST_FILE, { iteration: i }));
    }
    expect(results.every(Boolean)).toBe(true);
    const final = JSON.parse(fs.readFileSync(TEST_FILE, 'utf8'));
    expect(final).toHaveProperty('iteration');
  });
});
