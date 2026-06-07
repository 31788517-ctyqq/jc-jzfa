/**
 * odds-data.js — 赔率测试数据工厂
 * 为 odds-movement、market、odds-tracker 等模块提供标准赔率 fixture
 */

/**
 * 创建标准 SPF 赔率数据
 * @param {string} direction - 'home' | 'draw' | 'away' | 'even'
 * @returns {{home:number, draw:number, away:number}}
 */
function makeSpfOdds(direction) {
  switch (direction) {
    case 'home':
      return { home: 1.80, draw: 3.50, away: 4.50 };
    case 'draw':
      return { home: 2.80, draw: 2.10, away: 3.20 };
    case 'away':
      return { home: 4.50, draw: 3.50, away: 1.80 };
    case 'even':
    default:
      return { home: 2.60, draw: 3.20, away: 2.70 };
  }
}

/**
 * 创建完整赔率快照（兼容 detection 深度网络）
 */
function makeFullOddsSnapshot(overrides) {
  return Object.assign({
    spf: { home: 2.10, draw: 3.30, away: 3.20 },
    rqspf: { home: 4.50, draw: 3.80, away: 1.60 },
    halfFull: {
      hh: 2.80, hd: 5.50, ha: 15.0,
      dh: 4.20, dd: 4.80, da: 5.00,
      ah: 25.0, ad: 12.0, aa: 7.00,
    },
    totalGoals: { 0: 13, 1: 5.25, 2: 3.50, 3: 3.00, 4: 5.30, 5: 10, 6: 25, 7: 50 },
    scores: {
      '1:0': 7.0, '2:0': 8.0, '2:1': 8.5, '3:0': 15, '3:1': 16, '3:2': 30,
      '4:0': 40, '4:1': 45, '4:2': 60, '5:0': 100, '5:1': 120, '5:2': 180,
      '胜其它': 250,
      '0:0': 10, '1:1': 6.5, '2:2': 18, '3:3': 80, '平其它': 300,
      '0:1': 12, '0:2': 25, '1:2': 20, '0:3': 65, '1:3': 55, '2:3': 45,
      '0:4': 180, '1:4': 160, '2:4': 130, '0:5': 500, '1:5': 450, '2:5': 400,
      '负其它': 500,
    },
  }, overrides || {});
}

/**
 * 创建初盘赔率（稍高赔率，模拟开盘）
 */
function makeOpenOdds(overrides) {
  return Object.assign({ home: 2.30, draw: 3.10, away: 3.00 }, overrides || {});
}

/**
 * 创建即时盘赔率（稍低赔率，模拟降水）
 */
function makeLiveOdds(overrides) {
  return Object.assign({ home: 2.00, draw: 3.30, away: 3.80 }, overrides || {});
}

/**
 * V11.0 新增: 深盘让球场景（西班牙让3球 周四203）
 * SPF=null, 仅 RQSPF 有效
 * @returns {{spf:null, rqspf:{home:number,draw:number,away:number,handicap:number}, handicap:number, ...}}
 */
function makeDeepHandicapOdds(overrides) {
  return Object.assign({
    spf: null,
    rqspf: { home: 2.21, draw: 4.20, away: 2.28, handicap: -3 },
    handicap: -3,
    halfFull: {
      hh: 1.16, hd: 40, ha: 150,
      dh: 4.55, dd: 21, da: 60,
      ah: 26, ad: 40, aa: 55,
    },
    totalGoals: { 0: 45, 1: 11.5, 2: 6.3, 3: 4, 4: 4, 5: 5.15, 6: 7.5, '7+': 6.75 },
    scores: {
      '1:0': 12, '2:0': 6.75, '2:1': 14, '3:0': 5.3, '3:1': 11,
      '3:2': 40, '4:0': 6.25, '4:1': 13, '4:2': 50,
      '5:0': 8.5, '5:1': 19, '5:2': 80, '胜其他': 25,
      '0:0': 60, '1:1': 22, '2:2': 50, '3:3': 200, '平其他': 500,
      '0:1': 45, '0:2': 65, '1:2': 35, '0:3': 200, '1:3': 150,
      '2:3': 100, '0:4': 500, '1:4': 500, '2:4': 500,
      '0:5': 500, '1:5': 500, '2:5': 500, '负其他': 500,
    },
  }, overrides || {});
}

/**
 * V11.0 新增: 无 SPF 场景（仅 RQSPF 有效）
 * 用于测试 match-odds handler 的 spf={} 边界
 */
function makeRqspfOnlyOdds(overrides) {
  return Object.assign({
    spf: {},
    rqspf: { home: 2.21, draw: 4.20, away: 2.28, handicap: 0 },
  }, overrides || {});
}

module.exports = {
  makeSpfOdds,
  makeFullOddsSnapshot,
  makeOpenOdds,
  makeLiveOdds,
  makeDeepHandicapOdds,
  makeRqspfOnlyOdds,
};
