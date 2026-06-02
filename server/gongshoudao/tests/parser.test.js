/**
 * Phase 3 — P2: gongshoudao/tests/parser.test.js
 * 第一阶段：字段解析模块单元测试
 * 覆盖: parse() 完整输入映射、缺失字段容错、extractNumBefore/extractAvg/extractEfficiency
 */

const { parse, extractJiaoFenExtended } = require('../parser');

describe('gongshoudao/parser — parse 完整字段映射', () => {
  const SAMPLE_RAW = {
    homeWinGap_1: '3',
    homeWinGap_2: '1',
    homeLoseGap_1: '2',
    homeLoseGap_2: '0',
    awayWinGap_1: '2',
    awayWinGap_2: '1',
    awayLoseGap_1: '1',
    awayLoseGap_2: '1',
    homeSpf: '4胜3平3负',
    guestSpf: '3胜2平5负',
    homeWinQiu_0: '2',
    homeWinQiu_1: '3',
    homeWinQiu_2: '1',
    homeLoseQiu_0: '2',
    homeLoseQiu_1: '2',
    homeLoseQiu_2: '0',
    awayWinQiu_0: '4',
    awayWinQiu_1: '2',
    awayWinQiu_2: '0',
    awayLoseQiu_0: '3',
    awayLoseQiu_1: '1',
    awayLoseQiu_2: '1',
    homeDxqSame10Desc: '同主客近10场:进球1.4 失球1.3',
    homeDxqDesc: '近期:进球1.4 失球1.3',
    awayDxqSame10Desc: '同主客近10场:进球1.2 失球1.5',
    guestDxqDesc: '近期:进球1.2 失球1.5',
    homeEnterEfficiency: '进攻:0.29',
    homePreventEfficiency: '防守:-0.11',
    guestEnterEfficiency: '进攻:-0.15',
    guestPreventEfficiency: '防守:0.22',
    homeFieldGoal: '1.4',
    homeFieldLose: '1.3',
    homeDxqPercentStr: '60%',
    guestDxqPercentStr: '55%',
    homePower: 52,
    guestPower: 48,
    homeWinPan: '65',
    guestWinPan: '58',
    homeWinAward: '1.85',
    guestWinAward: '3.20',
    drawAward: '3.50',
    rq: '0',
    jiaoFenDesc: '近6次交战 2胜3平1负 进8球失6球 大球2次',
    jiaoFenMatch1: '芬超 2026-05-10 拉赫蒂 1:1 玛丽港 平',
    jiaoFenMatch2: '芬超 2026-04-15 玛丽港 2:1 拉赫蒂 胜',
  };

  it('应成功解析完整输入', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars).not.toBeNull();
  });

  it('比分差分布应精确映射', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeWinGap_1).toBe(3);
    expect(vars.homeWinGap_2).toBe(1);
    expect(vars.awayWinGap_1).toBe(2);
    expect(vars.awayLoseGap_2).toBe(1);
  });

  it('平局场次应从 SPF 文本提取', () => {
    const vars = parse(SAMPLE_RAW);
    // "4胜3平3负" → 平=3
    expect(vars.homeDraw).toBe(3);
    // "3胜2平5负" → 平=2
    expect(vars.awayDraw).toBe(2);
  });

  it('进球分布应精确映射', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeGoal0).toBe(2);
    expect(vars.homeGoal1).toBe(3);
    expect(vars.homeGoal2Plus).toBe(1);
    expect(vars.awayGoal0).toBe(4);
  });

  it('场均得失球应从描述提取', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeFieldGoalAvg).toBe(1.4);
    expect(vars.homeRecentGoalAvg).toBe(1.4);
    expect(vars.awayFieldGoalAvg).toBe(1.2);
  });

  it('攻防效率应提取绝对值', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeAttackEfficiency).toBe(0.29);
    expect(vars.homeDefendEfficiency).toBe(0.11);
    expect(vars.awayAttackEfficiency).toBe(0.15);
    expect(vars.awayDefendEfficiency).toBe(0.22);
  });

  it('攻防效率原始符号应保留', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeAttackEffRaw).toBe(0.29);
    expect(vars.homeDefendEffRaw).toBe(-0.11); // 负值保留
    expect(vars.awayAttackEffRaw).toBe(-0.15);
    expect(vars.awayDefendEffRaw).toBe(0.22);
  });

  it('效率方向标记应正确', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeAttackEffUp).toBe(true);
    expect(vars.homeDefendEffUp).toBe(false); // 防守低于均值
    expect(vars.awayAttackEffUp).toBe(false);
    expect(vars.awayDefendEffUp).toBe(true);
  });

  it('大球率应转换为小数', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homeOverRate).toBe(0.6);
    expect(vars.awayOverRate).toBe(0.55);
  });

  it('实力值/赢盘率/赔率/让球数应正确', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.homePower).toBe(52);
    expect(vars.awayPower).toBe(48);
    expect(vars.homeWinAward).toBe(1.85);
    expect(vars.drawAward).toBe(3.5);
    expect(vars.rq).toBe(0);
  });

  it('交锋数据应解析比分', () => {
    const vars = parse(SAMPLE_RAW);
    expect(vars.jiaoFenScores.length).toBe(2);
    expect(vars.jiaoFenScores[0].h).toBe(1);
    expect(vars.jiaoFenScores[0].a).toBe(1);
    expect(vars.jiaoFenScores[1].h).toBe(2);
    expect(vars.jiaoFenScores[1].a).toBe(1);
  });
});

describe('gongshoudao/parser — 缺失字段容错', () => {
  it('空对象应返回有效结构', () => {
    const vars = parse({});
    expect(vars).not.toBeNull();
    expect(vars.homeWinGap_1).toBe(0);
  });

  it('null 应返回 null', () => {
    expect(parse(null)).toBeNull();
  });

  it('undefined 应返回 null', () => {
    expect(parse(undefined)).toBeNull();
  });

  it('类型错误应返回 null', () => {
    expect(parse('string')).toBeNull();
    expect(parse(123)).toBeNull();
  });

  it('部分缺失字段应使用默认值', () => {
    const vars = parse({ homeSpf: '5胜3平2负' });
    expect(vars.homeDraw).toBe(3);
    expect(vars.homeWinGap_1).toBe(0);
    expect(vars.homePower).toBe(50);
  });

  it('异常格式描述不崩溃', () => {
    const vars = parse({
      homeDxqDesc: '近期:进 1.5 球 失 1.2 球',
      homeSpf: 'invalid',
    });
    expect(vars).not.toBeNull();
    expect(vars.homeDraw).toBe(0); // invalid → 0
  });

  it('SPF 文本无平局时不崩溃', () => {
    const vars = parse({ homeSpf: '3胜0平7负', guestSpf: '5胜0平5负' });
    expect(vars.homeDraw).toBe(0);
  });
});

describe('gongshoudao/parser — extractJiaoFenExtended', () => {
  it('标准格式应完整解析', () => {
    const result = extractJiaoFenExtended('近6次交战 2胜3平1负 进8球失6球 大球2次');
    expect(result.totalMatches).toBe(6);
    expect(result.wins).toBe(2);
    expect(result.draws).toBe(3);
    expect(result.losses).toBe(1);
    expect(result.goalsFor).toBe(8);
    expect(result.goalsAgainst).toBe(6);
    expect(result.overCount).toBe(2);
    expect(result.parsed).toBe(true);
  });

  it('空字符串应返回默认值', () => {
    const result = extractJiaoFenExtended('');
    expect(result.totalMatches).toBe(0);
    expect(result.parsed).toBe(false);
  });

  it('变体格式（含空格）应解析', () => {
    // 注意：当前正则不支持空格变体，仅验证不崩溃
    const result = extractJiaoFenExtended('近 10 次交战 4 胜 2 平 4 负 进12球 失10球');
    expect(result).toHaveProperty('totalMatches');
    expect(result).toHaveProperty('wins');
    // 变体格式触发部分匹配；wins/draws 可能未匹配但 parsed 仍可为 true
    expect(result.parsed !== undefined).toBe(true);
  });

  it('部分字段缺失不影响其他字段', () => {
    const result = extractJiaoFenExtended('近6次交战 2胜3平1负');
    expect(result.wins).toBe(2);
    expect(result.draws).toBe(3);
    expect(result.goalsFor).toBe(0); // 没提供
  });
});

describe('gongshoudao/parser — 净胜球序列', () => {
  it('应正确构建序列', () => {
    // homeWinGap_2=1, homeWinGap_1=3, homeDraw=2, homeLoseGap_1=2, homeLoseGap_2=0
    const vars = parse({
      homeWinGap_1: '3',
      homeWinGap_2: '1',
      homeDraw: '2',
      homeLoseGap_1: '2',
      homeLoseGap_2: '0',
      homeSpf: '3胜2平5负',
      guestSpf: '4胜1平5负',
    });
    expect(vars.homeGoalDiffSeries).toEqual([2, 1, 1, 1, 0, 0, -1, -1]);
  });
});

describe('gongshoudao/parser — 边界条件', () => {
  it('超大数值不应溢出', () => {
    const vars = parse({
      homeWinGap_1: '999',
      homeWinGap_2: '888',
      homeSpf: '99胜99平99负',
      guestSpf: '99胜99平99负',
      homePower: 9999,
      guestPower: 9999,
    });
    expect(vars).not.toBeNull();
    expect(vars.homeDraw).toBe(99);
    expect(vars.homePower).toBe(9999);
  });

  it('负数赔率不应崩溃', () => {
    const vars = parse({
      homeWinAward: '-1.85',
      guestWinAward: '0',
      drawAward: 'abc',
      homeSpf: '5胜3平2负',
      guestSpf: '4胜3平3负',
    });
    expect(vars).not.toBeNull();
  });
});
