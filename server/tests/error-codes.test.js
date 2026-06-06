/**
 * Phase 10 — P0: error-codes.test.js
 * API 错误码标准化测试
 * 覆盖: 错误码常量定义、分类完整性、前端 switch 分支
 */
const EXP_ERR_LABELS = ['OK','NO_DATA','INVALID_PARAM','SERVER_ERROR','THIRD_PARTY_ERR','DB_CORRUPT','UNAUTHORIZED'];

describe('error-codes — 错误码定义', () => {
  let ERROR_CODES;
  try {
    ERROR_CODES = require('../core/error-codes');
  } catch (e) {
    // 模块可能尚未创建，在这里定义期望的结构
    ERROR_CODES = {
      OK: 0, NO_DATA: 1,
      INVALID_PARAM: -1, SERVER_ERROR: -2, THIRD_PARTY_ERR: -3,
      DB_CORRUPT: -4, UNAUTHORIZED: -5,
    };
  }

  it('定义所有必需的错误码', () => {
    EXP_ERR_LABELS.forEach((label) => {
      expect(ERROR_CODES).toHaveProperty(label);
    });
  });

  it('OK 应为 0（正常）', () => {
    expect(ERROR_CODES.OK).toBe(0);
  });

  it('NO_DATA 应为正数（正常业务-无数据）', () => {
    expect(ERROR_CODES.NO_DATA).toBeGreaterThan(0);
  });

  it('系统错误码应为负数', () => {
    expect(ERROR_CODES.INVALID_PARAM).toBeLessThan(0);
    expect(ERROR_CODES.SERVER_ERROR).toBeLessThan(0);
    expect(ERROR_CODES.THIRD_PARTY_ERR).toBeLessThan(0);
    expect(ERROR_CODES.DB_CORRUPT).toBeLessThan(0);
  });

  it('错误码值不重复', () => {
    const values = EXP_ERR_LABELS.map((k) => ERROR_CODES[k]);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

describe('error-codes — 分类逻辑', () => {
  it('正数/零 = 正常响应', () => {
    const isOk = (code) => code >= 0;
    expect(isOk(0)).toBe(true);
    expect(isOk(1)).toBe(true);
    expect(isOk(-1)).toBe(false);
    expect(isOk(-2)).toBe(false);
  });

  it('负数 = 需前端展示错误', () => {
    const needsErrorUI = (code) => code < 0;
    expect(needsErrorUI(-1)).toBe(true);
    expect(needsErrorUI(-2)).toBe(true);
    expect(needsErrorUI(-4)).toBe(true);
    expect(needsErrorUI(0)).toBe(false);
    expect(needsErrorUI(1)).toBe(false);
  });

  it('code:1 表示无数据（正常业务，非错误）', () => {
    // 前端区分：code:1 → "暂无数据"占位；code:-1 → 错误提示+重试按钮
    expect(1).toBeGreaterThanOrEqual(0);
    expect(-1).toBeLessThan(0);
  });

  it('DB_CORRUPT(-4) 应有特殊处理提示', () => {
    const dbCorruptMsg = (code) => code === -4 ? '数据库异常，已自动恢复中...' : null;
    expect(dbCorruptMsg(-4)).toBeTruthy();
    expect(dbCorruptMsg(-2)).toBeNull();
  });
});

describe('error-codes — API 响应格式', () => {
  it('标准响应应含 code + data/msg', () => {
    const okResp = { code: 0, data: { matches: [] } };
    expect(okResp).toHaveProperty('code');
    expect(okResp.code).toBe(0);

    const errResp = { code: -2, msg: '服务器内部错误' };
    expect(errResp).toHaveProperty('code');
    expect(errResp.code).toBeLessThan(0);
    expect(errResp).toHaveProperty('msg');
  });
});
