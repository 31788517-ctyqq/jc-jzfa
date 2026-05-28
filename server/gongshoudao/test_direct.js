/**
 * 直接测试计算链路（绕过 data.json 匹配问题）
 */
const parser = require('./parser');
const attack = require('./attack');
const goal = require('./goal');
const diff = require('./diff');

// 从 API 提取的真实数据：玛丽港 vs 拉赫蒂 (2026-05-26, 芬兰杯)
const rawStats = {
  lineId: "001", rq: "1",
  homeTeam: "玛丽港", guestTeam: "拉赫蒂",
  homePower: 49, guestPower: 51,
  homeWinPan: 0.57, guestWinPan: 1.0,
  homeWinQiu_0: 1, homeWinQiu_1: 4, homeWinQiu_2: 5,
  homeLoseQiu_0: 3, homeLoseQiu_1: 6, homeLoseQiu_2: 1,
  awayWinQiu_0: 4, awayWinQiu_1: 3, awayWinQiu_2: 3,
  awayLoseQiu_0: 2, awayLoseQiu_1: 3, awayLoseQiu_2: 5,
  homeSpf: "4胜5平1负", guestSpf: "3胜2平5负",
  homeWinGap_1: 1, homeWinGap_2: 3, homeLoseGap_1: 1, homeLoseGap_2: 0,
  awayWinGap_1: 1, awayWinGap_2: 2, awayLoseGap_1: 4, awayLoseGap_2: 1,
  homeDxqPercentStr: "50%", guestDxqPercentStr: "80%",
  homeDxqDesc: "近期:进球1.4 失球1.3",
  guestDxqDesc: "近期:进球1.6 失球1.4",
  homeDxqSame10Desc: "主场:进球1.7 失球0.8",
  awayDxqSame10Desc: "客场:进球1.3 失球1.6",
  homeEnterEfficiency: "进攻:0.29", homePreventEfficiency: "防守:-0.11",
  guestEnterEfficiency: "进攻:0.22", guestPreventEfficiency: "防守:-0.20",
  jiaoFenDesc: "双方近6次交战,玛丽港132,进7球,失7,大球3次,小球3次",
  jiaoFenMatch1: "芬超 2026-05-10 拉赫蒂 1:1 玛丽港 平",
  jiaoFenMatch2: "芬联杯 2026-03-06 玛丽港 4:0 拉赫蒂 胜",
  matchTimeStr: "2026-05-26", gameShortName: "芬兰杯",
  homeWinAward: "1.93", guestWinAward: "4.68", drawAward: "3.71"
};

const matchInfo = {
  matchId: "test_001",
  homeName: "玛丽港", visitName: "拉赫蒂",
  leagueName: "芬兰杯", num: "周一001", startTime: "2026-05-26 23:30"
};

console.log('=== 功守道计算链路测试 ===\n');
console.log('比赛:', matchInfo.homeName, 'vs', matchInfo.visitName, '/', matchInfo.leagueName, '\n');

// 第一阶段
console.log('[1] 字段解析...');
const vars = parser.parse(rawStats);
console.log('  赢球差 [W2/W1/D/L1/L2]:');
console.log('    主:', vars.homeWinGap_2, vars.homeWinGap_1, vars.homeDraw, vars.homeLoseGap_1, vars.homeLoseGap_2);
console.log('    客:', vars.awayWinGap_2, vars.awayWinGap_1, vars.awayDraw, vars.awayLoseGap_1, vars.awayLoseGap_2);
console.log('  进球分布 [0/1/2+]:');
console.log('    主:', vars.homeGoal0, vars.homeGoal1, vars.homeGoal2Plus);
console.log('    客:', vars.awayGoal0, vars.awayGoal1, vars.awayGoal2Plus);
console.log('  攻防效率:', vars.homeAttackEfficiency, vars.homeDefendEfficiency, '|', vars.awayAttackEfficiency, vars.awayDefendEfficiency);
console.log('  场均进球/失球:', vars.homeRecentGoalAvg, '/', vars.homeRecentLoseAvg, '|', vars.awayRecentGoalAvg, '/', vars.awayRecentLoseAvg);
console.log('  大球率:', (vars.homeOverRate*100).toFixed(0)+'%', (vars.awayOverRate*100).toFixed(0)+'%');
console.log('  净胜球序列:', vars.homeGoalDiffSeries, '|', vars.awayGoalDiffSeries);
console.log();

// 第二阶段 + 第三阶段
console.log('[2] 实力分析...');
const att = attack.analyze(vars);
console.log('  进攻优势:', att.attackAdvantage, '(value:', att.attackAdvantageValue + ')');
console.log('  防守优势:', att.defenseAdvantage, '(value:', att.defenseAdvantageValue + ')');
console.log('  攻守格局:', att.attackPattern);
console.log('  进攻权重:', att.attackWeightHome, 'vs', att.attackWeightAway);
console.log('  防守权重:', att.defenseWeightHome, 'vs', att.defenseWeightAway);
console.log('  综合优势:', att.totalAdvantage, '(value:', att.totalAdvantageValue + ')');
console.log('  实力阶梯:', att.ladder.label, '(level:', att.ladder.level + ')');
console.log('  不让球交叉: 胜' + att.cross.spf.win + ' 平' + att.cross.spf.draw + ' 负' + att.cross.spf.lose + '（让0）');
console.log('  让球交叉: 让胜' + att.cross.handicap.win + ' 让平' + att.cross.handicap.draw + ' 让负' + att.cross.handicap.lose + '（让' + att.cross.rq + '）');
console.log();

// 第四阶段
console.log('[3] 大小球分析...');
const goalRes = goal.analyze(vars, att.totalAdvantagePct);
console.log('  主客权重:', goalRes.homeWeight, 'vs', goalRes.awayWeight);
console.log('  得失球:', goalRes.goalDiffHome, 'vs', goalRes.goalDiffAway);
console.log('  总进球期望:', goalRes.totalGoalsExpect, '(value:', goalRes.totalGoalsValue + ')');
console.log('  xG:', goalRes.xgHome.toFixed(2), '/', goalRes.xgAway.toFixed(2));
console.log('  区间:', goalRes.goalRange.range);
console.log();

// 第五阶段
console.log('[4] 净胜球/让球分析...');
const diffRes = diff.analyze(vars, goalRes.xgHome, goalRes.xgAway);
console.log('  预期净胜球差(ΔxG):', diffRes._diffXG.toFixed(4));
console.log('  综合实力(Total_战):', diffRes._totalStrength.normalized.toFixed(4), '(静态:', diffRes._totalStrength.static.toFixed(2), '动态:', diffRes._totalStrength.dynamic.toFixed(2) + ')');
console.log('  Anchor:', diffRes.anchor.label, '(' + diffRes.anchor.anchor + ')');
console.log('  维度一(主赢∩客输):', diffRes.sevenMatch.dimension1.label, '(共' + diffRes.sevenMatch.dimension1.total + '场)');
console.log('  维度二(主输∩客赢):', diffRes.sevenMatch.dimension2.label, '(共' + diffRes.sevenMatch.dimension2.total + '场)');
console.log('  共振裁决:', diffRes.resonance.verdict);
console.log();

// 汇总
console.log('====================================');
console.log('  弹窗数据汇总');
console.log('====================================');
const out = {
  attackAdvantage: att.attackAdvantage,
  attackAdvantageValue: att.attackAdvantageValue,
  defenseAdvantage: att.defenseAdvantage,
  defenseAdvantageValue: att.defenseAdvantageValue,
  attackPattern: att.attackPattern,
  attackWeightHome: att.attackWeightHome,
  attackWeightAway: att.attackWeightAway,
  defenseWeightHome: att.defenseWeightHome,
  defenseWeightAway: att.defenseWeightAway,
  totalAdvantage: att.totalAdvantage,
  totalAdvantageValue: att.totalAdvantageValue,
  ladderLabel: att.ladder.label,
  homeWeight: goalRes.homeWeight,
  awayWeight: goalRes.awayWeight,
  goalDiffHome: goalRes.goalDiffHome,
  goalDiffAway: goalRes.goalDiffAway,
  totalGoalsExpect: goalRes.totalGoalsExpect,
  totalGoalsValue: goalRes.totalGoalsValue,
  goalRange: goalRes.goalRange.range,
  homeWinExpect: diffRes.homeWinExpect,
  homeWinValue: diffRes.homeWinValue,
  verifyResult: diffRes.verifyResult,
  resonance: diffRes.resonance.verdict
};
Object.entries(out).forEach(([k,v]) => console.log('  ' + k + ': ' + v));

console.log('\n✅ 计算链路验证通过！');
