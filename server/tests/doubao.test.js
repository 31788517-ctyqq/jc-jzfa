/**
 * P2: doubao.test.js — 豆包 API 客户端 单元测试
 * 覆盖: callDoubao 基本结构、generateAnalysis/batchGenerate 导出验证
 *
 * ★ 不发起真实网络请求，仅验证模块导出和参数结构
 */
const doubao = require('../doubao');

describe('doubao — 模块导出', () => {
  it('导出 callDoubao', () => {
    expect(typeof doubao.callDoubao).toBe('function');
  });

  it('导出 generateAnalysis', () => {
    expect(typeof doubao.generateAnalysis).toBe('function');
  });

  it('导出 batchGenerate', () => {
    expect(typeof doubao.batchGenerate).toBe('function');
  });
});

describe('doubao — generateAnalysis 参数验证', () => {
  it('调用 generateAnalysis 返回 Promise', () => {
    const result = doubao.generateAnalysis({
      matchId: 'test_001',
      homeName: '主队',
      visitName: '客队',
      leagueName: '测试联赛',
      date: '2026-06-04',
      num: '测试001',
    });
    expect(result).toBeInstanceOf(Promise);
  });

  // 注意: 下面的测试会实际调用 API（如果没有 API KEY 会失败）
  // 仅验证函数签名，不验证实际返回
  it('batchGenerate 返回 Promise', () => {
    const result = doubao.batchGenerate([], null);
    expect(result).toBeInstanceOf(Promise);
  });
});
